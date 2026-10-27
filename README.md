# Everyone is a product manager

**Pre-launch checks for apps built with AI: a security and architecture review, a peak-traffic test, and acceptance testing, packaged as Claude Code skills that non-engineers can run and engineers can trust.**

[![CI](https://github.com/johnsonnoronathan/everyone_is_a_product_manager/actions/workflows/ci.yml/badge.svg)](https://github.com/johnsonnoronathan/everyone_is_a_product_manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

AI lets anyone build a web app in a weekend. It doesn't tell you whether that app leaks customer data, charges the wrong price, sells (or books) more than you have, or falls over when the promotion email goes out. These checks do what a careful engineering team would do before launch, and report back in plain language, with evidence.

They work for any web app: a shop, a booking system for classes or appointments, a membership site, an internal tool. The examples here are a sneaker shop, where "selling more than you have" means overselling; in a booking app it means an overbooked class or a double-booked appointment.

## What you need

- **[Claude Code](https://code.claude.com/docs/en/overview)**, Anthropic's coding assistant ([how to install it](https://code.claude.com/docs/en/setup)). It needs a paid Claude plan or an Anthropic API account. The checks are packaged as Claude Code *skills*: instructions and scripts it follows when you ask for a review.
- **Your app's code in a folder on your computer.** If you built it in an online builder, export it first (most can export to GitHub, and you can download it from there).
- **Ideally, a test copy of the app (staging)** with test payments. If you only have the live site, the review still works on the code and on a copy it starts on your computer; nothing is ever tested against the live site without your permission.

## Start here

1. **Install the skills.** Inside Claude Code (type it where you chat with it, not in a terminal):
   ```
   /plugin install launch-readiness --marketplace johnsonnoronathan/everyone_is_a_product_manager
   ```
   If that fails, your Claude Code is older than 2.1.275 (check with `claude --version` in a terminal). Use two steps instead: `/plugin marketplace add johnsonnoronathan/everyone_is_a_product_manager`, then `/plugin install launch-readiness@everyone-is-a-product-manager`. Engineers can also copy the folders in `.claude/skills/` into a project's `.claude/skills/`.
2. **Open Claude Code in your app's folder and ask, in plain words:**
   - *"Review this app before launch."* This is the one to start with. It runs the other checks itself where they apply.
   - *"Will we survive the launch? We expect 50,000 visitors in the first 10 minutes."* For traffic only.
   - *"Help me write acceptance tests for booking and tell me if it's ready to sign off."* For "does it do what we agreed?" only.
   - *"Prepare my project for review."* When someone else (a consultant, your client's engineers) will review it: see [handing a project in](docs/hand-in-guide.md).
3. **Read the result.** You get a verdict first (GO, GO WITH CONDITIONS or NO-GO), then what must happen before launch and who should do it, then the evidence. It comes as a report in a `launch-review/` folder and as a one-page review site you open in your browser: here is [an example](demo/flash-sale/review/) (download `index.html` and open it).

You can give the result to your client. Do it privately, because it describes how the app could be broken: not in a public repository or a shared ticket.

**Optional tools** make the review more thorough. Without them it still runs and tells you what it couldn't check. In order of value for a non-engineer: [Gitleaks](https://github.com/gitleaks/gitleaks) (finds leaked passwords and keys), [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) (load tests), [OSV-Scanner](https://github.com/google/osv-scanner) (known security holes in the libraries you use), [Semgrep](https://semgrep.dev/docs/getting-started/) (risky code patterns). The scripts need Node.js 18 or later; Playwright is installed per project when needed. Claude Code can install these for you if you ask.

## The skills

| Skill | Answers | You get |
|---|---|---|
| [`launch-review`](.claude/skills/launch-review/SKILL.md) | *Can we go live? What must be fixed first?* Security, architecture, data and business rules, performance, operations, tests and AI-agent instructions, and the history of bugs that keep coming back | A **GO / GO WITH CONDITIONS / NO-GO** verdict and a one-page review site. Every problem comes with evidence, a plain-language impact and a fix, plus what was *not* checked |
| [`peak-traffic-test`](.claude/skills/peak-traffic-test/SKILL.md) | *Will it survive the sale, the launch email, the schedule opening, and stay correct?* | A target load worked out from your business numbers, a stepped load test, and a "race" test: 1,000 people grabbing the last 100 items or places at once |
| [`acceptance-test`](.claude/skills/acceptance-test/SKILL.md) | *Does it do what we agreed?* | Numbered acceptance criteria agreed **before** testing, browser tests run 3 times (a test that only sometimes passes counts as a failure), and a criteria-by-criteria table with screenshots for sign-off |
| [`prepare-review`](.claude/skills/prepare-review/SKILL.md) | *How do I hand my project to a reviewer?* | The README section and review page a reviewer needs, with screenshots of the main journeys, checked complete by software |

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

## The core idea

Anyone can now write code with AI, using many different tools and models, so the last check before customers has to work no matter who or what wrote the code:

- **Judge the evidence, not the author or the tool.** "The AI says it's ready" is a claim, not evidence.
- **Review independently of the author**, and again after every round of fixes, not just re-test.
- **"Ready" is a written set of evidence signed by a person**, not a feeling.

The one-page version, with the seven questions every review must answer and the definition of ready: **[The release gate](docs/release-gate.md)**.

## Handing a project to someone else: the review standard

When one person builds and another reviews (you and a consultant, your team and a client), both work from the same format, so a review never starts from a blank page and every result reads the same. You don't need it to review your own app.

- **The author hands in** a README that lets a stranger run the app, and a review page: what the app does with screenshots of the main journeys, how to run it, the agreed requirements, how it's built and tested, and known problems. The `prepare-review` skill writes both; software checks the hand-in is complete and lists what's missing. Plain-language guide: **[Handing your project in](docs/hand-in-guide.md)**.
- **The reviewer judges** up to 99 criteria in nine areas (only those that fit the app apply): reviewability, harness (tests, CI, the instructions AI agents follow), architecture, data and business rules, security, performance, operations, quality history, and acceptance. Each gets *meets*, *does not meet*, *cannot verify* or *not applicable*, with graded evidence: something the reviewer ran, something they inspected, or only someone's claim. A claim alone never counts as *meets*.
- **Software does the counting.** After each stage a script counts what must be there ("expected 13, found 11, missing H-04 and H-09"), and the review can't move on until it matches. A summary written by an AI or a tired person is never trusted for numbers.
- **What keeps coming back gets fixed for good.** The review reads the git history and issue tracker, groups past bugs into kinds of problem that recur, names the root cause of each, checks that something now catches the next one automatically, and adds a rule to the AI agents' instructions.

[The standard](.claude/skills/launch-review/standard/review-standard.md) · [all 99 criteria](.claude/skills/launch-review/standard/criteria.md) · [example review page](demo/flash-sale/review/)

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

## Words used here

| Word | Meaning |
|---|---|
| Staging | A test copy of your site with test data, separate from the live one. |
| Load test | Sending many simulated visitors at the app to see how much it can take. |
| Requests per second (req/s) | How many page loads or button presses reach the server each second. |
| Flaky test | A test that sometimes passes and sometimes fails on the same code. Here it counts as a failure. |
| Race test | Many simulated people trying to get the last items or places at the same moment. |
| Review page / review pack | The one-page site a review produces, and the data file it's made from. |
| Agent instructions (`AGENTS.md`, `CLAUDE.md`) | The file an AI coding assistant reads before changing your code. |

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
