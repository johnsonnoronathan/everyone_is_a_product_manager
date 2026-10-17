# Launch review: Flash-sale shop (limited-edition sneaker drop)

**Verdict: NO-GO**: anyone can crash the shop with one request (Critical), and at risk tier 3 six High findings are still open. Customers can be charged without an order or twice, orders carry no shipping address, the sale opens the moment it's deployed, one admin call wipes every order, and start-up wipes the database. The production sign-in and card-payment integrations aren't in the code reviewed either.

*Reviewed commit `d572634` (branch `claude/eager-faraday-yz1w6f`) on 2026-10-16 · risk tier 3 · reviewer: Claude Code (launch-review skill) for the product owner*

## Before launch (blockers and conditions)
1. Stop malformed addresses crashing the server: parse the URL inside the error handler, add an unhandled-rejection handler, run under a restart supervisor → SEC-01
2. Treat a payment timeout as "unknown": keep the pair reserved, reuse one idempotency key per reservation, reconcile provider charges against orders and alert on mismatches → ARC-01
3. Never abandon the "mark paid" / "release" writes after a charge, and add a sweeper that settles stuck "pending" orders → ARC-02
4. Collect and require a shipping address before a pair is reserved → ARC-03
5. Add a server-side sale start time, and use the same switch as a pause button → ARC-04, OPS-02
6. Remove the reset endpoint from production; give admins personal, logged access → SEC-02
7. Show the production start-up: versioned migrations, and no seed or `DELETE` at boot → ARC-05
8. Hand over the production sign-in (magic link) and card-payment integration for review, and make one real small purchase and refund in production → see Limitations
9. Show database backups with a tested restore, error tracking with alerts to an on-call person, and a one-page runbook for the night → OPS-04
10. Tier 3: book an independent penetration test before or soon after launch.
11. Give every Medium an owner and a date (SEC-03, SEC-04, ARC-06–08, PERF-01, PERF-02, OPS-01–03). ARC-05 and ARC-06 must be closed before a second server is added.

## Summary

| Area | Critical | High | Medium | Low | Notes |
|---|---|---|---|---|---|
| Security | 1 | 1 | 2 | 1 | Order privacy, server-side price and token signing verified |
| Architecture & data | 0 | 5 | 3 | 1 | No oversell by design; the money paths break under stress |
| Performance & scale | 0 | 0 | 2 | 0 | [Peak-traffic report](peak-traffic/REPORT.md): passes to 200% (1,200 req/s), never oversold |
| Operations | 0 | 0 | 4 | 3 | Not verified with the team (no interview) |

The "fixed" version really does fix the classic flash-sale failures. In a 1,000-buyer rush it never sold more than 100 pairs. It charges the server's price, keeps each customer's orders private, and stayed fast at twice the expected midnight traffic. It is still not ready to launch. One malformed request crashes the only server. When the payment provider or the database is slow, which is most likely right at midnight, customers can be charged without getting an order, or charged twice. And as built, the sale would take orders without shipping addresses and open the moment it's deployed. Most fixes are small or medium effort. Afterwards, re-run the two reproductions and the load test through the real load balancer.

## What we checked (coverage)

| Check | How | Result |
|---|---|---|
| Secrets in code and git history | Gitleaks 8.28.0 (history + current files, plus `shared/`) | 0 in scope (1 history hit in `demo/flash-sale/naive/`, out of scope) |
| Vulnerable dependencies | OSV-Scanner 2.2.3 | Nothing to scan: no lockfile, and the app uses only Node built-ins |
| Risky code patterns | Semgrep 1.181.0 with own rules (17 security + 10 peak-traffic) + manual triage | 2 leads in `fixed/` (admin routes → SEC-02); 3 browser-fetch leads in `shared/public` dismissed |
| Database access rules | check-data-access-rules + manual review | n/a: no Supabase/Firebase; database reached only from the server with parameterised SQL |
| Access control on every entry point | Manual review of 11 HTTP routes, start-up and background jobs (system map) + curl on a local instance | Order privacy, admin auth and token signing verified; SEC-02, SEC-04 |
| Business logic (prices, limits, workflow) | Manual review + local reproductions | Price verified; ARC-01–05, SEC-03 |
| Crash and malformed input | Manual review + local reproduction | SEC-01, SEC-05 |
| Live headers / exposure | check-headers on the local instance `http://127.0.0.1:3100/` (no staging/production URL) | All pass; HSTS/TLS not checkable on local HTTP |
| Load and oversell | peak-traffic-test (existing k6 run, local) | Passes to 200% of target; never oversold; ARC-09 found by test |
| User acceptance | acceptance-test (existing Playwright 1.56.1 run, 27 runs) | 9/9 pass + AC-07 external; criteria don't cover address, start time or email |
| Operations readiness | Code and repo review; no interview, no dashboards | Not verified (OPS-04) |

