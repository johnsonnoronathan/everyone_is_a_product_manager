# Performance & scale findings

Commit `d572634` · 2026-10-16 · lens: `peak-traffic-test/references/anti-patterns.md` (static pass over the hot path: `GET /api/products/:id`, `POST /api/buy`, and everything they call) · inputs: `00-scope.md`, `01-system-map.md`, `scans/semgrep*.json`
Target from the owner: 3,000 visitors within 60 s of opening, planned at 3× peak factor (`demo/flash-sale/peak-brief.json`). No load test was run for this review (k6 results already exist and are folded in by the final report). Small local reproductions only.

### PERF-01 · Medium · Confirmed: Anonymous requests that skip the cache can use up the database and make checkouts fail
- **Where:** `demo/flash-sale/fixed/server.mjs:226-229` (`GET /api/search`: not cached, not rate-limited, never used by the page), `:154-174` + `:220-224` (`GET /api/products/:id`: every new id is a cache miss and a database query, and every id is kept in `productCache` forever via lines 168/170); no per-IP limit anywhere
- **Impact:** A single script sending a few thousand requests a second to the search address, or to made-up product numbers, keeps all 10 database connections busy. Real shoppers then get "We are very busy", and paid orders can end up stuck (ARC-02). The product cache also grows with every made-up product number until the server runs out of memory.
- **Evidence:** The ARC-02 reproduction used exactly this: anonymous `GET /api/search?q=x` every 4 ms while a payment was in flight, and the paying customer got `503 "We are very busy"`. `GET /api/products/<random>` → `404` each time, one database query per new id (`productCache.set(id, …)` with no eviction or size limit). Semgrep (own rules) did not flag these: the cache exists, it's just bypassable.
- **Fix:** Remove `/api/search` (unused), or cache it and rate-limit it. Accept only known product ids (anything else → 404 without touching the database). Cap the cache (only cache ids that exist, or an LRU of a few entries). Add per-IP rate limiting and bot protection at the edge (load balancer / CDN / WAF). Effort: S
- **Reference:** peak-traffic anti-patterns B2, B3, E3 · OWASP API4:2023 Unrestricted Resource Consumption

