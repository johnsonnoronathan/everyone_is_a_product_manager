# Operations & launch-readiness findings

Commit `d572634` · 2026-10-16 · lens: `references/operations.md` · inputs: `00-scope.md`, `01-system-map.md`, the repository
No operations interview was possible in this engagement (intake answers only), and no dashboards were shared. Items below are based on the code and repository, and are marked *not verified* where they depend on the host or the team. Risk tier 3: operational readiness is mandatory.

### OPS-01 · Medium · Confirmed: Nothing records orders, admin actions or sign-ins
- **Where:** `demo/flash-sale/fixed/server.mjs`: the only log lines are `:27` (missing env var), `:268` (payment failed), `:361` (unexpected error), `:368` (started). No request log, no "order paid" event, no admin-reset event, no sign-in event. Only 500 responses carry a request id.
- **Impact:** On sale night you can't answer "how many sold in the first minute, who bought, who wiped the orders, why did this customer see an error?" from the logs, and a customer's support email can't be matched to what happened.
- **Evidence:** `grep -nE 'console\.(log|warn|error|info)' server.mjs` → 4 lines (listed above). The admin reset in SEC-02 left no trace in the server log.
- **Fix:** Log one structured line per request (request id, route, status, duration; never tokens or addresses) and one per business event (order reserved / paid / payment failed / payment unknown, with order id; admin call with caller identity). Return the request id on every error response, and send logs to a searchable store kept ≥ 7 days. Effort: S
- **Reference:** OWASP A09:2025 Security Logging & Alerting Failures

