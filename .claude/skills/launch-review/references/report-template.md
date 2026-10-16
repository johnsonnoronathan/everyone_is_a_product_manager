# Launch-review report template

Copy to `launch-review/REPORT.md`. Replace *italic guidance*. The first screen must answer "can we launch, and what must happen first?" without scrolling.

---

# Launch review: [Product]

**Verdict: NO-GO / GO WITH CONDITIONS / GO**: *one sentence on why.*

*Reviewed commit `abc1234` on YYYY-MM-DD · risk tier N · reviewer: [name] with Claude Code (launch-review skill)*

## Before launch (blockers and conditions)
1. *Each Critical/High (or condition) as one action line, linking to its finding: "Rotate the payment key and move it to an environment variable → SEC-01".*
2. …

## Summary

| Area | Critical | High | Medium | Low | Notes |
|---|---|---|---|---|---|
| Security | | | | | |
| Architecture & data | | | | | |
| Performance & scale | | | | | *link peak-traffic report if run* |
| Operations | | | | | |

*2–4 sentences in plain language: the overall picture, the biggest risk, what's good.*

## What we checked (coverage)

| Check | How | Result |
|---|---|---|
| Secrets in code and git history | Gitleaks | *N found / none* |
| Vulnerable dependencies | OSV-Scanner | |
| Risky code patterns | Semgrep (own rules) + manual triage | |
| Database access rules | RLS/rules check + manual review | |
| Access control on every entry point | Manual review of N routes (system map) | |
| Business logic (prices, limits, workflow) | Manual review | |
| Live headers / exposure | check-headers on *URL* / *not run: no permission* | |
| Load and oversell | peak-traffic-test / *not run* | |
| User acceptance | acceptance-test / *not run* | |
| Operations readiness | Interview + dashboards | *asked / verified* |

**Not checked / limitations:** *e.g. infrastructure configuration in the cloud console, third-party services' own security, mobile app binary, social engineering. Automated and AI-assisted review reduces risk; it does not prove the absence of vulnerabilities. For tier 3, recommend an independent penetration test.*

## Findings

*Grouped by severity (Critical first). Use the finding format from SKILL.md. Each finding carries a status: Open / Fixed: verified (date, commit) / Risk accepted by (name, date, until).*

## System map

*Mermaid diagram + entry-point table from 01-system-map.md (or a link).*

## Appendix
- Tool versions and commands run (from `scans/coverage.md`).
- Scanner hits dismissed as false positives, one line each with the reason.
- Glossary of any technical terms used above.
