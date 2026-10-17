# Architecture & data-integrity findings (round 2)

Commit `fa296a2` · 2026-10-17 · lens: `references/architecture.md` (+ peak-traffic anti-patterns A1–A5, C1–C4, D1) · inputs: `00-scope.md`, `01-system-map.md`, `scans/`
Reproductions ran only against local instances started by the reviewer on ports 3100/4200. Some runs used the simulator's knobs (`DB_LATENCY_MS`, `PAYMENT_MIN_MS`/`PAYMENT_MAX_MS`, provider `/config`), and some used `DB_FILE` for a database that survives restarts. Scripts: `verification/`. Round-1 scripts were adapted: bodies now carry an `address`; `/api/search` is gone, so the busy-database flood uses a signed-in `/api/my-orders`.

## Round-1 findings, re-verified

### ARC-01 · High · Confirmed: A slow payment is treated as a failed one: the customer can be charged, lose the pair, and be charged again on retry
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:466` (one random `payment_key` per order, stored, `UNIQUE` at `:81`), `:299-310` (only 402 = declined; timeout/409/5xx = unknown), `:340-361` (unknown keeps the reservation), `:492-500` (202 "confirming… Please don't pay again"), `:363-387` (reconciler repeats the same charge with the same key); `demo/flash-sale/shared/public/app.js:99-110, 128-130` (page follows the order instead of asking for a retry)
- **Impact:** Round 1: when the provider took about 3 s, shoppers were told to try again and paid twice (41 payments for 39 pairs). Now a slow payment keeps the pair reserved, the shopper is told not to pay again, a retry is refused, and the order settles a few seconds later.
- **Evidence:** `verification/repro-slow-payment.mjs` with the provider answering in 2.985–3.015 s, two runs:
  ```
  40 buyers: first attempt {"202 confirming":35,"200 paid":5}; stats right after: paid 5, pending 35, charges 40
             retry by the 35 "confirming" shoppers -> 409 ×35
             after 8 s: paidOrders 40, pendingOrders 0, charges 40 (1,999.60 USD); all 35 orders now "paid"
  60 buyers: {"202 confirming":44,"200 paid":16} -> retries 409 ×44 -> after 4 s: paid 60, pending 0, charges 60
  ```
  Provider charges equal paid orders in both runs. The simulator now completes a charge after the app hangs up, like a real provider, so this test can see the round-1 problem. Remaining design gaps of the reconciler are in ARC-10.
- **Fix:** Done. Effort: M
- **Reference:** OWASP A06:2025 Insecure Design · CWE-754 Improper Check for Unusual or Exceptional Conditions

### ARC-02 · High · Confirmed: When the database is busy, a customer who has just paid is told "We are very busy" and the order is left stuck
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:313-322` (`settle()`: waits for a connection with no timeout, up to 5 attempts with backoff), `:324-337` (`markPaid` / `releaseOrder` via `settle()`, guarded by `status = 'pending'`), `:353-358` (a failed settle answers "unknown", not 503), `:363-387` (reconciler picks up any order left pending, including after a crash)
- **Impact:** Round 1: a shopper could be charged, then see "We are very busy", with the order stuck forever. Now the write after a charge waits until it lands, and anything left pending (crash, deploy) is settled by the reconciler.
- **Evidence:** `verification/repro-busy-db.mjs`: `DB_LATENCY_MS=300`, the pool flooded by one signed-in account while Carol's payment is in flight, three runs:
  ```
  paid:     carol buy -> 200 {"orderId":1,"status":"paid"} · my-orders -> [paid order] · retry -> 409 · stats paid 1, charges 1
  paid:     carol buy -> 200 {"orderId":2,"status":"paid"} · same result
  declined: carol buy -> 402 "Your card was declined. You have not been charged." · my-orders [] · retry -> 200 paid (pair was released)
  ```
  Crash mid-payment (`verification/repro-restart.sh`, `DB_FILE`): Vic's buy → 202 confirming. Then `SIGKILL` of the app process. After restart: `pendingOrders 1` → 12 s later `paidOrders 2, pendingOrders 0`, plus `order_paid {"orderId":2}` and `email_sent {"orderId":2}` in the log. During the same flood other shoppers did get 503s, but only *before* any money moved. That is a different problem (PERF-03).
- **Fix:** Done. Effort: M
- **Reference:** CWE-754 · architecture checklist "partial failure is compensated"

