# Verification · 17 September 2026

| Gate | Result |
| --- | --- |
| TypeScript 7 and Biome | Passed |
| Client domain tests | Passed: demo redemption, insufficient points, integer precision |
| Vite production build | Passed |
| Go formatting, vet, build and race tests | Passed |
| PostgreSQL/Redis integration | Passed against local Compose services |
| Authentication | Valid Ed25519 signature accepted; altered messages, wrong wallet and replay rejected |
| Issuance | Merchant key required; retries reuse operation; conflicting payload rejected |
| Redemption | Ownership, insufficient points, exact message and signature validation tested |
| Settlement | RPC ambiguity remains pending; finalized success issues one claim; stale worker cannot overwrite submission |
| Collection | A second collection of a claim is rejected |
| Browser | Desktop and 390px mobile tested; no page exceptions or horizontal overflow |
| Browser interactions | Demo redemption changed 2,450 to 2,200 points; activity, category filters, dialogs and demo exit worked |
| Wallet login in browser | Ephemeral Wallet Standard test wallet signed into the real API; logout revoked its session |
| Local services | API healthy, PostgreSQL healthy, Redis healthy |
| Devnet transactions | Not executed: no funded authority or mint was configured |
| External wallet extensions | Not tested with Phantom or Solflare |
| Publication/deployment | Not performed |

Integration tests use real storage and a deterministic chain gateway. RPC tests exercise serialized instructions and finalization responses through a local HTTP fixture. These results do not establish live on-chain execution.

Repeat automated checks with `make check-all` and `make integration`. Follow the README to create and fund the Devnet authority, then verify issuance, non-transferability and redemption on Devnet before using the program with members.

## Follow-up · 18 September 2026

The member client now stores operation IDs alongside retry keys. It recovers unfinished operations across reloads and starts a fresh request after terminal outcomes, including keys saved by older clients. Balance and activity refresh independently; unavailable balances disable redemption without hiding existing reward codes. Responses arriving after session expiry cannot reopen a private claim dialog.