**Not checked / limitations:**
- **Production sign-in.** The managed magic-link integration is not in the repo. The server verifies only its own `payload.HMAC` token format, while managed providers usually issue RS256 JWTs. Magic-link redirect allow-list, session lifetime and admin MFA were not checked.
- **Production card payments.** The page collects no card, and the charge call sends only an amount and an email. Card collection, 3-D Secure, declines, refunds, webhooks and live keys were not checked. This is a core flow and must be reviewed before launch.
- **Production database and infrastructure.** Start-up, migrations, pooler and backups; hosting and secret store; the load balancer (TLS, HSTS, path normalisation, idle timeout); CDN/WAF.
- **Test environment.** All tests ran on one local machine against simulators. The simulated database never slows down and the simulated provider never charges a call the app abandoned. Production capacity was not measured.
- **Other areas.** Real email sending; privacy policy, consent and data deletion (GDPR/CCPA); PCI DSS scope; accessibility beyond the automated check (AC-09).
- **Method.** Automated and AI-assisted review reduces risk; it does not prove the absence of vulnerabilities. For tier 3 an independent penetration test is recommended.

## Findings

All findings are **Open** (report-only engagement: no fixes were made). Full entries for every finding are in `findings/security.md`, `findings/architecture.md`, `findings/performance.md` and `findings/operations.md`. Critical and High are repeated in full here.

### Critical

### SEC-01 · Critical · Confirmed: One malformed web address crashes the whole shop
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:346` (`new URL(req.url, …)` runs before the `try` block that starts at line 353, inside an `async` request handler)
- **Impact:** Anyone can take the sale offline with a single request to `https://<shop>//`. No sign-in, no tools, one line. Bots and vulnerability scanners send addresses like this every day, so it can also happen by accident at midnight. Each crash drops every shopper who is mid-checkout, and with one server there is nothing to take over until it restarts. Payments in flight at that moment end up stuck (ARC-02), and if the production start-up keeps today's seed step, the restart wipes the orders (ARC-05).
- **Evidence:** `curl --path-as-is 'http://127.0.0.1:3100//'` → empty reply (curl exit 52); the next `curl /healthz` → connection refused. Server log: `TypeError: Invalid URL … at Server.<anonymous> (…/demo/flash-sale/fixed/server.mjs:346:15) code: 'ERR_INVALID_URL', input: '//'` → `process exited with code 1`. There is no `unhandledRejection` handler, and Node 22 exits on unhandled rejections. The same happens with `///`, `//[`, `//@`, `//:99999`. Confirm on staging that the real load balancer forwards `//` unchanged (most do).
- **Fix:** Parse the URL inside the `try` (or catch it and answer 400). Add `process.on('unhandledRejection')` / `uncaughtException` logging. Run under a restart supervisor, and make restarts harmless (ARC-05). Add a regression test: `GET //`, then `GET /healthz`. Effort: S
- **Reference:** OWASP A10:2025 Mishandling of Exceptional Conditions · CWE-248 Uncaught Exception

### High

