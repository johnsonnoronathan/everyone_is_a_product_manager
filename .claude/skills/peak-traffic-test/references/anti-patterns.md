# Peak-traffic anti-patterns

How to use this file: walk the hot path (every handler in the journey and everything it calls) and check each pattern. `rule:` names a check in `../semgrep/peak-traffic.yml`; everything else needs reading. For each confirmed hit, record file:line, the **PM sentence** (adapted to the product), severity, and the fix.

Severity guide: anything that makes the system *wrong* under load (oversell, double charge, lost orders) is **Critical**. Anything that makes it *fall over* at or below the target load is **High**. Slow but survives is **Medium**. Below that is **Low**.

---

## A. Correctness under concurrency (always Critical/High)

### A1. Check-then-act on stock (overselling)
- **Looks like:** read stock → `if (stock > 0)` → (anything slow, e.g. payment) → write `stock - 1`. Variants: `SET stock = ?` with an app-computed value (rule: `stock-lost-update-sql`), `product.stock -= 1; save()` (rules: `stock-lost-update-orm-*`), Firestore read-then-write outside a transaction.
- **Why it breaks:** 500 people read "1 left" at the same moment; all pass the check; all buy.
- **Fix:** one atomic conditional update: `UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0` and check rows affected = 1. ORMs: Prisma `updateMany({ where: { id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } })` and check `count`; Django `filter(pk=..., stock__gt=0).update(stock=F('stock') - 1)`. Or `SELECT … FOR UPDATE` in a short transaction. At very high scale: reserve in Redis (`DECR` / Lua script) and write orders asynchronously.
- **Reserve, then charge.** Charging before reserving bills customers for items you then can't deliver.
- **PM sentence:** "During the sale we would confirm more orders than we have stock: in our test, 1,969 orders for 100 pairs."

