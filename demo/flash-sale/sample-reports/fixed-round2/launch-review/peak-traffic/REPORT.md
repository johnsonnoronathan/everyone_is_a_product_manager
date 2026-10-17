# Will it survive the midnight sneaker drop? Peak-traffic report for the flash-sale shop (round 2)

**Verdict:** Ready for the expected midnight rush on the test machine, but not proven beyond it. In all three runs it handled the expected 600 requests a second with 95% of answers under 5 ms and no server errors, and in the rush test it sold exactly 100 pairs with nobody charged twice. One of the three runs faltered at 1.5× the expected rush, so there is no reliable headroom. Three code problems can still hurt at peak: one signed-in script can block checkout when the database is slow, the teaser page loops if it's opened more than about 25 days before the sale, and a payment error that never resolves locks pairs as "confirming".

| Check | Result | Evidence |
|---|---|---|
| Handles expected peak (600 req/s) | PASS in every run: 3 of 3 round-2 runs, plus a same-day run of the round-1 code. Holds to 200% (1,200 req/s) in 2 of 3 runs. FAIL in 1 of 3 runs at 150% (481 product-page requests not sent) | `load-summary.md`, `load-summary-run2.md`, `load-summary-run3.md`, `load-summary-round1-code-same-day.md`, `RUNS.md` |
| Never oversells / double-charges | PASS: 100 of 100 sold, 0 charged twice, 2 "confirming" orders settled. PASS with the provider answering at about 3 s: charges = paid orders (40/40, 60/60) | `oversell-summary.md`, `../verification/repro-slow-payment.mjs` |
| Code patterns that fail under load | 0 critical, 0 high, 3 medium (PERF-03, PERF-04, ARC-10), 1 low (PERF-05) | findings below |

## What we tested
- **Expected traffic:** 3,000 visitors in 60 s (from the product owner). Assumptions in `brief.json`: 3× peak factor, 3 product-page requests and 1 buy attempt per visitor. That gives **450 product-page req/s + 150 buy req/s = 600 req/s** at 100%, tested in steps of 50%, 100%, 150% and 200%, 20 s each (`plan.json`). Buy requests now carry a shipping address.
- **Environment:** one local Node.js process (`http://127.0.0.1:3000`, commit `fa296a2`) in the demo configuration (test sign-in, sale already open). Simulated hosted Postgres: 10 connections, ~3 ms per query. Simulated payment provider: 80–200 ms, 2% of calls hang for 30 s, and it now completes a charge even after the app hangs up, like a real provider. No load balancer, TLS or CDN in front. The production instance size is unknown, so these numbers show the code's behaviour, not production capacity.
- **Load generator:** k6 on the **same 4-core machine** as the app and the simulator (`RUNS.md`). Its CPU use was not recorded, so run 1's "not sent" can't be attributed to the app or to k6.
- **Not tested:**
  - Sign-in under load: the production magic link isn't in the code (OPS-03).
  - Checkout with stock left at 100–200%: the 100 pairs sold in the first seconds of the 50% step, so later buy requests measured the "sold out" / "already ordered" answers.
  - A slow database during the rush, a payment provider that errors permanently, and a countdown weeks long: reproduced separately on a local copy (PERF-03, ARC-10, PERF-04).
  - Traffic through the real load balancer (PERF-02 condition), bot traffic (SEC-03), a second server (ARC-06), real email (ARC-07).

## Results in plain language
- At the expected midnight rush, 95% of product-page loads and buy answers came back within 5 ms in every run, with no errors.
- At twice the rush, two runs stayed fast (95% within 33 ms and 79 ms). In the other run the machine stalled at 1.5×: about 1 in 80 page requests couldn't be sent, and the slowest 1% took nearly half a second. The round-1 code run on the same day was similar, so the fixes didn't slow anything down. But headroom above 1.5× isn't established on this machine.
- No server errors at any step. Round 1 showed "Payment did not go through" when the simulated provider hung. Those shoppers now see "We're confirming your payment", and the order settles seconds later.
- In the rush test, 1,000 shoppers double-clicked "Buy" at the same moment: exactly 100 sold, one per customer, nobody charged twice. Two shoppers were briefly "confirming" and both ended paid. Round 1 left 4 pairs unsold here; now none are stranded.
- Reproduced by hand on a local copy. With the provider answering at about 3 s, every shopper was charged exactly once, even those who pressed Buy again. With the database slowed down, a paying shopper still got her order. But one signed-in account polling "my orders" made other shoppers' checkouts and the product page fail with "We are very busy".