### SEC-02 · High · Confirmed: A one-call "delete every order" admin endpoint ships to production
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:303-312` (`POST /api/admin/reset`), `:129-133` (one shared static header token); the load-test config in the repo calls it as its setup step: `demo/flash-sale/peak-brief.json:31-36, 43-47`
- **Impact:** Anyone holding the shared admin token (a staff member, a CI job, or a load test pointed at the wrong address) can, with one request, permanently delete every order (the emails and shipping addresses of customers who already paid) and put all 100 pairs back on sale. Nothing records who did it. It is also the only "pause" lever (OPS-02).
- **Evidence:** Local: Dana buys → `200 {"orderId":1,…}`; `my-orders` → 1 paid order; `POST /api/admin/reset` (`x-admin-token: demo…`) → `200 {"ok":true}`; `my-orders` → `[]`; stats → `paidOrders: 0, stockRemaining: 100`. `seed()` runs `DELETE FROM … orders` (line 54). A wrong or missing token gets 404 (good).
- **Fix:** Register test routes only behind an explicit `ENABLE_TEST_ROUTES=1` that refuses to start in production. Give admins personal identities with MFA through the identity provider, log every admin call, and keep load-test configs pointed at staging only. Effort: S
- **Reference:** OWASP A01:2025 Broken Access Control · CWE-749 Exposed Dangerous Method or Function

### ARC-01 · High · Confirmed: A slow payment is treated as a failed one: the customer can be charged, lose the pair, and be charged again on retry
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:179-192` (aborts after 3 s), `:264-277` (any error → `payment_failed`, pair released, 503 "Please try again"), `:265-266` (idempotency key `order-${orderId}` is new for every attempt), `:269-270` (comment relies on a reconciliation job that does not exist)
- **Impact:** When the payment provider takes longer than 3 seconds, the shop tells the customer "Payment did not go through. Please try again." and puts the pair back on sale, even though the provider may already have taken the money. The customer tries again, as told, and pays twice for one pair, or someone else gets the pair. Nobody notices until complaints and chargebacks arrive.
- **Evidence:** Simulated provider answering in 2.985–3.015 s; 40 shoppers buy once, then everyone told to "try again" does so (`repro/repro-slow-payment.mjs`): first round `{"503 Payment did not go through…":23,"200 ok":17}`, charges 18 vs paid orders 17. After retries: `paidOrders 39, charges 41, chargedCents 204959`, i.e. **41 payments for 39 pairs**. Earlier runs: 9 vs 7, 21 vs 20. `grep reconcil` → only the comment. The simulator charges only if it answers before noticing the hang-up; a real provider completes the charge regardless. The passing oversell test ("0 charged twice") can't show this for the same reason. Acceptance criterion AC-08 currently asserts the release behaviour and should be reworded.
- **Fix:** Treat a timeout as **unknown**: keep the order `pending` with the pair reserved, tell the shopper "confirming your payment", and settle it with the provider (lookup by key/metadata, or the signed webhook). Use one random idempotency key per reservation, reused on retry. Run a reconciliation job (charges vs paid orders) with alerts and automatic refund of orphan charges. Effort: M
- **Reference:** OWASP A06:2025 Insecure Design · CWE-754 Improper Check for Unusual or Exceptional Conditions