### ARC-03 · High · Confirmed: Orders are taken and charged without a shipping address
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:411-415, 452` (address required, 10–300 chars, checked before the sale check and the reservation), `:80` (`ship_to TEXT NOT NULL`); `demo/flash-sale/shared/public/index.html:26-29`, `app.js:113-114, 121` (field shown after sign-in, sent with the buy)
- **Impact:** Round 1: every buyer would have been charged without a delivery address. Now no order is taken without one.
- **Evidence:** `verification/verify-basics.mjs`: buy without address / `"short"` / an address object → `400 {"error":"Please enter your full shipping address"}`; stats afterwards `stockRemaining 100, pendingOrders 0` (nothing reserved). Residual, not a finding: the address is one free-text box with only a length check, so "aaaaaaaaaa" or a country you don't ship to is accepted. Consider structured fields or an address-validation step before launch.
- **Fix:** Done. Effort: M
- **Reference:** OWASP A06:2025 Insecure Design

### ARC-04 · High · Confirmed: Nothing stops people buying before the sale opens at midnight
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2` (new, separate weakness in how the time is set: ARC-11)
- **Where:** `demo/flash-sale/fixed/server.mjs:24-26` (`SALE_STARTS_AT`, required in production), `:88, 111-114` (stored in `sale_settings`), `:417-425, 454-456` (buy refused before the opening time or while paused), `demo/flash-sale/shared/public/app.js:44-72` (countdown from the server clock)
- **Impact:** Round 1: the sale opened the moment it was deployed. Now the server refuses buys before the configured time.
- **Evidence:** Admin sets `startsAt` one hour ahead → `POST /api/buy` → `403 {"error":"The sale opens at 2026-10-17T22:00:01.649Z"}`. Production start without `SALE_STARTS_AT` → `Refusing to start: SALE_STARTS_AT is required in production`. The page shows "The sale opens at 11/27/2026, 9:07:24 PM." with the button "Not open yet" (`verification/frontend-harness.mjs`).
- **Fix:** Done. Make the time hard to set wrong → ARC-11. Effort: S
- **Reference:** OWASP A06:2025 Insecure Design

### ARC-05 · High · Likely: Every server start deletes all orders and resets stock to 100
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2` (the production stock-loading step it relies on doesn't exist yet: OPS-08)
- **Where:** `demo/flash-sale/fixed/server.mjs:73-115` (append-only migrations with a `schema_migrations` table), `:118-139` (demo data only with `SEED_DEMO_DATA=1`, and only into an empty database; wiping only from the test-only reset)
- **Impact:** Round 1: a restart during the sale would have erased every order and put 100 more pairs on sale. Now restarts keep the data.
- **Evidence:** `verification/repro-restart.sh` with `DB_FILE`: first boot applies migrations 1–4. Uma buys (paid); the app is killed. Second boot, `SEED_DEMO_DATA=1` still set: no migrations re-applied, stats `stockRemaining 98, paidOrders 1` (not reset to 100). Production-mode start with `SEED_DEMO_DATA` off: products table empty, `GET /api/products/1` → 404. Two notes, not findings: migrations run in the app at start-up, not as a deploy step, with no lock, so two instances starting at once against Postgres could race; the loser exits and succeeds on restart. And see OPS-09 for what a rollback does to this schema.
- **Fix:** Done. Before launch, provide the audited stock-loading script (OPS-08). Effort: M
- **Reference:** Twelve-Factor App XII · architecture checklist "Migrations are versioned and repeatable"

### ARC-06 · Medium · Confirmed: Sale state lives in one server's memory, so a second server would see different stock and limits
- **Status:** Condition / accepted risk ("sold out" part fixed; rate limits remain per server, accepted in the runbook with no named owner or date)
- **Where:** `demo/flash-sale/fixed/server.mjs:290-292, 457, 487` (sold-out hint now expires after 2 s), `:226-243` (rate-limit buckets still in process memory), `demo/flash-sale/fixed/RUNBOOK.md:36` ("Rate limits are per server. Run **one** instance, or move them to Redis before adding a second.")
- **Impact:** Fine on one server. With a second server, each server enforces "5 attempts per 10 s" on its own, so bots get double the attempts, and the email sender would send everything twice (ARC-13). The sold-out hint is now at most 2 s stale, which is harmless.
- **Evidence:** Code. Returned pair re-offered immediately (ARC-09 evidence). Two-instance behaviour not run.
- **Fix:** Condition: one instance for this sale (owner and date to be named). Before a second instance, move rate limits to Redis or the database, and make the outbox sender claim rows (ARC-13). Effort: M
- **Reference:** peak-traffic anti-pattern D1

### ARC-07 · Medium · Confirmed: Confirmation emails are never actually sent
- **Status:** Partially fixed (open): the queue is now durable, but nothing sends
- **Where:** `demo/flash-sale/fixed/server.mjs:89-90, 328` (outbox row written in the same transaction as "paid", good), `:390-408` (sender), `:397` (`await new Promise((resolve) => setTimeout(resolve, 50)); // simulated call to the email provider`)
- **Impact:** No buyer gets a confirmation yet. The page tells "confirming" shoppers "We'll email you as soon as it's done" (`app.js:109`), so the gap now matters more. Expect "did my order go through?" support mail on sale night.
- **Evidence:** Outbox rows are marked sent after a 50 ms timer; there is no email provider in the code or config. The log shows `email_sent` for orders whose email went nowhere. SPF/DKIM/DMARC for the sending domain: not in evidence.
- **Fix:** Call the real email provider from the outbox sender, with per-row attempts and backoff (ARC-13), authenticate the sending domain, and send a test to Gmail and Outlook. Effort: M
- **Reference:** peak-traffic anti-pattern C3

