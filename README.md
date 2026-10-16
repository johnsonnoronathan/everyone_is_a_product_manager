# everyone_is_a_product_manager

AI made building software possible for everyone. It didn't make it safe for everyone. A site that a product manager builds in a weekend can look perfect in a demo and still leak customer data, charge the wrong price, sell stock it doesn't have, or fall over the moment a promotion goes out.

This repository is a kit of **Claude Code skills** for a thorough, honest check before launch, written for people who aren't engineers and for the consultants who help them.

| Skill | Answers | You get |
|---|---|---|
| [`launch-review`](.claude/skills/launch-review/SKILL.md) | *Can we go live? What must be fixed first?* Architecture, security (OWASP Top 10:2025), performance, operations. | `REPORT.md` with **GO / GO WITH CONDITIONS / NO-GO**, evidence for every finding, coverage and limitations |
| [`peak-traffic-test`](.claude/skills/peak-traffic-test/SKILL.md) | *Will it survive the flash sale / Black Friday / launch spike, and stay correct?* | Target load from business numbers, staged k6 load test, oversell/double-charge test, plain-language verdict |
| [`acceptance-test`](.claude/skills/acceptance-test/SKILL.md) | *Does it do what we agreed?* | Numbered acceptance criteria, Playwright tests, a traceability matrix with screenshots, and a sign-off sheet |

The skills hand work to each other: `launch-review` calls `peak-traffic-test` for scale and `acceptance-test` for user-facing behaviour, and folds their results into one verdict.

## See it work in 5 minutes

[`demo/flash-sale`](demo/flash-sale/) is a sneaker drop built twice: a **naive** version with 20 planted problems (the kind AI-assisted builds typically ship with) and a **fixed** version. Every skill was run on both; the full outputs are in [`demo/flash-sale/sample-reports/`](demo/flash-sale/sample-reports/).

| | naive | fixed |
|---|---|---|
| **Launch review** | NO-GO: 10 Critical, 6 High ([report](demo/flash-sale/sample-reports/naive/launch-review/REPORT.md)) | NO-GO: 1 Critical, 6 High ([report](demo/flash-sale/sample-reports/fixed/launch-review/REPORT.md)) |
| **Load test**, target 600 req/s | Breaks at 50%: product page takes 2.6 s+ | Holds 200% (1,200 req/s) |
| **Oversell race**, 100 pairs, 1,000 buyers double-clicking | 1,962 pairs sold, 963 buyers charged twice | 96 sold, nobody charged twice |
| **Acceptance**, 10 criteria × 3 runs | Not ready: 3 "Must" criteria fail | Ready for sign-off |
| **Planted issues found** by a review that never saw the answer key | 19 of 20, plus a real crash bug we hadn't planted | n/a |

The most useful result is in the right-hand column. The "fixed" version passed the load test, the oversell race and every acceptance test. The review still found that a single `GET //` request crashes the server, and that a slow payment provider leads to double charges (reproduced: 57 payments for 39 pairs). No single check is enough, which is why the kit layers them. The details, and what we changed in the skills because of this run, are in the [scorecard](demo/flash-sale/sample-reports/SCORECARD.md).

## Use it on your own (or a client's) project

1. Install the skills as a Claude Code plugin (anyone with access to this repository can do this):
   ```
   /plugin install launch-readiness --marketplace johnsonnoronathan/everyone_is_a_product_manager
   ```
   On Claude Code older than 2.1.275, use two steps: `/plugin marketplace add johnsonnoronathan/everyone_is_a_product_manager`, then `/plugin install launch-readiness@everyone-is-a-product-manager`. Alternatively, copy the three folders in `.claude/skills/` into a project's `.claude/skills/` (or `~/.claude/skills/`).
