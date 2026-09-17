CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS rewards (
 id text PRIMARY KEY,
 title text NOT NULL,
 description text NOT NULL,
 category text NOT NULL,
 points bigint NOT NULL CHECK (points > 0 AND points <= 1000000000),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS operations (
 id uuid PRIMARY KEY,
 wallet text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('earn', 'redeem')),
 reward_id text REFERENCES rewards(id),
 title text NOT NULL,
 points bigint NOT NULL CHECK (points > 0 AND points <= 1000000000),
 idempotency_key text NOT NULL,
 payload_hash text NOT NULL,
 status text NOT NULL CHECK (status IN ('prepared', 'pending', 'confirmed', 'failed', 'expired')),
 message bytea NOT NULL,
 transaction_base64 text NOT NULL,
 signature text UNIQUE,
 last_valid_block_height bigint NOT NULL,
 claim_code uuid UNIQUE,
 fulfilled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(wallet, kind, idempotency_key)
);
CREATE INDEX IF NOT EXISTS operations_wallet_created ON operations(wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS operations_unsettled ON operations(created_at) WHERE status IN ('pending', 'prepared');
INSERT INTO rewards(id, title, description, category, points) VALUES
 ('coffee', 'Your next coffee, on us', 'A handcrafted coffee of your choice. Show your reward code at the counter.', 'Food & drink', 250),
 ('discount', 'A little off your next visit', 'Enjoy 10% off your next purchase. One reward per purchase.', 'Shopping', 500),
 ('tote', 'The everyday tote', 'A reusable cotton tote for wherever the day takes you. Collect in store.', 'Merch', 1200)
ON CONFLICT DO NOTHING;
