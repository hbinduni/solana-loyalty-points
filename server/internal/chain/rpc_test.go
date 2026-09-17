package chain

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gagliardetto/solana-go"
	token "github.com/gagliardetto/solana-go/programs/token-2022"
	"github.com/gagliardetto/solana-go/rpc"
)

func TestDevnetNetworkGuard(t *testing.T) {
	cases := []struct {
		name    string
		genesis string
		wantErr bool
	}{
		{name: "Devnet", genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"},
		{name: "another network", genesis: solana.Hash{1}.String(), wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					ID     any    `json:"id"`
					Method string `json:"method"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Error(err)
					return
				}
				if req.Method != "getGenesisHash" {
					t.Errorf("unexpected method %s", req.Method)
				}
				w.Header().Set("Content-Type", "application/json")
				if err := json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": tc.genesis}); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			err := CheckDevnet(context.Background(), rpc.New(server.URL))
			if (err != nil) != tc.wantErr {
				t.Fatalf("network guard returned %v, want error: %t", err, tc.wantErr)
			}
		})
	}
}

func TestChainFinalizationAndExpiry(t *testing.T) {
	cases := []struct {
		name     string
		height   uint64
		status   any
		want     string
		rpcError bool
	}{
		{name: "unknown signature still valid", height: 99, want: "pending"},
		{name: "expired absent signature", height: 101, want: "expired"},
		{name: "confirmed is not finalized", height: 101, status: map[string]any{"slot": 1, "confirmations": 1, "confirmationStatus": "confirmed", "err": nil}, want: "pending"},
		{name: "finalized success", height: 101, status: map[string]any{"slot": 1, "confirmations": nil, "confirmationStatus": "finalized", "err": nil}, want: "confirmed"},
		{name: "finalized failure", height: 101, status: map[string]any{"slot": 1, "confirmations": nil, "confirmationStatus": "finalized", "err": map[string]any{"InstructionError": []any{0, "InsufficientFunds"}}}, want: "failed"},
		{name: "RPC outage is not expiry", height: 101, rpcError: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					ID     any    `json:"id"`
					Method string `json:"method"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				response := map[string]any{"jsonrpc": "2.0", "id": req.ID}
				if tc.rpcError {
					response["error"] = map[string]any{"code": -32005, "message": "node unavailable"}
				} else if req.Method == "getBlockHeight" {
					response["result"] = tc.height
				} else {
					response["result"] = map[string]any{"context": map[string]any{"slot": 1}, "value": []any{tc.status}}
				}
				if err := json.NewEncoder(w).Encode(response); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			client := &Client{RPC: rpc.New(server.URL)}
			state, err := client.State(context.Background(), solana.Signature{1}.String(), 100)
			if tc.rpcError {
				if err == nil {
					t.Fatal("RPC outage treated as outcome")
				}
				return
			}
			if err != nil || state != tc.want {
				t.Fatalf("got %q %v, want %q", state, err, tc.want)
			}
		})
	}
}

func TestPrepareIssuanceCreatesToken2022AccountAndMint(t *testing.T) {
	authority := solana.NewWallet()
	owner := solana.NewWallet()
	mint := solana.NewWallet().PublicKey()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID any `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"context": map[string]any{"slot": 1}, "value": map[string]any{"blockhash": solana.Hash{1}.String(), "lastValidBlockHeight": 100}}}); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	client := &Client{RPC: rpc.New(server.URL), Mint: mint, Authority: authority.PrivateKey}
	p, err := client.Prepare(context.Background(), "earn", owner.PublicKey().String(), 250, "award-1")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(p.Transaction)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := solana.TransactionFromBytes(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.VerifySignatures(); err != nil {
		t.Fatal(err)
	}
	if len(tx.Message.Instructions) != 3 {
		t.Fatal("expected associated account, mint and memo")
	}
	create := tx.Message.Instructions[0]
	if tx.Message.AccountKeys[create.ProgramIDIndex] != solana.SPLAssociatedTokenAccountProgramID || create.Data[0] != 1 {
		t.Fatal("account creation must be idempotent")
	}
	if tx.Message.AccountKeys[create.Accounts[5]] != token.ProgramID {
		t.Fatal("associated account uses wrong token program")
	}
	mintIx := tx.Message.Instructions[1]
	if tx.Message.AccountKeys[mintIx.ProgramIDIndex] != token.ProgramID || mintIx.Data[0] != 14 || mintIx.Data[9] != 0 {
		t.Fatal("issuance must use integer MintToChecked")
	}
	if p.Signature != tx.Signatures[0].String() || p.LastHeight != 100 {
		t.Fatal("journal omitted transaction identity")
	}

	redemption, err := client.Prepare(context.Background(), "redeem", owner.PublicKey().String(), 250, "redeem-1")
	if err != nil {
		t.Fatal(err)
	}
	redemptionTx, err := solana.TransactionFromBase64(redemption.Transaction)
	if err != nil {
		t.Fatal(err)
	}
	if redemptionTx.Message.AccountKeys[0] != authority.PublicKey() || redemptionTx.Message.Header.NumRequiredSignatures != 2 {
		t.Fatal("redemption must use the app authority as fee payer and require the member signature")
	}
	if redemption.Signature != "" || len(redemptionTx.Signatures) != 2 || !redemptionTx.Signatures[0].IsZero() || !redemptionTx.Signatures[1].IsZero() {
		t.Fatal("prepared redemption must not be signed before member approval")
	}
}