### ARC-08 · Medium · Confirmed: The page gets stuck when the server is busy or the session has expired
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/shared/public/app.js:15-26` (checks `res.ok`, shows "We are very busy. Retrying…", retries with backoff and jitter), `:74-79, 131` (401 → clear the token, show sign-in), `:90-93` (token stored only when returned), `:11` (15 s timeout on every request)
- **Impact:** Round 1: a busy moment left the page on "Loading…", and an expired session couldn't sign in again. Both now recover.
- **Evidence:** `verification/frontend-harness.mjs` runs the real `app.js` with a DOM stub against the local instance:
  ```
  busy:    after first 503: name="We are very busy. Retrying…" -> after backoff: name="Limited Edition Holiday Sneakers" (3 product requests)
  expired: stored invalid token, click Buy -> message="Your session has expired. Please sign in again." login-form.hidden=false, token cleared
  ```
- **Fix:** Done. Effort: S
- **Reference:** architecture checklist "error handling is consistent"

### ARC-09 · Low · Confirmed (found by test in round 1): Pairs that come back after a failed payment aren't offered to anyone
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2` (local check, and the round-2 oversell test sold 100 of 100: see "Test evidence" below)
- **Where:** `demo/flash-sale/fixed/server.mjs:292, 346, 457, 487` (sold-out hint 2 s, cleared when a decline returns a pair), `demo/flash-sale/shared/public/app.js:43-50, 133-135, 140` (after "sold out" the page re-checks every ~20–25 s and says pairs may come back)
- **Impact:** Round 1: 4 of 100 pairs stayed unsold after the shop showed "Sold out". Now a returned pair is sold again within seconds, and pages that showed "sold out" keep checking.
- **Evidence:** `verification/repro-returned-pair.mjs` (stock 1): Ben while Ann's payment is pending → `410 Sold out`; Ann → `402 declined`; product page right after → `stock 1`; Ben again → `200 paid`. Note: a payment whose outcome is unknown keeps its pair until it settles. That is correct, but it means "sold out" can show for a few seconds while pairs are only reserved.
- **Fix:** Done. Effort: S
- **Reference:** peak-traffic anti-pattern E6

## New findings

