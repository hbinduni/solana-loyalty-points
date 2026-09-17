package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"orbit/server/internal/chain"
	"orbit/server/internal/config"
	"orbit/server/internal/store"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

type API struct {
	Config config.Config
	Store  *store.Store
	Redis  *redis.Client
	Chain  chain.Gateway
}

func (a *API) App() *fiber.App {
	app := fiber.New(fiber.Config{AppName: "Orbit", BodyLimit: 8192, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, Immutable: true, ErrorHandler: func(c fiber.Ctx, err error) error {
		code := 500
		message := "The service is unavailable. Please try again."
		var fe *fiber.Error
		if errors.As(err, &fe) {
			code = fe.Code
			message = fe.Message
		} else if errors.Is(err, store.ErrConflict) {
			code = 409
			message = err.Error()
		} else if errors.Is(err, pgx.ErrNoRows) {
			code = 404
			message = "Not found"
		} else {
			slog.Error("request failed", "path", c.Path(), "error", err)
		}
		return c.Status(code).JSON(fiber.Map{"error": message})
	}})
	app.Use(recover.New())
	app.Use(func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
		defer cancel()
		c.SetContext(ctx)
		c.Set("Cache-Control", "no-store")
		c.Set("X-Content-Type-Options", "nosniff")
		if c.Method() != "GET" && c.Method() != "HEAD" {
			origin := c.Get("Origin")
			if origin != a.Config.Origin && !(origin == "" && strings.HasPrefix(c.Path(), "/api/merchant/")) {
				return fiber.NewError(403, "Request origin is not allowed")
			}
			count, err := a.Redis.Eval(c.Context(), `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`, []string{"orbit:rate:" + digest(c.IP())}).Int()
			if err != nil {
				return err
			}
			if count > 120 {
				c.Set("Retry-After", "60")
				return fiber.NewError(429, "Too many requests. Try again in a minute.")
			}
		}
		return c.Next()
	})
	app.Get("/api/health", func(c fiber.Ctx) error {
		if err := a.Store.Pool.Ping(c.Context()); err != nil {
			return fiber.NewError(503, "PostgreSQL unavailable")
		}
		if err := a.Redis.Ping(c.Context()).Err(); err != nil {
			return fiber.NewError(503, "Redis unavailable")
		}
		return c.JSON(fiber.Map{"status": "ok", "chainConfigured": a.Chain.Ready()})
	})
	app.Get("/api/config", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"network": "solana:devnet", "mint": a.Chain.MintAddress(), "configured": a.Chain.Ready(), "transferable": false})
	})
	app.Get("/api/rewards", a.rewards)
	app.Post("/api/auth/challenge", a.challenge)
	app.Post("/api/auth/verify", a.verify)
	app.Post("/api/auth/logout", a.logout)
	member := app.Group("/api/member", a.authenticate)
	member.Get("/me", func(c fiber.Ctx) error { return c.JSON(fiber.Map{"wallet": wallet(c)}) })
	member.Get("/balance", a.balance)
	member.Get("/activity", func(c fiber.Ctx) error {
		items, err := a.Store.History(c.Context(), wallet(c))
		if err != nil {
			return err
		}
		return c.JSON(items)
	})
	member.Post("/redemptions", a.redeem)
	member.Get("/operations/:id", a.operation)
	member.Post("/operations/:id/submit", a.submit)
	merchant := app.Group("/api/merchant", a.merchant)
	merchant.Post("/points", a.issue)
	merchant.Get("/operations/:id", a.merchantOperation)
	merchant.Post("/claims/:code/fulfill", a.fulfill)
	return app
}

func (a *API) rewards(c fiber.Ctx) error {
	var items []store.Reward
	if cached, err := a.Redis.Get(c.Context(), "orbit:rewards:v1").Bytes(); err == nil && json.Unmarshal(cached, &items) == nil {
		return c.JSON(items)
	}
	items, err := a.Store.Rewards(c.Context())
	if err != nil {
		return err
	}
	if b, err := json.Marshal(items); err == nil {
		if err = a.Redis.Set(c.Context(), "orbit:rewards:v1", b, 30*time.Second).Err(); err != nil {
			slog.Warn("reward cache unavailable", "error", err)
		}
	}
	return c.JSON(items)
}

func (a *API) requireChain() error {
	if !a.Chain.Ready() {
		return fiber.NewError(503, "The loyalty program is not connected to Devnet yet. You can explore the demo.")
	}
	return nil
}
func (a *API) balance(c fiber.Ctx) error {
	if err := a.requireChain(); err != nil {
		return err
	}
	amount, err := a.Chain.Balance(c.Context(), wallet(c))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"points": strconv.FormatUint(amount, 10), "commitment": "finalized"})
}

