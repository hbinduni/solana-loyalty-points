package chain

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/gagliardetto/solana-go"
	ata "github.com/gagliardetto/solana-go/programs/associated-token-account"
	compute "github.com/gagliardetto/solana-go/programs/compute-budget"
	token "github.com/gagliardetto/solana-go/programs/token-2022"
	"github.com/gagliardetto/solana-go/rpc"
)

const DevnetGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"

type Prepared struct {
	Message                []byte
	Transaction, Signature string
	LastHeight             uint64
}
type Gateway interface {
	Ready() bool
	MintAddress() string
	Balance(context.Context, string) (uint64, error)
	Prepare(context.Context, string, string, uint64, string) (Prepared, error)
	State(context.Context, string, uint64) (string, error)
	Send(context.Context, string) error
}

type Client struct {
	RPC       *rpc.Client
	Mint      solana.PublicKey
	Authority solana.PrivateKey
}

func New(endpoint, mint, keyfile string) (*Client, error) {
	c := &Client{RPC: rpc.New(endpoint)}
	if mint == "" {
		return c, nil
	}
	var err error
	c.Mint, err = solana.PublicKeyFromBase58(mint)
	if err != nil {
		return nil, fmt.Errorf("invalid SOLANA_MINT: %w", err)
	}
	c.Authority, err = solana.PrivateKeyFromSolanaKeygenFile(keyfile)
	if err != nil {
		return nil, fmt.Errorf("read authority keypair: %w", err)
	}
	return c, nil
}

func (c *Client) Ready() bool { return len(c.Authority) == 64 && !c.Mint.IsZero() }
func (c *Client) MintAddress() string {
	if !c.Ready() {
		return ""
	}
	return c.Mint.String()
}

func CheckDevnet(ctx context.Context, client *rpc.Client) error {
	genesis, err := client.GetGenesisHash(ctx)
	if err != nil {
		return err
	}
	if genesis.String() != DevnetGenesis {
		return errors.New("this application is restricted to Solana Devnet")
	}
	return nil
}

func (c *Client) Validate(ctx context.Context) error {
	if !c.Ready() {
		return nil
	}
	if err := CheckDevnet(ctx, c.RPC); err != nil {
		return err
	}
	info, err := c.RPC.GetAccountInfoWithOpts(ctx, c.Mint, &rpc.GetAccountInfoOpts{Commitment: rpc.CommitmentFinalized})
	if err != nil {
		return err
	}
	if info.Value == nil || info.Value.Owner != token.ProgramID {
		return errors.New("mint must be owned by Token-2022")
	}
	m, extensions, err := token.ParseMintWithExtensions(info.Value.Data.GetBinary())
	if err != nil {
		return err
	}
	if !m.IsInitialized || m.Decimals != 0 || len(extensions) != 1 || extensions[0].Type != token.ExtensionNonTransferable || extensions[0].Length != 0 {
		return errors.New("mint must be initialized, non-transferable, and have zero decimals")
	}
	if m.MintAuthority == nil || *m.MintAuthority != c.Authority.PublicKey() {
		return errors.New("configured keypair is not the mint authority")
	}
	// Extra extensions can change burn semantics; accept only the program this app creates.
	if m.FreezeAuthority != nil {
		return errors.New("mint has unsupported authorities or extensions")
	}
	return nil
}

