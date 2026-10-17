# Automated scan coverage

- Project: `/home/user/everyone_is_a_product_manager/demo/flash-sale/fixed`
- Commit: `fe1e4e7` (HEAD; app code identical to `fa296a2`, the commit under review)
- Date (UTC): 2026-10-17T20:56Z

| Check | Tool | Status | Findings | Output |
|---|---|---|---|---|
| Secrets in git history (incl. deleted files) | gitleaks 8.28.0 | ran | 1 | gitleaks-history.json |
| Secrets in current files | gitleaks 8.28.0 | ran | 0 | gitleaks-files.json |
| Known-vulnerable dependencies | osv-scanner | no lockfiles found (add a lockfile to make builds reproducible) | – | – |
| Risky code patterns | semgrep 1.181.0: own rules (security + peak-traffic) | ran | 5 | semgrep.json |
| Dockerfile / IaC misconfiguration | trivy | not installed (optional; only matters with Docker/Terraform/K8s files) | – | – |
| Supabase RLS / Firebase security rules | check-data-access-rules.mjs | ran | 0 (no rule files found) | data-access-rules.md |
| Secrets in shared front end + simulated infra (added manually) | gitleaks 8.28.0 `dir demo/flash-sale/shared` | ran | 0 | gitleaks-shared-files.json |
| Risky code patterns in front end (added manually) | semgrep 1.181.0 own rules on `demo/flash-sale/shared/public` | ran | 0 | semgrep-shared-public.json |
| Live headers / exposure (added manually) | check-headers.mjs on local instance `http://127.0.0.1:3100/` | ran | 0 fails (HSTS/HTTPS not checkable on local HTTP) | headers.json |

Findings are leads, not verdicts: every one must be confirmed by reading the code before it goes in the report.
Not covered by these tools (needs the manual review): broken access control between users, business-logic flaws,
architecture, concurrency, operations. See references/security.md and references/architecture.md.

## Triage (every hit read in the code)

| Tool | Hit | Location | Verdict |
|---|---|---|---|
| gitleaks (history) | `generic-api-key` | `demo/flash-sale/naive/server.mjs:10`, commit `2f9131a` | Outside scope (deliberately broken demo variant); not opened. |
| semgrep | `db-query-in-loop-js` | `fixed/server.mjs:95` | False positive: `(await db.all('SELECT version …')).map(…)` is one query, then a map over its rows. |
| semgrep | `db-query-in-loop-js` | `fixed/server.mjs:249` | False positive: `(await db.all('SELECT id FROM products')).map(…)`, one query every 30 s. |
| semgrep | `admin-route-inventory` | `fixed/server.mjs:532` (`POST /api/admin/sale`) | Auth present (`requireAdmin`, timing-safe, 404 on mismatch). Shared token and lenient date parsing → SEC-06, ARC-11. |
| semgrep | `admin-route-inventory` | `fixed/server.mjs:550` (`GET /api/admin/stats`) | Auth present, read-only counts; provider call only with test routes (OPS-07 fixed). |
| semgrep | `admin-route-inventory` | `fixed/server.mjs:573` (`POST /api/admin/reset`) | Registered only when `ENABLE_TEST_ROUTES=1`, which production refuses (SEC-02 fixed, verified). |
| osv-scanner | – | – | No lockfile and no npm dependencies (Node built-ins only). |
| check-data-access-rules | – | – | No Supabase/Firebase; the database is reached only from the server with parameterised SQL. |

Round 1's three `fetch-without-timeout` hits in `shared/public/app.js` are gone: every browser call now goes through `api()` with `AbortSignal.timeout(15_000)` (`app.js:11`).
Loops that make database calls without the rule noticing (`reconcile()` `server.mjs:374-379`, `sendQueuedEmails()` `:396-400`) are background jobs bounded at 50 and 20 items; reviewed manually (ARC-10, ARC-13).
