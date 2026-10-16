# Architecture & data-integrity findings

Commit `d572634`. The concurrency/correctness problems (oversell, double orders) are written up under the performance lens (PERF-01, PERF-02) because they surface under load; the data-integrity angles that stand on their own are here.

---

### ARC-01 · High · Confirmed: Checkout is not transactional — customers can be charged with no order
- **Where:** `demo/flash-sale/naive/server.mjs:107-116` (`POST /api/buy`).
- **Impact:** The buy flow does three separate writes in sequence — charge the card, decrement stock, insert the order — with nothing tying them together. If anything fails between them (the frequent process crash of SEC-07, a DB hiccup, a redeploy), the customer's card is charged but no order exists, or stock drops with no order recorded. At peak, some of the 100 buyers will hit exactly this and be charged for sneakers they never get.
- **Evidence:** Code path: `await chargeCard(price, …)` → `await db.run('UPDATE products SET stock = ? …')` → `await db.run('INSERT INTO orders …')` → `await sendConfirmationEmail(...)`. There is no transaction around the stock + order writes, and the charge happens before either (so a charged customer with no order is the default failure mode). The payment call also carries no idempotency key (see PERF-02), so a retry charges again.
- **Fix:** Reserve stock first in a short atomic transaction (see PERF-01), then charge the provider with an idempotency key outside the transaction, then record the order (or release the reservation on failure) in a second short transaction. Make the order write and stock decrement one transaction so they can't diverge. Effort: M
- **Reference:** AWS Well-Architected (reliability); CWE-662 (improper synchronization) / data-integrity
- **Status:** Open

---

### ARC-02 · Critical · Confirmed: The app recreates the schema and deletes all orders on every startup
- **Where:** `demo/flash-sale/naive/server.mjs:13-27` (`db.exec('CREATE TABLE …')` then `seed()`, which runs `DELETE FROM … orders` and is called unconditionally at `:27`).
- **Impact:** Every time the process starts it drops to a clean, seeded state — **all paid orders are deleted**. On the planned "single process behind a load balancer" this means: (a) any restart/crash/redeploy during the sale wipes the orders taken so far; (b) if the load balancer ever runs more than one instance, the second instance wipes the first instance's orders on boot; and against a real shared Postgres, `CREATE TABLE` without `IF NOT EXISTS` makes the second instance crash on startup. There is no way to recover the lost orders (see OPS-02).
- **Evidence:** `seed()` begins `db.exec('DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;')` and is invoked at module top-level (`:27`) and by the open reset endpoint (SEC-03). During testing, `POST /api/admin/reset` (which calls `seed()`) removed previously created order #3.
- **Fix:** Separate schema setup (idempotent migrations, run once by a tool with `IF NOT EXISTS`) from seeding. Never run `DELETE FROM orders` on startup. Seed reference data (product, reviews) only if absent. Keep the app stateless so any instance can start without touching live data. Effort: M
- **Reference:** Twelve-Factor App (processes, stateless); AWS Well-Architected (reliability) · CWE-1188 (insecure default), data loss
- **Status:** Open

---

### ARC-03 · Medium · Confirmed: No database constraints to enforce the business rules
- **Where:** `demo/flash-sale/naive/server.mjs:14-18` (table definitions).
- **Impact:** The database is the last line of defence against oversell and duplicate orders, and here it enforces nothing: no `UNIQUE` on "one order per customer per product", no `CHECK (stock >= 0)`, no `NOT NULL`/foreign keys. So the concurrency bugs in PERF-01/PERF-02 have nothing to stop them, and stock can go negative.
- **Evidence:** `CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, customer TEXT, …)` — no unique index on `(product_id, customer)` for paid orders; `products … stock INTEGER` with no `CHECK`. During the oversell repro, `stock` reached values inconsistent with `paidOrders` (30 paid, stock not driven to a floor of 0 by any constraint).
- **Fix:** Add a partial `UNIQUE` index on `(product_id, customer)` for live/paid orders, `CHECK (stock >= 0)`, `NOT NULL` on required columns, and foreign keys. These turn the race conditions into clean, rejected duplicates even if application code slips. Effort: S
- **Reference:** AWS Well-Architected (reliability); data integrity · CWE-20
- **Status:** Open

---

### ARC-04 · Medium · Confirmed: Config and secrets come from code, not the environment
- **Where:** `demo/flash-sale/naive/server.mjs:8-11` (`PAYMENT_SECRET_KEY` hard-coded; `PORT`/`PAYMENT_URL` read from env but the key and admin behaviour are not).
- **Impact:** There is no dev/staging/prod separation: one hard-coded `pay_live_` key is used everywhere, and the app starts happily with no secrets configured instead of refusing. This is the design flaw behind the leak in SEC-06 and makes safe key rotation and separate test keys impossible.
- **Evidence:** The launcher supplies `PAYMENT_SECRET_KEY`, `TOKEN_SECRET`, `ADMIN_TOKEN` as env vars (`run.mjs:19-23`), but `server.mjs` ignores them and uses literals / no auth.
- **Fix:** Read every secret and environment-specific value from `process.env` (or a secret manager); validate them at startup and exit if a required one is missing; use separate keys per environment and the provider's test keys outside production. Effort: S
- **Reference:** Twelve-Factor App (config); OWASP A02:2025 · CWE-798
- **Status:** Open

---

### ARC-05 · Medium · Confirmed: The advertised "midnight" start is not enforced
- **Where:** `demo/flash-sale/naive/server.mjs:102-108` (`POST /api/buy` has no time gate); the product copy promises a start time (`demo/flash-sale/shared/seed-data.mjs:5`, "Sale starts at midnight").
- **Impact:** The sale is marketed as a fair midnight drop announced by email, but the buy endpoint works at any time. Anyone who finds the endpoint before midnight can buy early, so the stock may be gone before the email blast lands — undermining the whole promotion and risking consumer-fairness complaints.
- **Evidence:** A buy succeeded at 12:42 UTC with no "not open yet" check:
  ```
  $ curl -s -X POST localhost:3000/api/buy -H "authorization: Bearer $T" \
         -d '{"productId":1,"price":4999}'
  {"orderId":1,"amountCents":4999}
  ```
- **Fix:** Store a sale `starts_at` (UTC) and reject buys before it server-side (return a clear "opens at …" response); drive the countdown/enable state from the server, not the client. Effort: S
- **Reference:** OWASP A06:2025 Insecure Design · CWE-840
- **Status:** Open

---

### ARC-06 · Low · Confirmed: No tests, no CI, no lockfile on the critical paths
- **Where:** repository — no `package.json`/lockfile for the app, no test suite covering login/buy/permissions, no CI workflow (`.github/` absent).
- **Impact:** The money flow and the permission checks have no automated guard, so regressions ship silently, and installs aren't reproducible.
- **Evidence:** `demo/flash-sale/naive/` contains only `server.mjs`; OSV-Scanner reported "no lockfiles found"; there is no `.github/workflows`.
- **Fix:** Add a lockfile, a minimal test suite for sign-in, buy and access control, and run it in CI on every change. Effort: M
- **Reference:** Google SRE production-readiness; supply-chain hygiene
- **Status:** Open
