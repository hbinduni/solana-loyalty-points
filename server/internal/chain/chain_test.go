package chain

import (
	"encoding/base64"
	"encoding/binary"
	"testing"

	"github.com/gagliardetto/solana-go"
	compute "github.com/gagliardetto/solana-go/programs/compute-budget"
	token "github.com/gagliardetto/solana-go/programs/token-2022"
)

func TestSponsoredRedemptionRequiresExactMessageAndMemberSignature(t *testing.T) {
	owner, authority := solana.NewWallet(), solana.NewWallet()
	mint := solana.NewWallet().PublicKey()
	client := &Client{Mint: mint, Authority: authority.PrivateKey}
	tx, err := BuildBurn(owner.PublicKey(), mint, authority.PublicKey(), 250, "redemption-1", solana.Hash{1})
	if err != nil {
		t.Fatal(err)
	}
	expected, err := tx.Message.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.PartialSign(func(key solana.PublicKey) *solana.PrivateKey {
		if key == owner.PublicKey() {
			return &owner.PrivateKey
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	encoded, err := tx.ToBase64()
	if err != nil {
		t.Fatal(err)
	}
	signed, err := client.SignRedemption(expected, encoded, owner.PublicKey().String())
	if err != nil {
		t.Fatal(err)
	}
	complete, err := solana.TransactionFromBase64(signed.Transaction)
	if err != nil {
		t.Fatal(err)
	}
	if err = complete.VerifySignatures(); err != nil {
		t.Fatal(err)
	}
	if complete.Signatures[1] != tx.Signatures[1] || signed.Signature != complete.Signatures[0].String() {
		t.Fatal("member signature changed or journal used the wrong transaction identity")
	}
	retry, err := client.SignRedemption(expected, encoded, owner.PublicKey().String())
	if err != nil || retry != signed {
		t.Fatal("retry must produce the same signed transaction", err)
	}
	if retry, err = client.SignRedemption(expected, signed.Transaction, owner.PublicKey().String()); err != nil || retry != signed {
		t.Fatal("already signed retry must be stable", err)
	}
	cases := []struct {
		name   string
		mutate func(*solana.Transaction)
		wallet string
	}{
		{name: "changed blockhash", mutate: func(tx *solana.Transaction) { tx.Message.RecentBlockhash = solana.Hash{2} }},
		{name: "changed burn", mutate: func(tx *solana.Transaction) { tx.Message.Instructions[2].Data[1]++ }},
		{name: "changed fee", mutate: func(tx *solana.Transaction) { tx.Message.Instructions[0].Data[1]++ }},
		{name: "changed memo", mutate: func(tx *solana.Transaction) { tx.Message.Instructions[3].Data[0]++ }},
		{name: "missing member signature", mutate: func(tx *solana.Transaction) { tx.Signatures[1] = solana.Signature{} }},
		{name: "wrong member signature", mutate: func(tx *solana.Transaction) { tx.Signatures[1] = complete.Signatures[0] }},
		{name: "invalid payer signature", mutate: func(tx *solana.Transaction) { tx.Signatures[0] = tx.Signatures[1] }},
		{name: "missing signature slot", mutate: func(tx *solana.Transaction) { tx.Signatures = tx.Signatures[1:] }},
		{name: "wrong wallet", wallet: solana.NewWallet().PublicKey().String()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			candidate, err := solana.TransactionFromBase64(encoded)
			if err != nil {
				t.Fatal(err)
			}
			if tc.mutate != nil {
				tc.mutate(candidate)
			}
			wire, err := candidate.ToBase64()
			if err != nil {
				t.Fatal(err)
			}
			wallet := tc.wallet
			if wallet == "" {
				wallet = owner.PublicKey().String()
			}
			if _, err = client.SignRedemption(expected, wire, wallet); err == nil {
				t.Fatal("sponsored an invalid redemption")
			}
		})
	}
	raw, _ := base64.StdEncoding.DecodeString(encoded)
	if _, err = client.SignRedemption(expected, base64.StdEncoding.EncodeToString(append(raw, 0)), owner.PublicKey().String()); err == nil {
		t.Fatal("accepted trailing transaction data")
	}
	wrongAuthority := &Client{Mint: mint, Authority: solana.NewWallet().PrivateKey}
	if _, err = wrongAuthority.SignRedemption(expected, encoded, owner.PublicKey().String()); err == nil {
		t.Fatal("signed a transaction with a different payer")
	}
}

func TestBurnUsesToken2022AndUniqueMemo(t *testing.T) {
	owner := solana.NewWallet().PublicKey()
	mint := solana.NewWallet().PublicKey()
	payer := solana.NewWallet().PublicKey()
	tx, err := BuildBurn(owner, mint, payer, 500, "unique-redemption", solana.Hash{1})
	if err != nil {
		t.Fatal(err)
	}
	if tx.Message.AccountKeys[0] != payer || tx.Message.AccountKeys[1] != owner || tx.Message.Header.NumRequiredSignatures != 2 {
		t.Fatal("app must pay while member authorizes the burn")
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
	if tx.Message.AccountKeys[ix.Accounts[2]] != owner {
		t.Fatal("member must authorize the burn")
	}
	if len(ix.Data) != 10 || ix.Data[0] != 15 || ix.Data[9] != 0 {
		t.Fatal("expected integer BurnChecked")
	}
	if string(tx.Message.Instructions[3].Data) != "orbit:unique-redemption" {
		t.Fatal("missing operation binding")
	}
}