### ARC-10 · Medium · Confirmed: A payment error that retrying can't fix leaves orders "confirming" forever: the whole stock can be locked with nothing sold, and the first alert comes after 10 minutes
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:306-308` (every non-402 answer, including 400/401/403/404, counts as "unknown"), `:363-387` (reconciler: re-sends the charge instead of looking it up; no attempt limit, no age limit, no release path; `ORDER BY created_ms LIMIT 50`, one order after another), `:31, 376-377` (`ALERT_payment_stuck` only after 10 minutes), `:12` (`PAYMENT_URL` defaults to `http://127.0.0.1:4100` and isn't required in production); `demo/flash-sale/fixed/RUNBOOK.md:20-21` ("If rising: … Keep the sale open")
- **Impact:** Picture a wrong provider address or key, a revoked key, or a request the provider rejects for good. Every buyer is told "Your pair is reserved. Please don't pay again", and the pairs stay locked with no end. Within the one-minute sale all 100 pairs can be reserved with nothing sold. Shoppers see "Sold out" and the buyers can't try again. The first alert arrives 10 minutes later. The runbook tells the on-call person to keep the sale open while this happens. Nothing in the app can release these orders; it takes hand-written database changes. A real provider would make this more common than the simulator does. Stripe, for example, documents that it replays the first result for a key, including server errors, and may forget keys after 24 hours. So an order whose first attempt got a provider error would never settle by re-sending, and days later a re-send could start a fresh charge.
- **Evidence:** `verification/repro-stuck-payment.mjs`: the same two processes `run.mjs` starts, with `PAYMENT_URL=http://127.0.0.1:4200/v1` (a path the provider doesn't serve), stock 3:
  ```
  shoppers 1-3 buy        -> 202 {"status":"confirming","message":"… Your pair is reserved. Please don't pay again."}
  a fourth shopper        -> 410 Sold out
  after 15 s and 30 s     -> stats {"stockRemaining":0,"paidOrders":0,"pendingOrders":3}
  each order              -> "status":"pending"
  shopper 1 tries again   -> 410 Sold out
  log: 18 × {"event":"payment_unknown","reason":"payment provider answered 404"} in 30 s, 0 × ALERT
  ```
  The real-provider part (errors replayed for a key, keys expiring) is from provider documentation, not reproduced, so that part is *Likely*. Confirm against the chosen provider's idempotency docs.
- **Fix:** Settle by **looking up** the payment (the provider's retrieve/search API by idempotency key or order-id metadata, or its signed webhook) instead of re-sending the charge. Treat 4xx other than "in progress" as failed and release the pair. Give "unknown" a deadline (e.g. 2 minutes), then release and tell the customer. Alert on the first `payment_unknown` burst, not after 10 minutes. Make `PAYMENT_URL` required (HTTPS) in production. Add a two-person admin action to mark an order paid or released, with an audit log. Change the runbook line to "if pending orders rise and none settle, pause the sale". Effort: M
- **Reference:** CWE-754 Improper Check for Unusual or Exceptional Conditions · architecture checklist "a timeout is unknown… confirm with the provider (lookup or webhook)"

### ARC-11 · High · Confirmed: The opening time can silently be wrong: changing `SALE_STARTS_AT` after the first start does nothing (while the log says it did), and dates without a time zone are accepted
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:111-114` (`INSERT OR IGNORE` copies `SALE_STARTS_AT` into the database only on the very first start), `:646` (`server_started` logs the environment value, not the one in force), `:24-25` and `:537-539` (`new Date()` / `Date.parse()` accept a date with no time or zone, and any text JavaScript can read as a date); `demo/flash-sale/fixed/RUNBOOK.md:6` ("`SALE_STARTS_AT` set in production… The server refuses to start without it.")
- **Impact:** Production won't start without `SALE_STARTS_AT`, so the first deploy has to carry some date. That first date is the one that counts from then on. Here is how that bites. The team deploys early with a test date in the past, to make the real test purchase in production. On the day before, they set the real midnight date, as the runbook says, and redeploy. The server logs the new date but keeps the old one, so the sale stays open all evening and bots buy the pairs before the email goes out. If the date changes the other way, the sale stays shut at midnight while 3,000 people watch. Typing a date without a time zone also opens early: `2026-11-27` means midnight in London, which is 7 pm the evening before in New York. The admin endpoint accepted "Nov 27" as 27 November 2001 and opened the sale on the spot.
- **Evidence:** `verification/repro-restart.sh` (`DB_FILE`):
  ```
  boot 1: SALE_STARTS_AT=2026-10-17T21:03:55.620Z (already open)
  boot 2: SALE_STARTS_AT=2026-10-19T21:04:59.494Z (two days later)
    log:  {"event":"server_started",…,"saleStartsAt":"2026-10-19T21:04:59.494Z"}
    GET /api/products/1 .sale -> {"startsAt":"2026-10-17T21:03:55.620Z","paused":false,"open":true}
    wes buys -> 200 {"orderId":3,"status":"paid"}
  ```
  `verification/verify-basics.mjs`, `POST /api/admin/sale`:
  ```
  "2026-11-27"          -> stored 2026-11-27T00:00:00.000Z (= 19:00 on 26 Nov in New York)
  "2026-11-27T00:00:00" -> stored 2026-11-27T00:00:00.000Z (server's own zone, UTC here)
  "Nov 27"              -> stored 2001-11-27T00:00:00.000Z, open=true
  "1"                   -> stored 2001-01-01T00:00:00.000Z, open=true
  12345                 -> stored 1970-01-01T00:00:12.345Z, open=true
  paused "false" -> paused=true · paused null -> paused=false
  ```
  The pause flag (`RUNBOOK.md:12`, "sale paused until the final check") would hold the sale closed if the team uses it, but the opening time is what keeps it closed after the final check.
- **Fix:** One source of truth. Either the environment value wins at every start (update the row and log old → new), or the database wins and start-up refuses when the two differ. Accept only full ISO timestamps with an explicit offset (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/`) in both places. Accept `paused` only as a boolean. Log, and return from the admin endpoint, the time in force, both in UTC and in the sale's local zone. Add "open the page and read the opening time" to the T-1 checklist. Effort: S
- **Reference:** OWASP A06:2025 Insecure Design · CWE-20 Improper Input Validation · architecture checklist "Time: stored in UTC… sale start/end times tested across time zones"

### ARC-12 · Low · Confirmed: The one-per-address check ignores every letter that isn't plain English, so different addresses written in Japanese, Russian, Greek etc. block each other
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:414` (`key: shipTo.toLowerCase().replace(/[^a-z0-9]/g, '')`), `:87` (unique index on that key)
- **Impact:** For addresses in a non-Latin script, only the digits are left, so two different customers whose addresses share the same numbers are treated as one address. The second gets "This address already has an order" and can't buy. Accented letters are dropped too (é, ü, ø). Raise to Medium if you ship to countries that write addresses this way.
- **Evidence:** `verification/verify-basics.mjs`:
  ```
  Tokyo  "東京都千代田区丸の内1-1-1"                 -> 200 paid
  Osaka  "大阪府大阪市北区梅田1-1-1"                 -> 409 This address already has an order for this item
  Moscow "Москва, ул. Тверская, д. 7, кв. 12"         -> 200 paid
  St P.  "Санкт-Петербург, Невский пр., д. 7, кв. 12" -> 409 This address already has an order for this item
  ```
- **Fix:** Normalise with Unicode-aware rules (`normalize('NFKC')`, keep `\p{L}\p{N}`), and ideally use an address-validation service's canonical form (which also fixes the "St." vs "Street" bypass in SEC-03). Effort: S
- **Reference:** OWASP A06:2025 Insecure Design

### ARC-13 · Low · Likely: Once real sending is added, one failing email blocks all later ones, and a second server would send every email twice
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:390-408` (the `try` wraps the whole batch, so one exception stops it; next tick starts again from the same oldest unsent row; no attempt counter or backoff; rows aren't claimed before sending)
- **Impact:** If the email provider rejects one address, that email is retried every second forever, and no confirmation after it goes out. With the second server the team may add, both servers pick the same rows and every customer gets two emails.
- **Evidence:** Code. Sending is simulated today (`:397`) and can't fail, so this isn't reproducible yet. A failing `settle()` on the "mark sent" step (`:398`) already re-sends the same email on the next tick.
- **Fix:** Per-row `attempts`/`next_attempt_ms`/`last_error`, catch per row, move to "failed" after N attempts with an alert. Claim rows atomically (`UPDATE … SET claimed_by = ?, claimed_until = ? WHERE sent_ms IS NULL AND (claimed_until IS NULL OR claimed_until < now) LIMIT 20`) before sending. Effort: S
- **Reference:** architecture checklist "Slow or non-essential work is asynchronous via a durable queue"

### ARC-14 · Low · Confirmed: The page sends shoppers to an order history and an email that don't exist
- **Status:** Open
- **Where:** `demo/flash-sale/shared/public/app.js:124` ("Connection problem. Check your order history before trying again."), `:109` ("We'll email you as soon as it's done"); no order-history view in `index.html`/`app.js` (`/api/my-orders` is never called, and it lists only paid orders: `server.mjs:517`); emails only for paid orders (`server.mjs:328`)
- **Impact:** A shopper whose connection drops during checkout is told to check an order history the page doesn't have. Pressing Buy again then says "You already have an order", without saying whether they paid. A shopper whose payment was still being confirmed after two minutes is promised an email. If that payment is later declined (ARC-10) no email comes, so they never learn they weren't charged.
- **Evidence:** `grep -n "my-orders\|history" shared/public/*` → only the message at `app.js:124`. Server: an unknown order that ends `payment_failed` writes no outbox row.
- **Fix:** Show the shopper's own orders, including "confirming", on the page; after a dropped connection call that instead of guessing. Send a "not charged" email when a confirming order is released. Effort: S
- **Reference:** architecture checklist "error handling is consistent"

### ARC-15 · Low · Confirmed (found by test): The sign-in form never disappears, and the stock count doesn't change after a purchase
- **Status:** Open
- **Where:** `demo/flash-sale/shared/public/style.css:6` (`form { display: flex; … }` overrides the browser's `[hidden] { display: none }`, so `app.js:67` `$('login-form').hidden = Boolean(token)` has no visible effect; the new address block got its own `#checkout-fields[hidden]` rule at `style.css:15`, the form didn't); `demo/flash-sale/shared/public/app.js:127, 139` (after a successful buy the page re-renders without reloading the product)
- **Impact:** A signed-in shopper sees "Signed in as …" and, right above it, an email box with a "Sign in" button. At midnight some will sign in again, and in production each attempt sends another magic-link email (OPS-03). After buying, the page still says "100 left" and keeps "Buy now" enabled, so a second click just gets "You already have an order". Cosmetic, but confusing in a one-minute sale.
- **Evidence:** Round-2 acceptance screenshots (Playwright, Chrome): `acceptance/artifacts/flash-sale-AC-02-…/test-finished-1.png` shows the email field, "Sign in" and "Signed in as buyer-…@acceptance.test" together, with "Order #1 confirmed — $49.99 charged." under "$49.99 · 100 left" and an enabled "Buy now". The same in AC-08 ("1 left" after the only pair was bought) and AC-12. The CSS rule is unchanged since round 1 (`git show d572634:…/style.css` line 6), so round 1 had this too; neither review's code reading caught it.
- **Fix:** Add `[hidden] { display: none !important; }` (or `#login-form[hidden] { display: none; }`) to the stylesheet, and call `loadProduct()` after a 200/202 buy. Add a screenshot assertion that the sign-in form is hidden once signed in. Effort: S
- **Reference:** architecture checklist "error handling is consistent" (UI state)

## Test evidence folded in after the review
Read only after the findings above were written. Sources: `peak-traffic/` (RUNS.md, four load runs, oversell summary) and `acceptance/ACCEPTANCE.md` (criteria v1.1, 36 runs, 12 pass + AC-07 external).
- **ARC-01:** AC-08 ("slow or failing payments never charge twice or lose the pair") passes 3/3; its evidence shows `paidOrders 1, charges 1`. The oversell run had 2 buyers answered "confirming payment" at checkout, and both ended paid (`pending 0`, `sold 100`, `buyers charged twice 0`). Consistent with the ARC-01 reproduction.
- **ARC-03, ARC-04:** AC-11 (no order without an address, page and direct request) and AC-12 (nobody can buy before the opening; direct request → 403) pass 3/3.
- **ARC-09:** confirmed fixed by test. The oversell check now sells **100 of 100** (round 1: 96, with 4 pairs stranded); stock counter 0, nothing left pending.
- **No overselling:** 1,000 buyers × 2 clicks → 100 accepted, 1,998 rejected, 0 server errors, 100 distinct customers.
- **New, found by test:** ARC-15 (screenshots).
- **What the tests don't cover:** the opening time being changed after first start or typed without a zone (ARC-11), a permanent payment error (ARC-10), the 41-day countdown (PERF-04), a busy database (ARC-02/PERF-03), restarts (ARC-05). AC-02's "the order appears in their order history" passes, but the page has no order history (ARC-14), so it can only have been checked through the API (the test source was not opened).

## Verified and holding up (no finding)
- **No overselling by design:** reservation is one conditional `UPDATE … WHERE stock > 0` plus the pending order in one short transaction (`server.mjs:468-477`); `CHECK (stock >= 0)`; payment outside the transaction.
- **One live order per customer and per address** enforced by partial unique indexes (`:86-87`); a double click or retry gets 409.
- **No double charge:** `payment_key UNIQUE`, reused by every retry of the same order (ARC-01 evidence). `markPaid`/`releaseOrder` only change `pending` orders, so the request and the reconciler can both run safely, on one server or two.
- **Durable outbox** written in the same transaction as "paid" (`:324-330`).
- **Money as integer cents**, server-side price, timestamps as UTC epoch ms.
- **Graceful shutdown** stops timers, finishes in-flight requests, and anything left pending is settled by the reconciler after restart (ARC-02 evidence).

## Could not check
- Production database wiring (connection string, pooler, migration locking on Postgres) and the stock-loading script (not in the repo).
- The production payment integration (payment method, 3-D Secure, declines, refunds, lookup API, webhooks) and identity-provider integration.
- Behaviour with two app instances (not run; code reading only).
- Whether staging and production share keys, databases or payment accounts.
