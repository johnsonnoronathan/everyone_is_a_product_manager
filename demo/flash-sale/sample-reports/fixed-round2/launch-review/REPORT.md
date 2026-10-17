# Launch review (round 2): Flash-sale shop (limited-edition sneaker drop)

**Verdict: NO-GO.** One High is open at risk tier 3: the opening time can silently be wrong (ARC-11). Separately, the production card-payment and sign-in integrations are still not in the code, so the real payment flow has never been tested. Round 1's crash, double charges, stuck orders, missing addresses, early opening and start-up data wipe are all fixed and verified. Fixing ARC-11 (small) and closing the conditions below would allow GO WITH CONDITIONS.

*Reviewed commit `fa296a2` on 2026-10-17. HEAD was `fe1e4e7`, which changes only the README and repository files, not the app. Risk tier 3. Reviewer: Claude Code (launch-review skill) for the product owner. Re-review of round 1 (`d572634`: NO-GO, 23 findings).*

## Before launch (blockers and conditions)
1. **Blocker:** make the opening time impossible to set wrong. Keep one source of truth for `SALE_STARTS_AT`, accept only full ISO times with a time-zone offset, and log and show the time actually in force → ARC-11 (S)
2. **Blocker:** hand over the production sign-in (magic link) and card-payment integrations for review, and make one real small purchase and refund in production → Limitations
3. Make an unresolvable payment fail safely. Look the payment up instead of re-sending it. Give "confirming" a deadline, then release the pair and tell the customer. Alert at once. Require `PAYMENT_URL` in production → ARC-10
4. Build the operator tools the runbook relies on (load stock, resolve a stuck order, export addresses, compare charges with orders) and correct the rollback instructions → OPS-08, OPS-09
5. Show database backups with a tested restore, error tracking with alerts reaching a named on-call person, and the on-call rota → OPS-04 (mandatory at tier 3)
6. Deploy with `NODE_ENV=production` through a real production start command → SEC-04
7. Small fixes before the rush. Cap the countdown timer. Rate-limit signed-in reads, and let the product cache serve its last good copy when the database is slow. Keep the session across tabs. Hide the sign-in form after sign-in → PERF-04, PERF-03, PERF-05, OPS-03, ARC-15
8. Normalise every token's email and use a firmer address key. Put a waiting room or bot protection in front of the drop unconditionally. Give admins personal identities → SEC-03, SEC-06
9. Send real confirmation emails from the outbox, with retries per row → ARC-07, ARC-13
10. Conditions for the night: one app instance only (ARC-06); load-balancer idle timeout below 65 s (PERF-02); re-test on production-like infrastructure with k6 on a separate machine (`peak-traffic/REPORT.md`)
11. Tier 3: book an independent penetration test before or soon after launch.
12. Give every open Medium and Low an owner and a date (SEC-03, SEC-04, SEC-06, ARC-06, ARC-07, ARC-10, ARC-12 to ARC-15, PERF-03 to PERF-05, OPS-01, OPS-03, OPS-04, OPS-08 to OPS-10).

## Summary

| Area | Critical | High | Medium | Low | Notes |
|---|---|---|---|---|---|
| Security | 0 | 0 | 3 | 0 | SEC-01, SEC-02, SEC-05 fixed and verified |
| Architecture & data | 0 | 1 | 3 | 4 | ARC-01 to ARC-05, ARC-08, ARC-09 fixed and verified |
| Performance & scale | 0 | 0 | 2 | 1 | [Peak-traffic report](peak-traffic/REPORT.md): expected peak passes in every run; 200% in 2 of 3 runs; never oversold |
| Operations | 0 | 0 | 4 | 2 | Not verified with the team (no interview) |

