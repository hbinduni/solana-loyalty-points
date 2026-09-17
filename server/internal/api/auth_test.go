package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"

	"github.com/gagliardetto/solana-go"
)

func TestWalletSignature(t *testing.T) {
	wallet := solana.NewWallet()
	message := "Orbit sign in\nNonce: unique"
	signature := ed25519.Sign(ed25519.PrivateKey(wallet.PrivateKey), []byte(message))
	encoded := base64.StdEncoding.EncodeToString(signature)
	if !validSignature(wallet.PublicKey().String(), message, encoded) {
		t.Fatal("rejected valid wallet signature")
	}
	if validSignature(wallet.PublicKey().String(), message+"tampered", encoded) {
		t.Fatal("accepted another message")
	}
	if validSignature(solana.NewWallet().PublicKey().String(), message, encoded) {
		t.Fatal("accepted another wallet")
	}
	if validSignature("invalid", message, encoded) || validSignature(wallet.PublicKey().String(), message, "bad") {
		t.Fatal("accepted malformed input")
	}
}