### A2. No idempotency (double orders / double charges)
- **Looks like:** submit handler creates an order every time it's called; no unique constraint; no idempotency key to the payment provider; the button isn't disabled while submitting (frontend-only fixes don't count).
- **Why it breaks:** slow responses at peak cause double-clicks and automatic retries (browsers, mobile apps, load balancers).
- **Fix:** unique constraint matching the business rule (e.g. one live order per customer per product), or an idempotency key per checkout attempt stored with the order; pass an idempotency key to the payment provider (Stripe `Idempotency-Key`).
- **PM sentence:** "Customers who double-click get charged twice."

### A3. External calls inside a database transaction / while holding a lock
- **Looks like:** `BEGIN` → lock row → call payment/email API → `COMMIT`.
- **Why it breaks:** the lock is held for the whole API call (100 ms–30 s), so every other buyer queues behind it; one slow partner stalls everything.
- **Fix:** reserve in a short transaction, call the partner outside it, then confirm or release in another short transaction.

### A4. Coupon / limited-use counters, "first N customers", seat booking
Same as A1 with different names (`uses`, `redeemed`, `seats`, `balance`, `credits`). Check every counter that has a limit.

---

## B. Database load

### B1. N+1 queries (rule: `db-query-in-loop-*`)
- **Looks like:** fetch a list, then query once per item (author per review, stock per product, price per cart line). Also ORM lazy-loading inside templates/serializers.
- **Why it breaks:** a page with 50 items = 51 round trips. Fine at 10 visitors, a meltdown at 1,000.
- **Fix:** JOIN / `WHERE id IN (...)` / eager loading (`include`, `select_related`, `prefetch_related`, `joinedload`).

### B2. No caching on hot read paths
- **Looks like:** product page, prices, "stock left" computed from the DB on every request.
- **Fix:** cache for 1–5 s in memory or Redis, or at the CDN (`Cache-Control: public, s-maxage=2, stale-while-revalidate=…`). A 1-second cache turns 5,000 identical reads/s into 1. Stock shown on the page can be slightly stale; the purchase step stays authoritative.
- Also check for a **cache stampede**: when the cache entry expires, thousands of requests rebuild it at once. Fix with single-flight (one refresh at a time) or stale-while-revalidate.

### B3. Connection pool exhaustion / no fail-fast
- **Facts:** node-postgres `Pool` defaults to 10 connections and waits forever for a free one (`connectionTimeoutMillis: 0`). Prisma's default pool is `num_cpus × 2 + 1`. Postgres itself has a hard `max_connections` (often 100 or lower on small hosted tiers).
- **Why it breaks:** when queries slow down, requests queue for connections, latency explodes, then everything times out.
- **Fix:** right-size the pool; set an acquire timeout and return a fast 503 + `Retry-After` instead of queuing forever; keep transactions short.

### B4. Serverless functions + direct database connections
- **Looks like:** Vercel/Netlify/Lambda functions creating a DB client per invocation, or a pooled client per instance, connecting straight to Postgres/MySQL.
- **Why it breaks:** at peak the platform runs hundreds of instances, each opening connections, and the database hits `max_connections`. The error usually reads "too many connections" or "remaining connection slots are reserved".
- **Fix:** use the provider's pooler (Supabase Supavisor/pooler URL, Neon pooled connection string, PgBouncer, RDS Proxy, Prisma Accelerate) and a small per-instance limit (`connection_limit=1` for Prisma on serverless).

### B5. Hot rows / hot documents
- **Facts:** Firestore sustains about **1 write per second per document**; a global counter document will throttle. In SQL, every buyer updating the same row serialises on its lock, which is fine for a short atomic update and terrible for a long transaction (A3).
- **Fix:** keep the critical update tiny; shard counters (Firestore distributed counters); for extreme drops, pre-split stock into buckets or move reservation to Redis.

### B6. Missing indexes / unbounded queries
- **Looks like:** `WHERE customer_email = ?` or `ORDER BY created_at` on a table without an index; `SELECT *` without `LIMIT` (admin dashboards, "my orders" pages, exports).
- **Why it breaks:** fast with 100 rows in staging, a full scan with 2 million rows on sale day. Admin dashboards refreshed by the whole team during the sale add real load.
- **Fix:** add indexes for every hot `WHERE`/`ORDER BY`; paginate; run reporting on a read replica.

---

## C. Slow or fragile dependencies

### C1. No timeouts on outgoing calls (rules: `fetch-without-timeout`, `axios-without-timeout`, `requests-without-timeout`)
- **Facts:** `fetch`, axios and Python `requests` have no total request timeout by default.
- **Fix:** timeouts on every partner call (2–5 s for payments, less for everything else), a clear message to the user, release reservations on failure.

### C2. Partner rate limits
- **Looks like:** every order calls a payment, tax, shipping, email or SMS API synchronously.
- **Why it breaks:** partners cap requests per second per account (Stripe's default limits are on the order of 100 requests/second in live mode and lower in test mode; email/SMS providers have per-second sending caps). Your peak may exceed theirs, which returns 429s and fails orders.
- **Fix:** check each partner's documented limits against the target; queue non-urgent calls; ask the partner for a temporary limit increase before the event.

### C3. Slow work inside the request (rule: `email-in-request-path`)
- **Looks like:** confirmation email, PDF/invoice generation, image processing, analytics calls, webhooks awaited before responding.
- **Fix:** respond first; do the rest on a background queue (SQS, Cloud Tasks, BullMQ, Inngest, Supabase queues). The queue must be durable in production.

### C4. Retry storms
- **Looks like:** client or server retries immediately and indefinitely.
- **Fix:** limited retries with exponential backoff + jitter; honour `Retry-After`.

---

## D. Single-server assumptions

### D1. State in process memory
- **Looks like:** sessions, carts, rate-limit counters, stock reservations, websockets or job queues kept in a variable/Map.
- **Why it breaks:** as soon as there are 2+ instances (autoscaling, serverless, a deploy during the sale) each sees different data; on restart it's gone. Memory caches are fine; memory as the *source of truth* is not.
- **Fix:** Redis/database for anything that must be shared or survive restarts.

### D2. Blocking the event loop (Node.js) / too few workers (Python, Ruby) (rule: `sync-io-in-request-handler`)
- **Looks like:** `readFileSync`, `bcrypt.hashSync`, big JSON parsing or CPU-heavy loops in handlers; Gunicorn/Puma with 2 workers.
- **Fix:** async I/O, move CPU work off the request path, size workers to cores and test.

### D3. Local disk for uploads / generated files
Breaks with more than one server or on serverless. Use object storage (S3, R2, Supabase Storage).

---

## E. Edge, capacity and operations

### E1. Nothing cached at the CDN
Static assets and anonymous pages should be served by a CDN, not the app server. Check `Cache-Control` headers on HTML, JS, CSS, images and public API reads.

### E2. Autoscaling too slow / limits too low
Scaling up takes minutes; a drop peaks in seconds. Check max instances/concurrency limits on the hosting plan, and **pre-scale before the event**.

### E3. No protection from bots and overload
Scalper bots can be most of the traffic at a drop. Options: rate limits per user/IP, bot protection (Cloudflare, DataDome, hCaptcha/Turnstile), and a **virtual waiting room** (Cloudflare Waiting Room, Queue-it, Queue-Fair, CrowdHandler), which caps how many people are in checkout at once. Often the cheapest insurance; recommend it whenever the load test shows little headroom.

### E4. Frontend multiplies load
Polling "stock left" every second × 10,000 open tabs = 10,000 req/s. Prefer longer intervals with jitter, server-sent events, or a CDN-cached endpoint. Huge unoptimised images eat bandwidth.

### E5. Scheduled jobs at the same time as the sale
Midnight cron jobs (reports, emails, backups, cache rebuilds) colliding with a midnight drop. Check schedulers.

### E6. No graceful degradation or kill switch
Can you turn off recommendations, reviews, or search to save the checkout? Is there a feature flag to pause the sale? A "we're busy, you're in line" page beats a crash.