func requestKey(c fiber.Ctx) (string, error) {
	key := c.Get("Idempotency-Key")
	if _, err := uuid.Parse(key); err != nil {
		return "", fiber.NewError(400, "Idempotency-Key must be a UUID")
	}
	return key, nil
}
func (a *API) existing(c fiber.Ctx, owner, kind, key, hash string) (*store.Operation, error) {
	o, err := a.Store.FindKey(c.Context(), owner, kind, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if o.Hash != hash {
		return nil, store.ErrConflict
	}
	return &o, nil
}

func (a *API) redeem(c fiber.Ctx) error {
	if err := a.requireChain(); err != nil {
		return err
	}
	key, err := requestKey(c)
	if err != nil {
		return err
	}
	var req struct {
		RewardID string `json:"rewardId"`
	}
	if err = c.Bind().Body(&req); err != nil {
		return fiber.NewError(400, "Invalid reward request")
	}
	hash := digest("redeem:" + req.RewardID)
	previous, err := a.existing(c, wallet(c), "redeem", key, hash)
	if err != nil {
		return err
	}
	if previous != nil {
		return c.JSON(previous)
	}
	reward, err := a.Store.Reward(c.Context(), req.RewardID)
	if err != nil {
		return err
	}
	balance, err := a.Chain.Balance(c.Context(), wallet(c))
	if err != nil {
		return err
	}
	if balance < uint64(reward.Points) {
		return fiber.NewError(409, "You need more points for this reward")
	}
	id := uuid.NewString()
	prepared, err := a.Chain.Prepare(c.Context(), "redeem", wallet(c), uint64(reward.Points), id)
	if err != nil {
		return err
	}
	o, err := a.Store.Create(c.Context(), store.Operation{ID: id, Wallet: wallet(c), Kind: "redeem", RewardID: reward.ID, Title: reward.Title, Points: reward.Points, Key: key, Hash: hash, Status: "prepared", Message: prepared.Message, Transaction: prepared.Transaction, LastHeight: prepared.LastHeight})
	if err != nil {
		return err
	}
	return c.Status(201).JSON(o)
}

func (a *API) operation(c fiber.Ctx) error {
	if _, err := uuid.Parse(c.Params("id")); err != nil {
		return fiber.NewError(404, "Not found")
	}
	o, err := a.Store.Operation(c.Context(), c.Params("id"), wallet(c))
	if err != nil {
		return err
	}
	return c.JSON(o)
}

func (a *API) submit(c fiber.Ctx) error {
	if _, err := uuid.Parse(c.Params("id")); err != nil {
		return fiber.NewError(404, "Not found")
	}
	var req struct {
		Transaction string `json:"transaction"`
	}
	if err := c.Bind().Body(&req); err != nil {
		return fiber.NewError(400, "Invalid signed transaction")
	}
	o, err := a.Store.Operation(c.Context(), c.Params("id"), wallet(c))
	if err != nil {
		return err
	}
	if o.Kind != "redeem" {
		return fiber.NewError(400, "Only redemptions need a member signature")
	}
	signed, err := a.Chain.SignRedemption(o.Message, req.Transaction, wallet(c))
	if err != nil {
		return fiber.NewError(400, err.Error())
	}
	if o.Status != "prepared" {
		return c.JSON(o)
	}
	o, err = a.Store.Submit(c.Context(), o.ID, wallet(c), signed.Transaction, signed.Signature)
	if err != nil {
		return err
	}
	return c.Status(202).JSON(o)
}

func (a *API) merchant(c fiber.Ctx) error {
	if a.Config.MerchantKey == "" || subtle.ConstantTimeCompare([]byte(c.Get("X-Merchant-Key")), []byte(a.Config.MerchantKey)) != 1 {
		return fiber.NewError(401, "Merchant authentication required")
	}
	return c.Next()
}

func (a *API) issue(c fiber.Ctx) error {
	if err := a.requireChain(); err != nil {
		return err
	}
	key, err := requestKey(c)
	if err != nil {
		return err
	}
	var req struct {
		Wallet    string `json:"wallet"`
		Points    int64  `json:"points"`
		Reference string `json:"reference"`
	}
	if err = c.Bind().Body(&req); err != nil || req.Points < 1 || req.Points > 1000000000 || len(req.Reference) < 1 || len(req.Reference) > 120 {
		return fiber.NewError(400, "Provide a wallet, 1–1,000,000,000 points, and a reference up to 120 characters")
	}
	if !validWallet(req.Wallet) {
		return fiber.NewError(400, "Invalid wallet address")
	}
	hash := digest(fmt.Sprintf("earn:%s:%d:%s", req.Wallet, req.Points, req.Reference))
	previous, err := a.existing(c, req.Wallet, "earn", key, hash)
	if err != nil {
		return err
	}
	if previous != nil {
		previous.Transaction = ""
		return c.JSON(previous)
	}
	id := uuid.NewString()
	p, err := a.Chain.Prepare(c.Context(), "earn", req.Wallet, uint64(req.Points), id)
	if err != nil {
		return err
	}
	o, err := a.Store.Create(c.Context(), store.Operation{ID: id, Wallet: req.Wallet, Kind: "earn", Title: req.Reference, Points: req.Points, Key: key, Hash: hash, Status: "pending", Message: p.Message, Transaction: p.Transaction, Signature: p.Signature, LastHeight: p.LastHeight})
	if err != nil {
		return err
	}
	o.Transaction = ""
	return c.Status(202).JSON(o)
}

func (a *API) merchantOperation(c fiber.Ctx) error {
	if _, err := uuid.Parse(c.Params("id")); err != nil {
		return fiber.NewError(404, "Not found")
	}
	o, err := a.Store.Operation(c.Context(), c.Params("id"), c.Query("wallet"))
	if err != nil {
		return err
	}
	o.Transaction = ""
	return c.JSON(o)
}

func (a *API) fulfill(c fiber.Ctx) error {
	if _, err := uuid.Parse(c.Params("code")); err != nil {
		return fiber.NewError(404, "Not found")
	}
	o, err := a.Store.Fulfill(c.Context(), c.Params("code"))
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(409, "This reward code is invalid or has already been collected")
	}
	if err != nil {
		return err
	}
	o.Transaction = ""
	return c.JSON(o)
}
