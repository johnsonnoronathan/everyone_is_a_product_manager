# Will it survive the midnight sneaker drop? Peak-traffic report for the flash-sale shop

**Verdict:** Not ready yet. It is fast enough (it handled twice the expected midnight rush, 1,200 requests a second, with almost every page under 6 ms) and it never sold more than 100 pairs. But one malformed request takes the whole site down, and when the payment provider or the database is slow, customers can be charged without getting an order, or charged twice.

| Check | Result | Evidence |
|---|---|---|
| Handles expected peak (600 req/s) | ✅ holds up to 200% of target (1,200 req/s), no step failed | `load-summary.md` |
| Never oversells / double-charges | ✅ never oversold (96 of 100 sold, 0 double charges with the test provider) · ❌ double charges reproduced when the provider answers in about 3 s (41 payments for 39 pairs) | `oversell-summary.md`, `../findings/architecture.md` ARC-01 |
| Code patterns that fail under load | 1 critical, 2 high, 4 medium, 1 low | findings below |

## What we tested
- **Expected traffic:** 3,000 visitors in 60 s (from the product owner). Assumptions in `brief.json`: 3× peak factor, 3 product-page requests and 1 buy attempt per visitor. That gives **450 product-page req/s + 150 buy req/s = 600 req/s** at 100%, tested in steps of 50%, 100%, 150% and 200%, 20 s each (`plan.json`).
- **Environment:** one local Node.js process (`http://127.0.0.1:3000`, commit `d572634`) with a simulated hosted Postgres (10 connections, ~3 ms per query) and a simulated payment provider (80–200 ms, 2% of calls hang for 30 s). Test sign-in via the demo login (1,000 pre-made sessions). No load balancer, TLS or CDN in front. The production instance size is unknown, so these numbers show the code's behaviour, not production capacity.
- **Load generator:** k6 on the same machine as the app. Its CPU use was not recorded in the summaries.
- **Not tested:**
  - Sign-in under load: the production magic link wasn't available (see OPS-03).
  - Checkout with stock left at 100–200%: the 100 pairs sold during the first step, so later buy requests hit the fast "sold out" shortcut.
  - A payment provider that is slow but succeeds, or a slower database: the simulators can't do this in a load test, so these were reproduced separately (ARC-01, ARC-02).
  - Traffic through the real load balancer (PERF-02), bot traffic (PERF-01, SEC-03), a second server (ARC-06) and real email.

## Results in plain language
- At the expected midnight rush and at twice that, 95% of product-page loads were answered within 6 ms and 99% within 56 ms on the test machine (production adds network time).
- The 100 pairs sold in the first step. 4 of about 1,500 buy attempts in that step got "Payment did not go through" because the simulated provider hung. Expect a few percent of real checkouts to hit the 3-second payment timeout on a busy night, and each of those is a case where the money may still have been taken (ARC-01).
- In the rush test, 1,000 shoppers double-clicked "Buy" at the same instant: never more than 100 sold, one order per customer, nobody charged twice by the test provider. 4 pairs came back after failed payments and stayed unsold, because everyone had already been told "Sold out" (ARC-09).
- Nothing ran out at this load: the database connections and the single process kept up.
- Two things the load test can't show were reproduced by hand on a local copy. With a provider answering at about 3 s, 40 shoppers were charged 41 times for 39 pairs. With the database busy, a shopper was charged and told "We are very busy", and the order was left stuck.

## Findings (most important first)

| # | Severity | What happens at peak (plain language) | Where | Fix | Effort |
|---|---|---|---|---|---|
| 1 | Critical | One request to `//` crashes the only server; every shopper is cut off until it restarts (SEC-01) | `fixed/server.mjs:346` | Parse the URL inside the error handler; restart supervisor | S |
| 2 | High | A slow payment (> 3 s) is treated as failed: the pair is resold and the customer is charged again when they retry (ARC-01) | `fixed/server.mjs:179-192, 264-277` | Treat a timeout as "unknown", keep the reservation, reuse the idempotency key, reconcile with the provider | M |
| 3 | High | When the database is busy, a customer who paid sees "We are very busy" and the order stays stuck as pending (ARC-02) | `fixed/server.mjs:41, 279, 271-274` | Don't fail fast after money moved; retry the write; sweeper for stuck orders | M |
| 4 | Medium | A script hammering `/api/search` or made-up product numbers keeps the database busy, so real checkouts fail (PERF-01) | `fixed/server.mjs:154-174, 226-229` | Remove search, accept only real ids, cap the cache, per-IP limits at the edge | S |
| 5 | Medium | Scalper bots with many email addresses can take a big share of the 100 pairs (SEC-03) | `fixed/server.mjs:50, 234` | Normalise emails, limit by address/card, bot check or waiting room | M |
| 6 | Medium | Random 502 error pages at peak when the load balancer reuses a connection Node just closed (PERF-02) | `fixed/server.mjs:365-366` | `keepAliveTimeout` above the load balancer's idle timeout | S |
| 7 | Medium | With a second server, "sold out" and rate limits differ per server (ARC-06) | `fixed/server.mjs:137, 177` | Shared store before scaling out | M |
| 8 | Low | Pairs returned by failed payments stay unsold after "Sold out" is shown (ARC-09, found by test) | `fixed/server.mjs:259-262`, `shared/public/app.js:67` | "All reserved, check back" message and auto re-check | S |

## Top 3 actions before launch
1. **Stop the crash** (SEC-01): one-line fix plus a restart supervisor. Expected effect: no single request can take the sale down. Also make restarts harmless (ARC-05: no seed or schema step at start-up).
2. **Make payment outcomes safe** (ARC-01, ARC-02): a timeout means "we're confirming", not "try again". Keep the pair reserved, reuse the same idempotency key, add a job that matches provider charges to orders and settles stuck "pending" orders. Expected effect: no charge without an order, no double charge.
3. **Put a gate in front of the rush** (SEC-03, PERF-01, PERF-02): a virtual waiting room or bot protection, per-IP limits at the load balancer/CDN, remove the unused search endpoint, and set the keep-alive timeout. Then **re-test through the real load balancer on production-sized hardware**, with the test provider set to answer in 3–5 s.

Safety nets for the night: one person on call watching a small dashboard (paid orders vs provider charges, 5xx rate, pool "waiting"), a pause switch for the sale (OPS-02, not built yet), and no second server until ARC-05 and ARC-06 are fixed.

## Re-test
After the fixes, use the same plan and environment, plus the two scripts in `../repro/`. Before → after targets:

| Measure | Before | Target |
|---|---|---|
| `GET //` | process exits | 400, server keeps running |
| Provider ~3 s, 40 shoppers who retry: payments vs paid pairs | 41 vs 39 | equal |
| Busy database during payment: charged but order stuck | 1 of 2 runs | 0 |
| Load test 200% step, oversell check | PASS / PASS | PASS / PASS (re-run through the load balancer) |

---
*Glossary:* **req/s**: requests per second the site receives. **p95 / p99**: 95% / 99% of requests were faster than this. **Error rate**: share of requests that failed. **Oversell**: confirming more orders than there is stock. **Idempotency key**: a label sent with a payment so the provider charges only once even if the request is repeated. **Load balancer**: the front door that passes visitors' requests to the app server.
