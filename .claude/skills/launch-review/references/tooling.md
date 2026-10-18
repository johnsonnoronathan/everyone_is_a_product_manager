# Tools this review uses or can plug in

Picked so the whole kit can be used in **paid client work**: open-source engines with permissive licences plus rules we wrote ourselves. Check licences again if you redistribute any tool.

## Built in (run by `scripts/run-scanners.sh` when installed)

| Tool | Catches | Licence | Install |
|---|---|---|---|
| **Gitleaks** | Secrets in files and the full git history | MIT | `brew install gitleaks` · github.com/gitleaks/gitleaks/releases |
| **OSV-Scanner** (Google) | Known vulnerabilities in dependencies from lockfiles (npm, pnpm, yarn, pip, poetry, go, cargo, maven…) via osv.dev | Apache-2.0 | `brew install osv-scanner` · github.com/google/osv-scanner/releases |
| **Semgrep CE** engine + **our rules** (`semgrep/security.yml`, `../peak-traffic-test/semgrep/peak-traffic.yml`) | Risky code patterns: injection, unverified tokens, client-side prices, crash-on-bad-input, secrets in browser env vars, oversell patterns, N+1, missing timeouts | Engine LGPL-2.1; our rules MIT | `pipx install semgrep` / `brew install semgrep` |
| **Trivy** (optional) | Dockerfile, Terraform, Kubernetes misconfiguration | Apache-2.0 | `brew install trivy` |
| `check-data-access-rules.mjs` | Supabase tables without RLS, permissive policies; Firebase open/test-mode rules | ours | Node ≥ 18 |
| `check-headers.mjs` | HTTPS redirect, security headers, cookie flags, CORS reflection, exposed `.env`/`.git` on a live URL | ours | Node ≥ 18 |

**Semgrep registry rules** (`p/default`, `p/owasp-top-ten`…) are under the *Semgrep Rules License v1.0*: free for internal use, but charging for a scanning service that uses them requires a licence from Semgrep. They're therefore off by default (`SEMGREP_REGISTRY=1` turns them on). Use them freely on your own code.

## Recommended add-ons

| Tool | When | Notes |
|---|---|---|
| **OWASP ZAP baseline scan** (Apache-2.0) | You have a staging URL and permission | Passive scan, safe for staging: `docker run -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://staging.example.com`. Active scans attack the site; only with explicit permission, never production. |
| **Supabase Security Advisor** | App uses Supabase | Dashboard → Advisors. Checks the *live* database (RLS disabled, security-definer views, exposed auth tables), which the repo files may not reflect. |
| **Claude Code `/security-review`** | Reviewing a diff/branch | Built-in command; good for re-checking fixes. Anthropic also publishes a GitHub Action (`anthropics/claude-code-security-review`) for PR-time review. |
| **Trail of Bits skills** (`/plugin marketplace add trailofbits/skills`) | Deeper audits, tier 3 | Professional security-audit skills: static-analysis (CodeQL/Semgrep), sharp-edges (dangerous APIs), differential-review, variant-analysis. Their Semgrep rules are AGPL-3.0. |
| **Lighthouse** (Apache-2.0) | Front-end performance & accessibility snapshot | `npx lighthouse <url> --view`. |
| **k6** (AGPL-3.0, used as a tool) | Load testing | Driven by the `peak-traffic-test` skill. |
| **Playwright** (Apache-2.0) + **axe-core** (MPL-2.0) | Acceptance tests & accessibility | Driven by the `acceptance-test` skill. |
| **Independent penetration test** | Tier 3, or before large launches | Human testers find chained and business-logic issues that tools miss. This review prepares for it; it doesn't replace it. |

## Related community skills (ideas we borrowed from; check before installing)
- `production-audit` (affaan-m/ecc): evidence-only triage from local files.
- `prod-readiness` (acedergren/agentic-tools): parallel specialist agents → ship / don't-ship.
- `production-readiness` (nik-kale/sre-skills): Ready / Conditional / Not Ready verdict.