### PERF-02 · Medium · Likely: Idle connections are closed after 5 seconds; behind a load balancer that can cause random 502 errors at peak
- **Where:** `demo/flash-sale/fixed/server.mjs:365-366` (sets `requestTimeout` and `headersTimeout` but leaves `server.keepAliveTimeout` at Node's default of 5 s)
- **Impact:** Load balancers usually keep idle connections to the app open longer than 5 s (60 s is a common default). If Node closes a connection at the moment the load balancer reuses it, that shopper gets a 502 error page. It's rare at low traffic and shows up at peak.
- **Evidence:** `curl -D - http://127.0.0.1:3100/api/products/1` → `Connection: keep-alive`, `Keep-Alive: timeout=5`. The load balancer's idle timeout is unknown. Confirm by checking it: if it is 5 s or less, close this finding.
- **Fix:** Set `server.keepAliveTimeout` above the load balancer's idle timeout (e.g. 65 s for a 60 s idle timeout) and re-run the load test through the real load balancer. Effort: S
- **Reference:** peak-traffic anti-pattern E2 (capacity and edge configuration)

## Hot-path walk (anti-patterns checked)

| Pattern | Status | Where |
|---|---|---|
| A1 check-then-act on stock | ✅ avoided: one conditional `UPDATE … WHERE stock > 0` + rows-affected check, reserve before charge | `server.mjs:247-254` |
| A2 idempotency | ⚠️ DB unique index blocks double orders and the provider gets an idempotency key, but the key changes on every retry → **ARC-01** | `server.mjs:50, 265-266` |
| A3 external call inside a transaction | ✅ avoided: payment call is outside the transaction | `server.mjs:247-266` |
| A4 other limited counters | n/a (no coupons/seats) | |
| B1 N+1 queries | ✅ reviews fetched with one JOIN | `server.mjs:160-164` |
| B2 caching / stampede | ✅ 1 s cache with single-flight refresh. ⚠️ Bypassable by new ids and search → **PERF-01** | `server.mjs:154-174` |
| B3 pool exhaustion / fail-fast | ✅ 1 s acquire timeout → 503 + `Retry-After: 2`. ⚠️ Also applied after money moved → **ARC-02** | `server.mjs:41, 359` |
| B4 serverless + direct DB | n/a (long-running process). Check the hosted Postgres `max_connections` vs 10 per instance when a second instance is added | |
| B5 hot row | ✅ the stock row update is tiny and the transaction short | `server.mjs:248` |
| B6 indexes / unbounded queries | ✅ `orders_by_customer` index; my-orders scoped per customer; admin counts are fine at this size | `server.mjs:46-50` |
| C1 timeouts on outgoing calls | ✅ payment 3 s; admin fetches 3 s. The 3 browser `fetch` hits from semgrep are same-origin browser calls (not partner calls) → dismissed | `server.mjs:188, 310, 318` |
| C2 partner rate limits | ✅ at most ~100 successful charges plus failures and retries; far below typical provider limits | |
| C3 slow work in request | ✅ email queued after responding. ⚠️ Stub and not durable → **ARC-07** | `server.mjs:197-210, 280` |
| C4 retry storms | ✅ no automatic retries in the browser; `Retry-After` sent. The browser doesn't honour it (ARC-08) | |
| D1 state in memory | ⚠️ sold-out flag and rate limits → **ARC-06** (only with a second instance) | `server.mjs:137, 177` |
| D2 blocking the event loop | ✅ static files read once at start-up; bodies ≤ 10 kB; HMAC is cheap | `server.mjs:65-72` |
| D3 local disk | n/a | |
| E1 CDN caching | ✅ product API `public, max-age=1`, static `max-age=300`. ⚠️ Unversioned file names → **OPS-06** | `server.mjs:223, 349` |
| E2 autoscaling / pre-scaling | single process, no autoscaling; a second instance is unsafe until ARC-05/ARC-06 are fixed | |
| E3 bots / overload / waiting room | ⚠️ none → **SEC-03**, **PERF-01** | |
| E4 front end multiplies load | ✅ no polling; one product request per page view | `app.js:71` |
| E5 jobs at midnight | none in the code; ask whether backups/reports run at midnight on the host | |
| E6 graceful degradation / kill switch | ⚠️ no pause switch → **OPS-02** | |

## Test evidence folded in after the review (`peak-traffic/load-summary.md`, `oversell-summary.md`)
- Load test (k6, local process, 20 s per step): PASS at every step up to **200% of target (1,200 req/s)**. Product page p95 ≤ 6 ms and p99 ≤ 56 ms; buy p95 ≤ 128 ms. 4 server errors (0.27%) at the 50% step, which matches the simulator's 2% hanging payments hitting the 3 s timeout.
- Caveat: the 100 pairs sold during the first (50%) step. At 100–200% the buy requests were answered by the in-memory "sold out" shortcut (`server.mjs:237`) without touching the database or the payment provider. The test proves the cached and sold-out paths are fast. The checkout path itself was exercised only at 75 buys/s with stock remaining.
- Oversell (1,000 buyers × 2 clicks): never more than 100 sold, 0 double charges, 96 sold and 4 pairs left unsold → new finding ARC-09 (found by test).
- Neither test can show ARC-01 or ARC-02: the simulated provider never charges an abandoned call and the simulated database never slows down. Both were reproduced separately (`launch-review/repro/`).

## Could not check
- Real capacity of one Node process on the production instance size, and through the real load balancer (the existing k6 run is against a local process; see the final report).
- Hosted Postgres tier limits (`max_connections`, CPU) and the identity provider's sign-in limits at midnight (OPS-03).
- CDN configuration, if any.
