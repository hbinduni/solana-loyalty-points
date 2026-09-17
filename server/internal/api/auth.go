package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/gofiber/fiber/v3"
	"github.com/redis/go-redis/v9"
)

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(s string) string { b := sha256.Sum256([]byte(s)); return hex.EncodeToString(b[:]) }
func validSignature(wallet, message, signature string) bool {
	key, err := solana.PublicKeyFromBase58(wallet)
	if err != nil {
		return false
	}
	sig, err := base64.StdEncoding.DecodeString(signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(key[:]), []byte(message), sig)
}

func (a *API) challenge(c fiber.Ctx) error {
	var req struct {
		Wallet string `json:"wallet"`
	}
	if err := c.Bind().Body(&req); err != nil {
		return fiber.NewError(400, "Invalid request")
	}
	key, err := solana.PublicKeyFromBase58(req.Wallet)
	if err != nil || !key.IsOnCurve() {
		return fiber.NewError(400, "Enter a valid wallet address")
	}
	nonce := randomToken()
	expires := time.Now().UTC().Add(5 * time.Minute)
	message := fmt.Sprintf("Sign in to Orbit\n\nThis signature only signs you in. It does not authorize a transaction.\n\nOrigin: %s\nWallet: %s\nNetwork: solana:devnet\nNonce: %s\nExpires: %s", a.Config.Origin, req.Wallet, nonce, expires.Format(time.RFC3339))
	if err = a.Redis.Set(c.Context(), "orbit:challenge:"+nonce, req.Wallet+"\n"+message, 5*time.Minute).Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"nonce": nonce, "message": message})
}

func (a *API) verify(c fiber.Ctx) error {
	var req struct {
		Wallet    string `json:"wallet"`
		Nonce     string `json:"nonce"`
		Signature string `json:"signature"`
	}
	if err := c.Bind().Body(&req); err != nil || len(req.Nonce) > 128 {
		return fiber.NewError(400, "Invalid request")
	}
	// GETDEL makes each challenge single-use, including concurrent verification attempts.
	stored, err := a.Redis.GetDel(c.Context(), "orbit:challenge:"+req.Nonce).Result()
	if errors.Is(err, redis.Nil) {
		return fiber.NewError(401, "Sign-in request expired. Connect your wallet again.")
	}
	if err != nil {
		return err
	}
	wallet, message, ok := strings.Cut(stored, "\n")
	if !ok || wallet != req.Wallet || !validSignature(wallet, message, req.Signature) {
		return fiber.NewError(401, "Wallet signature could not be verified")
	}
	token := randomToken()
	if err = a.Redis.Set(c.Context(), "orbit:session:"+digest(token), wallet, 24*time.Hour).Err(); err != nil {
		return err
	}
	a.cookie(c, token, 24*60*60)
	return c.JSON(fiber.Map{"wallet": wallet})
}

func (a *API) cookie(c fiber.Ctx, token string, maxAge int) {
	c.Cookie(&fiber.Cookie{Name: "orbit_session", Value: token, HTTPOnly: true, Secure: strings.HasPrefix(a.Config.Origin, "https://"), SameSite: "Strict", Path: "/api", MaxAge: maxAge})
}

func (a *API) authenticate(c fiber.Ctx) error {
	token := c.Cookies("orbit_session")
	if token == "" {
		return fiber.NewError(401, "Connect your wallet to continue")
	}
	wallet, err := a.Redis.Get(c.Context(), "orbit:session:"+digest(token)).Result()
	if errors.Is(err, redis.Nil) {
		return fiber.NewError(401, "Your session expired. Connect your wallet again.")
	}
	if err != nil {
		return err
	}
	c.Locals("wallet", wallet)
	return c.Next()
}

func (a *API) logout(c fiber.Ctx) error {
	if token := c.Cookies("orbit_session"); token != "" {
		if err := a.Redis.Del(c.Context(), "orbit:session:"+digest(token)).Err(); err != nil {
			return err
		}
	}
	a.cookie(c, "", -1)
	return c.SendStatus(204)
}

func wallet(c fiber.Ctx) string { return c.Locals("wallet").(string) }
