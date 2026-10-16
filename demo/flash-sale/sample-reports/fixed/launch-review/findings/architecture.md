# Architecture & data-integrity findings

Commit `d572634` · 2026-10-16 · lens: `references/architecture.md` (+ peak-traffic anti-patterns A1–A4, C3, D1) · inputs: `00-scope.md`, `01-system-map.md`, `scans/`
Reproductions ran only against a local instance started by the reviewer on ports 3100/4200, sometimes with the simulator's own knobs (`DB_LATENCY_MS`, `PAYMENT_MIN_MS`/`PAYMENT_MAX_MS`, provider `/config`) to recreate a slow database or a slow payment provider. Scripts: `launch-review/repro/`.

### ARC-01 · High · Confirmed: A slow payment is treated as a failed one: the customer can be charged, lose the pair, and be charged again on retry
- **Where:** `demo/flash-sale/fixed/server.mjs:179-192` (`chargeCard`, aborts after 3 s), `:264-277` (any error → order `payment_failed`, pair released, 503 "Please try again"), `:265-266` (idempotency key `order-${orderId}`, new for every attempt), `:269-270` (comment relies on "a reconciliation job" that does not exist)
- **Impact:** When the payment provider takes longer than 3 seconds, which does happen on busy nights, the shop tells the customer "Payment did not go through. Please try again." and puts the pair back on sale, even though the provider may already have taken the money. The customer tries again, as told, and pays a second time for one pair. Or someone else gets "their" pair and they paid for nothing. No job compares the provider's charges with the orders, so nobody notices until the complaints and chargebacks arrive.
- **Evidence:** Simulated provider answering in 2.985–3.015 s, 40 shoppers buy once, then everyone told to "try again" does so (`repro/repro-slow-payment.mjs`):
  ```
  buy results: {"503 Payment did not go through. Please try again.":23,"200 ok":17}
  admin stats: {…"paidOrders":17,…,"payments":{"charges":18,"chargedCents":89982}}
  after retries: {…"paidOrders":39,"distinctCustomers":39,…,"payments":{"charges":41,"chargedCents":204959}}
  => provider took 41 payments ($2,049.59) for 39 pairs
  ```
  Two earlier runs before any retry: 9 charges vs 7 paid orders, and 21 vs 20. A retry gets a new order id and therefore a new idempotency key (failed order 3 → retry order 4 in the `repro-busy-db.mjs release` run), so the provider sees a brand-new payment. `grep -n reconcil server.mjs` finds only the comment on line 270. The simulator charges only if it answers before it notices the app hung up; a real provider completes the charge regardless, so production would hit this more often, not less. There is also no inbound payment webhook to learn about late charges.
