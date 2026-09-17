package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"orbit/server/internal/chain"
	"orbit/server/internal/config"
	"orbit/server/internal/store"

	"github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type testChain struct {
	mu        sync.Mutex
	authority *solana.Wallet
	state     string
	sendError bool
	sends     int
}

func (f *testChain) Ready() bool                                     { return true }
func (f *testChain) MintAddress() string                             { return f.authority.PublicKey().String() }
func (f *testChain) Balance(context.Context, string) (uint64, error) { return 1000, nil }
func (f *testChain) Prepare(_ context.Context, kind, wallet string, amount uint64, id string) (chain.Prepared, error) {
	owner, err := solana.PublicKeyFromBase58(wallet)
	if err != nil {
		return chain.Prepared{}, err
	}
	if kind == "earn" {
		owner = f.authority.PublicKey()
	}
	tx, err := chain.BuildBurn(owner, f.authority.PublicKey(), f.authority.PublicKey(), amount, id, solana.Hash{1})
	if err != nil {
		return chain.Prepared{}, err
	}
	p := chain.Prepared{LastHeight: 1000}
	if kind == "earn" {
		if _, err = tx.Sign(func(solana.PublicKey) *solana.PrivateKey { return &f.authority.PrivateKey }); err != nil {
			return p, err
		}
		p.Signature = tx.Signatures[0].String()
	}
	p.Message, err = tx.Message.MarshalBinary()
	if err != nil {
		return p, err
	}
	raw, err := tx.MarshalBinary()
	p.Transaction = base64.StdEncoding.EncodeToString(raw)
	return p, err
}
func (f *testChain) SignRedemption(message []byte, encoded, wallet string) (chain.Signed, error) {
	client := &chain.Client{Mint: f.authority.PublicKey(), Authority: f.authority.PrivateKey}
	return client.SignRedemption(message, encoded, wallet)
}
func (f *testChain) State(_ context.Context, signature string, _ uint64) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if signature == "" {
		return "pending", nil
	}
	return f.state, nil
}
func (f *testChain) Send(context.Context, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sends++
	if f.sendError {
		return errors.New("RPC timeout after submission")
	}
	return nil
}

func fixture(t *testing.T) (*API, *httptest.Server, *testChain) {
	t.Helper()
	if os.Getenv("INTEGRATION_TEST") != "1" {
		t.Skip("set INTEGRATION_TEST=1 with local PostgreSQL and Redis running")
	}
	ctx := context.Background()
	dsn := "postgres://orbit:orbit_local_only@127.0.0.1:55432/orbit?sslmode=disable"
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "orbit_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
		admin.Close()
	})
	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	poolCfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	db := &store.Store{Pool: pool}
	if err = db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	cache := redis.NewClient(&redis.Options{Addr: "127.0.0.1:56379", DB: 15})
	if err = cache.Ping(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cache.Close() })
	fake := &testChain{authority: solana.NewWallet(), state: "pending"}
	a := &API{Config: config.Config{Origin: "http://localhost:5173", MerchantKey: strings.Repeat("k", 32)}, Store: db, Redis: cache, Chain: fake}
	app := a.App()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		res, err := app.Test(r)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		defer res.Body.Close()
		for k, vs := range res.Header {
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(res.StatusCode)
		if _, err = io.Copy(w, res.Body); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(server.Close)
	return a, server, fake
}

func call(t *testing.T, server *httptest.Server, method, path string, body any, cookie *http.Cookie, headers map[string]string) (int, []byte, *http.Response) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, server.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, raw, res
}

func login(t *testing.T, server *httptest.Server, wallet *solana.Wallet) *http.Cookie {
	t.Helper()
	code, raw, _ := call(t, server, "POST", "/api/auth/challenge", map[string]string{"wallet": wallet.PublicKey().String()}, nil, nil)
	if code != 200 {
		t.Fatalf("challenge %d %s", code, raw)
	}
	var challenge struct{ Nonce, Message string }
	if err := json.Unmarshal(raw, &challenge); err != nil {
		t.Fatal(err)
	}
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(ed25519.PrivateKey(wallet.PrivateKey), []byte(challenge.Message)))
	body := map[string]string{"wallet": wallet.PublicKey().String(), "nonce": challenge.Nonce, "signature": signature}
	code, raw, res := call(t, server, "POST", "/api/auth/verify", body, nil, nil)
	if code != 200 {
		t.Fatalf("verify %d %s", code, raw)
	}
	var cookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == "orbit_session" {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("missing secure session properties")
	}
	code, _, _ = call(t, server, "POST", "/api/auth/verify", body, nil, nil)
	if code != 401 {
		t.Fatalf("challenge replay accepted: %d", code)
	}
	return cookie
}

