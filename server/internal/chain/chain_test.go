package chain

import (
	"encoding/base64"
	"encoding/binary"
	"testing"

	"github.com/gagliardetto/solana-go"
	compute "github.com/gagliardetto/solana-go/programs/compute-budget"
	token "github.com/gagliardetto/solana-go/programs/token-2022"
)

func TestRedemptionRequiresExactMessageAndOwnerSignature(t *testing.T) {
	owner := solana.NewWallet()
	mint := solana.NewWallet().PublicKey()
	tx, err := BuildBurn(owner.PublicKey(), mint, 250, "redemption-1", solana.Hash{1})
	if err != nil {
		t.Fatal(err)
	}
	expected, err := tx.Message.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey { return &owner.PrivateKey }); err != nil {
		t.Fatal(err)
	}
	raw, err := tx.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = VerifySigned(expected, base64.StdEncoding.EncodeToString(raw)); err != nil {
		t.Fatal(err)
	}
	tx.Message.RecentBlockhash = solana.Hash{2}
	raw, _ = tx.MarshalBinary()
	if _, err = VerifySigned(expected, base64.StdEncoding.EncodeToString(raw)); err == nil {
		t.Fatal("accepted modified transaction")
	}
	tx.Message.RecentBlockhash = solana.Hash{1}
	tx.Signatures[0] = solana.Signature{}
	raw, _ = tx.MarshalBinary()
	if _, err = VerifySigned(expected, base64.StdEncoding.EncodeToString(raw)); err == nil {
		t.Fatal("accepted unsigned transaction")
	}
}

func TestBurnUsesToken2022AndUniqueMemo(t *testing.T) {
	owner := solana.NewWallet().PublicKey()
	mint := solana.NewWallet().PublicKey()
	tx, err := BuildBurn(owner, mint, 500, "unique-redemption", solana.Hash{1})
	if err != nil {
		t.Fatal(err)
	}
	if tx.Message.AccountKeys[0] != owner {
		t.Fatal("member must pay and authorize burn")
	}
	if len(tx.Message.Instructions) != 4 {
		t.Fatal("expected explicit compute price, compute limit, burn and memo")
	}
	price, limit := tx.Message.Instructions[0], tx.Message.Instructions[1]
	if tx.Message.AccountKeys[price.ProgramIDIndex] != compute.ProgramID || len(price.Accounts) != 0 || len(price.Data) != 9 || price.Data[0] != 3 || binary.LittleEndian.Uint64(price.Data[1:]) != 1000 {
		t.Fatal("expected explicit 1000 micro-lamports per compute unit")
	}
	if tx.Message.AccountKeys[limit.ProgramIDIndex] != compute.ProgramID || len(limit.Accounts) != 0 || len(limit.Data) != 5 || limit.Data[0] != 2 || binary.LittleEndian.Uint32(limit.Data[1:]) != 200000 {
		t.Fatal("expected explicit 200000 compute unit limit")
	}
	ix := tx.Message.Instructions[2]
	if tx.Message.AccountKeys[ix.ProgramIDIndex] != token.ProgramID {
		t.Fatal("wrong token program")
	}
	if len(ix.Data) != 10 || ix.Data[0] != 15 || ix.Data[9] != 0 {
		t.Fatal("expected integer BurnChecked")
	}
	if string(tx.Message.Instructions[3].Data) != "orbit:unique-redemption" {
		t.Fatal("missing operation binding")
	}
}