## Findings (most important first)

| # | Severity | What happens at peak (plain language) | Where | Fix | Effort |
|---|---|---|---|---|---|
| 1 | Medium | A payment error that retrying can't fix (wrong key or address, a rejected request) shows every buyer "confirming" forever. All 100 pairs can be locked with nothing sold, and the first alert comes after 10 minutes (ARC-10) | `fixed/server.mjs:306-308, 363-387` | Look payments up instead of re-sending; deadline for "unknown", then release; alert at once | M |
| 2 | Medium | One signed-in script calling "my orders" in a loop ties up the database, so real buyers get "We are very busy" at checkout (PERF-03) | `fixed/server.mjs:503-518` | Rate-limit signed-in reads; keep connections for the buy path | S |
| 3 | Medium | If the sale is more than ~25 days away, every open page reloads the product non-stop: 363 requests a second from one page in our test (PERF-04) | `shared/public/app.js:46-47` | Cap the timer delay (e.g. re-check hourly) | S |
| 4 | Medium | Bots with `+tag` emails and address spellings ("St." vs "Street") can still buy several pairs; no bot check or waiting room (SEC-03) | `fixed/server.mjs:194-197, 411-415` | Normalise every token's email; firmer address key; waiting room or bot check | M |
| 5 | Medium | With a second server, rate limits differ per server and every email would be sent twice (ARC-06, ARC-13) | `fixed/server.mjs:228, 390-408` | Stay on one server for this sale; shared store before scaling out | M |
| 6 | Low | When the database is slow, the product page fails for everyone each second instead of showing a copy a second old (PERF-05) | `fixed/server.mjs:255-270` | Serve stale on error and while refreshing | S |

Fixed since round 1 and re-verified: the `//` crash (SEC-01), double charges on slow payments (ARC-01), stuck orders when the database is busy (ARC-02), bypassable cache and search (PERF-01), Node closing idle connections before the load balancer (PERF-02), stranded pairs (ARC-09).

## Top 3 actions before launch
1. **Fix the two quick code issues** (PERF-04, and PERF-03 with PERF-05). Cap the countdown timer, rate-limit "my orders" and order lookups per account, and let the product cache serve its last good copy. Expected effect: no self-inflicted load from the teaser page, and no single account can stall checkout. All three are small.
2. **Make an unresolvable payment fail safely** (ARC-10). Look payments up with the provider, and give "confirming" a deadline, then release the pair and tell the customer. Alert on the first burst of unknown payments, not after 10 minutes.
3. **Re-test on production-like infrastructure.** Go through the real load balancer, with k6 on a separate machine. Repeat each step at least twice, and add a slow-database and a slow-provider scenario. Headroom above 1.5× isn't established, so **put a virtual waiting room or bot protection in front of the drop**, not only "if needed" as the runbook says (`RUNBOOK.md:13`).

Safety nets for the night:
- The pause switch now exists (OPS-02, fixed).
- One person on call watching a small dashboard: 5xx rate, `pendingOrders`, `payment_unknown` log lines, and paid orders vs provider charges. No code computes that last comparison yet (OPS-08).
- One server only (ARC-06).

## Re-test (round 1 → round 2)

| Measure | Round 1 (`d572634`) | Round 2 (`fa296a2`) |
|---|---|---|
| `GET //` | process exits | 400, server keeps running |
| Provider ~3 s, shoppers retry: payments vs paid pairs | 41 vs 39 | 40 vs 40 and 60 vs 60; retries refused (409) |
| Busy database during payment: charged but order stuck | 1 of 2 runs | 0 of 3 runs (but other shoppers get 503: PERF-03) |
| Load test, highest step passed | 200% (1 run) | 200% in 2 of 3 runs; 1 run broke at 150% (round-1 code, same day: 200%) |
| Server errors at 50% step (hung payments) | 4 (0.27%) | 0 in all 3 runs |
| Oversell check | PASS, 96 of 100 sold, 4 stranded | PASS, 100 of 100 sold, 0 stranded |

---
*Glossary:*
- **req/s:** requests per second the site receives.
- **p95 / p99:** 95% / 99% of requests were faster than this.
- **Not sent:** requests the load tool couldn't start because every simulated shopper was still waiting, a sign the system had stopped keeping up.
- **Oversell:** confirming more orders than there is stock.
- **Idempotency key:** a label sent with a payment so the provider charges only once, even if the request is repeated.
- **Load balancer:** the front door that passes visitors' requests to the app server.
- **Waiting room:** a queue page that lets shoppers into checkout a few at a time.
