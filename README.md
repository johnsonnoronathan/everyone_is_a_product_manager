# Everyone is a product manager

**Pre-launch checks for apps built with AI: a security and architecture review, a peak-traffic test, and acceptance testing, packaged as Claude Code skills that non-engineers can run and engineers can trust.**

[![CI](https://github.com/johnsonnoronathan/everyone_is_a_product_manager/actions/workflows/ci.yml/badge.svg)](https://github.com/johnsonnoronathan/everyone_is_a_product_manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

AI lets anyone build a web app in a weekend. It doesn't tell you whether that app leaks customer data, charges the wrong price, sells stock it doesn't have, or falls over when the promotion email goes out. These skills run the check a careful engineering team would run before launch, and report back in plain language, with evidence.

| Skill | Answers | You get |
|---|---|---|
| [`launch-review`](.claude/skills/launch-review/SKILL.md) | *Can we go live? What must be fixed first?* Security (OWASP Top 10:2025), architecture, performance, operations | A **GO / GO WITH CONDITIONS / NO-GO** report. Every finding comes with evidence, a plain-language impact and a fix, plus what was *not* checked |
| [`peak-traffic-test`](.claude/skills/peak-traffic-test/SKILL.md) | *Will it survive the flash sale / Black Friday / launch spike, and stay correct?* | A target load worked out from your business numbers, a stepped k6 load test, and an "oversell race" (1,000 buyers, 100 items) |
| [`acceptance-test`](.claude/skills/acceptance-test/SKILL.md) | *Does it do what we agreed?* | Numbered acceptance criteria agreed **before** testing, Playwright tests run 3× (flaky ≠ pass), and a criteria-by-criteria evidence table with screenshots for sign-off |

The skills hand work to each other: `launch-review` calls on the other two and folds their results into one verdict.

## The core idea

Anyone can now write code with AI, using many different tools and models, so the last check before customers has to work no matter who or what wrote the code:

- **Judge the evidence, not the author or the tool.** "The AI says it's ready" is a claim, not evidence.
- **Review independently of the author**, and again after every round of fixes, not just re-test.
- **"Ready" is a written set of evidence signed by a person**, not a feeling.

The one-page version, with the seven questions every review must answer and the definition of ready: **[The release gate](docs/release-gate.md)**.

## The review standard

Every project is handed in and judged in the same format, so a review never starts from a blank page:
- **What the author hands in:** a README with nine required items, and a review pack (`review/review-pack.json`) that renders as one web page. The page covers the demo (main user journeys with screenshots), how to run it, the agreed requirements, architecture, business rules, tests and agent instructions, and known problems. A checker refuses an incomplete pack and lists what's missing.
- **How it's judged:** 98 criteria in nine areas: reviewability, harness (tests, CI, `AGENTS.md`), architecture, data and business rules, security, performance, operations, quality history, and acceptance. Each gets *meets*, *does not meet*, *cannot verify* or *not applicable*. Evidence is graded: something the reviewer measured, something they inspected, or only a claim. A claim alone never counts as *meets*.
- **What keeps coming back:** the review reads the git history and issue tracker and groups past bugs into recurring problems. For each one it names the root cause, checks that something now catches the next one automatically, and adds a rule to the agent instructions.

[The standard](.claude/skills/launch-review/standard/review-standard.md) · [all 98 criteria](.claude/skills/launch-review/standard/criteria.md) · worked example: [`demo/flash-sale/review/`](demo/flash-sale/review/) (download `index.html` and open it in a browser)

## Quick start

1. **Install** the skills in Claude Code:
   ```
   /plugin install launch-readiness --marketplace johnsonnoronathan/everyone_is_a_product_manager
   ```
   On Claude Code older than 2.1.275, use two steps: `/plugin marketplace add johnsonnoronathan/everyone_is_a_product_manager`, then `/plugin install launch-readiness@everyone-is-a-product-manager`. You can also copy the folders in `.claude/skills/` into your project's `.claude/skills/`.
2. **Optional tools.** Each skill uses what's installed and reports what it couldn't check:
   - [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) for load tests
   - [Gitleaks](https://github.com/gitleaks/gitleaks), [OSV-Scanner](https://github.com/google/osv-scanner) and [Semgrep](https://semgrep.dev/docs/getting-started/) for automated scans
   - Node.js ≥ 18
   - Playwright is installed per project by the acceptance-test skill.
3. **Ask in plain words**, from your project folder:
   - *"Review this app before launch."*
   - *"Will we survive Black Friday? We expect 50,000 visitors in the first 10 minutes."*
   - *"Help me write acceptance tests for checkout and tell me if it's ready to sign off."*

   Reports are written to `launch-review/` in your project.

## See it work

[`demo/flash-sale`](demo/flash-sale/) is a sneaker drop (100 pairs, one per customer). It comes in two versions: a **naive** one with 20 planted problems of the kind AI-assisted builds often ship with, and a **fixed** one that went through two rounds of review and fixes. Every skill was run on every version, by reviewers that never saw the answer key. The full reports are in [`demo/flash-sale/sample-reports/`](demo/flash-sale/sample-reports/).

| | naive | fixed, round 1 | fixed, round 2 |
|---|---|---|---|
| **Launch review** | NO-GO: 10 Critical, 6 High | NO-GO: 1 Critical, 6 High | NO-GO: 0 Critical, 1 High (16 of 23 earlier findings fixed and verified) |
| **Load test**, target 600 req/s | Breaks at 50% | Holds 200% | Target passes in every run; 200% in 2 of 3 runs |
| **Oversell race**, 100 pairs, 1,000 double-clicking buyers | **1,962 sold**, 963 charged twice | 96 sold, none charged twice | 100 sold, none charged twice |
| **Slow payment provider** (~3 s) | n/a | **57 payments for 39 pairs** | 40 payments for 40 pairs |
| **Acceptance tests**, 3 runs each | 3 must-have criteria fail | All pass | All pass (criteria v1.1) |
| **Planted issues found** by a review that never saw the answer key | 19 of 20, plus a real crash bug we hadn't planted | | |

What this shows:
- **The first "fixed" version passed every test and still had serious problems.** It passed the load test, the oversell race and all acceptance tests. The review found that one `GET //` request crashes the server, and that a slow payment provider double-charges customers.
- **Round 2 fixed and verified those**, then found new problems, including a sale start time that silently stays wrong after a redeploy.
- **It's still NO-GO, for an honest reason:** a demo has no real payment integration, so its payment flow can never be fully verified.

No single check is enough, and fixes need re-review, not just re-testing.

Details, including what we changed in the skills after each run: [scorecard](demo/flash-sale/sample-reports/SCORECARD.md).

## Why the results can be trusted

- **Evidence or it doesn't go in.** Every finding cites `file:line`, command output, or a reproduction. Critical and High findings get a second, sceptical verification pass.
- **Measure instead of guessing.** Capacity comes from a load test against an agreed target, not from reading code. Correctness under concurrency is tested by racing 1,000 buyers for 100 items. Load tests are run more than once, and every run is kept.
- **Agree first, then test.** Acceptance criteria are signed off *before* tests are written, and tests are never weakened to turn green.
- **Flaky is not a pass.** Tests run three times with no retries.
- **Say what wasn't checked.** Every report has a coverage table and its limitations. A verdict is never presented as a guarantee.
- **Do no harm.** Read-only by default. Secrets are redacted and escalated immediately. No load tests or active scans on systems you don't own (see below).

## Responsible use

- **Only test systems you own or are authorised to test.** A load test against someone else's site is a denial-of-service attack. The skills ask for explicit confirmation before any load test or live check, and default to staging.
- **Use staging.** Run load tests and active checks against production only with the owner's written permission, payments in test mode, and someone watching.
- **Treat reports as confidential.** They describe how to break the app.
- **The demo's `naive/` app is intentionally vulnerable.** Run it locally only; never deploy it. Its "secret key" is fake.

## Limits

- An AI-assisted review lowers risk; it does not prove the absence of vulnerabilities. For apps handling payments in-app, health, financial or children's data, the skill recommends an independent human penetration test as well.
- Load tests on staging or a laptop approximate production; they don't scale linearly to bigger or smaller machines.
- Supabase/Firebase rule checks read the repository; the live configuration can differ (the report says so and points to the provider's own advisor).
- The skills are written for Claude Code. The checklists, scripts and rules are plain files and can be used by hand.

## Built on existing tools

The skills drive established open-source tools and add what they lack: a plain-language explanation, verification of each finding, and a verdict.

| Tool | Used for | Licence |
|---|---|---|
| [Gitleaks](https://github.com/gitleaks/gitleaks) | Secrets in code and git history | MIT |
| [OSV-Scanner](https://github.com/google/osv-scanner) | Vulnerable dependencies | Apache-2.0 |
| [Semgrep CE](https://github.com/semgrep/semgrep) + **this project's own rules** | Risky code patterns (security and peak traffic) | Engine LGPL-2.1, rules MIT |
| [k6](https://github.com/grafana/k6) | Load and oversell tests | AGPL-3.0 (run as a separate tool) |
| [Playwright](https://playwright.dev) + [axe-core](https://github.com/dequelabs/axe-core) | Acceptance and accessibility tests | Apache-2.0 / MPL-2.0 |

**Note for consultants:** see [Running a launch review for a client](docs/running-client-reviews.md) for permission, expectations, delivery and re-review. Semgrep's own registry rules are under the Semgrep Rules License, which requires a commercial licence if you charge for a scanning service that uses them. They are therefore off by default, and the skills ship their own MIT-licensed rules, with regression tests. Optional add-ons (OWASP ZAP baseline, Supabase Security Advisor, Trail of Bits' security skills, Claude Code's `/security-review`) are described in [`tooling.md`](.claude/skills/launch-review/references/tooling.md).

The checklists draw on the [OWASP Top 10:2025](https://owasp.org/Top10/2025/), the OWASP API Security and LLM Top 10s, the AWS Well-Architected Framework, the Twelve-Factor App and Google SRE production-readiness practice.

## Repository layout

```
.claude/skills/
  launch-review/        SKILL.md, references (intake, security, architecture, operations, severity, report), review standard and criteria, scripts (scanners, review pack, history scan), Semgrep rules
  peak-traffic-test/    SKILL.md, references (capacity interview, anti-patterns, report), capacity calculator, k6 scripts, Semgrep rules
  acceptance-test/      SKILL.md, references (writing criteria, Playwright rules), report generator, templates
.claude-plugin/         marketplace.json: installs the three skills as the "launch-readiness" plugin
demo/flash-sale/        naive/ and fixed/ apps, simulated infrastructure, acceptance suite, sample reports, review page, answer key
docs/                   release-gate.md: the core lessons; running-client-reviews.md: a playbook for paid review engagements
tests/                  unit tests for the skill scripts, Semgrep rule fixtures
```

## Contributing

Contributions are welcome, especially reports of **false alarms and missed issues**, which are how the checklists and rules improve. See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` before opening a pull request (needs Node.js ≥ 22.13 and Semgrep). Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
