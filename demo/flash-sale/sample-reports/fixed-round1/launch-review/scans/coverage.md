# Automated scan coverage

- Project: `/home/user/everyone_is_a_product_manager/demo/flash-sale/fixed`
- Commit: `d572634`
- Date (UTC): 2026-10-16T12:35Z

| Check | Tool | Status | Findings | Output |
|---|---|---|---|---|
| Secrets in git history (incl. deleted files) | gitleaks 8.28.0 | ran | 1 | gitleaks-history.json |
| Secrets in current files | gitleaks 8.28.0 | ran | 0 | gitleaks-files.json |
| Known-vulnerable dependencies | osv-scanner | no lockfiles found (add a lockfile to make builds reproducible) | – | – |
| Risky code patterns | semgrep 1.181.0: own rules (security + peak-traffic) | ran | 2 | semgrep.json |
| Dockerfile / IaC misconfiguration | trivy | not installed (optional; only matters with Docker/Terraform/K8s files) | – | – |
| Supabase RLS / Firebase security rules | check-data-access-rules.mjs | ran | 0 (no rule files found) | data-access-rules.md |
| Secrets in shared front end + simulated infra (added manually) | gitleaks 8.28.0 `dir demo/flash-sale/shared` | ran | 0 | gitleaks-shared-files.json |
| Risky code patterns in front end (added manually) | semgrep 1.181.0 own rules on `demo/flash-sale/shared/public` | ran | 3 (browser fetch without timeout: dismissed) | semgrep-shared-public.json |
| Live headers / exposure (added manually) | check-headers.mjs on local instance `http://127.0.0.1:3100/` | ran | 0 fails (HSTS/HTTPS not checkable on local HTTP) | headers.json |

Triage: the gitleaks history hit is at `demo/flash-sale/naive/server.mjs:10` (commit `2f9131a`), which is outside this review's scope (deliberately broken demo variant). Semgrep `admin-route-inventory` hits at `fixed/server.mjs:303` and `:314` were triaged: auth is present; the reset route itself became SEC-02.

Findings are leads, not verdicts: every one must be confirmed by reading the code before it goes in the report.
Not covered by these tools (needs the manual review): broken access control between users, business-logic flaws,
architecture, concurrency, operations. See references/security.md and references/architecture.md.
