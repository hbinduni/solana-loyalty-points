package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
)

func validWallet(address string) bool {
	key, err := solana.PublicKeyFromBase58(address)
	return err == nil && key.IsOnCurve()
}

func (a *API) Reconcile(ctx context.Context) error {
	if !a.Chain.Ready() {
		return nil
	}
	operations, err := a.Store.Unsettled(ctx)
	if err != nil {
		return err
	}
	for _, o := range operations {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		state, err := a.Chain.State(ctx, o.Signature, o.LastHeight)
		if err != nil {
			slog.Warn("chain status unavailable", "operation", o.ID, "error", err)
			continue
		}
		if state == "pending" {
			if o.Status == "pending" {
				if err = a.Chain.Send(ctx, o.Transaction); err != nil {
					slog.Warn("transaction submission unresolved", "operation", o.ID, "error", err)
				}
			}
			// Touch pending rows for fairness when the queue exceeds one batch.
			if _, err = a.Store.Pool.Exec(ctx, "UPDATE operations SET updated_at=now() WHERE id=$1", o.ID); err != nil {
				return err
			}
			continue
		}
		if state != "confirmed" && state != "failed" && state != "expired" {
			continue
		}
		if err = a.Store.Settle(ctx, o, state, uuid.NewString()); err != nil {
			return err
		}
	}
	return nil
}

func (a *API) RunWorker(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			job, cancel := context.WithTimeout(ctx, 20*time.Second)
			if err := a.Reconcile(job); err != nil && ctx.Err() == nil {
				slog.Warn("reconciliation interrupted", "error", err)
			}
			cancel()
		}
	}
}
