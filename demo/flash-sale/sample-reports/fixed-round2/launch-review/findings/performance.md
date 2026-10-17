# Performance & scale findings (round 2)

Commit `fa296a2` · 2026-10-17 · lens: `peak-traffic-test/references/anti-patterns.md` (static pass over the hot path: `GET /api/products/:id`, `POST /api/buy`, the signed-in reads, the background jobs and the page's own polling) · inputs: `00-scope.md`, `01-system-map.md`, `scans/semgrep*.json`
Target from the owner: 3,000 visitors within 60 s of opening, planned at 3× peak factor (`demo/flash-sale/peak-brief.json`). No load test was run for this review: the round-2 k6 runs already exist and are folded in afterwards (`peak-traffic/REPORT.md`). Small local reproductions only.

## Round-1 findings, re-verified

### PERF-01 · Medium · Confirmed: Anonymous requests that skip the cache can use up the database and make checkouts fail
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2` (the same risk from signed-in requests remains: PERF-03)
- **Where:** `/api/search` removed; `demo/flash-sale/fixed/server.mjs:247-253, 439, 451` (unknown product ids are answered from an in-memory set before any database call), `:273-281` (cache entries only for known ids)
- **Impact:** Round 1: a script hitting the unused search, or made-up product numbers, could keep all 10 database connections busy. Anonymous visitors can no longer reach the database except through the 1-second caches.
- **Evidence:** `GET /api/search?q=x` → `404 Not found`; `GET /api/products/999999` and `/api/products/abc` → `404 Product not found` (the id check at `:439` runs before the cache or database at `:440`). The anonymous routes that do touch the database (`/api/products/1`, `/readyz`) are single-flight cached for 1 s, so each makes at most 3 queries a second.
- **Fix:** Done. Per-IP limits and bot protection at the edge are still missing (SEC-03, PERF-03). Effort: S
- **Reference:** peak-traffic anti-patterns B2, B3, E3 · OWASP API4:2023

### PERF-02 · Medium · Likely: Idle connections are closed after 5 seconds; behind a load balancer that can cause random 502 errors at peak
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2` (condition: the load balancer's idle timeout must be below 65 s, which is on the runbook checklist)
- **Where:** `demo/flash-sale/fixed/server.mjs:637-641` (`keepAliveTimeout = 65_000`, `headersTimeout = 66_000`); `demo/flash-sale/fixed/RUNBOOK.md:11`
- **Impact:** Round 1: Node closed idle connections before the load balancer did. Now it keeps them longer than a typical 60 s load-balancer idle timeout.
- **Evidence:** Every response on the local instance carries `Keep-Alive: timeout=65`. The load balancer's idle timeout itself is not in evidence.
- **Fix:** Done. Confirm the load balancer setting. Effort: S
- **Reference:** peak-traffic anti-pattern E2

## New findings

### PERF-03 · Medium · Confirmed: One signed-in account can tie up the database and make checkout fail for everyone
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:514-518` (`GET /api/my-orders`) and `:503-512` (`GET /api/orders/:id`): one database query per call, no cache, no rate limit; the only rate limit is on buy (`:448`); `:70` (1 s pool wait for ordinary queries → 503)
- **Impact:** Anyone with an account can run a simple loop against "my orders". In production an account is a free magic-link sign-in. That loop takes the database connections other shoppers need. While it runs, real buyers get "We are very busy. Please try again." at the moment they try to reserve a pair, and the product page fails too (PERF-05). Money is safe, because this happens before any charge (ARC-02 is fixed), but at midnight it hands the sale to whoever isn't being blocked.
- **Evidence:** `verification/repro-busy-db.mjs`, three runs with `DB_LATENCY_MS=300` (a database under load), one account sending `GET /api/my-orders` every 4 ms:
  ```
  flood: 439 requests from one signed-in account -> {"200":108,"503":331}
  dave buy during the flood -> 503 {"error":"We are very busy. Please try again."} (1004 ms)
  product page during the flood -> 503 after 1002 ms
  ```
  Same result in all three runs. At the simulator's default 3 ms per query, the same effect needs a few thousand requests a second. That is within reach of one machine, or of a handful of accounts. The page itself polls `/api/orders/:id` only every 2 s and only while a payment is being confirmed (`app.js:99-110`), so the shop's own traffic isn't the problem.
- **Fix:** Rate-limit every signed-in read per account (and per IP at the edge), e.g. 1 request per second for my-orders. Serve `/api/orders/:id` for a "confirming" order from a short cache. Keep a few connections reserved for the buy path (a separate small pool, or a cap on concurrent read queries). Effort: S
- **Reference:** peak-traffic anti-patterns B3, E3 · OWASP API4:2023 Unrestricted Resource Consumption

### PERF-04 · Medium · Confirmed: If the opening time is more than about 25 days away, every open page reloads the product non-stop
- **Status:** Open
- **Where:** `demo/flash-sale/shared/public/app.js:46-47` (`setTimeout(loadProduct, opensIn + Math.random() * 2000)`); browsers and Node store timer delays as 32-bit signed integers, so anything above 2,147,483,647 ms (about 24.9 days) fires immediately
- **Impact:** While the sale is more than about 25 days away, every visitor's page reloads the product as fast as it can, then schedules the next reload "immediately", forever. The runbook's own example date (27 November) is 41 days after this review. In our test one open page made 363 requests a second. In a real browser the 1-second cache header slows the network side to about one request per second per tab, but the page still spins in a loop that burns the visitor's battery and CPU. The teaser page before the sale would melt phones and multiply server traffic.
- **Evidence:** `verification/frontend-harness.mjs` (the real `app.js` in Node with a DOM stub, no HTTP cache) against the local instance:
  ```
  SALE_STARTS_AT 41 days ahead: requests in 3 s: {"/api/products/1":1089} (363 per second from one open page)
     (node) TimeoutOverflowWarning: 3542399885.99 does not fit into a 32-bit signed integer. Timeout duration was set to 1.  (×1,090)
  opening 20 days ahead:        requests in 3 s: {"/api/products/1":1}
  ```
  The same overflow in browsers is documented behaviour (MDN, `setTimeout`: "delays larger than 2,147,483,647 ms… cause the timeout to be executed immediately").
- **Fix:** Cap the delay: `setTimeout(loadProduct, Math.min(opensIn, 60 * 60_000) + Math.random() * 2000)`. The page then re-checks at most hourly until the last hour, and on time at the end. Add a test with a date 30+ days out. Effort: S
- **Reference:** peak-traffic anti-pattern E4 (front end multiplies load)

### PERF-05 · Low · Confirmed: The product page cache throws away its last good copy when the database is slow
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:255-270` (`cached()`: a failed refresh deletes the entry, `:264`; while a refresh runs, callers wait for it instead of getting the previous copy, `:259`)
- **Impact:** When the database is slow (PERF-03, or a real slowdown at midnight), the busiest page on the site fails for every visitor each time its 1-second copy expires, even though a copy a second or two old would be perfectly fine to show. The page retries, so shoppers see "We are very busy. Retrying…" instead of the product.
- **Evidence:** In the `repro-busy-db.mjs` runs the product page had been loaded 1.5 s before the flood, and returned `503 … after 1002 ms` during it, three times out of three.
- **Fix:** Serve stale on error and while revalidating (keep `value` on failure and return it while `pending` exists, for up to e.g. 30 s). Effort: S
- **Reference:** peak-traffic anti-pattern B2 (stale-while-revalidate)

## Hot-path walk (anti-patterns checked)

| Pattern | Status | Where |
|---|---|---|
| A1 check-then-act on stock | ✅ one conditional `UPDATE … WHERE stock > 0` + rows check, reserve before charge | `server.mjs:468-477` |
| A2 idempotency | ✅ partial unique indexes per customer and per address; one `payment_key` per order, reused by every retry → ARC-01 fixed | `:81, 86-87, 466` |
| A3 external call inside a transaction | ✅ payment call outside the transaction | `:468-492` |
| A4 other limited counters | n/a | |
| A5 timeout treated as failure | ✅ timeout = unknown, reservation kept, same key. ⚠️ errors that never resolve stay "unknown" forever → **ARC-10** | `:306-308, 340-387` |
| B1 N+1 queries | ✅ reviews with one JOIN; semgrep's two hits are false positives (`scans/coverage.md`) | `:276-279` |
| B2 caching / stampede | ✅ 1 s single-flight caches for product and sale settings. ⚠️ no stale-on-error → **PERF-05** | `:255-288` |
| B3 pool exhaustion / fail-fast | ✅ 1 s acquire timeout → 503 + `Retry-After` before money moves; no timeout after (ARC-02 fixed). ⚠️ signed-in reads unlimited → **PERF-03** | `:70, 313-322, 624` |
| B4 serverless + direct DB | n/a (long-running process). Check hosted Postgres `max_connections` vs 10 per instance before a second instance | |
| B5 hot row | ✅ tiny stock update, short transaction | `:469` |
| B6 indexes / unbounded queries | ✅ `orders_by_customer`, `orders_pending (status, created_ms)`; reconciler `LIMIT 50`, outbox `LIMIT 20` | `:83-84, 371, 395` |
| C1 timeouts on outgoing calls | ✅ payment 3 s; admin/provider fetches 3 s; browser 15 s | `:304, 565, 582`, `app.js:11` |
| C2 partner rate limits | ✅ ~100 charges plus reconciler re-sends; the reconciler is sequential, so it can't burst | `:374-379` |
| C3 slow work in request | ✅ email via durable outbox after the response. ⚠️ still simulated → ARC-07 | `:328, 390-408` |
| C4 retry storms | ✅ page retries product loads with exponential backoff + jitter, never retries buy automatically | `app.js:24, 112-141` |
| D1 state in memory | ⚠️ rate limits per server → ARC-06 (condition: one instance) | `:228` |
| D2 blocking the event loop | ✅ static files hashed and read once at start-up; bodies ≤ 10 kB | `:141-152` |
| D3 local disk | n/a | |
| E1 CDN caching | ✅ HTML `no-cache`, hashed assets `immutable`. ⚠️ any `?v=` accepted → OPS-10 | `:614` |
| E2 autoscaling / pre-scaling | single process, no autoscaling; keep-alive fixed (PERF-02) | |
| E3 bots / overload / waiting room | ⚠️ none in code; runbook makes it conditional → SEC-03, PERF-03 | `RUNBOOK.md:13` |
| E4 front end multiplies load | ✅ sold-out re-check every ~20–25 s with jitter; "confirming" poll every 2 s for 2 min. ⚠️ countdown timer overflow → **PERF-04**. At opening, every page waiting on the countdown reloads within a 2 s window (3,000 pages ≈ 1,500 req/s for 2 s), which the 1 s cache absorbs | `app.js:43-50, 99-110` |
| E5 jobs at midnight | reconciler every 5 s, outbox every 1 s, id refresh every 30 s; all small and bounded | `:252, 386, 407` |
| E6 graceful degradation / kill switch | ✅ pause switch without a deploy (OPS-02 fixed) | `:532-548` |

## Test evidence folded in after the review (`peak-traffic/RUNS.md`, all four load runs, `oversell-summary.md`)
- **Load (k6, local, 20 s per step, app + simulator + k6 on one 4-core machine), all runs kept:**
  - Round 2, run 1: **FAIL at 150%**. 481 product-page requests were never sent (1.2%; k6 ran out of virtual users) during a latency spike, p95 206 ms / p99 448 ms. The 200% step then passed (p95 187 ms, p99 562 ms).
  - Round 2, runs 2 and 3: PASS to 200% (1,200 req/s), worst p95 33 ms / 79 ms.
  - Round-1 code, same day: PASS to 200%, worst p95 84 ms.
  - Every run passes the expected peak (100%, 600 req/s) with product-page and buy p95 ≤ 5 ms, and **0 server errors in every round-2 step**. Round-1 code had two 503s at the 50% step: hung payments, now answered 202 "confirming".
- **Reading:** no regression from the round-2 changes; headroom above 150% is not reliably established on this machine. As in round 1, the 100 pairs sold in the first seconds of the 50% step, so the 100–200% buy steps measure the sold-out / already-ordered answers, not checkouts with stock. Checkout with stock was exercised only at about 75 buys/s. No new finding from the load test; the re-test on production-sized infrastructure is a condition (`peak-traffic/REPORT.md`).
- **Oversell:** PASS. 100 sold of 100, 0 charged twice, 0 errors, 2 "confirming" at checkout that both settled.
- **Not exercised by either test:** a slow database (PERF-03, PERF-05), the countdown more than 25 days out (PERF-04), signed-in read endpoints, the page's own polling.

## Could not check
- Real capacity of one Node process on the production instance size and through the real load balancer (the round-2 k6 runs are against a local process; see `peak-traffic/REPORT.md`).
- Hosted Postgres tier limits (`max_connections`, CPU), and the identity provider's sign-in limits at midnight (OPS-03).
- CDN configuration, if any.
- A real browser's behaviour for PERF-04 (Playwright was not run for this review; the harness has no HTTP cache).