### OPS-02 · Medium · Confirmed: No way to pause the sale or payments without a deploy, except one that wipes all orders
- **Where:** no flag or setting is read at request time in `demo/flash-sale/fixed/server.mjs`. The only lever is `POST /api/admin/reset {"stock":0}` (`:303-312`).
- **Impact:** If something goes wrong at midnight (double charges, bots, a payment outage), the only ways to stop selling are a deploy (minutes, at peak) or the reset, which also deletes every order already taken.
- **Evidence:** Local: Dana buys → `POST /api/admin/reset {"stock":0}` → `GET /api/my-orders` (Dana) → `[]`.
- **Fix:** Add a "sale open / paused" switch read from the database or config at request time (the same mechanism as ARC-04's start time), with a clear message on the page. Write down who may flip it. Effort: S
- **Reference:** operations checklist "Kill switches"

### OPS-03 · Medium · Likely: Magic-link sign-in at midnight: shoppers wait for an email while the 100 pairs sell out
- **Where:** owner intake (production sign-in = managed magic link); `demo/flash-sale/shared/public/app.js:36-49` (sign-in is only offered on the sale page itself); session expiry enforced at `demo/flash-sale/fixed/server.mjs:123`
- **Impact:** Shoppers who open the email at midnight must first ask for a sign-in link and wait for a second email, while the whole stock is expected to go within a minute. Up to 3,000 sign-in emails in one minute may also hit the identity provider's sending limits, so some links arrive late or not at all.
- **Evidence:** Intake: 3,000 visitors in 60 s, magic-link sign-in. The page has no "sign in before the sale" path, and sessions expire (2 h in the demo issuer; production lifetime set by the provider, unknown). *Not verified:* the provider's email rate limit and delivery time.
- **Fix:** Invite customers to sign in before midnight (e.g. in a teaser email), with a session lifetime that covers it. Ask the identity provider for its email-sending limit and raise it for the night. Test magic-link delivery to Gmail and Outlook. Consider a waiting room that also covers sign-in. Effort: S
- **Reference:** operations checklist "Launch logistics"

### OPS-04 · Medium · Likely: The safety nets for launch night are not in evidence
- **Where:** repository-wide. There is no backup or restore configuration, no error tracking (Sentry or similar), no metrics, uptime check or alerts, no runbook, and no deploy/rollback configuration (no Dockerfile, IaC or CI workflow for the app). `/healthz` (`server.mjs:301`) always answers `ok: true`.
- **Impact:** For a tier-3 launch these must exist before midnight: database backups with a tested restore, error tracking, alerts that reach an on-call person, a one-page runbook (roll back, pause the sale, rotate a key, contact the payment provider), and one real small purchase and refund in production. If they're missing, customers will notice problems before the team does.
- **Evidence:** `grep -rniE 'sentry|datadog|opentelemetry|newrelic|bugsnag|rollbar' demo/flash-sale/fixed demo/flash-sale/shared` → no match. *Not verified with the team:* these may exist on the hosting side. Asking would settle it.
- **Fix:** Confirm or set up each item, and record who is on call during the sale and the following week, how they're reached, and where customers see status. Effort: M
- **Reference:** operations checklist "Recover", "Notice", "Respond"

### OPS-05 · Low · Confirmed: The health check is public, shows database pool usage, and checks nothing
- **Where:** `demo/flash-sale/fixed/server.mjs:301`
- **Impact:** Anyone can watch how busy the database is, which is handy for timing an attack, while the load balancer is told "ok" even if the database is unreachable.
- **Evidence:** `curl http://127.0.0.1:3100/healthz` (anonymous) → `{"ok":true,"db":{"poolSize":10,"inUse":0,"waiting":0}}`
- **Fix:** Keep a cheap liveness check that returns only `ok`. Add a readiness check that runs `SELECT 1` with a short timeout. Expose pool numbers only to monitoring. Effort: S
- **Reference:** OWASP A02:2025 Security Misconfiguration

### OPS-06 · Low · Confirmed: Page files are cached for 5 minutes under fixed names, so a hotfix arrives after the sale
- **Where:** `demo/flash-sale/fixed/server.mjs:349` (`cache-control: public, max-age=300` for `/`, `/app.js`, `/style.css`)
- **Impact:** A front-end fix during the sale (for example for ARC-08) reaches shoppers who already loaded the page only up to 5 minutes later, by which time the sale is over. A CDN in front would do the same.
- **Evidence:** `curl -D - http://127.0.0.1:3100/` → `cache-control: public, max-age=300`. File names have no version hash.
- **Fix:** Serve `index.html` with `no-cache` (revalidate with ETag). Give JS/CSS fingerprinted names and cache those for a long time. Effort: S
- **Reference:** peak-traffic anti-pattern E1

### OPS-07 · Low · Likely: The admin "how many sold" view will fail against the real payment provider
- **Where:** `demo/flash-sale/fixed/server.mjs:318` (`GET {PAYMENT_URL}/stats`) and `:310` (`POST {PAYMENT_URL}/reset`), endpoints that only the test provider has
- **Impact:** On sale night the team's only built-in "sold / remaining" view errors out, so they'd be watching the sale blind or querying the database by hand.
- **Evidence:** Code. The real provider's API is not in the repo, so confirm against its documentation. Locally the call works only because the simulator offers `/stats`.
- **Fix:** Build the admin stats from the database (paid / pending / failed counts, remaining stock) and the provider's real API (or the reconciliation job from ARC-01). Remove the provider reset call. Effort: S
- **Reference:** operations checklist "Dashboards"

## Verified and holding up (no finding)
- Graceful shutdown on SIGTERM/SIGINT (finishes in-flight requests, forced exit after 10 s) (`server.mjs:371-377`).
- Unexpected errors return a generic message plus a request id, and log the detail server-side (`server.mjs:360-362`). No stack traces reach the browser.
- Pool saturation returns a fast 503 with `Retry-After` instead of hanging (`server.mjs:359`).

## Could not check (needs the team or the host)
Backups and point-in-time recovery, restore test, rollback procedure, error tracking, uptime monitoring, log retention, alert routing, on-call rota, runbook, status page / support channel, production access hygiene and MFA, TLS certificate renewal, email domain authentication (SPF/DKIM/DMARC), privacy policy and data-deletion process, live-key purchase-and-refund test, scheduled jobs at midnight on the host.
