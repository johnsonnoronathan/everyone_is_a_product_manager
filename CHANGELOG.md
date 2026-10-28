# Changelog

## 0.2.0 (2026-10-28): the review standard

### Review standard
- **A fixed format for handing projects in and judging them** (`launch-review/standard/review-standard.md`):
  - a README minimum (nine items);
  - a review pack (`review-pack.json`) that renders as a one-page demo and review site with 16 sections in a fixed order;
  - four results (meets, does not meet, cannot verify, not applicable);
  - evidence grades (measured, inspected, claim only);
  - verdict rules.
- **99 criteria in nine areas** (`standard/criteria.json`, listed in `criteria.md`): reviewability, harness (tests, CI, agent instructions such as `AGENTS.md`), architecture, data and business rules, security, performance, operations, quality history, acceptance and report.
- **`review-pack.mjs`:**
  - creates a template;
  - checks a submission or a review (it refuses a verdict more favourable than the results allow);
  - renders a self-contained page that works offline.
- **`history-scan.mjs`:** reads git history (and optionally an issue export) and reports:
  - fix commits, reverts and bundled fixes;
  - recurring problem classes and code hotspots;
  - the share of AI-co-authored commits;
  - a warning when there is too little history to learn from.
- **Quality gates: software counts, not the AI.** `review-pack.mjs gate submission | worksheet | review` counts what each stage must have produced, lists exactly what is missing, and fails until nothing is:
  - checker errors, journeys with evidence, and evidence files that exist;
  - saved text evidence with no real email addresses or keys (at hand-in; it says what it found without printing it);
  - the README's nine items and its link to the review page (at hand-in);
  - per area, mandatory criteria with a result (the worksheet can be split per lens and merged with `merge`; `status` shows progress);
  - open Critical and High findings listed as blockers, each blocker with a card, and Must acceptance criteria with a result;
  - every scanner rule that fired, reported as a finding or dismissed with a reason (new `scans` field; the database-rules check names a rule for each finding so it is counted too).
- **The verdict ceiling counts open findings**, not only failing worksheet rows: an open Critical (or an unaccepted High) means NO-GO even if no row points at it.
- **An owner-first review page:** the verdict comes with a to-do list (who, how big, when), what would happen if the app launched anyway, decisions only the owner can make, and an estimate. Every count on the page is computed from the data, and technical terms are explained where they first appear.
- **Criterion D-13** "Real payments work end to end", and H-08 now names malformed input and restarts.
- **`docs/hand-in-guide.md`:** the standard in plain words, for the person handing a project in.

### Skills
- **`prepare-review`** (new, for the author): writes the README's nine items and the review pack, with demo journeys shown by screenshots taken in a real browser, and runs the submission gate. It doesn't judge the project; `launch-review` does.
- `launch-review`:
  - checks the author's review pack first, and hands back an incomplete one with the missing items listed;
  - reviews the quality history: root cause, automatic control and agent rule for each recurring problem;
  - has a fifth lens, the harness;
  - fills in the worksheet and renders the review page alongside `REPORT.md`;
  - runs a gate after each stage, and offers a focused review for narrow questions (just the architecture, the `AGENTS.md`, recurring bugs);
  - records what became of every scanner hit, and gives the Lighthouse command for page speed on phones.
- `peak-traffic-test`: **fixed a counting bug in the race test.** Accepted clicks were also counted as rejected (the round-2 sample report says 1,998 rejected; the right number is 1,900). Each response now lands in exactly one bucket, and the summary flags a problem if the buckets don't add up to the clicks sent.
- `acceptance-test`: the report skips demo journeys tagged `@journey`.

### Safety and housekeeping
- **Review other people's code somewhere you can throw away.** A review installs the project's packages and runs its app and tests. `launch-review` now warns before doing that on a machine with real keys or data when the project isn't the user's own; the README and the client playbook say the same.
- **Hand-ins use test data only.** `prepare-review` and the hand-in guide say so, and the hand-in gate checks saved text evidence. Screenshots still need a person to look at them.
- **The README says what a review costs** in time and usage allowance, measured in our tests.
- **`AGENTS.md` for this repository** (with `CLAUDE.md` pointing to it): how to test, the rules that must not be broken, and lessons from past problems.

### Demo
- `demo/flash-sale/review/`: the fixed version handed in and judged under the standard. All 95 criteria that apply have a result. It records six kinds of problem that came back across three reviews, five problems introduced by fixes, and the verdict NO-GO.
- The demo README has the nine-item Review section; the acceptance suite's ports are configurable (`APP_PORT`, `PAYMENT_PORT`).
- **Skill and reading tests** ([scorecard](demo/flash-sale/sample-reports/SCORECARD.md#skill-and-reading-tests-27-october-2026)):
  - 16 of 16 requests started the right skill;
  - two rounds of reading tests by role;
  - an author test of `prepare-review`;
  - two independent reviewer tests: 72% agreement with the reference review on the fixed version, and 19 of 20 planted problems on the naive one.

## 0.1.0 (2026-10-26): first public release

### Core lessons
- **The release gate** (`docs/release-gate.md`): the project's core lessons on one page. It covers three principles, the seven questions every review must answer, a definition of ready, how to run the gate, and the evidence from the demo.

### Skills
- **launch-review**: a pre-launch review of security (OWASP Top 10:2025, API and LLM risks, Supabase/Firebase/Next.js/Stripe pitfalls), architecture and data integrity, performance and operations, ending in a GO / GO WITH CONDITIONS / NO-GO verdict.
  - Judges the evidence, not the author or the tool: claims like "tests pass" are verified, and an independent review is recommended when the reviewer also wrote the code. Starts from the author's submission pack when there is one, but verifies it.
  - Scanner runner: Gitleaks, OSV-Scanner, Semgrep with our own rules, optional Trivy.
  - Supabase RLS / Firebase rules checker and live header checker.
  - Severity rubric, report template, and a guide for running client engagements.
- **peak-traffic-test**: turns business numbers into a target load.
  - Staged k6 load test with a smoke mode and a per-step verdict.
  - Oversell race test that understands orders awaiting payment confirmation.
  - Peak-traffic anti-pattern catalogue and Semgrep rules.
- **acceptance-test**: criteria-first acceptance testing with Playwright.
  - Every test runs 3× without retries; flaky results are reported as FLAKY.
  - Criteria-by-criteria evidence matrix with screenshots and a sign-off sheet.
  - Templates for client projects.
- Installs as the `launch-readiness` Claude Code plugin.

### Demo and validation
- A flash-sale demo app in a naive version (20 planted issues, answer key) and a fixed version, with full sample reports for three review rounds.
- Scorecard: the naive review found 19 of 20 planted issues plus an unplanted crash. Two fix-and-re-review rounds show what each layer of checks catches.

### Project
- MIT licence, contributing guide, security policy, code of conduct.
- CI: script unit tests, Semgrep rule fixtures, the demo oversell race and acceptance suite.
- Release workflow: publishes a GitHub release with notes taken from this changelog.
