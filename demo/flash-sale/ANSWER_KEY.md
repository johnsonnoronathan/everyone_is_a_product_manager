# Answer key: issues planted in `naive/server.mjs`

> Spoilers. This file exists so we can measure how many issues a review finds.
> When you test the review skills on the demo, point them at `naive/` only and
> don't let them read this file.

Severity uses the rubric in `.claude/skills/launch-review/references/severity.md`.

| ID | Area | Issue | Where | Severity | Fixed in `fixed/` by |
|----|------|-------|-------|----------|----------------------|
| P1 | Correctness under load | **Overselling.** Stock is read, the card is charged, then `SET stock = ?` writes the old value minus one. Concurrent buyers all see stock > 0 and overwrite each other's decrement (lost update). | `POST /api/buy` | Critical | Single atomic `UPDATE … SET stock = stock - 1 WHERE stock > 0` inside a transaction |
| P2 | Correctness under load | **Duplicate orders.** A double-click or retry creates a second order and a second charge. No idempotency, no one-per-customer rule. | `POST /api/buy`, `orders` table | High | Partial unique index on `(product_id, customer)` for live orders; payment idempotency key |
| P3 | Performance | **Charging before reserving.** Customers are charged even when the last unit is gone by the time the order is written. | `POST /api/buy` | High | Reserve first, charge second, release on failure |
| P4 | Performance | **N+1 queries, no cache** on the product page: 14 DB round-trips per view, and every view hits the DB. | `GET /api/products/:id` | High | One JOIN, 1-second cache, single-flight refresh |
| P5 | Resilience | **No timeout on the payment call.** When the provider hangs, requests hang for 30 s+. | `chargeCard` | High | `AbortSignal.timeout(3000)`, release the reservation, return 503 |
| P6 | Performance | **Confirmation email sent inside the request** (+250 ms per order). | `sendConfirmationEmail` | Medium | Background queue (in-memory in the demo; durable queue in production) |
| P7 | Performance | **`readFileSync` on every page/asset request** blocks the event loop. No cache headers. | `GET /`, `/app.js`, `/style.css` | Low | Read once at startup; `cache-control` |
| P8 | Resilience | **DB pool waits forever.** Under overload requests queue indefinitely instead of failing fast. | `openDb()` defaults | Medium | `acquireTimeoutMs: 1000` + 503 with `Retry-After` |
| P9 | Resilience | **No rate limit** on buy/login; bots can hammer the endpoints. | all | Medium | Per-customer token bucket |
| S1 | Security | **Hard-coded payment secret key** in source. | top of file | Critical | Read from environment, fail if missing |
| S2 | Security | **Forgeable login token:** base64 JSON, unsigned, never expires. Anyone can impersonate anyone. | `currentUser`, `/api/login` | Critical | HMAC-signed token with expiry |
| S3 | Security | **SQL injection** in search; leaks every customer's email and amount. | `GET /api/search` | Critical | Parameterised query, input length cap, `LIMIT` |
| S4 | Security | **IDOR:** any visitor can read any order (incl. address) by changing the number in the URL. | `GET /api/orders/:id` | High | Query scoped to the signed-in customer |
| S5 | Security | **Unauthenticated admin endpoints:** anyone can wipe all orders or read sales stats. | `/api/admin/*` | Critical | `x-admin-token` checked with constant-time compare |
| S6 | Security / business logic | **Price trusted from the browser:** buyer can pay 1 cent. | `POST /api/buy` | Critical | Server-side price |
| S7 | Security / resilience | **One malformed JSON body crashes the whole server** (`JSON.parse` throws in a stream callback). No body-size limit. | `readBody` | Critical | try/catch → 400; 10 KB limit → 413 |
| S8 | Security | **Stack traces sent to the client.** | top-level error handler | Medium | Generic message + request id; details only in server logs |
| S9 | Security | **No security headers** (CSP, nosniff…); `Access-Control-Allow-Origin: *` on every API response. | `sendJson` | Low | Security headers, no wildcard CORS |
| S10 | Security / privacy | **Order API returns full PII** (address) and customer emails are written to logs. | `/api/orders/:id`, `sendConfirmationEmail` | Medium | Select only needed columns; don't log emails |
| O1 | Operations | **No health check, no graceful shutdown, no server timeouts.** | server setup | Medium | `/healthz`, SIGTERM handler, `requestTimeout` |

## Found by the review, not planted

The validation run ([`sample-reports/SCORECARD.md`](sample-reports/SCORECARD.md)) found real issues we didn't plant:

- **Both variants:** parsing the request URL outside `try`. In `naive/`, a bad `Host` header crashes the process; in `fixed/`, `GET //` does (Critical). Start-up deletes all data via `seed()`. The page never asks for a shipping address. The midnight start isn't enforced.
- **`fixed/` round 1 only, introduced by the "fixes" above (round 2 is in the scorecard):** P5's fix (timeout → release the reservation → 503 "try again") can charge a customer twice when the provider is slow but succeeds. The correct fix treats a timeout as *unknown* and reconciles with the provider. After a successful charge, a pool timeout can leave a paid order stuck as pending.

## Deliberate demo simplifications (present in both variants, not bugs to score)

- The database is in-memory SQLite with simulated network latency (`shared/db.mjs`).
- `/api/login` has no password/magic link; in `fixed/` it's a test stub gated by `DEMO_LOGIN=1`.
- The fixed version keeps the rate limiter, product cache and email queue in process memory. That's fine for one server, but each needs a shared store (Redis, a durable queue) once you run several. A good review flags this as a launch **condition**.