The team fixed what round 1 asked for, and the fixes hold up when tested. One bad web address no longer crashes the shop. A slow payment no longer charges anyone twice: in our test, every shopper was charged exactly once, even those who pressed Buy again. A shopper who paid while the database was busy still got their order. Every order now has an address. The sale can't open early or be wiped by a restart, and there is a pause switch. What's left is mostly about running the night safely. The opening time is easy to set wrong without anyone noticing. A payment problem that never resolves locks pairs as "confirming". The runbook relies on tools and a rollback that don't exist or don't work. The real sign-in and card payment still have to be shown.

## Round 1 → Round 2

| ID | Round-1 severity | Round-2 status | How it was checked |
|---|---|---|---|
| SEC-01 | Critical | Fixed: verified | 7 malformed paths → 400; server still answers |
| SEC-02 | High | Fixed: verified | Production refuses test routes; reset → 404 in production mode |
| SEC-03 | Medium | Partially fixed | IdP-format token for `dana+2@` and an address spelled "St." each bought another pair |
| SEC-04 | Medium | Condition | Guards verified with `NODE_ENV=production`; without it the demo configuration starts |
| SEC-05 | Low | Fixed: verified | `null`/array/scalar bodies → 400 |
| ARC-01 | High | Fixed: verified | Provider at ~3 s: 40/40 and 60/60 charges vs paid orders; retries → 409; AC-08 passes |
| ARC-02 | High | Fixed: verified | Busy database: payer gets 200 (3 of 3 runs); SIGKILL mid-payment settled after restart |
| ARC-03 | High | Fixed: verified | No address → 400, nothing reserved; AC-11 passes |
| ARC-04 | High | Fixed: verified | Before opening → 403; required in production; AC-12 passes (new weakness: ARC-11) |
| ARC-05 | High | Fixed: verified | Restart with a persistent database keeps orders and stock |
| ARC-06 | Medium | Condition / accepted risk | Sold-out hint fixed; rate limits per server; runbook says one instance |
| ARC-07 | Medium | Partially fixed | Durable outbox; sending still simulated |
| ARC-08 | Medium | Fixed: verified | Real `app.js` with a stub page: 503 → retry; 401 → sign in again |
| ARC-09 | Low | Fixed: verified | Returned pair resold at once; oversell test 100 of 100 sold |
| PERF-01 | Medium | Fixed: verified | Search removed; unknown ids → 404 without the database |
| PERF-02 | Medium | Fixed: verified | `Keep-Alive: timeout=65` (condition: LB idle < 65 s) |
| OPS-01 | Medium → Low | Partially fixed | Business events logged without personal data; no request log or admin identity |
| OPS-02 | Medium | Fixed: verified | Pause → 403, orders kept, resume → 200; AC-13 passes |
| OPS-03 | Medium | Partially fixed | Session kept in `sessionStorage`: a new tab is signed out |
| OPS-04 | Medium | Partially fixed | Runbook exists; safety nets unverified |
| OPS-05 | Low | Fixed: verified | `/healthz` `{ok}`, `/readyz` checks the database |
| OPS-06 | Low | Fixed: verified | HTML `no-cache`, hashed assets immutable |
| OPS-07 | Low | Fixed: verified | Stats from the database; provider called only in test mode |

## What we checked (coverage)