### ARC-02 · High · Confirmed: When the database is busy, a customer who has just paid is told "We are very busy" and the order is left stuck
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:41` (1 s pool acquire timeout on every query), `:279` (mark paid after the charge), `:271-274` (release after a failed charge), `:359` (`PoolTimeoutError` → 503 "We are very busy. Please try again."); nothing picks up stuck `pending` orders
- **Impact:** At the busiest moment a customer can be charged and then see "We are very busy". Their order stays "pending": not shown to them, no confirmation, not counted as sold, and trying again says "You already have an order". On the failure path, the pair can stay reserved forever. Orders in flight during a crash or restart end the same way.
- **Evidence:** Normal 10-connection pool with 300 ms queries (`DB_LATENCY_MS=300`), anonymous `/api/search` traffic during the payment (`repro/repro-busy-db.mjs paid`): `buy -> 503 {"error":"We are very busy. Please try again."}` · `my-orders -> []` · `retry buy -> 409 You already have an order` · stats `paidOrders 0, stockRemaining 99, charges 1, chargedCents 4999`. Reproduced in 1 of 2 runs (timing-dependent). The release path uses the same call; it held in 4 attempts and is confirmed by code trace.
- **Fix:** Fail fast only before the reservation. After that, retry the follow-up writes with a longer timeout (or use an outbox), and answer "order received" after a successful charge. Add a sweeper that settles `pending` orders older than ~30 s with the provider. Effort: M
- **Reference:** CWE-754 · architecture checklist "partial failure is compensated"

### ARC-03 · High · Confirmed: Orders are taken and charged without a shipping address
- **Status:** Open
- **Where:** `demo/flash-sale/shared/public/index.html:16-26` (only an email field), `demo/flash-sale/shared/public/app.js:56` (buy sends `{ productId, price }`), `demo/flash-sale/fixed/server.mjs:235, 252` (`String(address ?? '')` stored without a check)
- **Impact:** All 100 buyers will be charged without a delivery address. Nothing can ship until each buyer has been chased by email, which means refunds, chargebacks and unhappy customers after launch.
- **Evidence:** The browser body is exactly `{ productId: PRODUCT_ID, price: product.price_cents }`. Local `POST /api/buy {"productId":1,"price":1}` → `200 {"orderId":1,"amountCents":4999}`. Traced page → request → `INSERT … address = ''`. No acceptance criterion covers the address.
- **Fix:** Required address fields on the page, server-side validation, and a 400 before reserving if missing (or collect it via the payment provider and store it on the order). Effort: M
- **Reference:** OWASP A06:2025 Insecure Design

### ARC-04 · High · Confirmed: Nothing stops people buying before the sale opens at midnight
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:231-282` (no start-time check), `:53-62` (stock 100 at every start), `demo/flash-sale/shared/public/app.js:32`
- **Impact:** As soon as this version is live, anyone who finds the page or API can buy, hours before the email goes out; sneaker bots watch for this. The launch could open already sold out. Holding the sale closed today means the admin reset with stock 0, which deletes all orders and shows "Sold out".
- **Evidence:** Local at 12:47 UTC: `POST /api/buy` → `200 {"orderId":1,…}`. `grep -nEi 'startsAt|sale_start|opens' server.mjs` → nothing. "Sale starts at midnight" is only product text (`shared/seed-data.mjs:5`).
- **Fix:** A `sale_starts_at` (UTC, with the time zone of "midnight" written down) checked by the buy endpoint (403 "Sale opens at …"), a countdown on the page driven by the server clock, and the same switch to pause (OPS-02). Effort: S
- **Reference:** OWASP A06:2025 Insecure Design

