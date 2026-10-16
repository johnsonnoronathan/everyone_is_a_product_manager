# Launch review: Holiday Flash Sale (sneaker drop)

**Verdict: NO-GO.** The app has multiple critical, exploitable defects - anyone can read every customer's address, buy for one cent, forge a login, wipe the database, or crash the whole site with one request - and under launch-night load it oversells and double-charges. It must not go live in this state.

*Reviewed commit `d572634` on 2026-10-16 - risk tier 3 (High) - reviewer: Claude Code (launch-review skill). App under review: `demo/flash-sale/naive/server.mjs` + `demo/flash-sale/shared/public/`.*

## Before launch (blockers and conditions)

Every item below is a blocker: at tier 3, open Criticals and Highs all block. Fix in roughly this order.

1. **Rotate the leaked payment key now and move it to an environment variable** -> SEC-06. (A live-prefixed key is committed in source and git history; treat it as compromised today.)
2. **Lock down the admin endpoints** (`/api/admin/reset`, `/api/admin/stats`) behind a server-side admin check, and remove the destructive reset from production -> SEC-03.
3. **Stop trusting the browser's price**: charge the server-side product price, never the amount the client sends -> SEC-05 (also acceptance AC-03 FAIL).
4. **Make login real and tokens signed/verified** so people can't act as other customers -> SEC-02.
5. **Scope order reads to the signed-in customer** so addresses stop leaking -> SEC-04 (also acceptance AC-06 FAIL).
6. **Parameterise every SQL query** to close the injection in search and seed/reset -> SEC-01.
7. **Stop the server crashing on bad input** (guard JSON parsing and the URL parse; add process-level handlers) -> SEC-07.
8. **Fix oversell and double-charge**: atomic stock update, one-order-per-customer constraint, idempotency key to the payment provider -> PERF-01, PERF-02 (also acceptance AC-04 FAIL and oversell test).
9. **Add a timeout and clean failure to the payment call**, and make checkout fail closed and release stock -> PERF-03, ARC-01 (also acceptance AC-08 FAIL).
10. **Fix the load collapse**: cut the product page's 14 DB round trips, cache hot reads, right-size the connection pool with fast-fail -> PERF-04, PERF-05, PERF-07.
11. **Stop deleting all orders on startup**, and add backups + a tested restore -> ARC-02, OPS-02.
12. **Add rate limiting / bot protection** and the operational safety nets for a drop (waiting room, kill switch, monitoring, on-call) -> SEC-08, OPS-01, OPS-03.

For a tier-3 launch we also recommend an independent human penetration test before or soon after go-live.

## Summary

| Area | Critical | High | Medium | Low | Notes |
|---|---|---|---|---|---|
| Security | 7 | 1 | 3 | 0 | SQLi, fake auth, open admin, IDOR, client price, leaked key, crash-on-input |
| Architecture & data | 1 | 1 | 3 | 1 | orders wiped on restart; non-transactional checkout; no DB constraints |
| Performance & scale | 2 | 2 | 3 | 0 | oversold 1,962/100; breaks at 50% of peak - see `peak-traffic/REPORT.md` |
| Operations | 0 | 2 | 3 | 1 | no monitoring, no backups, no kill switch |
| **Total** | **10** | **6** | **12** | **2** | 30 findings |

In plain language: this is a quick AI-assisted build that works when one person clicks through it but fails almost every production test. The single biggest risk is a data breach - customer emails and home addresses are readable by anyone with no login (confirmed live and by the acceptance test) - closely followed by losing money (buy-for-a-penny, double charges) and a guaranteed bad launch night (oversells its 100-pair stock nearly 20x over and slows to a crawl at half the expected traffic). What's good: money is handled in integer cents, the frontend renders user content safely as text (no obvious XSS), the page is accessible and works on a phone (acceptance AC-09, AC-10 pass), and the "sold out" state is clear (AC-05). None of that offsets the blockers.

## What we checked (coverage)