| Check | How | Result |
|---|---|---|
| Secrets in code and git history | Gitleaks 8.28.0 (history, current files, plus `shared/`) | 0 in scope (1 history hit in `naive/`, out of scope) |
| Vulnerable dependencies | OSV-Scanner 2.2.3 | Nothing to scan: no lockfile, Node built-ins only |
| Risky code patterns | Semgrep 1.181.0, own rules (security + peak-traffic) + manual triage | 5 leads in `fixed/`: 2 false positives, 3 admin routes triaged; 0 in `shared/public` |
| Database access rules | check-data-access-rules + manual review | n/a: no Supabase/Firebase; parameterised SQL from the server only |
| Access control on every entry point | Manual review of 12 HTTP routes, start-up, 3 background jobs (system map) + local requests | Order privacy, admin auth, production gating verified; SEC-06 |
| Business logic (prices, limits, workflow) | Manual review + 9 local reproduction scripts (`verification/`) | Price verified; ARC-01 to ARC-05 fixed; SEC-03, ARC-10, ARC-11, ARC-12 |
| Crash and malformed input | Local requests | SEC-01, SEC-05 fixed |
| Restarts, crash mid-payment, rollback | Persistent database (`DB_FILE`), SIGKILL, replay of the previous release's start-up | ARC-02, ARC-05 fixed; ARC-11, OPS-09 |
| Front end | Code review + the real `app.js` in Node with a stub page + acceptance screenshots | ARC-08 fixed; PERF-04, ARC-14, ARC-15, OPS-03 |
| Live headers / exposure | check-headers on the local instance `http://127.0.0.1:3100/` | All pass; HSTS/TLS not checkable on local HTTP |
| Load and oversell | peak-traffic-test (existing k6 runs: 3 round-2 runs + 1 same-day round-1 baseline; oversell) | Expected peak passes in every run; 200% in 2 of 3; never oversold |
| User acceptance | acceptance-test (existing Playwright 1.56.1 run, 36 runs, criteria v1.1) | 12 of 12 pass + AC-07 external; ARC-15 found by test |
| Operations readiness | Code, runbook and repo review; no interview, no dashboards | Not verified (OPS-04) |

**Not checked / limitations:**
- **Production sign-in.** Not in the repo. The page's sign-in form posts to the test stub, which is a 404 in production. The provider's token format, email normalisation, redirect allow-list, session lifetime and admin MFA were not checked.
- **Production card payments.** Not in the repo. The charge request carries only an amount and an email: no card collection, 3-D Secure, declines, refunds, lookup API or webhook. This is a core flow and it blocks launch until reviewed and a real purchase and refund are done.
- **Production database and infrastructure.** Postgres pooler, migration locking, backups; the load balancer (TLS, HSTS, `//` handling, idle timeout); CDN/WAF; whether `NODE_ENV=production` is set.
- **Test environment.** Everything ran on one local machine against simulators, with k6 sharing the CPU. Production capacity was not measured. Two app instances were not run.
- **Provider behaviour.** The real-provider part of ARC-10 (results replayed for a key, keys expiring) comes from provider documentation and is Likely, not reproduced.
- **Browser.** PERF-04 was reproduced in Node; browsers overflow the same way per MDN. This review did not run Playwright.
- **Other areas.** Real email sending; privacy policy, consent and data deletion (GDPR/CCPA); PCI DSS scope; accessibility beyond AC-09.
- **Method.** Automated and AI-assisted review reduces risk; it does not prove the absence of vulnerabilities. For tier 3 an independent penetration test is recommended.

## Findings

Full entries for every finding (round-1 re-checks and new ones) are in `findings/security.md`, `findings/architecture.md`, `findings/performance.md` and `findings/operations.md`. The High is repeated in full here.

### High