### ARC-05 · High · Likely: Every server start deletes all orders and resets stock to 100
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:42-51` (schema created at start), `:53-62` (`seed()` deletes every table and inserts stock 100, called unconditionally at line 62); no migrations in the repo
- **Impact:** If production starts the same way, any restart during or after the sale (a crash such as SEC-01, a deploy, adding the second server) erases every order and address and puts 100 more pairs on sale: oversold, and no record of who paid. If the tables already exist, `CREATE TABLE` fails and the server can't start.
- **Evidence:** `db.exec('DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;')` then `await seed();` at module load. Also observed: with a slow database (2 connections, 300 ms) start-up itself crashed with `PoolTimeoutError` from the 25 parallel seed inserts. **Likely**, because the production database wiring isn't in the repo. Showing a production start-up that runs versioned migrations and never seeds would close this.
- **Fix:** Versioned migrations applied by a deploy step; no seeding in production; load stock with a one-off, audited admin script. Effort: M
- **Reference:** Twelve-Factor App XII (one-off admin processes) · architecture checklist "Migrations are versioned and repeatable"

### Medium and Low

| ID | Severity | Status | What it means | Full entry |
|---|---|---|---|---|
| SEC-03 | Medium · Confirmed | Open | "One per customer" is one per email: `alice+2@…` bought a second pair; nothing slows bots | `findings/security.md` |
| SEC-04 | Medium · Likely | Open | One wrong environment variable turns on test sign-in (anyone can be anyone); demo secrets aren't rejected | `findings/security.md` |
| ARC-06 | Medium · Confirmed | Open | "Sold out" flag and rate limits are per server, so a second server sees different stock and limits | `findings/architecture.md` |
| ARC-07 | Medium · Confirmed | Open | Confirmation emails are a stub; queued emails would be lost on restart | `findings/architecture.md` |
| ARC-08 | Medium · Confirmed | Open | The page sticks on "Loading…" when busy; an expired session can't sign in again | `findings/architecture.md` |
| PERF-01 | Medium · Confirmed | Open | Unused search and made-up product ids bypass the cache and can exhaust the database pool | `findings/performance.md` |
| PERF-02 | Medium · Likely | Open | Node's 5 s keep-alive vs a longer load-balancer idle timeout → random 502s at peak | `findings/performance.md` |
| OPS-01 | Medium · Confirmed | Open | No log of orders, admin actions or sign-ins (4 log lines in total) | `findings/operations.md` |
| OPS-02 | Medium · Confirmed | Open | No pause switch; the only lever wipes all orders | `findings/operations.md` |
| OPS-03 | Medium · Likely | Open | Magic-link sign-in at midnight delays shoppers; identity-provider email limits unknown | `findings/operations.md` |
| OPS-04 | Medium · Likely | Open | Backups/restore, error tracking, alerts, on-call, runbook not in evidence (tier 3 mandatory) | `findings/operations.md` |
| SEC-05 | Low · Confirmed | Open | A `null` request body gives a 500 instead of a 400 | `findings/security.md` |
| ARC-09 | Low · Confirmed (found by test) | Open | 4 of 100 pairs released after failed payments stayed unsold after "Sold out" | `findings/architecture.md` |
| OPS-05 | Low · Confirmed | Open | Public health check shows pool usage and checks nothing | `findings/operations.md` |
| OPS-06 | Low · Confirmed | Open | Page/JS cached 5 min under fixed names, so a hotfix arrives late | `findings/operations.md` |
| OPS-07 | Low · Likely | Open | Admin stats call a test-only provider endpoint and will fail in production | `findings/operations.md` |

## System map
See [`01-system-map.md`](01-system-map.md) for the Mermaid diagram, all 16 entry points (11 HTTP routes, start-up, two background jobs, the outbound payment call and signal handlers), the data stores and the third parties. Not present: inbound payment webhook, cron jobs, uploads, browser-to-database access, CORS.

## Appendix
- **Tools and versions:** Gitleaks 8.28.0 · OSV-Scanner 2.2.3 · Semgrep 1.181.0 (own rules only; registry rules off) · Trivy not installed (no Docker/IaC files) · Node v22.22.0 · existing evidence: k6 load/oversell summaries (k6 version not recorded), Playwright 1.56.1.
- **Commands run:**
  - `bash .claude/skills/launch-review/scripts/run-scanners.sh demo/flash-sale/fixed demo/flash-sale/sample-reports/fixed/launch-review/scans`
  - Extra Semgrep and Gitleaks runs on `demo/flash-sale/shared` (`scans/semgrep-shared-public.json`, `scans/gitleaks-shared-files.json`)
  - `node .claude/skills/launch-review/scripts/check-headers.mjs http://127.0.0.1:3100/ …/scans/headers.json`
  - Local instance `PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed`, also with `DB_LATENCY_MS=300` and with `PAYMENT_MIN_MS=2985 PAYMENT_MAX_MS=3015`
  - Reproduction scripts in `repro/` (set `ADMIN_TOKEN`)
- **Dismissed scanner hits:**
  - Gitleaks history `generic-api-key` at `demo/flash-sale/naive/server.mjs:10` (commit `2f9131a`): outside scope (broken demo variant), not opened.
  - Semgrep `admin-route-inventory` at `fixed/server.mjs:303` and `:314`: auth is present; the reset route itself is SEC-02, the stats route is read-only.
  - Semgrep `fetch-without-timeout` at `shared/public/app.js:10, 39, 53`: same-origin browser calls, not partner calls; their error handling is ARC-08.
  - OSV-Scanner: no lockfile, no dependencies.
- **Glossary:**
  - **IDOR:** reading someone else's record by changing an id.
  - **Idempotency key:** a label that makes the payment provider charge only once for repeated requests.
  - **Connection pool:** the fixed set of database connections the app shares (10 here).
  - **503:** "service busy" error.
  - **Magic link:** sign-in by clicking a link sent by email.
  - **Reconciliation:** comparing the provider's charges with the shop's orders.
  - **Load balancer:** the front door that passes requests to the app server.
  - **Keep-alive:** reusing one network connection for several requests.
