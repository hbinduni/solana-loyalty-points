package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"orbit/server/internal/chain"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/programs/system"
	token "github.com/gagliardetto/solana-go/programs/token-2022"
	"github.com/gagliardetto/solana-go/rpc"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func keypair(file string) (solana.PrivateKey, error) {
	if _, err := os.Stat(file); err == nil {
		return solana.PrivateKeyFromSolanaKeygenFile(file)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return nil, err
	}
	key := solana.NewWallet().PrivateKey
	ints := make([]int, len(key))
	for i, b := range key {
		ints[i] = int(b)
	}
	raw, err := json.Marshal(ints)
	if err != nil {
		return nil, err
	}
	f, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	_, writeErr := f.Write(raw)
	closeErr := f.Close()
	if writeErr != nil {
		return nil, writeErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	return key, nil
}

func run() error {
	authorityFile := flag.String("keypair", "../.local/authority.json", "Devnet authority keypair file")
	mintFile := flag.String("mint-keypair", "../.local/mint.json", "Mint keypair file; reuse on retry")
	create := flag.Bool("create-mint", false, "Create the non-transferable Devnet mint using the funded authority")
	endpoint := flag.String("rpc", "https://api.devnet.solana.com", "Solana Devnet RPC URL")
	flag.Parse()
	authority, err := keypair(*authorityFile)
	if err != nil {
		return err
	}
	fmt.Println("Authority:", authority.PublicKey())
	if !*create {
		fmt.Println("Fund this address with Devnet SOL, then run again with -create-mint.")
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client := rpc.New(*endpoint)
	if err = chain.CheckDevnet(ctx, client); err != nil {
		return err
	}
	mint, err := keypair(*mintFile)
	if err != nil {
		return err
	}
	existing, err := client.GetAccountInfoWithOpts(ctx, mint.PublicKey(), &rpc.GetAccountInfoOpts{Commitment: rpc.CommitmentFinalized})
	if err != nil && !errors.Is(err, rpc.ErrNotFound) {
		return err
	}
	if err == nil && existing.Value != nil {
		configured, e := chain.New(*endpoint, mint.PublicKey().String(), *authorityFile)
		if e != nil {
			return e
		}
		if e = configured.Validate(ctx); e != nil {
			return e
		}
		fmt.Println("Existing mint:", mint.PublicKey())
		return nil
	}
	// Token-2022 extended mints use the 165-byte base account boundary, one account-type byte and a four-byte zero-length marker.
	size := uint64(token.ACCOUNT_SIZE + 1 + 4)
	rent, err := client.GetMinimumBalanceForRentExemption(ctx, size, rpc.CommitmentFinalized)
	if err != nil {
		return err
	}
	hash, err := client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return err
	}
	initMint, err := token.NewInitializeMint2InstructionBuilder().SetDecimals(0).SetMintAuthority(authority.PublicKey()).SetMintAccount(mint.PublicKey()).ValidateAndBuild()
	if err != nil {
		return err
	}
	tx, err := solana.NewTransaction([]solana.Instruction{
		system.NewCreateAccountInstruction(rent, size, token.ProgramID, authority.PublicKey(), mint.PublicKey()).Build(),
		token.NewInitializeNonTransferableMintInstruction(mint.PublicKey()).Build(), initMint,
	}, hash.Value.Blockhash, solana.TransactionPayer(authority.PublicKey()))
	if err != nil {
		return err
	}
	if _, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		if key == authority.PublicKey() {
			return &authority
		}
		if key == mint.PublicKey() {
			return &mint
		}
		return nil
	}); err != nil {
		return err
	}
	fmt.Println("Mint:", mint.PublicKey())
	fmt.Println("Transaction:", tx.Signatures[0])
	if _, err = client.SendTransactionWithOpts(ctx, tx, rpc.TransactionOpts{PreflightCommitment: rpc.CommitmentFinalized}); err != nil {
		return fmt.Errorf("submission unresolved; inspect the printed transaction before retrying: %w", err)
	}
	checker := &chain.Client{RPC: client}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("finalization not observed; inspect the printed transaction: %w", ctx.Err())
		case <-ticker.C:
			state, e := checker.State(ctx, tx.Signatures[0].String(), hash.Value.LastValidBlockHeight)
			if e != nil {
				continue
			}
			if state == "confirmed" {
				fmt.Printf("Finalized. Set SOLANA_MINT=%s and SOLANA_AUTHORITY_KEYPAIR=%s in server/.env.\n", mint.PublicKey(), *authorityFile)
				return nil
			}
			if state == "failed" || state == "expired" {
				return fmt.Errorf("mint creation %s; inspect the printed transaction", state)
			}
		}
	}
}