### ARC-11 · High · Confirmed: The opening time can silently be wrong: changing `SALE_STARTS_AT` after the first start does nothing (while the log says it did), and dates without a time zone are accepted
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:111-114` (`INSERT OR IGNORE` copies `SALE_STARTS_AT` into the database only on the very first start), `:646` (`server_started` logs the environment value, not the one in force), `:24-25` and `:537-539` (`new Date()` / `Date.parse()` accept a date with no time or zone, and any text JavaScript can read as a date); `demo/flash-sale/fixed/RUNBOOK.md:6`
- **Impact:** Production won't start without `SALE_STARTS_AT`, so the first deploy has to carry some date, and that first date is the one that counts from then on. Here is how that bites. The team deploys early with a test date in the past, to make the real test purchase in production. On the day before, they set the real midnight date, as the runbook says, and redeploy. The server logs the new date but keeps the old one, so the sale stays open all evening and bots buy the pairs before the email goes out. If the date changes the other way, the sale stays shut at midnight while 3,000 people watch. Typing a date without a time zone also opens early: `2026-11-27` means midnight in London, which is 7 pm the evening before in New York. The admin endpoint accepted "Nov 27" as 27 November 2001 and opened the sale on the spot.
- **Evidence:** `verification/repro-restart.sh` with a persistent database. Boot 1: `SALE_STARTS_AT=2026-10-17T21:03:55.620Z`. Boot 2: `SALE_STARTS_AT=2026-10-19T21:04:59.494Z`; the log says `"saleStartsAt":"2026-10-19T21:04:59.494Z"`, but `GET /api/products/1` → `"startsAt":"2026-10-17T21:03:55.620Z","open":true`, and a buy → `200 paid`. `POST /api/admin/sale`: `"2026-11-27"` → stored `2026-11-27T00:00:00.000Z`; `"Nov 27"` → `2001-11-27…`, `open=true`; `"1"` → `2001-01-01…`, `open=true`; `12345` → `1970-01-01…`, `open=true`; `paused:"false"` → paused.
- **Fix:** One source of truth. Either the environment value wins at every start (update the row and log old → new), or the database wins and start-up refuses when the two differ. Accept only full ISO timestamps with an explicit offset, in both places. Accept `paused` only as a boolean. Log, and return from the admin endpoint, the time in force, both in UTC and in the sale's local zone. Add "open the page and read the opening time" to the T-1 checklist. Effort: S
- **Reference:** OWASP A06:2025 Insecure Design · CWE-20 Improper Input Validation

### Medium and Low (open)

| ID | Severity | Status | What it means | Full entry |
|---|---|---|---|---|
| ARC-10 | Medium · Confirmed | Open | A payment error that retrying can't fix locks pairs as "confirming" forever; first alert after 10 min | `findings/architecture.md` |
| SEC-03 | Medium · Confirmed | Partially fixed | One mailbox and one street address can still buy several pairs; no bot protection | `findings/security.md` |
| SEC-04 | Medium · Confirmed | Condition | Production safety depends on `NODE_ENV=production`, set nowhere in the repo | `findings/security.md` |
| SEC-06 | Medium · Confirmed | Open | A shared admin token opens or pauses the sale; the log can't say who | `findings/security.md` |
| ARC-06 | Medium · Confirmed | Condition / accepted risk | Rate limits per server: run one instance | `findings/architecture.md` |
| ARC-07 | Medium · Confirmed | Partially fixed | Confirmation emails are queued durably but never sent | `findings/architecture.md` |
| PERF-03 | Medium · Confirmed | Open | One signed-in script can tie up the database and block checkout | `findings/performance.md` |
| PERF-04 | Medium · Confirmed | Open | Page reloads non-stop if the opening is more than ~25 days away | `findings/performance.md` |
| OPS-03 | Medium · Confirmed | Partially fixed | Signing in early doesn't survive a new tab (`sessionStorage`) | `findings/operations.md` |
| OPS-04 | Medium · Likely | Partially fixed | Backups, error tracking, alerts, on-call: listed, not shown | `findings/operations.md` |
| OPS-08 | Medium · Confirmed | Open | Runbook relies on missing tools (stock loading, stuck orders, address export, charges check) | `findings/operations.md` |
| OPS-09 | Medium · Confirmed | Open | Rolling back to the previous release fails at start-up | `findings/operations.md` |
| OPS-01 | Low · Confirmed | Partially fixed | No per-request log or request ids; admin calls anonymous | `findings/operations.md` |
| ARC-12 | Low · Confirmed | Open | Address check drops non-Latin letters: different addresses collide | `findings/architecture.md` |
| ARC-13 | Low · Likely | Open | Outbox sender: head-of-line blocking; duplicates with two servers | `findings/architecture.md` |
| ARC-14 | Low · Confirmed | Open | Page points to an order history and an email that don't exist | `findings/architecture.md` |
| ARC-15 | Low · Confirmed (found by test) | Open | Sign-in form stays visible when signed in; stock count stale after buying | `findings/architecture.md` |
| PERF-05 | Low · Confirmed | Open | Product cache drops its last good copy when the database is slow | `findings/performance.md` |
| OPS-10 | Low · Confirmed | Open | Any `?v=` value cached for a year | `findings/operations.md` |

Fixed and verified on 2026-10-17 at commit `fa296a2`: SEC-01, SEC-02, SEC-05, ARC-01 to ARC-05, ARC-08, ARC-09, PERF-01, PERF-02, OPS-02, OPS-05, OPS-06, OPS-07 (details in the findings files).

## System map
See [`01-system-map.md`](01-system-map.md). It has the Mermaid diagram, all 18 entry points (12 HTTP routes, start-up, 3 background jobs, the outbound payment call and signal handlers), the data stores and the third parties. Not present: inbound payment webhook, provider lookup call, cron jobs, uploads, browser-to-database access, CORS, an order-history view, a production sign-in UI, admin tools for stock, stuck orders or address export.

## Appendix
- **Tools and versions:** Gitleaks 8.28.0 · OSV-Scanner 2.2.3 · Semgrep 1.181.0 (own rules only; registry rules off) · Trivy not installed (no Docker/IaC files) · Node v22.22.0 · existing evidence: k6 load and oversell summaries (k6 version not recorded), Playwright 1.56.1.
- **Commands run:**
  - `bash .claude/skills/launch-review/scripts/run-scanners.sh demo/flash-sale/fixed demo/flash-sale/sample-reports/fixed-round2/launch-review/scans`
  - Semgrep own rules on `demo/flash-sale/shared/public`; Gitleaks `dir demo/flash-sale/shared`
  - `node .claude/skills/launch-review/scripts/check-headers.mjs http://127.0.0.1:3100/ …/scans/headers.json`
  - Local instances: `PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed`, also with:
    - `PAYMENT_MIN_MS=2985 PAYMENT_MAX_MS=3015`
    - `DB_LATENCY_MS=300`
    - `DB_FILE=<scratch>` and `SALE_STARTS_AT=…`
    - `NODE_ENV=production`, with strong random secrets generated in the shell and never printed
  - ARC-10: the simulator and server started directly on 4200/3100 with `PAYMENT_URL=http://127.0.0.1:4200/v1`.
  - Scripts in `verification/`; set `ADMIN_TOKEN`, and `TOKEN_SECRET` for `verify-basics.mjs`.