| Gate | Result |
| --- | --- |
| Client regression tests | 20 passed, including existing domain tests; real React rendering with controlled HTTP and wallet responses |
| Full validation | `make check-all` passed: TypeScript, Biome, client tests/build, Go formatting, vet, race tests and build |
| Storage integration | `make integration` passed against local PostgreSQL and Redis with the deterministic chain gateway |
| Retry recovery | Confirmed/failed/expired operations, legacy keys, reloads outside the activity window, lost prepare responses and unavailable status lookups covered |
| Partial outages | Claims load before a delayed balance completes; balance/activity failures, overlapping refreshes and session expiry covered |
| Browser regression | With controlled API responses and a Wallet Standard test wallet, a second redemption created a separate operation and its claim remained accessible during balance HTTP 503 |
| Mobile regression | At 390px, no horizontal overflow; unavailable balance shown explicitly and redemption disabled |
| Devnet network guard | Corrected a truncated genesis hash; regression accepts the full Devnet hash and rejects another network |
| Live Devnet RPC | `getGenesisHash` returned `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Devnet funding | User funded the authority with 10 Devnet SOL; 0.003 Devnet SOL transferred to a separate local test member for fees |
| Live mint/earn/burn/collection | Passed at 00:35 WIB on 18 September: mint created, 500 points issued, two separate 250-point burns finalized, both rewards collected |

The local authority is `7twutFoPeiPAiU9rWQotRcK3J26ocv1o7FnbRf9Q8wk6`; its private key is in the ignored `.local/authority.json`. `server/.env` now configures the validated mint, authority path and a generated merchant secret. PostgreSQL's `devnet_mint` setting matches the mint below.

### Live Devnet evidence

- Mint: [`81NcDN9ibRWng57uABVSATcKjn2ZoajJdBANxfgR4e2i`](https://explorer.solana.com/address/81NcDN9ibRWng57uABVSATcKjn2ZoajJdBANxfgR4e2i?cluster=devnet).
- Test member: `g8GybsPHxgGFzLVgwaJJELcFhvSpnVpchEmfmy726dc`. Its keypair is retained in the ignored `.local/test-member.json`.
- Completed at `2026-09-17T17:35:04Z` (18 September, 00:35 WIB). The ignored `.local/devnet-verification.json` records operation IDs and signatures.

| Action | Persisted operation | Finalized transaction |
| --- | --- | --- |
| Create non-transferable mint | Setup CLI | [Mint creation](https://explorer.solana.com/tx/4oynJAFwvfDfKnAkWwpLLgCSA38MdYMbwQaGyHaXUWchGiqtNaWUcbCVkMEQ8tQvpK21bgimC1rWovpGuy9tamse?cluster=devnet) |
| Award 500 points | `e64b9855-462b-44be-a82e-d6676bb28be4` | [Issuance](https://explorer.solana.com/tx/2HTQA7pCvNWT3c2DGx4iMj6dmfLPz7aPSADQqj6LQAxo3NsYHtvUuUEYPKK4HhDBcFcudS7BnFfRDrJ46NHoWvBh?cluster=devnet) |
| Redeem first 250-point coffee | `d78cacde-37ae-49d0-85a3-8defd74b057b` | [First burn](https://explorer.solana.com/tx/3RNhX74PmG26Cxn73JU7dvcEwYg4jBxxRQVcBVvCRETkrbytykJ9c6dLn9xYvtQUR8u5tfJiUZD1gtjaQHcnB1B9?cluster=devnet) |
| Redeem second 250-point coffee | `e5738567-1565-4bd9-a48b-e4856b1d0c81` | [Second burn](https://explorer.solana.com/tx/3pVgKLUQKgUtnSWWxzmHAFnb8F2AM4PGG7K8M9Qi6Wy1BiWq6cPynwG8KXSViWKiatVah8HbpHvUGBMrDE3G2SXa?cluster=devnet) |

Separate RPC reads confirmed all four transactions were `finalized` with `err: null`. API and direct chain balance reads agreed at 500, 250 and 0 points. PostgreSQL contains one confirmed earn and two distinct confirmed redemptions, each with a claim code and collection timestamp.

The real API also rejected replayed login challenges (`401`), changed issuance payloads using the same key (`409`), repeated collection (`409`), redemption with no remaining points (`409`), and member access after logout (`401`). An identical issuance retry returned the original operation. A signed Token-2022 transfer simulation on Devnet rejected the transfer with `NonTransferable` (`Custom: 37`); this check used simulation and did not broadcast a transfer.

Live signing used the Solana Go SDK and a local test keypair. Browser regression checks used a Wallet Standard test wallet with controlled responses. Phantom/Solflare extension compatibility, mainnet and production deployment remain unverified.

## Phantom acceptance follow-up · 18 September 2026

The real Phantom extension now passes login, rejected login, rejected redemption, two finalized 250-point burns, reload during settlement, claim recovery, and single-use collection. Account `3bEg…ovr2` moved from 500 to 250 to 0 points. The two claims were distinct; initial collection returned 200 and repeat collection returned 409 for each. The connected zero-balance UI disabled redemption. Logout removed member data and survived reload. Account switching was skipped at the user's request.

Testing exposed two bugs: polling erased wallet errors, and Phantom added compute-budget instructions to prepared burns, causing strict transaction validation to reject them. The client now preserves action errors separately from refresh errors. The API prepares explicit compute-budget instructions; both accepted Phantom transactions matched the prepared message exactly. Strict message and signature validation remain in place.

`make check-all` passed with 21 client tests and all client/server checks. `make integration` passed against local PostgreSQL and Redis. The [wallet acceptance record](wallet-acceptance.md) contains transaction links, observations and remaining cases. Solflare, mainnet and production deployment remain untested.

## Public repository and token metadata · 18 September 2026

The app and public token assets are published at [hbinduni/solana-loyalty-points](https://github.com/hbinduni/solana-loyalty-points). The initial commit contains 53 source, test, documentation and asset files. Local environment files, keypairs, signed recovery records, test helpers, dependencies and build output are excluded. A scan of the staged files found no matches for the actual local merchant secret, local private-key encodings or common credential patterns.

- Token identity: **Orbit Points (ORBIT)**, with the existing Orbit logo and a Devnet loyalty-point description.
- Existing mint: `81NcDN9ibRWng57uABVSATcKjn2ZoajJdBANxfgR4e2i`.
- Separate Metaplex metadata account: `8Jr26sUkSLYphjYNNphvqu6ZSzeR8gT2GkGDmueFiY98`.
- [Public metadata JSON](https://raw.githubusercontent.com/hbinduni/solana-loyalty-points/main/client/public/token/metadata.json) and [PNG logo](https://raw.githubusercontent.com/hbinduni/solana-loyalty-points/main/client/public/token/orbit-points.png) were fetched successfully without authentication.
- [Metadata creation transaction](https://explorer.solana.com/tx/2G3ZoSpmk5TcRGDx8BLapvHqDmBdPacQNuJFd4gqnZYZbPPY13tA8Pyr8ksx9DkkSTQEdhUPR9wPp4zrtbYyJ2BV?cluster=devnet): independently verified as finalized with no error.

Simulation and finalized readback both confirmed the mint account bytes remained unchanged, including supply and authorities. Independent RPC decoding confirmed the expected name, symbol and URI. Repeating the same command with `--apply` reported already current and submitted no transaction. The API remained healthy, and the acceptance wallet still held 0 points.

`make check-all` passed with 21 client tests and 9 metadata-tool tests, TypeScript, Biome, the production client build, Go formatting, vet, race tests and compilation. `make integration` passed. Review identified that the pinned Umi SDK drops per-call simulation commitment; the tool sets the connection commitment explicitly, with a request-level regression test verified failing before the fix and passing afterward.

The initial display check had no token row because the wallet held 0 points. The user then requested more points to verify the metadata. A 500-point award through the merchant API created operation `0dbc5767-abf7-41b5-bfa0-4fe078ad7e64`; its [issuance transaction](https://explorer.solana.com/tx/q4nviGdcA7rQWXNnd5UNSt9E8P7bXMKHJwfDQK3zM9cvqu1xzqAh5uSojk4qqo9ZDhEoTK57LmkJFNGxpbnxHSz?cluster=devnet) was independently verified as finalized with no error. The finalized token balance and Orbit UI both showed 500 points. Native Chrome accessibility and screenshot inspection then confirmed Phantom displayed **Orbit Points**, **500 ORBIT**, and the correct green Orbit logo. Wallet metadata display is verified.

## App-paid redemption fees · 18 September 2026

Orbit now uses the backend authority as fee payer for redemption. The prepared burn is unsigned; the member signs to authorize spending points. The API requires the exact stored message and correct member signature before adding the authority signature, then stores the fully signed transaction and its fee-payer signature before the worker can broadcast it.

`make check-all` and `make integration` passed. Regression tests cover fee-payer selection, unsigned preparation, changed fees/burns/memos/blockhashes, missing or wrong signatures, unexpected signers, trailing data, unauthorized submission, fully signed persistence, stable retries and stale-worker settlement. Independent code review found no blockers.

A live API/Go-SDK test completed at `2026-09-17T19:22:33Z` using a fresh member `EY6YeMvUC6jJtqTd4qpQKSgwTyjFcKjWjxtMSaBdCQ68` with no SOL funding:

| Check | Finalized result |
| --- | --- |
| Point balance | 250 → 0 |
| Member SOL | 0 → 0 lamports |
| Fee payer | App authority `7twutFoPeiPAiU9rWQotRcK3J26ocv1o7FnbRf9Q8wk6` |
| Network fee | 10,200 lamports, debited entirely from the authority |
| Burn operation | `e7472851-ce49-4ac0-825c-7db971045a53` |
| Claim | Created after finalization |
| Submission retry | Same transaction signature |

The [sponsored burn](https://explorer.solana.com/tx/2GqvS4VE2CtFAC1hxQmpdsMDpM2F2tPRNBhHHiqLVCMvjCSSWHg1H2r86JqKNUJ6EDkGu3AJirnyRhqvAJP9V55r?cluster=devnet) was independently fetched at finalized commitment with no execution error. Both transaction signatures verified. The authority's transaction balance decrease equalled the network fee; the member's pre/post SOL balances were zero. The ignored `.local/sponsored-redemption.json` retains the test record. This test used the Go SDK, not the Phantom extension.

The fresh Phantom flow also passed. Operation `e8162bf9-3f5f-471b-bf78-ef4e4230513f` finalized with a claim, and Chrome showed **Reward ready**. Independent finalized RPC evidence for the [Phantom sponsored burn](https://explorer.solana.com/tx/59fpjVxqJoxDFC2TLtG69cWqbj3ekAAdPRdpzQpbYBbyur71DGX6wecWb7YzTVVSsrv7Br4Lx4N4w8Gy582h2DFX?cluster=devnet) showed no execution error, 500 → 250 points, and exactly 2,989,600 lamports (0.0029896 SOL) in the member account before and after. The authority was the fee payer and lost exactly the 10,200-lamport fee. The agent opened the approval prompt; wallet confirmation remained with the user.