func TestIntegrationRedemptionAndClaim(t *testing.T) {
	a, server, fake := fixture(t)
	ctx := context.Background()
	owner := solana.NewWallet()
	cookie := login(t, server, owner)
	key := uuid.NewString()
	headers := map[string]string{"Idempotency-Key": key}
	code, raw, _ := call(t, server, "POST", "/api/member/redemptions", map[string]string{"rewardId": "coffee"}, cookie, headers)
	if code != 201 {
		t.Fatalf("prepare %d %s", code, raw)
	}
	var op store.Operation
	if err := json.Unmarshal(raw, &op); err != nil {
		t.Fatal(err)
	}
	if op.Status != "prepared" || op.ClaimCode != "" {
		t.Fatal("reward issued before burn")
	}
	code, raw, _ = call(t, server, "POST", "/api/member/redemptions", map[string]string{"rewardId": "coffee"}, cookie, headers)
	if code != 200 {
		t.Fatal(code, string(raw))
	}
	var duplicate store.Operation
	json.Unmarshal(raw, &duplicate)
	if duplicate.ID != op.ID {
		t.Fatal("retry created another operation")
	}
	code, _, _ = call(t, server, "POST", "/api/member/redemptions", map[string]string{"rewardId": "discount"}, cookie, headers)
	if code != 409 {
		t.Fatal("idempotency payload conflict was accepted")
	}
	code, _, _ = call(t, server, "POST", "/api/member/redemptions", map[string]string{"rewardId": "tote"}, cookie, map[string]string{"Idempotency-Key": uuid.NewString()})
	if code != 409 {
		t.Fatal("insufficient points accepted")
	}
	other := login(t, server, solana.NewWallet())
	code, _, _ = call(t, server, "GET", "/api/member/operations/"+op.ID, nil, other, nil)
	if code != 404 {
		t.Fatal("another member read private operation")
	}
	bytes, err := base64.StdEncoding.DecodeString(op.Transaction)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := solana.TransactionFromBytes(bytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(tx.Signatures) != 2 || !tx.Signatures[0].IsZero() || !tx.Signatures[1].IsZero() {
		t.Fatal("prepared redemption must not contain an app signature")
	}
	code, _, _ = call(t, server, "POST", "/api/member/operations/"+op.ID+"/submit", map[string]string{"transaction": op.Transaction}, cookie, nil)
	if code != 400 {
		t.Fatal("unsigned burn received sponsorship")
	}
	if _, err = tx.PartialSign(func(key solana.PublicKey) *solana.PrivateKey {
		if key == owner.PublicKey() {
			return &owner.PrivateKey
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	wire, err := tx.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	signed := base64.StdEncoding.EncodeToString(wire)
	code, _, _ = call(t, server, "POST", "/api/member/operations/"+op.ID+"/submit", map[string]string{"transaction": signed}, other, nil)
	if code != 404 {
		t.Fatal("another member submitted a private operation")
	}
	unchanged, err := a.Store.Operation(ctx, op.ID, owner.PublicKey().String())
	if err != nil || unchanged.Status != "prepared" || unchanged.Signature != "" || unchanged.Transaction != op.Transaction {
		t.Fatal("rejected submissions changed the prepared transaction", err)
	}
	code, raw, _ = call(t, server, "POST", "/api/member/operations/"+op.ID+"/submit", map[string]string{"transaction": signed}, cookie, nil)
	if code != 202 {
		t.Fatal(code, string(raw))
	}
	persisted, err := a.Store.Operation(ctx, op.ID, owner.PublicKey().String())
	if err != nil {
		t.Fatal(err)
	}
	complete, err := solana.TransactionFromBase64(persisted.Transaction)
	if err != nil {
		t.Fatal(err)
	}
	if err = complete.VerifySignatures(); err != nil {
		t.Fatal("journal must contain both signatures before broadcast", err)
	}
	if complete.Message.AccountKeys[0] != fake.authority.PublicKey() || persisted.Signature != complete.Signatures[0].String() || complete.Signatures[1] != tx.Signatures[1] {
		t.Fatal("journal must preserve member approval and track the app-paid transaction")
	}
	code, raw, _ = call(t, server, "POST", "/api/member/operations/"+op.ID+"/submit", map[string]string{"transaction": signed}, cookie, nil)
	if code != 200 {
		t.Fatal("submission retry failed", code, string(raw))
	}
	var resubmitted store.Operation
	if err = json.Unmarshal(raw, &resubmitted); err != nil || resubmitted.Signature != persisted.Signature {
		t.Fatal("submission retry changed transaction identity", err)
	}
	if err = a.Store.Settle(ctx, op, "expired", uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	afterRace, err := a.Store.Operation(ctx, op.ID, owner.PublicKey().String())
	if err != nil || afterRace.Status != "pending" {
		t.Fatal("stale worker expired a submitted transaction", err)
	}
	fake.mu.Lock()
	fake.sendError = true
	fake.mu.Unlock()
	if err = a.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	pending, err := a.Store.Operation(ctx, op.ID, owner.PublicKey().String())
	if err != nil {
		t.Fatal(err)
	}
	if pending.Status != "pending" || pending.ClaimCode != "" {
		t.Fatal("ambiguous RPC result changed points outcome")
	}
	fake.mu.Lock()
	fake.state = "confirmed"
	fake.mu.Unlock()
	if err = a.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	confirmed, err := a.Store.Operation(ctx, op.ID, owner.PublicKey().String())
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != "confirmed" || confirmed.ClaimCode == "" {
		t.Fatal("finalized burn did not issue claim")
	}
	if err = a.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	again, _ := a.Store.Operation(ctx, op.ID, owner.PublicKey().String())
	if again.ClaimCode != confirmed.ClaimCode {
		t.Fatal("claim changed on retry")
	}
	merchant := map[string]string{"X-Merchant-Key": a.Config.MerchantKey}
	code, raw, _ = call(t, server, "POST", "/api/merchant/claims/"+confirmed.ClaimCode+"/fulfill", nil, nil, merchant)
	if code != 200 {
		t.Fatal(code, string(raw))
	}
	code, _, _ = call(t, server, "POST", "/api/merchant/claims/"+confirmed.ClaimCode+"/fulfill", nil, nil, merchant)
	if code != 409 {
		t.Fatalf("reward collected twice: %d", code)
	}
}

func TestIntegrationMerchantAndOriginGuards(t *testing.T) {
	a, server, _ := fixture(t)
	owner := solana.NewWallet()
	cookie := login(t, server, owner)
	code, _, _ := call(t, server, "POST", "/api/member/redemptions", map[string]string{"rewardId": "coffee"}, cookie, map[string]string{"Origin": "https://attacker.example", "Idempotency-Key": uuid.NewString()})
	if code != 403 {
		t.Fatal("foreign origin allowed")
	}
	body := map[string]any{"wallet": owner.PublicKey().String(), "points": 300, "reference": "Receipt 1"}
	code, _, _ = call(t, server, "POST", "/api/merchant/points", body, cookie, map[string]string{"Idempotency-Key": uuid.NewString()})
	if code != 401 {
		t.Fatal("member minted points")
	}
	headers := map[string]string{"Idempotency-Key": uuid.NewString(), "X-Merchant-Key": a.Config.MerchantKey}
	code, raw, _ := call(t, server, "POST", "/api/merchant/points", body, nil, headers)
	if code != 202 {
		t.Fatal(code, string(raw))
	}
	var op store.Operation
	json.Unmarshal(raw, &op)
	code, raw, _ = call(t, server, "POST", "/api/merchant/points", body, nil, headers)
	if code != 200 {
		t.Fatal(code, string(raw))
	}
	var second store.Operation
	json.Unmarshal(raw, &second)
	if op.ID != second.ID {
		t.Fatal("issuance duplicated")
	}
	body["points"] = 301
	code, _, _ = call(t, server, "POST", "/api/merchant/points", body, nil, headers)
	if code != 409 {
		t.Fatal("changed award accepted with same key")
	}
}