| Check | How | Result |
|---|---|---|
| Secrets in code and git history | Gitleaks 8.28.0 (files + full history) | 1 found: hard-coded payment key (SEC-06), in current file and commit `2f9131a` |
| Vulnerable dependencies | OSV-Scanner 2.2.3 | No lockfile found; app has no npm dependencies. Not a vuln, but not reproducible (ARC-06) |
| Risky code patterns | Semgrep 1.181.0 (own security + peak-traffic rules) + manual triage | 20 hits, all triaged; led to SEC-01/05/07/09/11 and PERF-01/03/05/06; 0 false positives |
| Database access rules | check-data-access-rules.mjs | No Supabase/Firebase rules files (app uses direct SQL); n/a |
| Access control on every entry point | Manual review of 9 routes (system map) + live curl | Multiple broken: SEC-02/03/04, CORS SEC-11 |
| Business logic (prices, limits, workflow) | Manual review + live repro | Broken: SEC-05, PERF-01/02, ARC-05 |
| Live headers / exposure | check-headers.mjs on `/` and `/api/products/1` (local instance) | Missing CSP/nosniff/frame/referrer (SEC-10); CORS `*` (SEC-11); `.env`/`.git` not exposed |
| Load and oversell | peak-traffic-test (k6, results pre-supplied) | FAIL: breaks at 50% of peak; oversold 1,962/100; 963 double-charged |
| User acceptance | acceptance-test (Playwright, results pre-supplied) | 5 pass, 4 fail (AC-03, AC-04, AC-06 Must; AC-08 Should), AC-07 external (oversell) |
| Operations readiness | Intake + code review | No monitoring, backups, kill switch, on-call, email auth (OPS-01..06) - asked |

**Not checked / limitations:** production/cloud configuration, the load balancer and TLS termination, the hosted Postgres settings, the payment provider's own security and real rate limits, and email deliverability were not inspected (no access; local instance only). k6 and Playwright were not re-run in this engagement; their existing results were reviewed and folded in. The connection-pool collapse (PERF-04) was confirmed from the load-test summary, not reproduced locally, because the simulated DB runs in-process. Automated and AI-assisted review reduces risk; it does not prove the absence of vulnerabilities. For a tier-3 launch, commission an independent penetration test.

## Findings

Full detail, evidence and fixes are in `findings/security.md`, `findings/architecture.md`, `findings/performance.md`, `findings/operations.md`. All are **Status: Open**. Summary list:

### Critical
- **SEC-01 - SQL injection (search + seed/reset)** - anonymous data theft and DB tampering. Confirmed (dumped orders via `/api/search`). `findings/security.md`
- **SEC-02 - Forgeable, self-issued login tokens** - act as any customer. Confirmed (hand-made token read a victim's orders). `findings/security.md`
- **SEC-03 - Open admin endpoints** - anyone can wipe orders / set stock / read sales. Confirmed. `findings/security.md`
- **SEC-04 - IDOR: any order readable by id, unauthenticated** - emails + addresses leak. Confirmed live and by acceptance AC-06. `findings/security.md`
- **SEC-05 - Price taken from the browser** - buy for 1 cent or a negative amount. Confirmed live and by acceptance AC-03. `findings/security.md`
- **SEC-06 - Live payment key hard-coded in source + git history** - escalated, rotate now. Confirmed (Gitleaks). `findings/security.md`
- **SEC-07 - One malformed request crashes the whole process** - trivial outage. Confirmed (bad JSON and bad Host header each killed it). `findings/security.md`
- **PERF-01 - Oversell (stock check-then-act)** - 1,962 confirmed for 100. Confirmed (local race + oversell test). `findings/performance.md`
- **PERF-02 - No one-per-customer limit / no idempotency** - double orders and double charges (963 buyers). Confirmed (double-click repro + AC-04). `findings/performance.md`
- **ARC-02 - All orders deleted on every startup; `CREATE TABLE` not idempotent** - data loss / second instance crashes. Confirmed. `findings/architecture.md`

### High
- **SEC-08 - No rate limiting or bot protection on login/buy** - scalper and abuse risk. Confirmed. `findings/security.md`
- **ARC-01 - Checkout isn't transactional** - customers charged with no order on partial failure. Confirmed (code path). `findings/architecture.md`
- **PERF-03 - No timeout on the payment call** - one hung charge stalls a request 30 s. Confirmed (30.0 s repro) + AC-08. `findings/performance.md`
- **PERF-04 - Connection-pool exhaustion, no fail-fast** - site hangs under load. Likely (confirmed by load summary). `findings/performance.md`
- **OPS-01 - No error tracking, monitoring, dashboards or alerting.** Asked. `findings/operations.md`
- **OPS-02 - No backups/restore; orders wiped on restart.** Asked/verified. `findings/operations.md`

### Medium
- **SEC-09 - Stack traces returned to the client.** Confirmed. `findings/security.md`
- **SEC-10 - Missing security headers (CSP/nosniff/frame/referrer).** Confirmed. `findings/security.md`
- **SEC-11 - CORS `*` on personal-data endpoints.** Confirmed. `findings/security.md`
- **ARC-03 - No database constraints (unique/one-per-customer/`CHECK stock>=0`).** Confirmed. `findings/architecture.md`
- **ARC-04 - Config/secrets in code, no env separation.** Confirmed. `findings/architecture.md`
- **ARC-05 - Advertised "midnight" start not enforced server-side.** Confirmed. `findings/architecture.md`
- **PERF-05 - N+1 queries on the product page (14 DB trips).** Confirmed. `findings/performance.md`
- **PERF-06 - Confirmation email sent inside the checkout request.** Confirmed. `findings/performance.md`
- **PERF-07 - No caching on hot reads; static files read from disk; no CDN.** Confirmed. `findings/performance.md`
- **OPS-03 - No safe kill switch / graceful degradation.** Verified. `findings/operations.md`
- **OPS-04 - PII and stack traces in logs; no request id/retention.** Verified. `findings/operations.md`
- **OPS-05 - Launch email not verified (SPF/DKIM/DMARC).** Asked. `findings/operations.md`

### Low / Info
- **ARC-06 - No tests/CI/lockfile on critical paths.** Confirmed. `findings/architecture.md`
- **OPS-06 - Privacy/legal basics not evidenced (GDPR/CCPA flag).** Asked. `findings/operations.md`

## System map

See `01-system-map.md` for the full Mermaid diagram and the 9-route entry-point table. In short: a single Node process serves the frontend and a hand-written API; the hot entry points are `GET /api/products/:id`, `POST /api/buy` (which charges the card and writes stock + order), the order-read endpoints, and two unauthenticated `/api/admin/*` routes. Trust boundary: everything the browser sends - price, token, ids - is attacker-controlled.

## Appendix

**Tool versions and commands.** Gitleaks 8.28.0, OSV-Scanner 2.2.3, Semgrep 1.181.0, Node 22.22.0. Scans: `bash .claude/skills/launch-review/scripts/run-scanners.sh demo/flash-sale/naive <scans>` (see `scans/coverage.md`). Live header checks: `node .claude/skills/launch-review/scripts/check-headers.mjs http://127.0.0.1:3000/ scans/headers.json` (and `.../api/products/1 scans/headers-api.json`). Reproductions: curl against a local instance (`PORT=3000 PAYMENT_PORT=4100 node demo/flash-sale/run.mjs naive`), stopped after use.

**Scanner hits dismissed as false positives:** none. All 20 Semgrep hits and the 1 Gitleaks hit were confirmed by reading the code and map to findings above. The three `admin-route-inventory` / extra `fetch-without-timeout` / `sync-io-in-request-handler` hits are real and folded into SEC-03, PERF-03 and PERF-07 respectively.

**Glossary.** *IDOR*: changing an id in a URL to read someone else's record. *Idempotency*: a repeated request has the same effect as one request (no double charge). *p95*: 95% of requests were faster than this. *Oversell*: confirming more orders than there is stock. *CORS*: the rule that controls which other websites may read this API's responses in a browser. *RLS*: database row-level security (not used here; the app talks to the DB directly).
