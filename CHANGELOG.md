# Changelog

## Unreleased

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
  - the share of AI-co-authored commits.

### Skills
- `launch-review`:
  - checks the author's review pack first, and hands back an incomplete one with the missing items listed;
  - reviews the quality history: root cause, automatic control and agent rule for each recurring problem;
  - has a fifth lens, the harness;
  - fills in the worksheet and renders the review page alongside `REPORT.md`.

### Demo
- `demo/flash-sale/review/`: the fixed version handed in and judged under the standard. All 95 criteria that apply have a result. It records six kinds of problem that came back across three reviews, five problems introduced by fixes, and the verdict NO-GO.

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
