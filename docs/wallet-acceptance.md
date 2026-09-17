# Real-wallet acceptance

Status: Phantom login, rejected login, cancellation, two finalized redemptions (500 → 250 → 0), pending reload recovery, claim recovery, single-use collection, zero-balance UI and logout UI passed on 18 September 2026. Account switching was skipped at the user's request. Solflare is untested.

Use the local app at `http://localhost:5173` on the same computer as the running services. Test Phantom and Solflare separately. Results from one extension do not establish compatibility with the other.

## Preparation

- Install or enable the chosen wallet extension in the browser used for testing.
- Create two dedicated test accounts, A and B, and select Solana Devnet. Keep recovery phrases and private keys inside the wallet.
- Disable automatic signing or localhost auto-confirm so approval and cancellation can be tested.
- Supply only account A's public Solana address. The operator will award 500 test points through the merchant API. Orbit pays redemption network fees; neither member account needs SOL.
- Record browser and extension versions, public addresses, starting balances, and test time when the session starts.

Phantom exposes Testnet Mode and Auto-Confirm on localhost under [Settings → Developer Settings](https://help.phantom.com/articles/28951369255699). Solflare selects Devnet through its [Network setting](https://help.solflare.com/en/articles/6328814-differences-between-mainnet-devnet-and-testnet-and-how-to-switch-between-on-solflare).

## Acceptance cases

| Case | Action | Acceptance condition | Result |
| --- | --- | --- | --- |
| Discovery | Open Connect wallet with the extension enabled. | The real wallet is listed without an injected test fixture. | Passed: Phantom listed in the user's Chrome tab on 18 September 2026 |
| Rejected login | Connect account A, then reject the login message. | No member session is granted; the UI offers a retry. | Passed in the real extension after logout: Cancel returned User rejected the request with an enabled Phantom retry button and no member data |
| Login | Retry and approve the login message. | The API verifies the signature; the app displays account A and its balance. | Passed: user approved Phantom login; operator observed account 3bEg…ovr2 and 500 points in Chrome |
| Issuance | Award 500 points to fresh account A through the merchant API. | The app and finalized chain balance reach 500; activity contains the issuance. | Passed: API and chain verified; Chrome shows 500 points and the matching issuance transaction in Activity |
| Rejected redemption | Select the 250-point coffee and reject transaction signing. | No burn is submitted, no claim is issued, and the balance remains 500. | Passed: user cancelled; Chrome and finalized chain show 500 points; both recorded attempts expired unsigned without claims |
| Successful retry | Retry the coffee redemption and approve signing. | One burn finalizes, the balance becomes 250, and one claim appears. | Passed after the compute-budget fix: operation `e1de33c2…` finalized, chain and UI showed 250, and the claim opened |
| Reload recovery | Reload while that submitted redemption is pending, if the timing permits. Otherwise use the second redemption below. | The same operation settles; reload creates no additional burn. Mark untested if pending timing cannot be observed. | Passed: second operation was pending with a persisted signature; reload showed Confirming on Solana, then the same operation settled |
| Second redemption | Reconnect signing if needed, then approve another 250-point coffee. | A distinct operation and claim are created; the finalized balance reaches 0. | Passed: operation `fbaf9cae…`, distinct signature and claim; chain and UI showed 0 |
| Claim recovery | Reload and open Activity after settlement. | Both claims remain accessible. | Passed: first claim matched before/after reload; both claims remained accessible after the second pending reload |
| Account isolation | Open a claim, then switch the extension to account B. | A's private claim is hidden and its signing connection invalidated; signing in as B reveals only B's data. | Skipped at the user's request |
| Return to A | Switch back and reconnect account A. | A's own history and claims return. | Skipped with account-switch testing |
| Collection | Fulfill each claim through the merchant API, then repeat the request. | Each first collection succeeds; each duplicate returns 409. The UI shows collection after refresh. | Passed: both first requests returned 200, both duplicates returned 409; Chrome displayed two Collected receipts |
| Insufficient points | Attempt another coffee redemption at 0 points. | The UI prevents it; the API rejects a direct request. | UI passed: connected Phantom account shows You need 250 more points and a disabled Redeem button. Direct API rejection was verified with the earlier SDK test account, not this browser session |
| Logout | Disconnect in Orbit, then reload and check the member endpoint. | Private member data clears and the revoked session receives 401. | UI passed: disconnect removed the account and receipts; reload remained signed out. Direct revoked-cookie HTTP 401 was covered by the earlier SDK test, not repeated for this browser cookie |

Record each wallet's results separately, with operation IDs, finalized transaction signatures and any observed wallet error. Never record recovery phrases, private keys, session cookies, or merchant credentials. A wallet case passes only after observation with the real extension and matching API/chain evidence where applicable.

## Session · 18 September 2026

- Browser: the user's existing Chrome tab at `http://localhost:5173/`; extension: Phantom. Versions remain to be recorded.
- Account A: `3bEgAiDuKHMbaRGewLFPM2XazWiPqJgz9UJopNctovr2`, supplied by the user.
- Mint: `81NcDN9ibRWng57uABVSATcKjn2ZoajJdBANxfgR4e2i`.
- Starting finalized balance: 0 SOL and 0 points.
- [Funding transaction](https://explorer.solana.com/tx/3qsuYsVxMZswB5e2Qi8aVhLYZM4aZCSr6wzyzDrrjdUQjMZxGGhFUwPNEJxPZoyZeDGqfstdwmGZGJA3k3CYxSvW?cluster=devnet): finalized, supplying 0.003 Devnet SOL.
- [500-point issuance](https://explorer.solana.com/tx/5rvE25SyxByNg4Q5b57HhgLENGzsTTLgs62Ghdaeci5kh3DNxeFj7tazKgcmAR94NaiZueKvA56Brjojhh9WGBeF?cluster=devnet): finalized; API operation `e45a4749-e0db-4d05-a09e-f2db800cad8f` is confirmed.
- Independent finalized balance reads at preparation completion: 0.003 SOL and 500 points, `2026-09-17T17:55:48Z` (18 September, 00:55 WIB).
- The real Chrome wallet picker listed Phantom. The user approved the initial login and reconnection; Chrome displayed the matching account, 500 points and the issuance activity link. Reconnect after reload restored signing without losing authenticated history.
- After the user reported cancelling, Chrome returned to an enabled Redeem button and showed 500 points. A finalized Devnet read also returned 500. PostgreSQL showed `ecc4c2ec-2a4a-4477-a325-0fb88fa7e5b5` and a second attempt, `1b7c37f0-0325-4789-bf2d-161508317753`, both expired with no signature or claim. Both appear as Expired in Activity. The operator did not observe the second attempt being initiated or the transient cancellation error.
- The user reported approving the next attempt, `657f808f-afe4-4c8b-9259-29ea61797f1a`. It was created at `2026-09-17T18:04:01.882464Z` and marked expired at `18:04:28.647451Z`, about 27 seconds later. No signature or claim was persisted. Chrome and a fresh finalized chain read still showed 500 points. The user described seeing "reward 1"; the specific screen and meaning of that indication have not been established.
- At that checkpoint the cause was unknown. The later captured submission below established a transaction-message mismatch.
- Native Chrome inspection confirmed that Phantom is in Testnet Mode and displays `0.003 SOL` and `500` units of an `Unknown Token` beginning `81Nc`. The dashes occupy price fields; they do not indicate an empty token balance. The setup CLI initializes the non-transferable mint without token name/symbol metadata.
- The operator observed separate Phantom screens for Sign Message (Orbit authentication) and Confirm Transaction (an estimated 250-token debit). Attempt `328c1016-156b-46bc-8baf-e39cbdf459c4` also ended expired without a persisted signature. The exact signing/submission error was not captured at that point.
- A client bug was reproduced in a regression test: a successful background balance/activity refresh erased a preceding signing error. The client now keeps refresh errors separate from action errors; signing errors persist until retry or dismissal, and transient refresh errors still clear on recovery. The test failed before the fix and passed afterward. `make check-all` passed with 21 client tests, the client build, and Go formatting/vet/race tests/build.
- The next diagnostic attempt, `7b98cfad-47d0-40ef-b4e7-ed9c99549b9e`, captured HTTP 400: `wallet changed the requested transaction`. Comparing the prepared and Phantom-signed messages proved that Phantom prepended Compute Budget instructions for a price of 375,000 micro-lamports and a limit of 200,000 units. The burn amount, owner, mint, blockhash and operation memo were unchanged. The signature was valid. The rejected operation later expired without a claim; expiry was a consequence, not the demonstrated submission blocker.
- `BuildBurn` now prepares an explicit price of 1,000 micro-lamports and a limit of 200,000 units, followed by the burn and memo. Strict message equality and signature verification remain unchanged. A regression test failed before this change and passed afterward. `make check-all` (21 client tests, TypeScript, Biome, client build, Go formatting/vet/race tests/build) and `make integration` passed.
- Both subsequent Phantom-signed transactions contained four instructions, matched their stored prepared messages exactly, and passed signature verification. Each charged 5,200 lamports, including a 200-lamport priority fee.

### Finalized Phantom redemptions

| Operation | Finalized transaction | Settled at (UTC) | Result |
| --- | --- | --- | --- |
| `e1de33c2-a83c-481d-b697-fba9002aeb09` | [First Phantom burn](https://explorer.solana.com/tx/3rtuheyFJ5zK8TRMyEq4p97rGDG6U9tmnr88rWMC49stdSHHPMe1fzn3MtHaudStcL6UGCTmVRQsikFprUkniCcq?cluster=devnet) | 2026-09-17 18:30:38 | 500 → 250 points; one claim |
| `fbaf9cae-d3c9-4626-a91f-f52e9240367e` | [Second Phantom burn](https://explorer.solana.com/tx/3RNreWJopNyK4fg1XYY1CYCSaRyH3dk683y2gYc39spSbnT6wxNeJwoLjrMAPVhARJPzABm4ETzkeVMLEYemYGzH?cluster=devnet) | 2026-09-17 18:32:35 | 250 → 0 points; a distinct claim |

Independent Devnet RPC reads returned `finalized` and `err: null` for both signatures. The final account balance was 0 points and 0.0029896 Devnet SOL. PostgreSQL contained exactly these two confirmed redemptions for this wallet. The user confirmed both transactions manually in Phantom.

The first claim reopened with the same code after reload. During the second redemption, the operator observed a persisted pending signature, reloaded, saw Confirming on Solana, then observed the same operation become Reward ready. Both rewards were subsequently collected through the merchant API; duplicate collection returned 409 for each. No further burn was created.

The connected account's zero-balance reward dialog displayed You need 250 more points with Redeem disabled. Disconnect removed the account and private receipts, including after reload. Cancelling a subsequent real Phantom login message left the app signed out and offered a retry. Approving the retry restored the correct account, 0 points and both collected receipts. Direct navigation to the member API was blocked by the browser, so this session does not add a separate HTTP 401 assertion. Account-switch testing was explicitly skipped by the user.

## App-paid redemption fees · 18 September 2026

Redemptions now use the backend authority as fee payer. The member approves the burn; the API validates that approval before adding the authority signature. The earlier completed Phantom runs above used member-paid fees; the new signing flow was verified separately below.

The fresh Phantom flow also passed. Operation `e8162bf9-3f5f-471b-bf78-ef4e4230513f` finalized with a claim, and Chrome showed **Reward ready**. Independent finalized RPC evidence for the [Phantom sponsored burn](https://explorer.solana.com/tx/59fpjVxqJoxDFC2TLtG69cWqbj3ekAAdPRdpzQpbYBbyur71DGX6wecWb7YzTVVSsrv7Br4Lx4N4w8Gy582h2DFX?cluster=devnet) showed no execution error, 500 → 250 points, and exactly 2,989,600 lamports (0.0029896 SOL) in the member account before and after. The authority was the fee payer and lost exactly the 10,200-lamport fee. The agent opened the approval prompt; wallet confirmation remained with the user.