- **Dismissed scanner hits:**
  - Gitleaks history `generic-api-key` at `demo/flash-sale/naive/server.mjs:10` (commit `2f9131a`): out of scope, not opened.
  - Semgrep `db-query-in-loop-js` at `fixed/server.mjs:95` and `:249`: one query followed by `.map` over its rows.
  - Semgrep `admin-route-inventory` at `:532` (auth present → SEC-06, ARC-11), `:550` (auth present, read-only), `:573` (test-only, refused in production → SEC-02 fixed).
  - OSV-Scanner: no lockfile, no dependencies.
- **Glossary:**
  - **Idempotency key:** a label sent with a payment so the provider charges only once, even if the request is repeated.
  - **Reconciler:** a background job that settles orders whose payment outcome is unknown.
  - **Outbox:** a database table of emails waiting to be sent, so none are lost on a restart.
  - **Connection pool:** the fixed set of database connections the app shares (10 here).
  - **202 / 503:** "accepted, still working on it" / "service busy".
  - **Magic link:** sign-in by clicking a link sent by email.
  - **Load balancer:** the front door that passes requests to the app server.
  - **Keep-alive:** reusing one network connection for several requests.
  - **Migration:** a versioned change to the database structure.
  - **Rollback:** going back to the previous release.
  - **Waiting room:** a queue page that lets shoppers into checkout a few at a time.
