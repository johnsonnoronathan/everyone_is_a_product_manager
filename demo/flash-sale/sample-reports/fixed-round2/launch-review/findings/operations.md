# Operations & launch-readiness findings (round 2)

Commit `fa296a2` · 2026-10-17 · lens: `references/operations.md` · inputs: `00-scope.md`, `01-system-map.md`, the repository, `demo/flash-sale/fixed/RUNBOOK.md`
There was no operations interview and no dashboards were shared. Items that depend on the host or the team are marked *not verified*. Risk tier 3: operational readiness is mandatory.

## Round-1 findings, re-verified

### OPS-01 · Low · Confirmed: Nothing records orders, admin actions or sign-ins
- **Status:** Partially fixed (open; severity lowered from Medium because business events are now logged)
- **Where:** `demo/flash-sale/fixed/server.mjs:62-66` (JSON event log with an HMAC customer reference), events at `:104, 223, 347, 350, 356, 359, 377, 381, 399, 402, 433, 490, 546, 626, 646`; still missing: a per-request line (route, status, duration), a request id on non-500 errors (`:623-624`), and the caller's identity or IP on admin events (`:223`)
- **Impact:** Orders reserved/paid/declined/unknown, admin actions and test sign-ins now leave a trace, with no emails or addresses in the log. What's still hard: matching a customer's "I got an error" to a specific request. 400/404/409/429/503 answers leave no log line and carry no request id. And there is no way to tell who used the shared admin token (SEC-06).
- **Evidence:** Local run (`verify-basics.mjs`): 71 log lines, `login` 14, `admin_action` 19, `order_reserved` 8, `order_paid` 8, `email_sent` 4, `sale_settings_changed` 12, 0 lines containing `@` or street names. The 409/400/404 answers in the same run produced no log line.
- **Fix:** One structured line per request (request id, route, status, duration, client IP from the trusted proxy header) and a request id on every error response. Logs to a searchable store, kept ≥ 7 days (*not verified*). Effort: S
- **Reference:** OWASP A09:2025 Security Logging & Alerting Failures

### OPS-02 · Medium · Confirmed: No way to pause the sale or payments without a deploy, except one that wipes all orders
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:532-548` (`POST /api/admin/sale {"paused": true|false}`), `:454-455` (buy refused while paused), `:283-286` (1 s cache, so every instance sees it within a second); `RUNBOOK.md:25`
- **Impact:** Round 1: the only lever deleted all orders. Now the sale can be paused and resumed in a second without touching orders.
- **Evidence:** Erin buys → `200 paid`. `{"paused": true}` → `200`; Gina buys → `403 The sale is paused…`; Erin's my-orders → still her paid order; `{"paused": false}` → Gina buys → `200 paid`. Payments in progress keep settling while paused (the reconciler is not paused), which is the right behaviour. Who may flip the switch → SEC-06.
- **Fix:** Done. Effort: S
- **Reference:** operations checklist "Kill switches"

### OPS-03 · Medium · Confirmed: Magic-link sign-in at midnight: shoppers wait for an email while the 100 pairs sell out
- **Status:** Partially fixed (open). The mitigation was added, but the page's session storage undoes it.
- **Where:** `demo/flash-sale/fixed/server.mjs:37` (12 h sessions in the demo issuer), `demo/flash-sale/shared/public/index.html:23` ("Sign in before the sale opens: you stay signed in for 12 hours."), `RUNBOOK.md:14` (send a "sign in now" email ~1 h before); `demo/flash-sale/shared/public/app.js:4-5, 92-93` (the session token is kept in `sessionStorage`)
- **Impact:** The plan is to sign in early so nobody waits for a magic link at midnight. But the page keeps the session in `sessionStorage`, which belongs to one browser tab and is wiped when that tab closes. A shopper who signs in at 11 pm, closes the tab, and then taps the midnight email opens a new tab that isn't signed in. So they wait for a magic link after all, at the busiest minute. The identity provider's email-sending limit for 3,000 links in a minute is still unknown.
- **Evidence:** `app.js:4` `let token = sessionStorage.getItem('token');` and `:92` `sessionStorage.setItem('token', token);` (no other storage). Per the Web Storage standard (and MDN), opening a page in a new tab starts a new, empty `sessionStorage`, and closing the tab clears it. The production sign-in flow is not in the repo, so whether the identity provider's own session would rescue this is *not verified*.
- **Fix:** Keep the session where a new tab can see it: a `Secure; HttpOnly; SameSite=Lax` cookie set by the server or the identity provider's SDK, with an expiry that covers the gap. Then test "sign in, close the browser, open the email link". Ask the identity provider for its email limit and raise it for the night. Effort: S
- **Reference:** operations checklist "Launch logistics"

### OPS-04 · Medium · Likely: The safety nets for launch night are not in evidence
- **Status:** Partially fixed (open). A runbook now exists; the safety nets it lists are unchecked boxes.
- **Where:** `demo/flash-sale/fixed/RUNBOOK.md:9-10` (backups with a tested restore; error tracking and alerts to the on-call phone, both as unchecked boxes); no error-tracking SDK, metrics or alert code in `fixed/` or `shared/` (`grep -rniE 'sentry|datadog|opentelemetry|newrelic|bugsnag|rollbar|prometheus'` → none); no deploy, rollback or infrastructure config in the repo
- **Impact:** The runbook is a real improvement: levers, signals and an after-sale checklist on one page. For a tier-3 launch these things must exist and be shown, not just listed: backups with a tested restore, error tracking, alerts that reach a named on-call person, the on-call rota, a status/support channel, and a real small purchase and refund in production. Without them, customers notice problems before the team does.
- **Evidence:** Runbook checklist items unchecked. *Not verified with the team.* These may exist on the hosting side, and asking would settle it.
- **Fix:** Confirm each item with evidence (backup settings screenshot plus restore log; a test alert reaching the phone; the on-call name and number in the runbook). Effort: M
- **Reference:** operations checklist "Recover", "Notice", "Respond"

### OPS-05 · Low · Confirmed: The health check is public, shows database pool usage, and checks nothing
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:520-529` (`/healthz` liveness `{ok:true}`; `/readyz` runs `SELECT 1`, cached 1 s, returns only `{ok}`)
- **Impact:** Round 1: anyone could watch database load, and the check said "ok" even with the database down. Now pool numbers are gone, and readiness checks the database without being a way to flood it.
- **Evidence:** `GET /healthz` → `200 {"ok":true}`; `GET /readyz` → `200 {"ok":true}`. The runbook puts the load balancer on `/healthz`, so a slow database at peak doesn't take the only server out of rotation (`RUNBOOK.md:11`).
- **Fix:** Done. Effort: S
- **Reference:** OWASP A02:2025 Security Misconfiguration