func (c *Client) Balance(ctx context.Context, wallet string) (uint64, error) {
	if !c.Ready() {
		return 0, errors.New("Devnet mint is not configured")
	}
	owner, err := solana.PublicKeyFromBase58(wallet)
	if err != nil {
		return 0, err
	}
	account, _, err := solana.FindAssociatedTokenAddressWithProgram(owner, c.Mint, token.ProgramID)
	if err != nil {
		return 0, err
	}
	result, err := c.RPC.GetAccountInfoWithOpts(ctx, account, &rpc.GetAccountInfoOpts{Commitment: rpc.CommitmentFinalized})
	if errors.Is(err, rpc.ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if result.Value == nil {
		return 0, nil
	}
	if result.Value.Owner != token.ProgramID {
		return 0, errors.New("unexpected token account owner")
	}
	state, _, err := token.ParseAccountWithExtensions(result.Value.Data.GetBinary())
	if err != nil {
		return 0, err
	}
	if state.Mint != c.Mint || state.Owner != owner {
		return 0, errors.New("unexpected token account")
	}
	return state.Amount, nil
}

func memo(id string) solana.Instruction {
	return solana.NewInstruction(solana.MemoProgramID, nil, []byte("orbit:"+id))
}

func BuildBurn(owner, mint solana.PublicKey, amount uint64, id string, hash solana.Hash) (*solana.Transaction, error) {
	account, _, err := solana.FindAssociatedTokenAddressWithProgram(owner, mint, token.ProgramID)
	if err != nil {
		return nil, err
	}
	burn, err := token.NewBurnCheckedInstruction(amount, 0, account, mint, owner, nil).ValidateAndBuild()
	if err != nil {
		return nil, err
	}
	// Explicit fees prevent wallets from adding budget instructions after the API
	// records the exact message. This Devnet budget caps the priority fee at 200 lamports.
	price := compute.NewSetComputeUnitPriceInstruction(1000).Build()
	limit := compute.NewSetComputeUnitLimitInstruction(200000).Build()
	return solana.NewTransaction([]solana.Instruction{price, limit, burn, memo(id)}, hash, solana.TransactionPayer(owner))
}

func (c *Client) Prepare(ctx context.Context, kind, wallet string, amount uint64, id string) (Prepared, error) {
	var p Prepared
	if !c.Ready() {
		return p, errors.New("Devnet mint is not configured")
	}
	owner, err := solana.PublicKeyFromBase58(wallet)
	if err != nil {
		return p, err
	}
	hash, err := c.RPC.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return p, err
	}
	var tx *solana.Transaction
	switch kind {
	case "redeem":
		tx, err = BuildBurn(owner, c.Mint, amount, id, hash.Value.Blockhash)
	case "earn":
		account, _, e := solana.FindAssociatedTokenAddressWithProgram(owner, c.Mint, token.ProgramID)
		if e != nil {
			return p, e
		}
		create, e := ata.NewCreateIdempotentInstructionBuilder().SetPayer(c.Authority.PublicKey()).SetWallet(owner).SetMint(c.Mint).SetTokenProgram(token.ProgramID).ValidateAndBuild()
		if e != nil {
			return p, e
		}
		mint, e := token.NewMintToCheckedInstruction(amount, 0, c.Mint, account, c.Authority.PublicKey(), nil).ValidateAndBuild()
		if e != nil {
			return p, e
		}
		tx, err = solana.NewTransaction([]solana.Instruction{create, mint, memo(id)}, hash.Value.Blockhash, solana.TransactionPayer(c.Authority.PublicKey()))
	default:
		return p, errors.New("unsupported operation")
	}
	if err != nil {
		return p, err
	}
	if kind == "earn" {
		if _, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
			if key == c.Authority.PublicKey() {
				return &c.Authority
			}
			return nil
		}); err != nil {
			return p, err
		}
		p.Signature = tx.Signatures[0].String()
	}
	p.Message, err = tx.Message.MarshalBinary()
	if err != nil {
		return p, err
	}
	raw, err := tx.MarshalBinary()
	if err != nil {
		return p, err
	}
	p.Transaction = base64.StdEncoding.EncodeToString(raw)
	p.LastHeight = hash.Value.LastValidBlockHeight
	return p, nil
}

func VerifySigned(expected []byte, encoded string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(raw) > 1232 {
		return "", errors.New("invalid signed transaction")
	}
	tx, err := solana.TransactionFromBytes(raw)
	if err != nil {
		return "", errors.New("invalid signed transaction")
	}
	message, err := tx.Message.MarshalBinary()
	if err != nil || !bytes.Equal(expected, message) {
		return "", errors.New("wallet changed the requested transaction")
	}
	if err = tx.VerifySignatures(); err != nil || len(tx.Signatures) != 1 {
		return "", errors.New("invalid wallet signature")
	}
	return tx.Signatures[0].String(), nil
}

func (c *Client) Send(ctx context.Context, encoded string) error {
	_, err := c.RPC.SendEncodedTransactionWithOpts(ctx, encoded, rpc.TransactionOpts{SkipPreflight: false, PreflightCommitment: rpc.CommitmentFinalized})
	return err
}

func (c *Client) State(ctx context.Context, signature string, lastHeight uint64) (string, error) {
	// Read height first so a stale status response cannot expire a transaction early.
	height, err := c.RPC.GetBlockHeight(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return "", err
	}
	if signature != "" {
		sig, err := solana.SignatureFromBase58(signature)
		if err != nil {
			return "", err
		}
		result, err := c.RPC.GetSignatureStatuses(ctx, true, sig)
		if err != nil {
			return "", err
		}
		if len(result.Value) != 1 {
			return "", errors.New("missing signature status result")
		}
		if status := result.Value[0]; status != nil {
			if status.ConfirmationStatus == rpc.ConfirmationStatusFinalized {
				if status.Err != nil {
					return "failed", nil
				}
				return "confirmed", nil
			}
			return "pending", nil
		}
	}
	if height > lastHeight {
		return "expired", nil
	}
	return "pending", nil
}
