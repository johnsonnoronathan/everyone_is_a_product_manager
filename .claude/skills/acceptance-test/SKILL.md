---
name: acceptance-test
description: Turns what a product manager expects ("shoppers can buy one pair", "sold-out is clear", "orders are private") into agreed, numbered acceptance criteria, then into Playwright tests that check them in a real browser, and finally into an evidence-backed pass/fail report with screenshots for sign-off. Use when someone wants to "test my app", "check it works as intended", "UAT", "user acceptance testing", "QA before launch", "verify the requirements", "end-to-end tests", or needs proof for a client that features work.
---

# Acceptance test

Give a product owner a trustworthy answer to "does the app do what we agreed?", with proof they can open and sign. The audience is usually not an engineer: write criteria and reports in plain language; keep the technical detail in the tests and the evidence links.

`<skill-dir>` = this skill's base directory. Work in an `acceptance/` folder in the project (its own `package.json`, so it works whatever the app is built with).

## What makes the results reliable (non-negotiable)

1. **Criteria first, agreed before tests.** Tests check what the product owner agreed, not what the code happens to do. Number every criterion (`AC-01`…) and version the list.
2. **Traceability both ways.** Every criterion has at least one test tagged with its id, or is marked as verified elsewhere (`**Evidence:** external: …`). Every test belongs to a criterion.
3. **Check the outcome, not just the message.** If the criterion is "one order per customer", count the orders (API/database), don't only read the toast.
4. **Never weaken an assertion to get green.** If the app behaves differently from the criterion, that's a FAIL to report. If the criterion is ambiguous, ask the product owner and bump the criteria version. Test-code changes after a failure are limited to selectors, waits and setup, and are noted in the report.
5. **No retries; repeat instead.** Run every test 3× (`--repeat-each=3`, `retries: 0`). Mixed results = **FLAKY**, which is not a pass. Flakiness is either a bad test or a real intermittent bug (race conditions are real bugs).
6. **Deterministic and safe environment.** Local or staging only; test accounts; payments/emails in test mode; data reset between tests or unique data per test. Failure modes (payment down, slow network) are triggered deliberately, not hoped for.
7. **Evidence for every result.** A screenshot of each test's end state, a trace for failures, request/response evidence for API checks, plus the commit and environment in the report.

## Workflow

### 1. Learn the product
Read the PRD/tickets/README and the code's routes and pages, then use the app (Playwright MCP or `npx playwright codegen <url>` if available) to walk the main flows. Note where data comes from and how to reset it.

### 2. Draft the criteria → `acceptance/criteria.md`
Follow `references/writing-criteria.md`: Given/When/Then, Must/Should/Could, measurable wording, and the edge-case checklist (double-submit, empty/invalid input, permissions, sold-out/limits, failures of third parties, mobile, accessibility). Propose the list to the product owner in plain language and get explicit agreement ("v1.0 agreed by X on date") **before** writing tests. Things a browser test can't prove (load, oversell under concurrency, security scans) get `**Evidence:** external: …` pointing to `peak-traffic-test` / `launch-review` output.

### 3. Set up the harness
Copy `<skill-dir>/templates/` into `acceptance/` (`package.json`, `playwright.config.mjs`, `tests/example.spec.mjs`), then:
```bash
cd acceptance && npm install && npx playwright install chromium   # skip install if browsers already exist
```
Set `BASE_URL` (staging) or configure `webServer` to start the app locally. Decide the data strategy: a test-only reset endpoint, a seed script, or unique users/data per test.

### 4. Write the tests
Follow `references/playwright-rules.md`. One `test()` per criterion (more if it has several paths), titled and tagged with the id: `test('AC-04 one per customer', { tag: '@AC-04' }, …)`. Use role/label locators and web-first assertions; verify the system of record for anything about money, counts, permissions or data.

Playwright's built-in agents (planner/generator/healer, Playwright ≥ 1.56: `npx playwright init-agents --loop=claude`) can speed up exploring and drafting. Rule 4 still applies: the healer may fix selectors and waits, never expectations.

### 5. Run and triage
```bash
npx playwright test --repeat-each=3
node <skill-dir>/scripts/ac-report.mjs results/results.json criteria.md ACCEPTANCE.md
```
(Point the first argument at the JSON reporter's output file from the config.) For every FAIL or FLAKY, open the screenshot/trace and classify it:
- **Product bug**: keep the test as is; describe the bug in plain language (what the shopper sees vs. what was agreed).
- **Test bug**: fix the test (rule 4) and re-run all repeats.
- **Unclear criterion**: ask the product owner; update criteria and version.

### 6. Report and sign-off
`ACCEPTANCE.md` contains the verdict ("Ready for sign-off" only when every Must passes), the traceability matrix with evidence links, details for everything not passing, and a sign-off table. In chat, tell the product owner: the verdict, each failing criterion in one sentence, and where to look. Never hand-edit statuses in the generated matrix.

### 7. Keep it as a regression suite
The suite is an asset: re-run it after every fix and before every release (e.g. a CI job running `npx playwright test --repeat-each=2`). When criteria change, update `criteria.md` first, then the tests.

## When used from launch-review
Return the verdict line, failing Must/Should criteria, and the path to `ACCEPTANCE.md`; launch-review adds them to its coverage table and findings.