### OPS-06 · Low · Confirmed: Page files are cached for 5 minutes under fixed names, so a hotfix arrives after the sale
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2` (a smaller, related gap: OPS-10)
- **Where:** `demo/flash-sale/fixed/server.mjs:141-147` (content-hash versions written into `index.html`), `:614` (HTML `no-cache`, versioned assets `immutable`)
- **Impact:** Round 1: a front-end fix reached shoppers up to 5 minutes late. Now the page is revalidated on every load and picks up new files at once.
- **Evidence:** `GET /` → `cache-control: no-cache`; `GET /app.js?v=429d4b36a5` → `public, max-age=31536000, immutable`; `GET /app.js` → `no-cache`.
- **Fix:** Done. Effort: S
- **Reference:** peak-traffic anti-pattern E1

### OPS-07 · Low · Likely: The admin "how many sold" view will fail against the real payment provider
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:550-568` (counts from the database; the test provider's `/stats` only when `ENABLE_TEST_ROUTES=1`)
- **Impact:** Round 1: the team's only "sold / remaining" view depended on a test-only provider endpoint. It now works against any provider.
- **Evidence:** Production-mode instance: `GET /api/admin/stats` → `200 {"initialStock":0,"stockRemaining":0,"paidOrders":0,"pendingOrders":0,"distinctCustomers":0}`, with no call to the provider. It shows zero stock because there is no way to load stock in production yet (OPS-08). The "paid orders ≠ provider charges" check the runbook relies on is not computed anywhere (OPS-08).
- **Fix:** Done. Effort: S
- **Reference:** operations checklist "Dashboards"

## New findings

### OPS-08 · Medium · Confirmed: The runbook depends on tools that don't exist: loading the stock, resolving a stuck payment, exporting addresses, and the charges-vs-orders alert
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:117` ("Production stock is loaded with a one-off, audited admin script"); `demo/flash-sale/fixed/RUNBOOK.md:10` (alert on "paid orders ≠ provider charges"), `:12` ("Stock loaded with the audited admin script"), `:21` ("mark paid or release by hand (two people)"), `:31` (compare provider charges with paid orders), `:33` ("Export shipping addresses through the audited admin path, not ad-hoc database queries"). None of these scripts, paths or checks is in the repo: `fixed/` contains only `server.mjs` and `RUNBOOK.md`.
- **Impact:** As delivered, a production start has no product to sell. A production-mode instance answers `GET /api/products/1` with 404, and admin stats show `initialStock 0`. The steps the on-call person is told to take for stuck payments (ARC-10) and for fulfilment mean editing the live database by hand, which the runbook itself says not to do. And the one alert that would catch a charged-but-no-order customer has nothing feeding it.
- **Evidence:** Production-mode instance (strong random secrets, flags off): `GET /api/products/1` → `404 {"error":"Product not found"}`; `GET /api/admin/stats` → `initialStock 0`. `grep -rniE 'audited|export' demo/flash-sale/fixed --include=*.mjs` → only the comment at `server.mjs:117`.
- **Fix:** Before launch, add small admin commands (CLI or admin routes behind personal admin identities) that write an audit record: load stock, mark an order paid / release it after checking the provider, export paid orders with addresses. Also add a job that compares the provider's charges (its reporting or list API) with paid orders and alerts on any difference. Rehearse each one on staging. Effort: M
- **Reference:** operations checklist "Respond" (runbook) · Twelve-Factor App XII (admin processes)

### OPS-09 · Medium · Confirmed: The runbook's rollback step doesn't work: the previous release can't start against the new database
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/RUNBOOK.md:27` ("Roll back: redeploy the previous release. Migrations are additive, so the old code runs against the new schema. Restarts never wipe data."); previous release `d572634`: `demo/flash-sale/fixed/server.mjs:42-54` at that commit (plain `CREATE TABLE products …` at start-up, then `seed()` deleting every table)
- **Impact:** If something goes wrong on sale night and the on-call person rolls back as the runbook says, the previous version fails at start-up. The shop is then down until someone redeploys the new version. Had that start-up got further, its order inserts would fail against the new schema, and its seed step deletes every order. Rollback is the lever you reach for when things are already bad.
- **Evidence:** `verification/rollback-ddl.mjs` replays the previous release's start-up statements (copied from `git show d572634:demo/flash-sale/fixed/server.mjs`) against a copy of a database migrated by the current release:
  ```
  orders in the database before the old start-up: 3
  old CREATE TABLE statements: table products already exists  -> the previous release exits at start-up
  old order INSERT (if it got that far): table orders has no column named address
  old seed() would run next: DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;
  ```
  (In the demo the old code uses an in-memory database and would start empty, so the failure only shows against a persistent database, as production has.)
- **Fix:** Correct the runbook: the oldest release you can roll back to is this one (`fa296a2`) or later. Tag it, and test a rollback between two tagged releases on staging with a copy of the data. Keep future migrations backward-compatible (add columns; never rename or drop during the season). Effort: S
- **Reference:** operations checklist "Rollback… Database migrations in this release are backward-compatible or have a rollback script"

### OPS-10 · Low · Confirmed: Any `?v=` value is cached for a year, so a mixed-version deploy can pin old JavaScript
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:614` (`url.searchParams.has('v') ? 'public, max-age=31536000, immutable'`, without checking the value matches the current file)
- **Impact:** During a rolling deploy (two versions briefly live, or a CDN in front), a browser or CDN can fetch the new page's `app.js?v=NEW` from a server still running the old version. It then gets the old script marked "keep for a year". That shopper, or everyone behind that CDN, keeps the old script, which is exactly what versioned names are meant to prevent.
- **Evidence:** `GET /app.js?v=anything-at-all` → `200`, `cache-control: public, max-age=31536000, immutable`. Two-version deploy not run (*Likely* impact).
- **Fix:** Send the long cache header only when `v` equals the current hash; otherwise `no-cache` (or 404). Effort: S
- **Reference:** peak-traffic anti-pattern E1

## Test evidence folded in after the review
- AC-13 (pause without losing orders) passes 3/3: `403 "The sale is paused…"` during the pause, `200` after resuming. This confirms OPS-02.
- AC-12's screenshot shows the sign-in form still visible while signed in (ARC-15, found by test). That matters here because each extra sign-in at midnight is another magic-link email (OPS-03).
- No test covers the runbook levers (rollback, stuck payments, stock loading) or the monitoring items.

## Verified and holding up (no finding)
- Graceful shutdown on SIGTERM/SIGINT: timers stopped, in-flight requests finished, forced exit after 10 s (`server.mjs:649-657`). Anything left pending is settled after restart (ARC-02 evidence).
- Start-up runs nothing destructive and refuses unsafe production configuration (ARC-05, SEC-04 evidence).
- Unexpected errors return a generic message plus a request id; detail goes only to the log (`server.mjs:625-627`).
- The runbook (`RUNBOOK.md`) covers levers (pause, move opening time, rotate key), the signals to watch, and after-sale checks. Its gaps are OPS-08, OPS-09 and ARC-10's "keep the sale open" line.

## Could not check (needs the team or the host)
Backups and point-in-time recovery, restore test, error tracking, uptime monitoring, log retention, alert routing, on-call rota, status page / support channel, production access hygiene and MFA, TLS renewal, email domain authentication (SPF/DKIM/DMARC), privacy policy and data deletion, live-key purchase-and-refund test, load-balancer idle timeout and health-check settings, scheduled jobs on the host at midnight, whether `NODE_ENV=production` is set by the deploy.
