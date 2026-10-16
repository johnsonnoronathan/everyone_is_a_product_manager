# Performance & scale findings

Commit `d572634`. Lens: `peak-traffic-test` static pass against `references/anti-patterns.md`, plus local reproductions. The full load/oversell measurements are in `../peak-traffic/REPORT.md` (from the existing k6 summaries); the static findings and their code evidence are here.

Target load (from `demo/flash-sale/peak-brief.json`, owner's numbers): 3,000 visitors in 60 s, peak factor 3 → roughly 450 product-page req/s and 150 buy req/s at the 200% step.

---

### PERF-01 · Critical · Confirmed: Oversell — stock is read, then written back, so more orders than stock go through
- **Where:** `demo/flash-sale/naive/server.mjs:107-111` (`POST /api/buy`): `SELECT … stock` → `if (stock <= 0)` → `await chargeCard(...)` → `UPDATE products SET stock = ?` with the app-computed `product.stock - 1`.
- **Impact:** At a drop, hundreds of buyers read the same stock value at the same instant, all pass the `> 0` check, and all write back a decremented value — so the shop confirms far more orders than it has pairs. This is anti-pattern A1 (check-then-act lost update), made worse by a slow payment call sitting between the read and the write.
- **Evidence:** Local race, 30 concurrent buyers (distinct customers) against a stock of 5:
  ```
  $ curl -s -X POST localhost:3000/api/admin/reset -d '{"stock":5}'
  # 30 concurrent POST /api/buy → all HTTP 200
  $ curl -s localhost:3000/api/admin/stats
  {"initialStock":5,"stockRemaining":4,"paidOrders":30,"distinctCustomers":30,...}
  ```
  30 paid orders for 5 pairs. The existing k6 oversell test shows the same at scale (see peak-traffic report / `oversell-summary.json`).
- **Fix:** One atomic conditional update — `UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0` — and treat "0 rows affected" as sold out; reserve before charging. Back it with `CHECK (stock >= 0)` (ARC-03). Effort: M
- **Reference:** peak-traffic anti-pattern A1 · CWE-362 (race condition)
- **Status:** Open

---

### PERF-02 · Critical · Confirmed: No "one per customer" limit and no idempotency — duplicate orders and double charges
- **Where:** `demo/flash-sale/naive/server.mjs:102-117` (`POST /api/buy`), plus the client (`demo/flash-sale/shared/public/app.js:51-57`) which does not disable the button while submitting.
- **Impact:** The "one pair per customer" promise isn't enforced, and nothing makes the buy idempotent: a double-click or an automatic retry creates a second order and a second charge. One customer can also simply call buy repeatedly and take many pairs.
- **Evidence:** Same customer, two simultaneous clicks then three more, all accepted:
  ```
  # dbl@example.com: concurrent + sequential buys
  → orders 4,5,6,7,8   (5 orders for one customer)
  $ curl -s localhost:3000/api/admin/stats
  {"stockRemaining":96,"paidOrders":5,"distinctCustomers":1,"payments":{"charges":5,"chargedCents":24995}}
  ```
  Five charges on one customer. No unique constraint (ARC-03) and no idempotency key is sent to the provider (`chargeCard`, `server.mjs:49-57`).
- **Fix:** Enforce one live order per `(product_id, customer)` with a `UNIQUE` index and treat the violation as "already bought" (409). Generate an idempotency key per checkout attempt, store it with the order, and pass it to the payment provider (the simulated provider already honours an `Idempotency-Key` header, as real ones do). Disabling the button client-side is not sufficient on its own. Effort: M
- **Reference:** peak-traffic anti-pattern A2 · CWE-362, CWE-799
- **Status:** Open

---

### PERF-03 · High · Confirmed: No timeout on the payment call — one slow charge ties up the request for 30 s
- **Where:** `demo/flash-sale/naive/server.mjs:49-57` (`chargeCard` uses `fetch` with no timeout), awaited at `:110`.
- **Impact:** Real card processors occasionally hang. With no timeout, a single hung charge keeps that request (and its database connection work queued behind it) alive for the full provider timeout. At peak, these pile up and exhaust the server and the connection pool (PERF-04), so a few slow charges stall the whole checkout.
- **Evidence:** With the provider forced to hang, one buy took the full 30 s before failing:
  ```
  $ curl -w 'HTTP %{http_code} after %{time_total}s\n' -X POST localhost:3000/api/buy …
  HTTP 500 after 30.019877s      # Error: Payment failed with status 504
  ```
  Semgrep flagged `fetch-without-timeout` at `server.mjs:50`, `:135`, `:142`.
- **Fix:** Put a 2–5 s timeout on the payment call (`AbortSignal.timeout`), fewer and backed-off retries, and on failure release any reservation and return a clear message. Effort: S
- **Reference:** peak-traffic anti-pattern C1 · CWE-1088
- **Status:** Open

---

### PERF-04 · High · Likely: Connection pool exhaustion with no fail-fast
- **Where:** `demo/flash-sale/naive/server.mjs:13` (`openDb()` with defaults) using the hosted-Postgres-like pool in `shared/db.mjs:22-27` (pool size 10, `acquireTimeoutMs = 0` = wait forever).
- **Impact:** Every query borrows one of 10 connections and waits forever if none is free. When queries slow down (the N+1 product page, or the DB under load), requests queue for connections, latency climbs, and instead of shedding load with a fast 503 the whole site hangs. This is the classic resource that runs out first at peak.
- **Evidence:** The app opens the pool with defaults (no `poolSize`/`acquireTimeoutMs` override). The product page performs 14 separate pool acquisitions per view (PERF-05); at 450 views/s that is ~6,300 acquisitions/s against 10 connections. The existing load test shows latency/error growth at the upper steps (see peak-traffic report / `load-summary.json`). Marked *Likely* for the exact failure point because the connection-pool collapse itself was not reproduced locally (the simulated DB is in-process); the load-test summary is the confirming evidence.
- **Fix:** Right-size the pool for the instance, set an acquire timeout and return `503` + `Retry-After` instead of queuing forever, and cut the queries per request (PERF-05) so connections free up fast. Effort: M
- **Reference:** peak-traffic anti-pattern B3 · CWE-400
- **Status:** Open

---

### PERF-05 · Medium · Confirmed: N+1 queries on the product page (the hottest read path)
- **Where:** `demo/flash-sale/naive/server.mjs:88-92` (`GET /api/products/:id` loops over reviews and runs one `SELECT name FROM users` per review).
- **Impact:** The product page — hit ~3× per visitor, the busiest endpoint — makes 1 (product) + 1 (reviews) + 12 (one per reviewer) = 14 database round trips every time. Fine for one visitor, a multiplier of load and pool pressure at 3,000.
- **Evidence:** The loop `for (const review of reviews) { … db.get('SELECT name FROM users WHERE id = ?', review.user_id) }`; 12 seeded reviews. Measured idle latency ~46 ms per product page vs ~4 ms for the single-query search endpoint — about a 12× difference from the extra round trips. Semgrep flagged `db-query-in-loop-js` at `server.mjs:90`.
- **Fix:** One query with a JOIN (`reviews` join `users`) or `WHERE user_id IN (…)`; combine with caching (PERF-07). Effort: S
- **Reference:** peak-traffic anti-pattern B1 · CWE-1049
- **Status:** Open

---

### PERF-06 · Medium · Confirmed: Confirmation email is sent inside the checkout request
- **Where:** `demo/flash-sale/naive/server.mjs:59-63` (`sendConfirmationEmail`, a 250 ms simulated SMTP call) awaited at `:116` before the response.
- **Impact:** Every checkout waits ~250 ms on email before the customer sees "confirmed", extending how long each buy holds server resources at peak. If the mail server is slow, checkout is slow; if it's down with no timeout, checkout fails after a successful charge.
- **Evidence:** `await sendConfirmationEmail(user.email, order.lastInsertRowid)` sits in the request path; semgrep flagged `email-in-request-path` at `server.mjs:116`.
- **Fix:** Respond as soon as the order is recorded; send the email from a durable background queue. Effort: S
- **Reference:** peak-traffic anti-pattern C3
- **Status:** Open

---

### PERF-07 · Medium · Confirmed: No caching on hot reads; static files read from disk every request; no CDN headers
- **Where:** `demo/flash-sale/naive/server.mjs:66-77` (`readFileSync` of `index.html`/`app.js`/`style.css` per request) and `:85-94` (product page computed from the DB every time). No `Cache-Control` on any response.
- **Impact:** Thousands of identical product-page and asset reads all hit disk and the database. A 1–2 s cache on the product read, and CDN caching of the static assets, would turn most of the peak into near-zero work; without it the app server does all of it.
- **Evidence:** `fs.readFileSync(...)` on each static request; the product handler queries the DB on every call; `check-headers` shows no `Cache-Control`/`ETag` on `/`, `/app.js`, `/style.css`, or `/api/products/1`.
- **Fix:** Serve static assets via the CDN/load balancer with long cache headers (read them into memory once at startup at minimum — see also D2 sync I/O); cache the product read for 1–2 s (stock on the page may be slightly stale, the buy step stays authoritative). Effort: S
- **Reference:** peak-traffic anti-patterns B2 / E1
- **Status:** Open
