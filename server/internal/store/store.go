package store

import (
	"context"
	_ "embed"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

var ErrConflict = errors.New("idempotency key already used for another request")

type Reward struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Points      int64  `json:"points"`
}

type Operation struct {
	ID          string     `json:"id"`
	Wallet      string     `json:"wallet"`
	Kind        string     `json:"kind"`
	RewardID    string     `json:"rewardId,omitempty"`
	Title       string     `json:"title"`
	Points      int64      `json:"points"`
	Key         string     `json:"-"`
	Hash        string     `json:"-"`
	Status      string     `json:"status"`
	Message     []byte     `json:"-"`
	Transaction string     `json:"transaction,omitempty"`
	Signature   string     `json:"signature,omitempty"`
	LastHeight  uint64     `json:"-"`
	ClaimCode   string     `json:"claimCode,omitempty"`
	FulfilledAt *time.Time `json:"fulfilledAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type Store struct{ Pool *pgxpool.Pool }

func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool}, nil
}

func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(829104230)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, schema); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) BindMint(ctx context.Context, mint string) error {
	if _, err := s.Pool.Exec(ctx, "INSERT INTO app_settings VALUES('devnet_mint', $1) ON CONFLICT DO NOTHING", mint); err != nil {
		return err
	}
	var existing string
	if err := s.Pool.QueryRow(ctx, "SELECT value FROM app_settings WHERE key='devnet_mint'").Scan(&existing); err != nil {
		return err
	}
	if existing != mint {
		return errors.New("database belongs to a different mint; use a separate database")
	}
	return nil
}

func (s *Store) Rewards(ctx context.Context) ([]Reward, error) {
	rows, err := s.Pool.Query(ctx, "SELECT id,title,description,category,points FROM rewards WHERE active ORDER BY points")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Reward{}
	for rows.Next() {
		var r Reward
		if err := rows.Scan(&r.ID, &r.Title, &r.Description, &r.Category, &r.Points); err != nil {
			return nil, err
		}
		items = append(items, r)
	}
	return items, rows.Err()
}

func (s *Store) Reward(ctx context.Context, id string) (Reward, error) {
	var r Reward
	err := s.Pool.QueryRow(ctx, "SELECT id,title,description,category,points FROM rewards WHERE id=$1 AND active", id).Scan(&r.ID, &r.Title, &r.Description, &r.Category, &r.Points)
	return r, err
}

const columns = "id::text,wallet,kind,COALESCE(reward_id,''),title,points,idempotency_key,payload_hash,status,message,transaction_base64,COALESCE(signature,''),last_valid_block_height,COALESCE(claim_code::text,''),fulfilled_at,created_at"

func scan(row pgx.Row) (Operation, error) {
	var o Operation
	err := row.Scan(&o.ID, &o.Wallet, &o.Kind, &o.RewardID, &o.Title, &o.Points, &o.Key, &o.Hash, &o.Status, &o.Message, &o.Transaction, &o.Signature, &o.LastHeight, &o.ClaimCode, &o.FulfilledAt, &o.CreatedAt)
	return o, err
}

func (s *Store) FindKey(ctx context.Context, wallet, kind, key string) (Operation, error) {
	return scan(s.Pool.QueryRow(ctx, "SELECT "+columns+" FROM operations WHERE wallet=$1 AND kind=$2 AND idempotency_key=$3", wallet, kind, key))
}
func (s *Store) Operation(ctx context.Context, id, wallet string) (Operation, error) {
	return scan(s.Pool.QueryRow(ctx, "SELECT "+columns+" FROM operations WHERE id=$1 AND wallet=$2", id, wallet))
}

func (s *Store) Create(ctx context.Context, o Operation) (Operation, error) {
	_, err := s.Pool.Exec(ctx, `INSERT INTO operations(id,wallet,kind,reward_id,title,points,idempotency_key,payload_hash,status,message,transaction_base64,signature,last_valid_block_height)
 VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,NULLIF($12,''),$13) ON CONFLICT(wallet,kind,idempotency_key) DO NOTHING`, o.ID, o.Wallet, o.Kind, o.RewardID, o.Title, o.Points, o.Key, o.Hash, o.Status, o.Message, o.Transaction, o.Signature, o.LastHeight)
	if err != nil {
		return o, err
	}
	existing, err := s.FindKey(ctx, o.Wallet, o.Kind, o.Key)
	if err != nil {
		return o, err
	}
	if existing.Hash != o.Hash {
		return o, ErrConflict
	}
	return existing, nil
}

func (s *Store) Submit(ctx context.Context, id, wallet, raw, signature string) (Operation, error) {
	_, err := s.Pool.Exec(ctx, "UPDATE operations SET transaction_base64=$3, signature=$4,status='pending',updated_at=now() WHERE id=$1 AND wallet=$2 AND status='prepared'", id, wallet, raw, signature)
	if err != nil {
		return Operation{}, err
	}
	return s.Operation(ctx, id, wallet)
}

func (s *Store) History(ctx context.Context, wallet string) ([]Operation, error) {
	rows, err := s.Pool.Query(ctx, "SELECT "+columns+" FROM operations WHERE wallet=$1 ORDER BY created_at DESC LIMIT 100", wallet)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Operation{}
	for rows.Next() {
		o, err := scan(rows)
		if err != nil {
			return nil, err
		}
		o.Transaction = ""
		items = append(items, o)
	}
	return items, rows.Err()
}

func (s *Store) Unsettled(ctx context.Context) ([]Operation, error) {
	rows, err := s.Pool.Query(ctx, "SELECT "+columns+" FROM operations WHERE status IN ('prepared','pending') ORDER BY updated_at LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Operation{}
	for rows.Next() {
		o, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, o)
	}
	return items, rows.Err()
}

func (s *Store) Settle(ctx context.Context, snapshot Operation, state, claim string) error {
	// A worker holding a prepared snapshot must not expire a concurrently submitted transaction.
	_, err := s.Pool.Exec(ctx, `UPDATE operations SET status=$2,claim_code=CASE WHEN $2='confirmed' AND kind='redeem' THEN $3::uuid ELSE claim_code END,updated_at=now() WHERE id=$1 AND status=$4 AND COALESCE(signature,'')=$5`, snapshot.ID, state, claim, snapshot.Status, snapshot.Signature)
	return err
}

func (s *Store) Fulfill(ctx context.Context, code string) (Operation, error) {
	return scan(s.Pool.QueryRow(ctx, `UPDATE operations SET fulfilled_at=now(),updated_at=now() WHERE claim_code=$1 AND kind='redeem' AND status='confirmed' AND fulfilled_at IS NULL RETURNING `+columns, code))
}