- **Fix:** Treat a timeout or network error as **unknown**, not failed. Keep the order `pending` with the pair reserved, tell the shopper "We're confirming your payment", and settle it by asking the provider (look up by idempotency key or order-id metadata, or receive the provider's webhook with signature check). Use one random idempotency key per reservation, stored on the order, and reuse it if the same shopper retries, so a retry can never be a second charge. Add a reconciliation job (provider charges vs paid orders) with an alert on any mismatch, and refund automatically when a charge has no order. Effort: M
- **Reference:** OWASP A06:2025 Insecure Design · CWE-754 Improper Check for Unusual or Exceptional Conditions

### ARC-02 · High · Confirmed: When the database is busy, a customer who has just paid is told "We are very busy" and the order is left stuck
- **Where:** `demo/flash-sale/fixed/server.mjs:41` (1 s pool acquire timeout applies to every query), `:279` (`UPDATE orders SET status = 'paid'` after the charge), `:271-274` (release transaction after a failed charge), `:359` (`PoolTimeoutError` → 503 "We are very busy. Please try again."); nothing anywhere picks up orders left in `pending`
- **Impact:** At the busiest moment, a customer can be charged and then see "We are very busy. Please try again." Their order stays "pending": it isn't shown in their orders, no confirmation is queued, it isn't counted as sold, and trying again says "You already have an order". If the payment had failed instead, the release can fail the same way and the pair stays reserved forever and is never sold. Orders in flight during a crash or restart (SEC-01) end up in the same state.
- **Evidence:** Normal 10-connection pool with queries slowed to 300 ms (`DB_LATENCY_MS=300`, a database under load), anonymous search requests keeping the pool busy while the payment was in flight (`repro/repro-busy-db.mjs paid`):
  ```
  buy -> 503 {"error":"We are very busy. Please try again."} after 2762 ms
  my-orders -> []
  retry buy -> 409 {"error":"You already have an order for this item"}
  admin stats -> {"initialStock":100,"stockRemaining":99,"paidOrders":0,"distinctCustomers":0,"payments":{"charges":1,"chargedCents":4999}}
  ```
  Charged $49.99, no visible order, can't retry, pair held. Reproduced in 1 of 2 runs (the other completed normally; it is timing-dependent). The release path (lines 271-274) uses the same pool call. It held in 4 attempts and is confirmed by code trace only.
- **Fix:** Fail fast only *before* the reservation. Once a pair is reserved or money has moved, never abandon the follow-up write: give it its own longer timeout with retries (or write it through a durable outbox), and after a successful charge answer "order received" rather than "please try again". Add a sweeper that settles `pending` orders older than ~30 s by asking the provider (charged → mark paid and send the email; not charged → release the pair). Effort: M
- **Reference:** CWE-754 Improper Check for Unusual or Exceptional Conditions · architecture checklist "multi-step writes … partial failure is compensated"

### ARC-03 · High · Confirmed: Orders are taken and charged without a shipping address
- **Where:** `demo/flash-sale/shared/public/index.html:16-26` (checkout has only an email field), `demo/flash-sale/shared/public/app.js:56` (buy sends `{ productId, price }`), `demo/flash-sale/fixed/server.mjs:235, 252` (`String(address ?? '').slice(0, 500)` stores an empty string, no check)
- **Impact:** Every one of the 100 buyers will be charged without giving a delivery address. No pair can ship until someone emails each buyer and waits for a reply. Some never answer, which means refunds, chargebacks and unhappy customers right after launch.
- **Evidence:** The browser's request body is exactly `JSON.stringify({ productId: PRODUCT_ID, price: product.price_cents })` (`app.js:56`). Local: `POST /api/buy {"productId":1,"price":1}` → `200 {"orderId":1,"amountCents":4999}`, so the server accepts an order with no address. Traced end to end: page → request → `INSERT … address = ''`.
- **Fix:** Collect the address on the page (required fields with `autocomplete="shipping …"`), validate it on the server (present, length, country you ship to), and reject the buy with 400 *before* reserving stock if it's missing. Alternatively collect it through the payment provider and store it on the order. Effort: M
- **Reference:** OWASP A06:2025 Insecure Design (business rule not enforced on the server)

### ARC-04 · High · Confirmed: Nothing stops people buying before the sale opens at midnight
- **Where:** `demo/flash-sale/fixed/server.mjs:231-282` (buy has no start-time check), `:53-62` (stock set to 100 at every start), `demo/flash-sale/shared/public/app.js:32` (Buy enabled whenever signed in and stock > 0)
- **Impact:** As soon as this version is live, anyone who finds the page or the API can buy, hours before the email goes out. Sneaker bots watch for exactly this. The midnight launch could open already sold out. The only way to keep the sale closed today is the admin reset with stock 0, which deletes all orders (SEC-02) and shows "Sold out" rather than "Opens at midnight".
- **Evidence:** Local instance at 12:47 UTC: `POST /api/buy` → `200 {"orderId":1,"amountCents":4999}`. `grep -nEi 'startsAt|sale_start|opens' server.mjs` → nothing; "Sale starts at midnight" exists only as product text (`shared/seed-data.mjs:5`).
- **Fix:** Store `sale_starts_at` (UTC; write down which time zone "midnight" means) with the product. Before that time the buy endpoint answers 403 "Sale opens at …" and the page shows a countdown and enables Buy from the server's clock. The same switch can pause the sale (OPS-02). Effort: S
- **Reference:** OWASP A06:2025 Insecure Design

### ARC-05 · High · Likely: Every server start deletes all orders and resets stock to 100
- **Where:** `demo/flash-sale/fixed/server.mjs:42-51` (schema created by the app at start), `:53-62` (`seed()` runs `DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;` and inserts stock 100; called unconditionally at line 62); no migration files in the repo
- **Impact:** If production starts the same way, any restart during or after the sale (a crash such as SEC-01, a deploy, or adding the second server) erases every order and shipping address and puts 100 more pairs on sale: you oversell and can no longer tell who paid. If the tables already exist instead, `CREATE TABLE` fails and the server can't start at all.
- **Evidence:**
  ```js
  function seed(stock = PRODUCT.stock) {
    db.exec('DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;');
    …
  }
  await seed();
  ```
  Also observed: with a slow database (2-connection pool, 300 ms per query) the start-up itself crashed, because the 25 parallel seed inserts exceeded the app's 1 s pool timeout (`PoolTimeoutError`, process exited with code 1). **Likely**, because the production database wiring isn't in the repo. Confirm by showing the production start-up: if it runs versioned migrations and never seeds, close this finding.
- **Fix:** Move the schema into versioned migrations applied by a deploy step, not at app start. Never seed in production (only behind an explicit dev/test flag). Load the 100 pairs with a one-off admin script that leaves an audit record. Effort: M
- **Reference:** Twelve-Factor App XII (admin processes as one-off tasks) · architecture checklist "Migrations are versioned and repeatable"

### ARC-06 · Medium · Confirmed: Sale state lives in one server's memory, so a second server would see different stock and limits
- **Where:** `demo/flash-sale/fixed/server.mjs:177` (`soldOut` set, added at `:260`, removed at `:275` only in the process that saw the failed payment), `:137-151` (rate-limit buckets; the comment at `:136` notes the multi-server limit)
- **Impact:** Fine with today's single server. With the second server the team may add, each one keeps its own "sold out" flag and rate limits. A pair returned after a failed payment on server B still shows "Sold out" on server A, bots get double the attempts, and a restart forgets it all.
- **Evidence:** `const soldOut = new Set();` and `const buckets = new Map();` are module-level variables; nothing shares or persists them.
- **Fix:** Before adding a second instance: drop the `soldOut` shortcut or make it a 1 s hint refreshed from the database (the product cache already holds stock), and move rate limits to Redis or the database. Effort: M
- **Reference:** peak-traffic anti-pattern D1 (state in process memory)

### ARC-07 · Medium · Confirmed: Confirmation emails are never actually sent
- **Where:** `demo/flash-sale/fixed/server.mjs:194-210` (`// simulated SMTP call` at line 205; in-memory queue; no retry)
- **Impact:** Buyers get no confirmation after paying. Expect "did my order go through?" emails, and second attempts that ARC-01 can turn into double charges. Once real sending is added, any email still waiting in memory is lost on a restart, and a failed send isn't retried.
- **Evidence:** Line 205: `await new Promise((resolve) => setTimeout(resolve, 250)); // simulated SMTP call`. No email provider in the code or configuration. The comment at lines 195-196 acknowledges the in-memory queue.
- **Fix:** Send through the email provider from a durable queue or an outbox table (status per order, retries with backoff), and authenticate the sending domain (SPF, DKIM, DMARC). Effort: M
- **Reference:** peak-traffic anti-pattern C3 (slow work on a durable queue)

### ARC-08 · Medium · Confirmed: The page gets stuck when the server is busy or the session has expired
- **Where:** `demo/flash-sale/shared/public/app.js:9-18` (no `res.ok` check before `product.reviews.map`), `:36-48` (sign-in stores `body.token` even on an error, so the string "undefined" is saved), `:29-31` and `:59-66` (no 401 handling; the sign-in form stays hidden while any token is stored), `:67` (a 410 is shown as permanently sold out)
- **Impact:** If the product request fails at midnight (a 503 "busy" or a load-balancer error page), the page stays on "Loading…" with Buy disabled and no retry. A shopper whose session has expired sees "Something went wrong. Please try again." on every click, with no way to sign in again from the page. In a sale that lasts a minute, both mean a lost customer.
- **Evidence:** The server returns `503 {error}` when the pool is exhausted (`server.mjs:359`) and 401 for expired or invalid tokens (`server.mjs:123, 233`). `loadProduct()` does `product = await res.json(); … product.reviews.map(…)`, which throws a TypeError on `{error}`. The `messages` map covers only 200/409/410/429/503.
- **Fix:** Check `res.ok`; on failure show a message and retry with backoff (honour `Retry-After`). On 401, clear the stored token and show sign-in. Store a token only when one is returned. After a 410, re-check stock a few seconds later, because failed payments return pairs. Effort: S
- **Reference:** architecture checklist "error handling is consistent"

## Verified and holding up (no finding)
- **No overselling by design:** the reservation is a single conditional statement `UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0` with a rows-affected check, inside one short transaction with the order insert (`server.mjs:247-254`). The database backs it up with `CHECK (stock >= 0)`. The payment call happens outside the transaction (no lock held during the call, anti-pattern A3 avoided).
- **One live order per customer** is enforced by the database: partial unique index on `(product_id, customer)` for `pending`/`paid` (`server.mjs:50`). A double click gets 409 (local: second buy → 409).
- **Money as integer cents**, server-side price, timestamps in UTC (`datetime('now')`).
- **Config fails fast** when a required secret is missing (`server.mjs:24-31`). **Graceful shutdown** finishes in-flight requests (`server.mjs:371-377`).
- **Partner call has a timeout** (3 s) and an idempotency key. The weakness is what happens after a timeout (ARC-01), not the timeout itself.

## Could not check
- The production start-up and database wiring (migrations, connection string, pooler, backups); see ARC-05.
- The production payment integration (payment method collection, 3-D Secure, declines, refunds, webhooks) and identity-provider integration; neither is in the repo.
- Whether staging and production share keys, databases or payment accounts (no environments described).
