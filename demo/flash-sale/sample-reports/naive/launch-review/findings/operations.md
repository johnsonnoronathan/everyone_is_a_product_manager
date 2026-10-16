# Operations & launch-readiness findings

Commit `d572634`. Many of these are answered by the setup and the owner's intake, not by code. The owner described a single Node process behind a load balancer and a hosted Postgres, with no monitoring, backup, on-call or runbook mentioned; items below are marked *asked* (from intake/setup) or *verified* (seen in code/behaviour).

---

### OPS-01 · High · asked: No error tracking, uptime monitoring, dashboards or alerting
- **Where:** whole system; no error tracker, uptime check, metrics or alert configuration in the repo or the intake.
- **Impact:** On launch night, if checkout starts failing, the process crashes (SEC-07), or the payment provider hangs (PERF-03), nobody finds out until customers complain. There is no dashboard to see the bottleneck (DB connections, error rate) and no alert to wake anyone.
- **Evidence:** The only observability is `console.log`/`console.error` to stdout (`server.mjs:62, 172`). No Sentry/Rollbar, no uptime monitor, no metrics endpoint; intake listed none.
- **Fix:** Add server + browser error tracking (e.g. Sentry) with source maps uploaded privately; an uptime check on the home page and on `POST /api/buy` (synthetic) that pages a person; a basic dashboard for request rate, error rate, latency and DB connections/CPU; alerts on error-rate spikes and payment failures. Name an on-call owner for launch week. Effort: M
- **Reference:** operations.md — Notice
- **Status:** Open

---

### OPS-02 · High · asked/verified: No backups or recovery, and orders are wiped on restart
- **Where:** data layer; no backup/restore plan in the intake, compounded by ARC-02.
- **Impact:** Orders hold the only record of who bought what and where to ship it. There is no stated backup, no tested restore, and the app actively deletes all orders on startup (ARC-02). A crash, redeploy or second instance on sale night could lose every order taken so far with no way back.
- **Evidence:** Intake describes no backups or point-in-time recovery; `seed()` runs `DELETE FROM orders` on boot (`server.mjs:22, 27`), which was observed deleting a live order.
- **Fix:** Turn on automated backups + point-in-time recovery on the hosted Postgres and test a restore into a scratch database before launch; remove the destructive startup seed (ARC-02); confirm the previous version can be rolled back in minutes. Effort: M (mostly configuration + ARC-02 fix)
- **Reference:** operations.md — Recover
- **Status:** Open

---

### OPS-03 · Medium · verified: No safe kill switch or graceful degradation
- **Where:** whole system; the only runtime control is the unauthenticated, destructive `POST /api/admin/reset` (SEC-03).
- **Impact:** If something goes wrong mid-sale there is no way to pause the sale, show a "we're busy, you're in line" page, or turn off non-essential parts (reviews) to protect checkout — short of killing the process, which wipes orders. The one control that exists is dangerous and open to the public.
- **Evidence:** No feature flag, maintenance mode or pause control in the code; reviews are loaded inline with the product page (`server.mjs:88-92`) with no way to disable them under load.
- **Fix:** Add an env-var/feature-flag kill switch to pause buys and a maintenance page at the load balancer; allow reviews/search to be turned off to protect checkout; make any admin control authenticated (SEC-03). Effort: S
- **Reference:** operations.md — Respond; peak-traffic anti-pattern E6
- **Status:** Open

---

### OPS-04 · Medium · verified: Logs contain personal data and stack traces, with no request id or retention
- **Where:** `demo/flash-sale/naive/server.mjs:62` (`email sent to <customer email> for order <id>`) and `:172` (`console.error(err)` dumps full stacks).
- **Impact:** Customer emails are written to stdout for every order, and full error stacks are logged, with no request id to tie a customer report to an error and no stated retention or access control on logs. That is unnecessary personal data in logs and weak forensics.
- **Evidence:** During testing the server log showed lines like `email sent to race24@example.com for order 31` and full `SyntaxError … at … server.mjs:46` stacks.
- **Fix:** Log a request id and order id, not the raw email; keep structured logs for ≥ 7 days in a searchable store with access control; log auth events, admin actions and payment events deliberately (and never tokens/keys). Effort: S
- **Reference:** operations.md — Notice; OWASP A09:2025
- **Status:** Open

---

### OPS-05 · Medium · asked: Launch email not verified for deliverability or anti-spoofing
- **Where:** email sending (`sendConfirmationEmail`, `server.mjs:59-63`) and the planned midnight email blast.
- **Impact:** The whole sale is driven by an email blast, and confirmations are emailed. If the sending domain has no SPF/DKIM/DMARC, the blast and receipts may land in spam (fewer buyers) and the domain can be spoofed (phishing "your order" emails).
- **Evidence:** No email configuration in the repo; intake did not confirm domain authentication or a spam-folder test.
- **Fix:** Set SPF, DKIM and DMARC for the sending domain and test delivery to Gmail/Outlook before the blast; send from an authenticated transactional provider. Effort: S
- **Reference:** operations.md — Launch logistics
- **Status:** Open

---

### OPS-06 · Low · asked: Privacy and legal basics not evidenced
- **Where:** product-wide; collects customer emails and shipping addresses.
- **Impact:** Personal data of public consumers is collected with no visible privacy policy, consent, or data access/deletion process. Depending on where customers are, GDPR/UK GDPR and CCPA/CPRA apply. (Flag, not a compliance certification.)
- **Evidence:** No privacy policy, terms, consent banner or data-subject-request handling in the repo or intake.
- **Fix:** Publish a privacy policy and terms matching what is actually collected; add consent where the audience requires it; define how to handle access/deletion requests for stored emails/addresses. Effort: M (mostly non-engineering)
- **Reference:** operations.md — Legal & privacy basics
- **Status:** Open
