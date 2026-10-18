# Will it survive the midnight sneaker drop? Peak-traffic report for the holiday flash sale

**Verdict: Not ready.** The site slows to multi-second page loads at **50% of the expected peak** (the first and lowest step of the test), and under a realistic rush it **oversold 1,962 pairs of a 100-pair stock** and **charged 963 customers twice**. It fails on both counts: it falls over below the target load, and it is incorrect while doing so.

| Check | Result | Evidence |
|---|---|---|
| Handles expected peak (600 req/s) | FAIL - fails the lowest step; breaks at 50% of target (300 req/s) | `load-summary.md` / `load-summary.json` |
| Never oversells / double-charges | FAIL - 1,962 orders for 100 units; 963 buyers charged twice | `oversell-summary.md` / `oversell-summary.json` |
| Code patterns that fail under load | 2 critical, 2 high, 3 medium | findings below / `../findings/performance.md` |

## What we tested
- **Expected traffic (owner's numbers):** 3,000 visitors within 60 s, with a 3x peak factor. Journey per visitor: 3 product-page views + 1 buy. That gives a target of **~600 req/s** (450 product-page + 150 buy) at 100%, tested in staged steps of 50 / 100 / 150 / 200%, 20 s each (`brief.json`, `plan.json`). These figures came from the product owner; the peak factor and journey mix are the test's assumptions.
- **Environment:** the local demo instance (`http://127.0.0.1:3000`), one Node process, in front of the simulated hosted Postgres (10-connection pool, ~3 ms/query) and the simulated payment provider (usually fast, ~2% of charges hang for 30 s). This is **not** production; a real hosted Postgres and network will behave differently, so treat the absolute numbers as indicative and the failure modes as real.
- **Load generator:** k6 on the same host (local demo). For production-scale numbers, re-run from a machine near the app and watch generator CPU stays < ~80%.
- **Requests mirrored the real frontend:** same paths and bodies the browser sends (`GET /api/products/1`, `POST /api/buy` with `{productId, price}` and a bearer token from `POST /api/login`).
- **Not tested here (results pre-supplied; k6 not re-run in this engagement):** login throughput under load, the real payment provider's rate limits, CDN behaviour, and multi-instance/load-balancer effects. Noted as assumptions where they matter.

## Results in plain language
- **It breaks at half the expected peak.** At 300 req/s (50% of target), product pages took a median 1.86 s and a p95 of 2.63 s against a 500 ms budget, and 473 requests could not even be sent because every simulated shopper was stuck waiting. At 100% it was far worse (p95 5.3 s, 4,808 requests never sent).
- **The product page is the bottleneck.** Its throughput flat-lined around ~210-230 req/s no matter how hard we pushed - the sign of a resource running out. That matches the code: each product view makes 14 database round trips (PERF-05) against a 10-connection pool that waits forever (PERF-04), so connections starve and latency explodes.
- **Checkout failures track the hanging payment provider.** Buy showed ~1-2% errors/timeouts at the lower steps (27-29 timeouts), consistent with charges that hang for 30 s with no timeout in the app (PERF-03). The acceptance test AC-08 confirmed the customer-facing effect: when the provider doesn't respond, the shopper is left on "Placing your order..." with no error and the pair is not released.
- **Under a real rush it oversells massively.** 1,000 buyers each double-clicking against 100 units produced **1,962 confirmed purchases** - 1,862 customers promised sneakers that don't exist - and the database agreed (1,962 orders). Stock arithmetic was nonsense (1,962 sold + 92 remaining does not equal 100 start).
- **It double-charges.** 963 buyers got two confirmed orders (and two charges) from a single double-click, because there's no one-per-customer limit and no idempotency (PERF-02).
- **The one bright spot is misleading:** the "Buy" step "passed" its speed budget at 150% and 200%, but only because by then the product page had collapsed and far fewer shoppers ever reached checkout.

## Findings (most important first)

| # | Severity | What happens at peak (plain language) | Where | Fix | Effort |
|---|---|---|---|---|---|
| PERF-01 | Critical | The shop confirms far more orders than it has pairs (1,962 for 100 in the test) | `demo/flash-sale/naive/server.mjs:107-111` | Atomic conditional stock update + reserve before charge | M |
| PERF-02 | Critical | A double-click charges the customer twice and makes two orders (963 buyers in the test) | `demo/flash-sale/naive/server.mjs:102-117` | Unique one-per-customer constraint + idempotency key to the provider | M |
| PERF-03 | High | One hung card charge ties up a request for 30 s; at peak these pile up and checkout stalls | `demo/flash-sale/naive/server.mjs:49-57,110` | 2-5 s timeout on the payment call; release reservation and show an error on failure | S |
| PERF-04 | High | Database connections run out; requests queue forever and the whole site hangs instead of shedding load | `demo/flash-sale/naive/server.mjs:13` (pool defaults) | Right-size pool, set an acquire timeout, return fast 503 + Retry-After | M |
| PERF-05 | Medium | The product page makes 14 database trips each time, so it's the first thing to fall over | `demo/flash-sale/naive/server.mjs:88-92` | One JOIN / `IN (...)` instead of a query per review | S |
| PERF-06 | Medium | Every checkout waits ~250 ms on the confirmation email before responding | `demo/flash-sale/naive/server.mjs:59-63,116` | Send the email on a background queue | S |
| PERF-07 | Medium | Thousands of identical reads all hit disk and the database; nothing is cached | `demo/flash-sale/naive/server.mjs:66-77,85-94` | CDN for assets + a 1-2 s cache on the product read | S |

## Top 3 actions before launch
1. **Make stock and orders correct under concurrency** (PERF-01 + PERF-02): one atomic `UPDATE ... WHERE stock > 0`, a unique one-order-per-customer constraint, and an idempotency key passed to the payment provider. Effect: no oversell, no double charge. This is the launch blocker. Effort: ~1 day.
2. **Cut the product page to one or two queries and cache it** (PERF-05 + PERF-07 + PERF-04): JOIN reviews, cache for 1-2 s, serve assets from the CDN, and give the connection pool a sane size and a fast-fail timeout. Effect: the page stops being the bottleneck and the site stops hanging under load. Effort: ~half a day.
3. **Put a timeout and clean failure on the payment call** (PERF-03 + PERF-06): 2-5 s timeout, release the reservation and tell the shopper if it fails, and move the email off the request path. Effort: a few hours.

**Operational safety nets (headroom is effectively zero, so these matter):** a virtual waiting room to cap how many shoppers are in checkout at once; pre-scaling / raised plan limits before midnight; a kill switch to pause the sale; and an on-call engineer watching a dashboard (request rate, error rate, DB connections) during the drop. See `../findings/operations.md`.

## Re-test
After fixes, re-run the **same** plan (`plan.json`) unchanged against the same environment and compare before -> after for: product-page p95, the step at which it fails, and the oversell/double-charge counts (which must be 0 and 0). Do not relax the thresholds to make it pass.

---
*Glossary:* **req/s** requests per second the site receives. **p95** 95% of requests were faster than this. **Error rate** share of requests that failed. **Oversell** confirming more orders than there is stock. **Not sent** requests the load tool couldn't even start because shoppers were stuck waiting - a sign the site stopped keeping up. **Staging** a copy of the site for testing.
