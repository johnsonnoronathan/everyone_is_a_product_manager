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

Findings are leads, not verdicts: every one must be confirmed by reading the code before it goes in the report.
Not covered by these tools (needs the manual review): broken access control between users, business-logic flaws,
architecture, concurrency, operations. See references/security.md and references/architecture.md.