2. Install what you can (each skill works with what's available and reports what it couldn't check):
   - Node.js ≥ 18 (≥ 22.13 for the demo)
   - [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) for load tests
   - [Gitleaks](https://github.com/gitleaks/gitleaks), [OSV-Scanner](https://github.com/google/osv-scanner), [Semgrep](https://semgrep.dev/docs/getting-started/) for the automated scans
   - Playwright is installed per project by the acceptance-test skill
3. Ask Claude in plain words: *"Review this app before launch"*, *"Will we survive Black Friday with 50,000 visitors in the first 10 minutes?"*, *"Help me write acceptance tests for checkout and tell me if it's ready to sign off."*

## Why the results can be trusted

The skills are built around rules that keep an AI-assisted review honest:

- **Evidence or it doesn't go in.** Every finding cites `file:line`, command output or a reproduction. Critical and High findings get a second, sceptical verification pass.
- **Measure instead of guessing.** Capacity comes from a load test against an agreed target, not from reading code. Correctness under concurrency is tested by racing 1,000 buyers for 100 items.
- **Agree first, then test.** Acceptance criteria are signed off by the product owner *before* tests are written, and tests are never weakened to turn green.
- **Flaky is not a pass.** Tests run three times with no retries; inconsistent results are reported as FLAKY.
- **Say what wasn't checked.** Every report has a coverage table and limitations. The verdict is never presented as a guarantee.
- **Do no harm.** Read-only by default; no load tests or active scans against production or third-party sites without explicit permission; secrets are redacted and escalated immediately.

## Built on existing tools (and safe for paid client work)

Rather than reinvent scanners, the skills drive established open-source tools and add what they lack: business-language reporting, verification, and a verdict.

| Tool | Used for | Licence |
|---|---|---|
| [Gitleaks](https://github.com/gitleaks/gitleaks) | Secrets in code and git history | MIT |
| [OSV-Scanner](https://github.com/google/osv-scanner) | Vulnerable dependencies | Apache-2.0 |
| [Semgrep CE](https://github.com/semgrep/semgrep) + **our own rules** | Risky code patterns (security and peak-traffic) | Engine LGPL-2.1, rules MIT |
| [k6](https://github.com/grafana/k6) | Load and oversell tests | AGPL-3.0 (used as a tool) |
| [Playwright](https://playwright.dev) + [axe-core](https://github.com/dequelabs/axe-core) | Acceptance and accessibility tests | Apache-2.0 / MPL-2.0 |

Semgrep's own registry rules are **not** used by default: under the Semgrep Rules License, charging for a scanning service that uses them requires a commercial licence. The skills ship their own MIT-licensed rules instead (with regression tests in `tests/semgrep/`). Optional add-ons (OWASP ZAP baseline, Supabase Security Advisor, Trail of Bits' security skills, Claude Code's `/security-review`) are described in [`tooling.md`](.claude/skills/launch-review/references/tooling.md).

## Limits, honestly

- An AI-assisted review lowers risk; it does not prove there are no vulnerabilities. For apps handling payments in-app, health, financial or children's data, the skill recommends an independent human penetration test as well.
- Load tests against a staging environment approximate production; results don't scale linearly to bigger or smaller machines.
- Checks of Supabase/Firebase rules read the repository; the live configuration can differ (the report says so and points to the provider's own advisor).

## Repository layout

```
.claude-plugin/         marketplace.json: installs the three skills as the "launch-readiness" plugin
.claude/skills/
  launch-review/        SKILL.md, references (intake, security, architecture, operations, severity, report), scripts, semgrep rules
  peak-traffic-test/    SKILL.md, references (capacity interview, anti-patterns, report), capacity.mjs, k6 scripts, semgrep rules
  acceptance-test/      SKILL.md, references (writing criteria, Playwright rules), ac-report.mjs, templates
demo/flash-sale/        naive/ and fixed/ apps, shared infrastructure, acceptance suite, sample reports, answer key
tests/                  unit tests for the skill scripts, semgrep rule fixtures
```

Run the tests with `npm test` (needs Node ≥ 22 and Semgrep).
