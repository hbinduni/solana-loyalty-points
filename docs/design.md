# Orbit loyalty

## Scope

A single-merchant loyalty app with non-transferable integer points on Solana Devnet. React, Vite, Bun, TypeScript 7 and StyleX live in `/client`; Go and Fiber live in `/server`. PostgreSQL stores reward definitions and operation records. Redis stores short-lived authentication data and the public reward cache.

Token-2022 supplies minting, burning and non-transferability. A custom Rust or C program is unnecessary for this scope. The merchant owns mint authority. Members retain their own keys and authorize redemptions. Mainnet, token transfers, fiat payments and inventory fulfillment are outside this first version.

## Flows and consistency

- Wallet Standard connection and Ed25519 signed, expiring, single-use login challenges. Opaque sessions use HttpOnly, SameSite cookies and origin checks on writes.
- A merchant API key protects issuance. An idempotency key uniquely identifies each award. The backend prepares and signs the transaction, persists it, then submits it.
- Redemption creates an exact burn transaction with a unique memo. The wallet signs; the backend compares the signed message against the stored message and verifies signatures before submission.
- A PostgreSQL operation journal retains signed transactions before RPC calls. Reconciliation resends the same transaction while it is valid. Ambiguous submission errors stay pending. Only finalized successful transactions become confirmed rewards. Expired operations require a new action and never reuse the old key for a different transaction.
- Solana is the balance authority. No cached balance authorizes redemption. The token program enforces available points, even for concurrent requests. Reward codes are issued only after finalization.
- An explicit, isolated demo provides sample points and rewards without wallet, database, or on-chain claims.

## Interface

Orbit is a member's reward wallet: a quiet navigation rail, a membership card, reward shelf and receipt-like activity list. Palette: paper `#f6f7f2`, ink `#232b25`, leaf `#405a42`, lime `#d9f27e`, lavender `#e9e4f4`, muted `#737c71`. Use a sans-serif face throughout, with generous numerals on the membership card. Left-align content. Make the lime membership card the main visual feature; reward categories use restrained pastel illustrations and clear point costs.

```
navigation | greeting                   wallet
           | membership card    | how points work
           | reward shelf: coffee / discount / tote
           | recent activity
```

Unlike a trading dashboard, show usable rewards first and keep chain details in activity links and network status. Mobile navigation becomes a compact horizontal row. Native dialogs, visible focus, reduced motion and readable contrast are required.

## Verification

Test wallet signature rejection/replay, operation ownership, merchant authorization, payload idempotency, signed-message tampering, uncertain RPC outcomes, finalization and insufficient points. Run real PostgreSQL/Redis integration tests with a deterministic RPC fixture, Go race/vet/build, TypeScript and production bundle checks, and desktop/mobile browser checks. Devnet chain deployment requires a funded authority; report that boundary explicitly.
