package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"orbit/server/internal/api"
	"orbit/server/internal/chain"
	"orbit/server/internal/config"
	"orbit/server/internal/store"

	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	if err := godotenv.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	db, err := store.Open(startup, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Pool.Close()
	if err = db.Migrate(startup); err != nil {
		return err
	}
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return err
	}
	cache := redis.NewClient(opts)
	defer cache.Close()
	if err = cache.Ping(startup).Err(); err != nil {
		return err
	}
	network, err := chain.New(cfg.RPCURL, cfg.Mint, cfg.AuthorityFile)
	if err != nil {
		return err
	}
	if err = network.Validate(startup); err != nil {
		return err
	}
	if network.Ready() {
		if err = db.BindMint(startup, cfg.Mint); err != nil {
			return err
		}
	}
	service := &api.API{Config: cfg, Store: db, Redis: cache, Chain: network}
	app := service.App()
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); service.RunWorker(ctx) }()
	go func() {
		<-ctx.Done()
		if err := app.ShutdownWithTimeout(10 * time.Second); err != nil {
			slog.Warn("shutdown", "error", err)
		}
	}()
	slog.Info("Orbit API starting", "address", cfg.Listen, "chainConfigured", network.Ready())
	err = app.Listen(cfg.Listen)
	stop()
	<-workerDone
	return err
}
