# Pre-delivery inspection: Holiday flash sale

Version `bb6c41e891268d70b1ba4f7d3d584b725e08e838` (branch main, "Holiday flash sale"; the issue export `handover/issues.json` is not committed) · inspected 2026-10-28 by Claude (launch-review skill), in a separate session that did not write or change this code · risk tier 3. Generated from `review-pack.json`; the review page shows the same record with all the evidence.

## 1. Summary: evidence and conclusions

**Verdict: NO-GO.** The shop cannot be delivered as it is. Under the expected midnight rush it sells far more pairs than it has and charges people twice, anyone can read customers' addresses or wipe all orders, one bad request or a restart takes the sale down and loses paid orders, and it is not connected to a real payment provider.

**If it were delivered or launched now:** Within the first minute, hundreds of customers would be charged for sneakers that do not exist and many would be charged twice, while the page took several seconds to load. Anyone could download every buyer's email and home address, buy at a price they choose, or delete all orders with one request; a single malformed request would stop the sale for everyone, and the restart would erase every paid order. The client would face refunds, chargebacks, a personal-data breach to report, and angry customers on launch night.

*These answers measure how complete the testing and the inspection are, not whether the app is ready: the verdict says that.*

| Question | Answer | Evidence |
|---|---|---|
| 1. Is the test harness properly set up? | **No** | 0 of 13 harness checks met; of the 7 kinds of problem that came back, 4 have no automatic test that would catch them and 3 are only partly caught |
| 2. Are the performance tests comprehensive? | **Partly** | 6 of 8 kinds of performance test run; 1 passed, 5 failed |
| 3. Does the architecture review cover hidden problems? | **Yes** | 9 of 9 places examined; 18 hidden problems found |

- The test harness is not set up: 12 of 13 checks are not met and 1 could not be verified, and of the 7 kinds of problem that came back, 4 have no automatic test that would catch them and 3 are only partly caught. Expect the same bugs to return after the next change.
- The performance tests are not fully comprehensive: 2 of 8 kinds this product needs were not run (long run, on a production-like setup). 5 of the 6 that were run failed (see each).
- The review looked in all 9 places where hidden problems usually sit. It found 18 problems there.

**Before delivery (8 blockers):**

1. Make the purchase safe: the price comes from the server, stock is reserved atomically before charging, one pair per customer is enforced in the database, every purchase carries one idempotency key, a time-out leaves the order pending, and a job settles and reconciles payments.
2. Close access: a real sign-in with signed sessions, an ownership check on every order, admin routes removed or behind an admin role, and the search route fixed or removed.
3. Rotate the payment key that is written in the code, move it to a secret setting and remove it from the history.
4. Keep orders safe across crashes and deploys: a persistent database with backups and migrations, no deletion at start-up, error handling that answers 400 instead of crashing, and a graceful shutdown.
5. Connect the real payment provider and try a purchase, a decline and a refund in its test mode, then one small live purchase and refund.
6. Add the sale opening time (date, time and time zone) and a pause switch on the server.
7. Make the page hold the expected crowd and keep bots out: one query per page view with a short cache, a waiting room or busy page, and limits on sign-ins and purchases; then pass the load and race tests on a staging copy.
8. Prepare to run the sale: health checks, error tracking and alerts to a named person, clean logs, backups and a rollback that have been tried, and a rehearsed launch runbook.

**When it could be delivered:** Estimate only: about three to four weeks of developer work for the blockers, plus a staging copy and a re-inspection, so delivery is realistic no earlier than late November 2026 if work starts now.

## 2. How the inspection was done

### Sources of evidence

| Source | Used | What was used, or why not |
|---|---|---|
| The code, at the version inspected | Yes | All 15 files of commit `bb6c41e` (branch main), read in full; `app/server.mjs` line by line. |
| Change history | Yes | Git history: 1 commit (27 October 2026), no fix commits or reverts (`history/history.md`). |
| Issue tracker or tickets | Yes | `handover/issues.json`: 16 tickets from the pilot sale, 16 to 17 October 2026 (13 open, 3 closed), each read and grouped by cause. |
| Reports from users and support | Yes | The tickets are reports by staff testers in the pilot sale; there are no reports from real customers or support, as the shop has not launched. |
| Earlier reviews and incident notes | No | `acceptance/criteria.md` says version 1.1 "follows the first launch review", but that review and any incident notes were not handed over. |
| The project's own tests, run again | Yes | The acceptance suite (Playwright 1.56.1), run three times per test with retries off on 28 October 2026 (`logs/acceptance-run.txt`, `acceptance/ACCEPTANCE.md`). |
| The running app, used by the inspector | Yes | Local copies started with `node run.mjs app` (and from a clean clone); every route probed with curl, including crashes, restarts and a slow provider (`evidence/probes-*.txt`). |
| Load, race and speed measurements | Yes | Two staged load tests, two race tests and one slow-partner race test with k6 v1.3.0 against the owner's brief, and Lighthouse 12.8.2 on the sale page (`peak-traffic/`, `scans/lighthouse/`). |
| Automatic scans | Yes | Gitleaks 8.28.0 (files and history), OSV-Scanner 2.2.3, Semgrep 1.181.0 with the kit's own rules, the data-access-rules check, and the header check on the local copy (`scans/coverage.md`). Trivy not installed (no Docker or infrastructure files to scan). |
| Answers from the owner and the team | No | Nobody was available to answer questions. The owner's brief (`peak-brief.json`) and the architect's instructions (no staging copy; load and race tests allowed on a local copy only; payments and email are simulators) were used, and every other answer is marked as an assumption in `00-scope.md`. |

### Skills and tools used

| Skill or tool | What it did |
|---|---|
| launch-review (this inspection) | Scope, system map, scanners (`run-scanners.sh`), quality history (`history-scan.mjs --issues`), the five lenses, verification, gates and this report (`review-pack.mjs`). |
| peak-traffic-test | Turned the owner's brief into a load plan (`capacity.mjs`), ran the smoke test, two staged load tests (`k6/load.js`), two race tests and a slow-partner race test (`k6/oversell.js`). |
| acceptance-test | Re-ran the project's acceptance suite three times and generated the pass/fail report (`ac-report.mjs`). |
| k6 v1.3.0 | Load and race tests. |
| Playwright 1.56.1 with axe-core (@axe-core/playwright 4.10.2) | The project's acceptance tests and accessibility check. |
| Lighthouse 12.8.2 | Mobile page speed of the sale page (run with npx and the installed Chromium). |
| Gitleaks 8.28.0, OSV-Scanner 2.2.3, Semgrep 1.181.0 | Secrets in files and history, vulnerable dependencies, risky code patterns (the kit's own rules only). |
| curl and bash scripts | Access, crash, restart and slow-partner reproductions on local copies (`evidence/probes-*.txt`). |

**How the answers are worked out.** Software counts them from the record: everything done is Yes, at least half is Partly, less than half is No. Every checklist result carries its evidence grade: A, the inspector ran or measured it; B, the inspector read the code or settings; C, a statement only, which never counts as proof.

## 3. Results

### 3.1 Is the test harness properly set up? No

*The tests, automatic checks and AI-agent instructions that stop the next change, by a person or an AI agent, from breaking something or bringing an old bug back.*

**Evidence.** 0 of 13 harness checks met.

Missing or unproven:

- H-01 Agent instructions exist (does not meet). Found: No `AGENTS.md`, `CLAUDE.md` or equivalent in the repository.
- H-02 Agent instructions are true (does not meet). Found: There is no instruction file whose commands could be checked. (The README commands were run and work; see R-02.)
- H-03 Agents know the rules and boundaries (does not meet). Found: No file tells agents the rules that must never be broken (stock, one per customer, server-side price, never delete orders at start-up).
- H-04 Lessons are recorded for agents (does not meet). Found: None of the recurring problems from the pilot is recorded as a rule for agents.
- H-05 Agent instructions are lean and safe (does not meet). Found: No instruction file exists to be lean and safe.
- H-06 Every promise has a test (does not meet). Found: Every Must criterion except AC-07 has a test in `acceptance/tests/flash-sale.spec.mjs`; AC-07 (never oversell) relies on a race test that is not in the repository. Rules without a test: one per customer across separate purchases, orders survive a restart, admin routes closed.
- H-07 Tests check outcomes (does not meet). Found: Most tests count orders, amounts and charges (good), but none checks what should disappear: AC-02 passed while the sign-in box stayed on screen (`evidence/acceptance/AC-02-test-finished-1.png`).
- H-08 Failure paths are tested (does not meet). Found: Tests cover tampering (AC-03), another user's data (AC-06), double submission (AC-04), a stuck provider (AC-08) and a missing address (AC-11); none covers malformed requests, restarts or admin access.
- H-09 Tests are reliable (does not meet). Found: Three runs with retries off: the same 7 tests failed in every run (21 failures, 15 passes, no flaky results) (`logs/acceptance-run.txt`).
- H-10 Every change goes through CI (does not meet). Found: No CI configuration in the repository; the delivered commit fails its own tests.
- H-11 Lint and type checks pass (does not meet). Found: No linter, formatter or type checker is configured (no ESLint, Prettier or TypeScript configuration, no `check` script).
- H-12 Security checks are automated (does not meet). Found: No secret scanning or dependency scanning in CI or in commit hooks.
- H-13 Changes get an independent review (cannot verify). Needed to verify: The pull-request history with reviews from the code host. The repository holds a single commit by "Shop team" with no merge commits, which suggests no review step, but reviews would live on the code host, which was not shared.

7 kinds of problem came back during the project; 4 have no automatic test that would catch them and 3 are only partly caught. The kind of test that would catch each:

| Kind of test | In the project | Would catch these problems that came back |
|---|---|---|
| Unit tests | **No** | Errors crash the site or show the code to visitors (3 times) |
| Integration tests | **No** | Customers charged twice for one purchase (2 times); More sold than in stock, and more than one pair per customer (2 times); Customers charged but no order recorded (2 times); The server trusts the browser: someone else's data, the price, admin functions (3 times); Errors crash the site or show the code to visitors (3 times); Slow pages and long waits under load or with a slow payment provider (2 times) |
| End-to-end tests in a browser | Yes: Acceptance tests (Playwright) | Customers charged twice for one purchase (2 times); The server trusts the browser: someone else's data, the price, admin functions (3 times); Sign-in box does not go away after signing in (2 times) |
| Visual tests | **No** | Sign-in box does not go away after signing in (2 times) |
| Self-checks | **No** | Customers charged but no order recorded (2 times) |
| Load and race tests | **No** | Customers charged twice for one purchase (2 times); More sold than in stock, and more than one pair per customer (2 times); Customers charged but no order recorded (2 times); Slow pages and long waits under load or with a slow payment provider (2 times) |
| Automatic scans | **No** | More sold than in stock, and more than one pair per customer (2 times); The server trusts the browser: someone else's data, the price, admin functions (3 times); Errors crash the site or show the code to visitors (3 times) |

**Conclusion.** The test harness is not set up: 12 of 13 checks are not met and 1 could not be verified, and of the 7 kinds of problem that came back, 4 have no automatic test that would catch them and 3 are only partly caught. Expect the same bugs to return after the next change.

### 3.2 Are the performance tests comprehensive? Partly

*Whether every kind of performance test this product needs was run. Whether the app passed each one is shown beside it.*

| Kind of test | Result | What it showed |
|---|---|---|
| Load at the target and above it | Failed | Stepped test at 50%, 100%, 150% and 200% of 600 requests per second: the product page missed its 500 ms budget from the first step (95th percentile 2.38 s) and served at most about 237 views per second. |
| Repeated runs, all kept | Failed | The full plan ran twice and both runs are kept; both failed the same way (2.38 s and 2.35 s at 50% of the target), so the failure is not luck. |
| Rush on something limited | Failed | Race test run twice: 1,957 and 1,956 orders confirmed for 100 pairs; 957 and 956 buyers charged twice. |
| Slow or failing partner | Failed | Payments at 3 to 10 s: 400 charges for 400 clicks by 200 buyers. Payments stuck for 30 s: the shopper waited 30 s and got an error page. |
| Beyond capacity | Failed | At 150% and 200% of the target nobody was turned away politely (no 429 or 503); everyone waited up to 8 s and thousands of page views were never served. The app did not crash and recovered after the test. |
| Long run | Not run | Not run: an hour at normal traffic means little until the capacity and data-loss blockers are fixed. Memory grew from 66 MB to 201 MB in one two-minute run, so this test should be run after the fixes. |
| Page speed on phones | Passed | Lighthouse mobile on the local copy: score 98, Largest Contentful Paint 1.6 s, layout shift 0.085, no blocking time. |
| On a production-like setup | Not run | Not run: there is no staging copy and no hosting has been chosen; all numbers come from one laptop-sized machine with simulated payments and database delay. |

**Conclusion.** The performance tests are not fully comprehensive: 2 of 8 kinds this product needs were not run (long run, on a production-like setup). 5 of the 6 that were run failed (see each).

### 3.3 Does the architecture review cover hidden problems? Yes

*The places where problems usually hide from tests: two things at once, restarts, settings, time and the rest. The review looks in each and says what it found there.*

| Where hidden problems sit | Result | How the review looked | Problems |
|---|---|---|---|
| Two things at once | Problems found | Ran the race test twice (1,000 buyers, two clicks each, 100 pairs) and a two-click test by hand; read the purchase handler for read-decide-write steps. | ARC-01, ARC-02 |
| Slow, failing or repeated outside calls | Problems found | Set the payment simulator to 3 s, 8 s, 3 to 10 s and "stuck for 30 s"; compared the provider's charges with orders; read every outgoing call for time limits and idempotency keys. | ARC-07, ARC-04, ARC-12 |
| Restarts, deploys and rollbacks | Problems found | Restarted the app after a purchase, crashed it and sent SIGTERM in the middle of a payment with the provider running separately, and read the start-up code. | ARC-05, ARC-04, OPS-02 |
| Settings and environments | Problems found | Searched the code for every setting, compared with `run.mjs` and the README, and started the app with a wrong payment address and no secrets. | ARC-10, SEC-05 |
| Unexpected input | Problems found | Sent malformed JSON, a bad Host header, a 20 MB body, a missing address, a tampered price and a broken token to the local copy. | ARC-06, ARC-09, SEC-06, PERF-03 |
| What runs out first | Problems found | Two staged load tests up to twice the target while sampling CPU and memory; read the database pool and request limits. | PERF-01, PERF-02, PERF-03 |
| Data that can become wrong | Problems found | Checked each business rule for where it is enforced (database, transaction or code) and broke each one with a direct request. | ARC-03, ARC-01, ARC-02, ARC-09 |
| Time and dates | Problems found | Looked for the opening time on the server and in the page, tried to set it (`POST /api/admin/sale`), bought outside any window, and checked how order times are stored. | ARC-08 |
| Background jobs and queues | Problems found | Looked for jobs, queues and schedulers: there are none. The work that needs one (sending emails, settling unknown payments, reconciling charges with orders) runs inside the request or not at all. | ARC-11, ARC-04 |

The 18 hidden problems, most serious first:

- ARC-01 (Critical) It sells far more pairs than exist when many people buy at once
- ARC-02 (Critical) One pair per customer is not enforced: double clicks and repeat purchases charge again
- ARC-04 (Critical) A crash or deploy during payment leaves customers charged with no order
- ARC-05 (Critical) Every restart deletes all orders and puts the 100 pairs back on sale
- SEC-05 (Critical) A payment key named like a live key is written in the code and in the git history
- ARC-06 (Critical) One malformed request takes the whole site down
- ARC-03 (Critical) Customers set their own price
- ARC-07 (High) When the payment provider is slow, shoppers wait up to 30 seconds and then get an error
- ARC-12 (High) No real payment provider is connected or tested
- OPS-02 (High) A deploy or restart cuts off purchases in progress
- PERF-01 (High) The sale page slows to 2 to 8 seconds at half the expected crowd
- ARC-08 (High) Nothing stops people buying before midnight, and the sale cannot be paused
- ARC-10 (Medium) Settings are written in the code or ignored, and the app starts with wrong ones
- ARC-09 (Medium) Orders can be paid without a shipping address
- SEC-06 (Medium) Error pages show the code's internals
- PERF-03 (Medium) No limits on request size or waiting time
- PERF-02 (Medium) Past its limit the site makes everyone wait instead of turning some people away politely
- ARC-11 (Medium) The confirmation email is sent while the shopper waits

**Conclusion.** The review looked in all 9 places where hidden problems usually sit. It found 18 problems there.

## 4. Recommendations

### What has to happen

| # | What has to happen | Who | How big | When |
|---|---|---|---|---|
| 1 | **Blocker:** Make the purchase safe: the price comes from the server, stock is reserved atomically before charging, one pair per customer is enforced in the database, every purchase carries one idempotency key, a time-out leaves the order pending, and a job settles and reconciles payments. (ARC-01, ARC-02, ARC-03, ARC-04, ARC-07) | Developer | L (about 1 to 2 weeks) | Before delivery |
| 2 | **Blocker:** Close access: a real sign-in with signed sessions, an ownership check on every order, admin routes removed or behind an admin role, and the search route fixed or removed. (SEC-01, SEC-02, SEC-03, SEC-04) | Developer | M (2 to 4 days) | Before delivery |
| 3 | **Blocker:** Rotate the payment key that is written in the code, move it to a secret setting and remove it from the history. (SEC-05) | Developer, with whoever owns the payment provider account | S (hours) | Before delivery |
| 4 | **Blocker:** Keep orders safe across crashes and deploys: a persistent database with backups and migrations, no deletion at start-up, error handling that answers 400 instead of crashing, and a graceful shutdown. (ARC-05, ARC-06, OPS-02) | Developer, with the hosting provider | M to L (about 1 week) | Before delivery |
| 5 | **Blocker:** Connect the real payment provider and try a purchase, a decline and a refund in its test mode, then one small live purchase and refund. (ARC-12) | Developer, with the product owner (choice of provider) | L (about 1 week) | Before delivery |
| 6 | **Blocker:** Add the sale opening time (date, time and time zone) and a pause switch on the server. (ARC-08) | Developer | M (1 to 2 days) | Before delivery |
| 7 | **Blocker:** Make the page hold the expected crowd and keep bots out: one query per page view with a short cache, a waiting room or busy page, and limits on sign-ins and purchases; then pass the load and race tests on a staging copy. (PERF-01, SEC-08) | Developer, with the hosting provider | M (3 to 5 days) | Before delivery |
| 8 | **Blocker:** Prepare to run the sale: health checks, error tracking and alerts to a named person, clean logs, backups and a rollback that have been tried, and a rehearsed launch runbook. (OPS-01, OPS-03) | Developer, with the hosting provider and the product owner | M (2 to 4 days) | Before delivery |
| 9 | **Condition:** Show plain error messages instead of the code's internals, add security headers and drop the open CORS header. (SEC-06, SEC-07) | Developer | S | Before delivery |
| 10 | **Condition:** Check every field of a purchase on the server, including a required shipping address. (ARC-09) | Developer | S | Before delivery |
| 11 | **Condition:** Read every setting in one place, refuse to start with missing or test values, and list them in the README. (ARC-10, R-04) | Developer | S | Before delivery |
| 12 | **Condition:** Send the confirmation email from a background worker, and set request size and time limits. (ARC-11, PERF-02, PERF-03) | Developer | M | Before delivery |
| 13 | **Condition:** Add the agent instruction file, CI that runs the tests and scans on every change, and the missing tests (malformed requests, restarts, admin access, repeat purchase, sign-in box hidden, race test). (HAR-01, HAR-02, HAR-03) | Developer | M | Before delivery |
| 14 | **Condition:** Close bugs only with a fix and a test; give every open ticket a severity, owner and due date. (HIS-01, Q-07) | Product owner, with the developer | S | Before delivery |
| 15 | **Condition:** Set up a staging copy, write down the missing requirements and who agreed them, record the approval of the acceptance criteria, and hand in the review pack. (R-03, R-06, R-07, U-01) | Architect (author), with the product owner | M | Before the re-inspection |
| 16 | **Condition:** Book an independent penetration test, arrange on-call cover and a way to tell customers about problems during the sale. (S-15, O-10) | Product owner | S | Before the sale |
| 17 | **Condition:** Fix the sign-in box that stays on screen. (HIS-02) | Developer | S | After launch is acceptable |

### Strengthen the test harness

So the problems that came back can't come back again unnoticed. Most needed first:

1. **Add integration tests.** Would catch: Customers charged twice for one purchase; More sold than in stock, and more than one pair per customer; Customers charged but no order recorded; The server trusts the browser: someone else's data, the price, admin functions; Errors crash the site or show the code to visitors; Slow pages and long waits under load or with a slow payment provider. Integration tests catch parts that work alone but not together: database rules and transactions, a stand-in payment provider that is slow or fails. Skills and tools: test-driven-development.
2. **Add load and race tests.** Would catch: Customers charged twice for one purchase; More sold than in stock, and more than one pair per customer; Customers charged but no order recorded; Slow pages and long waits under load or with a slow payment provider. Load and race tests catch slow pages, overselling and double charges when many people arrive at once. Skills and tools: peak-traffic-test.
3. **Add automatic scans.** Would catch: More sold than in stock, and more than one pair per customer; The server trusts the browser: someone else's data, the price, admin functions; Errors crash the site or show the code to visitors. Automatic scans catch leaked keys, risky code patterns, libraries with known security holes. Skills and tools: launch-review.
4. **Run the end-to-end tests in a browser on every change (CI), and extend them.** Would catch: Customers charged twice for one purchase; The server trusts the browser: someone else's data, the price, admin functions; Sign-in box does not go away after signing in. End-to-end tests in a browser catch a user journey that breaks: signing in, buying, seeing the order. Skills and tools: acceptance-test, webapp-testing.
5. **Add unit tests.** Would catch: Errors crash the site or show the code to visitors. Unit tests catch a rule or calculation that is wrong: prices, limits, reading input, dates. Skills and tools: test-driven-development.
6. **Add visual tests.** Would catch: Sign-in box does not go away after signing in. Visual tests catch a screen that looks wrong although it works: something that should disappear stays, things overlap, a layout breaks on a phone. Skills and tools: acceptance-test, webapp-testing, Playwright screenshot comparison.
7. **Add self-checks.** Would catch: Customers charged but no order recorded. Self-checks catch the app checking itself: refusing to start with missing or unsafe settings, a health check that tests what matters, a quick test after every deploy. Skills and tools: verification-before-completion.

### Complete the performance tests

Run these tests:

- **Long run.** An hour or more at normal traffic without slowing down, filling up or running out of memory.
- **On a production-like setup.** The numbers hold on the real hosting, with a realistic amount of data, not only on a laptop.

### Skills and tools the team can use

Install them in Claude Code so the AI agents that write the code also write and run these tests.

| Skill or tool | From | Helps build | What it does |
|---|---|---|---|
| `acceptance-test` | this repository | end-to-end tests in a browser, visual tests | Turns what the owner expects into numbered criteria and browser tests with screenshots, run three times each; add Playwright screenshot comparisons for visual checks. |
| `peak-traffic-test` | this repository | load and race tests | Turns the expected crowd into a load plan, runs staged load tests and the race test, and explains the result in plain words. |
| `launch-review` | this repository | automatic scans | Runs the scanners and this inspection; its scanner script can run on every change in CI. |
| [webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) | Anthropic skills | end-to-end tests in a browser, visual tests | Lets an AI agent drive a local web app in a real browser with Playwright: check behaviour, take screenshots, read the browser log. |
| [test-driven-development](https://github.com/obra/superpowers) | Superpowers (obra/superpowers) | unit tests, integration tests | Makes the AI agent write a failing test before each fix or feature, so every bug fixed gets the test that stops it coming back. |
| [systematic-debugging](https://github.com/obra/superpowers) | Superpowers (obra/superpowers) | — | Makes the AI agent find the root cause of a bug before changing code, instead of patching the symptom. |
| [verification-before-completion](https://github.com/obra/superpowers) | Superpowers (obra/superpowers) | self-checks | Makes the AI agent prove a fix works (run the test, show the output) before it says the work is done. |
| [Playwright screenshot comparison](https://playwright.dev/docs/test-snapshots) | Playwright (toHaveScreenshot) | visual tests | Compares each screen with an approved picture and fails when it changes; the usual way to add visual tests to browser tests. |

### Decisions only the owner can make

- Choose the payment provider, the email provider and the hosting (with a staging copy).
- Set the sale date, the time zone of "midnight", and whether a virtual waiting room (a paid service) is worth it for a 100-pair drop.
- Agree how much order data may be lost and how quickly the shop must be back after an outage.
- Decide how long customers' email and home addresses are kept after the sale.
- Confirm whether AI coding assistants are used on this code; if not, the agent-instruction checks no longer apply.

## 5. Limits: what was not checked

- Production-like hosting, HTTPS, a real database and more than one app instance: none exists yet, so every measurement comes from a local copy with simulated database delay.
- The real payment and email providers (not chosen): their limits, declines, card checks, refunds and notifications.
- A one-hour run at normal traffic.
- Backups, monitoring, alerting and on-call arrangements, which do not exist yet or were not shared.
- Pull-request reviews on the code host, and the earlier launch review mentioned in `acceptance/criteria.md` (neither shared).
- Legal and privacy obligations (privacy notice, consent, data retention): flagged, not assessed.
- Accessibility of the signed-in state and of error messages (the axe check ran on the sale page as first loaded).
- Whether the issue export is complete: only the 16 tickets in `handover/issues.json` were seen.

An inspection lowers the risk; it does not prove there are no problems.

## Appendix A. Every open problem

### SEC-01 · Critical · Confirmed: Anyone can read any customer's order, including their home address

- **Impact:** Anyone can collect every buyer's email address and home address by trying order numbers 1, 2, 3 and so on.
- **Where:** `app/server.mjs:120-124` (`GET /api/orders/:id`): no sign-in or ownership check. **Evidence:** With no token, `curl -s localhost:3310/api/orders/1` returned Alice's email, address and amount with HTTP 200 (`evidence/probes-access.txt`, step 1). Acceptance test AC-06 failed in all three runs: Bob and a logged-out visitor both got HTTP 200. **Tickets:** #8.
- **Evidence:** With no token, `curl -s localhost:3310/api/orders/1` returned Alice's email, address and amount with HTTP 200 (`evidence/probes-access.txt`, step 1). Acceptance test AC-06 failed in all three runs: Bob and a logged-out visitor both got HTTP 200.
- **Fix:** Require a signed-in customer and look the order up by id and customer together (`WHERE id = ? AND customer = ?`); answer 404 otherwise.
- **Done when:** AC-06 passes three runs in a row, and the request in `evidence/probes-access.txt` step 1 answers 401 or 404.
- **Who:** Developer
- **Status:** Open

### SEC-02 · Critical · Confirmed: Anyone can act as any customer: the sign-in "token" is just the email address, unsigned

- **Impact:** Anyone who knows or guesses a customer's email address can see their orders and address, or buy in their name. There is no password, email link or code.
- **Where:** `app/server.mjs:79-83` (`POST /api/login` returns base64 of whatever email it is given) and `app/server.mjs:42-47` (`currentUser` decodes the token without checking a signature); `TOKEN_SECRET` (`run.mjs:21`) is never read. **Evidence:** A token made by hand (`printf '{"email":"alice@example.test"}' | base64`), without signing in, returned Alice's orders from `GET /api/my-orders` (`evidence/probes-access.txt`, step 2). Semgrep `unverified-token-decode` at `app/server.mjs:46`.
- **Evidence:** A token made by hand (`printf '{"email":"alice@example.test"}' | base64`), without signing in, returned Alice's orders from `GET /api/my-orders` (`evidence/probes-access.txt`, step 2). Semgrep `unverified-token-decode` at `app/server.mjs:46`.
- **Fix:** Use a proven sign-in method (an email link or one-time code from an auth provider, or a hosted auth service) and signed, expiring session tokens whose secret comes from the environment; verify the token on every request.
- **Done when:** A hand-made or edited token gets 401 from `/api/my-orders` and `/api/buy`, and an automated test proves it.
- **Who:** Developer
- **Status:** Open

### SEC-03 · Critical · Confirmed: Admin functions are open to everyone: one request deletes every order

- **Impact:** Anyone on the internet can delete all orders and set the stock to any number in the middle of the sale, and anyone can read the sales figures.
- **Where:** `app/server.mjs:132-137` (`POST /api/admin/reset`) and `app/server.mjs:139-150` (`GET /api/admin/stats`) check nothing; the `x-admin-token` header the tests send is ignored and `ADMIN_TOKEN` (`run.mjs:22`) is never read. **Evidence:** Without any token, `POST /api/admin/reset` answered `{"ok":true}` and Alice's orders went from 3 to none; `GET /api/admin/stats` answered HTTP 200 with sales and payment totals (`evidence/probes-access.txt`, steps 7 and 10). **Tickets:** #16.
- **Evidence:** Without any token, `POST /api/admin/reset` answered `{"ok":true}` and Alice's orders went from 3 to none; `GET /api/admin/stats` answered HTTP 200 with sales and payment totals (`evidence/probes-access.txt`, steps 7 and 10).
- **Fix:** Remove the reset route from anything that faces the internet (test builds only, behind a setting production refuses); put the stats behind an admin role with personal accounts.
- **Done when:** Both routes answer 401 or 404 without an admin session, checked by an automated test that calls them with no credentials.
- **Who:** Developer
- **Status:** Open

### SEC-04 · Critical · Confirmed: The search address hands out every customer's email and address (SQL injection)

- **Impact:** One crafted search returns every buyer's email and home address, and the same hole could change or delete data.
- **Where:** `app/server.mjs:96-100` (`GET /api/search`): the search text is pasted into the SQL statement. The page never uses this route.. **Evidence:** `q=zzz' UNION SELECT id, customer || ' / ' || address, amount_cents FROM orders --` returned every order's email and address (`evidence/probes-access.txt`, step 8). Semgrep `sql-built-from-strings-js` at `app/server.mjs:98`.
- **Evidence:** `q=zzz' UNION SELECT id, customer || ' / ' || address, amount_cents FROM orders --` returned every order's email and address (`evidence/probes-access.txt`, step 8). Semgrep `sql-built-from-strings-js` at `app/server.mjs:98`.
- **Fix:** Delete the unused route, or pass the search text as a parameter (`WHERE name LIKE ?`).
- **Done when:** The request in step 8 returns an empty list or 400, and Semgrep `sql-built-from-strings-js` no longer fires on line 98.
- **Who:** Developer
- **Status:** Open

### SEC-05 · Critical · Confirmed: A payment key named like a live key is written in the code and in the git history

- **Impact:** Anyone who gets a copy of the code (contractors, the client's staff, a leaked backup) could charge or refund through the shop's payment account. Every copy of the app uses the same key.
- **Where:** `app/server.mjs:10` (`PAYMENT_SECRET_KEY = 'pay_…'`, redacted), committed in `bb6c41e`; the `PAYMENT_SECRET_KEY` setting in `run.mjs:20` is ignored. **Evidence:** Gitleaks rule `generic-api-key` fired on `app/server.mjs:10` in the current files and in the git history (`scans/gitleaks-files.json`, `scans/gitleaks-history.json`).
- **Evidence:** Gitleaks rule `generic-api-key` fired on `app/server.mjs:10` in the current files and in the git history (`scans/gitleaks-files.json`, `scans/gitleaks-history.json`).
- **Fix:** Rotate the key at the payment provider now. Read it from a secret setting, refuse to start without it, keep test and live keys apart, and remove it from the history before the repository is handed over.
- **Done when:** The old key is revoked at the provider, Gitleaks finds nothing in the files, and the app refuses to start without `PAYMENT_SECRET_KEY`.
- **Who:** Developer, with whoever owns the payment provider account
- **Status:** Open

### ARC-01 · Critical · Confirmed: It sells far more pairs than exist when many people buy at once

- **Impact:** In the race test, 1,957 purchases were confirmed and charged for 100 pairs: 1,857 customers would pay for sneakers that do not exist.
- **Where:** `app/server.mjs:107-111`: reads the stock, charges the card, then writes `stock = <the number read earlier> - 1`; nothing in the database stops the stock going below zero. **Evidence:** Race test, two runs: 1,957 and 1,956 orders for 100 pairs, stock counter left at 93 (`peak-traffic/oversell1/oversell-summary.md`, `peak-traffic/oversell2/oversell-summary.md`). Load run 1 ended with 2,939 paid orders for 100 pairs (`peak-traffic/run1/stats-after.txt`). Semgrep `stock-lost-update-sql` at line 111. **Tickets:** #4.
- **Evidence:** Race test, two runs: 1,957 and 1,956 orders for 100 pairs, stock counter left at 93 (`peak-traffic/oversell1/oversell-summary.md`, `peak-traffic/oversell2/oversell-summary.md`). Load run 1 ended with 2,939 paid orders for 100 pairs (`peak-traffic/run1/stats-after.txt`). Semgrep `stock-lost-update-sql` at line 111.
- **Fix:** Reserve first with one atomic update (`UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0`, and check that one row changed), then charge, then confirm; give the pair back only when the payment definitely failed; add `CHECK (stock >= 0)`.
- **Done when:** The race test with the same plan shows at most 100 sold, and sold + awaiting payment + remaining = 100.
- **Who:** Developer
- **Status:** Open

### ARC-02 · Critical · Confirmed: One pair per customer is not enforced: double clicks and repeat purchases charge again

- **Impact:** A shopper who double-clicks, reloads or presses Buy again pays again for another pair, and one person can buy as many pairs as they like.
- **Where:** `app/server.mjs:102-118` (no check for an existing order, no unique rule on `orders`) and `app/server.mjs:49-57` (no idempotency key sent to the payment provider). **Evidence:** Two clicks at the same moment gave Dave 2 orders and 2 charges; Alice bought 3 pairs (`evidence/probes-access.txt`, steps 5 and 6). AC-04 failed in all three runs (2 orders after a double-click). Race test: 957 buyers charged twice (`peak-traffic/oversell1`). **Tickets:** #1, #2, #3.
- **Evidence:** Two clicks at the same moment gave Dave 2 orders and 2 charges; Alice bought 3 pairs (`evidence/probes-access.txt`, steps 5 and 6). AC-04 failed in all three runs (2 orders after a double-click). Race test: 957 buyers charged twice (`peak-traffic/oversell1`).
- **Fix:** Enforce one live order per customer and product in the database (a unique index). Give each purchase attempt an id from the page, reuse it on retries, store it with the order and pass it to the provider as `Idempotency-Key`; answer a repeat with the existing order.
- **Done when:** AC-04 passes three runs in a row, and the race test shows no buyer charged twice.
- **Who:** Developer
- **Status:** Open

### ARC-03 · Critical · Confirmed: Customers set their own price

- **Impact:** Anyone can buy the $49.99 sneakers for one cent by editing the request.
- **Where:** `app/server.mjs:105`, `:110`, `:114`: the `price` sent by the browser is charged and stored; the page sends it at `shared/public/app.js:121`. **Evidence:** Bob's purchase with `"price":1` was confirmed as `amountCents: 1` and the provider charged one cent (`evidence/probes-access.txt`, step 3; provider total 29,995 cents = 6 × 4,999 + 1). AC-03 failed in all three runs. Semgrep `price-from-client` at line 105. **Tickets:** #9.
- **Evidence:** Bob's purchase with `"price":1` was confirmed as `amountCents: 1` and the provider charged one cent (`evidence/probes-access.txt`, step 3; provider total 29,995 cents = 6 × 4,999 + 1). AC-03 failed in all three runs. Semgrep `price-from-client` at line 105.
- **Fix:** Take the price from the product record on the server and ignore any price from the browser (or refuse a request whose price differs).
- **Done when:** AC-03 passes three runs in a row.
- **Who:** Developer
- **Status:** Open

### ARC-04 · Critical · Confirmed: A crash or deploy during payment leaves customers charged with no order

- **Impact:** Customers pay and get nothing, and the shop has no record that they paid; it finds out only when they complain.
- **Where:** `app/server.mjs:110-115`: the card is charged first, and only then are the stock and the order written; nothing records the attempt before the charge, and nothing compares the provider's charges with the orders. **Evidence:** With the payment provider running on its own and answering in 3 seconds, one malformed request (a crash) and a SIGTERM (a deploy), each sent 1 second into a purchase: the provider recorded the charge and the app had no order (`evidence/probes-charged-no-order.txt`, parts D and E). **Tickets:** #7, #10.
- **Evidence:** With the payment provider running on its own and answering in 3 seconds, one malformed request (a crash) and a SIGTERM (a deploy), each sent 1 second into a purchase: the provider recorded the charge and the app had no order (`evidence/probes-charged-no-order.txt`, parts D and E).
- **Fix:** Record a pending order (with the reserved pair and the idempotency key) before charging, and mark it paid or failed afterwards. A background job settles pending orders with the provider and compares the provider's charges with the orders, raising an alert on any difference.
- **Done when:** Both reproductions end with a paid or refunded order for every provider charge, and a reconciliation run reports no differences.
- **Who:** Developer
- **Status:** Open

### ARC-05 · Critical · Confirmed: Every restart deletes all orders and puts the 100 pairs back on sale

- **Impact:** A crash, a deploy or a host restart during the sale erases every paid order (who bought and where to ship) and lets another 100 pairs be sold.
- **Where:** `app/server.mjs:13` (`openDb()` opens an in-memory database) and `app/server.mjs:14-27` (`CREATE TABLE` and `seed()`, which runs `DELETE FROM orders`, on every start). **Evidence:** One paid order before a restart, none after it, and the stock back at 100 (`evidence/probes-restarts.txt`, part C). **Tickets:** #7.
- **Evidence:** One paid order before a restart, none after it, and the stock back at 100 (`evidence/probes-restarts.txt`, part C).
- **Fix:** Use a persistent database (managed Postgres, or a SQLite file on a persistent disk) with automatic backups; create tables through versioned migrations; seed demo data only in tests and never delete data at start-up.
- **Done when:** An order placed before a restart is still there after it, start-up code contains no `DELETE`, and a backup has been restored once.
- **Who:** Developer, with the hosting provider
- **Status:** Open

### ARC-06 · Critical · Confirmed: One malformed request takes the whole site down

- **Impact:** Anyone, or one buggy browser, can stop the sale for everyone with a single request, as often as they like.
- **Where:** `app/server.mjs:34-40` (`JSON.parse` inside the request's end callback, outside any error handling) and `app/server.mjs:166` (the address is parsed from the `Host` header outside the error handling); `run.mjs:38-43` then stops the payment provider too, and nothing restarts either. **Evidence:** A body of `{not json` sent to `/api/login`, and a request with `Host: bad host`, each made the server exit with code 1; the site stopped answering (`evidence/probes-restarts.txt`, parts A and B). Semgrep `json-parse-in-stream-callback` (line 38) and `url-parse-outside-try` (line 166). **Tickets:** #5, #6.
- **Evidence:** A body of `{not json` sent to `/api/login`, and a request with `Host: bad host`, each made the server exit with code 1; the site stopped answering (`evidence/probes-restarts.txt`, parts A and B). Semgrep `json-parse-in-stream-callback` (line 38) and `url-parse-outside-try` (line 166).
- **Fix:** Parse bodies inside error handling and answer 400; build the URL inside the error handling (or answer 400 on a bad `Host`); limit body size; run the app under a supervisor that restarts it.
- **Done when:** Both requests get 400 and the site keeps answering, checked by an automated test.
- **Who:** Developer
- **Status:** Open

### SEC-08 · High · Confirmed: Nothing slows down scripts: bots can sign in and buy as fast as they like

- **Impact:** In a sneaker drop, scripts buy faster than people. With no limits and no bot protection, resellers can take the stock before real customers finish loading the page.
- **Where:** `app/server.mjs:79-118`: no rate limit or bot check on `POST /api/login` or `POST /api/buy`. **Evidence:** 60 sign-ins in a row from one address all answered 200 (`evidence/probes-access.txt`, step 12); 1,000 scripted buyers placed 1,957 orders in the race test (`peak-traffic/oversell1/oversell-summary.md`).
- **Evidence:** 60 sign-ins in a row from one address all answered 200 (`evidence/probes-access.txt`, step 12); 1,000 scripted buyers placed 1,957 orders in the race test (`peak-traffic/oversell1/oversell-summary.md`).
- **Fix:** Limit sign-ins and purchases per account and per address in a shared store, and put bot protection or a virtual waiting room in front of the sale.
- **Done when:** The 60-request burst gets 429 after the limit, and a waiting room or bot check sits in front of checkout during the sale.
- **Who:** Developer, with the hosting provider for edge protection
- **Status:** Open

### ARC-07 · High · Confirmed: When the payment provider is slow, shoppers wait up to 30 seconds and then get an error

- **Impact:** When the provider slows down at midnight, the Buy button spins for up to 30 seconds and then shows technical text; shoppers try again and may pay twice. There is no "we are confirming your payment" state.
- **Where:** `app/server.mjs:49-57`: the call to the provider has no time limit and no idempotency key, and any answer other than success becomes a 500 error. **Evidence:** Provider stuck for 30 s: the shopper got HTTP 500 with a stack trace after 30.0 s (`evidence/probes-charged-no-order.txt`, part G). Provider at 8 s: the purchase took 8.3 s (`evidence/probes-restarts.txt`, part F). AC-08 failed in all three runs (page stuck on "Placing your order…"). Slow-partner race test (3 to 10 s per charge): 400 charges for 400 clicks by 200 buyers (`peak-traffic/slow-partner/`). Semgrep `fetch-without-timeout` at lines 50, 135, 142. **Tickets:** #12.
- **Evidence:** Provider stuck for 30 s: the shopper got HTTP 500 with a stack trace after 30.0 s (`evidence/probes-charged-no-order.txt`, part G). Provider at 8 s: the purchase took 8.3 s (`evidence/probes-restarts.txt`, part F). AC-08 failed in all three runs (page stuck on "Placing your order…"). Slow-partner race test (3 to 10 s per charge): 400 charges for 400 clicks by 200 buyers (`peak-traffic/slow-partner/`). Semgrep `fetch-without-timeout` at lines 50, 135, 142.
- **Fix:** Give the call a time limit (2 to 5 seconds). On a time-out keep the order pending (not failed), answer "we are confirming your payment", settle it with the provider's lookup or webhook, and reuse one idempotency key per purchase attempt.
- **Done when:** AC-08 passes three runs in a row, and the slow-partner test shows provider charges equal to paid orders with no buyer charged twice.
- **Who:** Developer
- **Status:** Open

### ARC-08 · High · Confirmed: Nothing stops people buying before midnight, and the sale cannot be paused

- **Impact:** Anyone who finds the page before midnight (resellers watch for it) can buy the stock before the email goes out. If something goes wrong during the sale, the only way to stop it is to shut the site down, which today deletes every order.
- **Where:** `app/server.mjs` has no opening time, no pause switch and no `/api/admin/sale` route; the page's opening-time logic (`shared/public/app.js:44-60`) waits for a `sale` field the server never sends. **Evidence:** AC-12 and AC-13 failed in all three runs at their first step: `POST /api/admin/sale` answered 404; `GET /api/products/1` has no `sale` field; purchases succeed at any time (`evidence/probes-access.txt`, step 11).
- **Evidence:** AC-12 and AC-13 failed in all three runs at their first step: `POST /api/admin/sale` answered 404; `GET /api/products/1` has no `sale` field; purchases succeed at any time (`evidence/probes-access.txt`, step 11).
- **Fix:** Add a sale window on the server: the opening time as a full date, time and time zone from one setting, logged at start-up and sent to the page, and a pause switch that needs no deploy. `POST /api/buy` refuses (403) before opening and while paused.
- **Done when:** AC-12 and AC-13 pass three runs in a row.
- **Who:** Developer, with the product owner for the date and time zone
- **Status:** Open

### ARC-12 · High · Confirmed: No real payment provider is connected or tested

- **Impact:** As delivered, the shop cannot take real money, and the real provider's behaviour (declines, card checks, refunds, limits, notifications) has never been tried.
- **Where:** `app/server.mjs:49-57` calls only the local simulator's `/charge`; the README says payments and email are simulators. **Evidence:** The code and the README; no provider library, webhook route or refund path exists.
- **Evidence:** The code and the README; no provider library, webhook route or refund path exists.
- **Fix:** Choose the provider, connect its hosted checkout or payment API with amounts set on the server and idempotency keys, verify its notifications, and try a purchase, a decline and a refund in its test mode, then one small real purchase and refund before launch.
- **Done when:** The provider's test-mode records of a purchase, a decline and a refund match the app's orders, and one small live purchase and refund are done before launch.
- **Who:** Developer, with the product owner (choice of provider)
- **Status:** Open

### PERF-01 · High · Confirmed: The sale page slows to 2 to 8 seconds at half the expected crowd

- **Impact:** At midnight shoppers wait 2 to 8 seconds for the page, and the server manages only about half of the page views it is asked for, so many people see "We are very busy. Retrying…".
- **Where:** `app/server.mjs:85-94` (`GET /api/products/:id`: one query for the product, one for the reviews, then one per review author, so 14 per page view), no caching, and a pool of 10 database connections that waits forever. **Evidence:** Two load runs (`peak-traffic/run1/load-summary.md`, `peak-traffic/run2/load-summary.md`): product page 95th percentile 2.38 s and 2.35 s at 50% of the target (budget 500 ms), 5.07 to 5.20 s at 100%, 7.69 to 8.14 s at 200%; it served 205 to 237 page views per second against a target of 450. Semgrep `db-query-in-loop-js` at line 90. **Tickets:** #11.
- **Evidence:** Two load runs (`peak-traffic/run1/load-summary.md`, `peak-traffic/run2/load-summary.md`): product page 95th percentile 2.38 s and 2.35 s at 50% of the target (budget 500 ms), 5.07 to 5.20 s at 100%, 7.69 to 8.14 s at 200%; it served 205 to 237 page views per second against a target of 450. Semgrep `db-query-in-loop-js` at line 90.
- **Fix:** Read the reviews with their authors in one query (a JOIN); cache the product answer for 1 to 2 seconds (the stock on the page may lag; the purchase stays exact); serve the page files from a CDN.
- **Done when:** The same load plan passes at 100% and 150% of the target (product page under 500 ms for 95% of requests, under 1% errors).
- **Who:** Developer
- **Status:** Open

### OPS-01 · High · Confirmed: Nobody would notice problems: no health check, monitoring or alerts, and the logs hold customers' email addresses

- **Impact:** During the sale, crashes, slow pages and payment failures would be discovered by customers, not by the team, and the logs would hold personal data.
- **Where:** No health route (`GET /health` answers 404), no error tracking, metrics or alerts anywhere in the repository; `app/server.mjs:62` logs customer email addresses; `app/server.mjs:172` logs raw errors; no request id. **Evidence:** `GET /health` answered 404 (`evidence/probes-access.txt`, step 11); no monitoring or alerting code or configuration in the 15 files of commit `bb6c41e`.
- **Evidence:** `GET /health` answered 404 (`evidence/probes-access.txt`, step 11); no monitoring or alerting code or configuration in the 15 files of commit `bb6c41e`.
- **Fix:** Add a liveness check and a readiness check (database and payment provider), error tracking, dashboards for requests, errors and response times, and alerts that reach a named on-call person; write structured logs with a request id and no personal data.
- **Done when:** A test alert reaches the on-call person, both health checks answer, and a log line from a purchase carries a request id and no email address.
- **Who:** Developer, with the hosting provider
- **Status:** Open

### OPS-02 · High · Confirmed: A deploy or restart cuts off purchases in progress

- **Impact:** Every deploy during the sale cuts off shoppers who are paying: they are charged, get no answer and have no order (see ARC-04).
- **Where:** `app/server.mjs` does not handle SIGTERM (no `server.close()`), and `run.mjs:35-37` passes SIGTERM straight on. **Evidence:** SIGTERM sent 1 second into a 3-second payment: the app exited at once (code 143), the shopper got no answer, the provider recorded the charge and no order existed (`evidence/probes-charged-no-order.txt`, part E).
- **Evidence:** SIGTERM sent 1 second into a 3-second payment: the app exited at once (code 143), the shopper got no answer, the provider recorded the charge and no order existed (`evidence/probes-charged-no-order.txt`, part E).
- **Fix:** On SIGTERM stop taking new requests, finish those in progress (allowing longer than the payment time limit), then exit; deploy one instance at a time behind a health check.
- **Done when:** A restart under load drops no requests, and every provider charge has an order.
- **Who:** Developer
- **Status:** Open

### OPS-03 · High · Confirmed: No backups, rollback plan, runbook or launch-day plan

- **Impact:** If anything goes wrong at midnight nobody knows what to do, and there is nothing to restore the orders from.
- **Where:** The repository and the hand-over: no hosting chosen, no deploy or rollback configuration, no backups (the database lives in memory), no runbook. **Evidence:** The 15 files of commit `bb6c41e` and the README: none covers deploys, backups, rollback or incidents.
- **Evidence:** The 15 files of commit `bb6c41e` and the README: none covers deploys, backups, rollback or incidents.
- **Fix:** Choose hosting; turn on automatic backups and try a restore; tag releases and try a rollback on a staging copy; write a one-page launch and incident runbook (pause the sale, roll back, rotate a key, who to call) and rehearse it once.
- **Done when:** A restore log, a rollback log and a runbook rehearsal log from the staging copy exist.
- **Who:** Developer, with the hosting provider and the product owner
- **Status:** Open

### SEC-06 · Medium · Confirmed: Error pages show the code's internals

- **Impact:** Shoppers see a wall of technical text with file names and line numbers instead of a clear message, and attackers learn how the server is built.
- **Where:** `app/server.mjs:171-175` sends `err.stack` to the visitor. **Evidence:** A token that is not valid returned a `SyntaxError` with file paths (`evidence/probes-access.txt`, step 9); a stuck payment returned "Error: Payment failed with status 504 at chargeCard (./app/server.mjs:55:22)" (`evidence/probes-charged-no-order.txt`, part G). Semgrep `stack-trace-to-client` at line 174. **Tickets:** #15.
- **Evidence:** A token that is not valid returned a `SyntaxError` with file paths (`evidence/probes-access.txt`, step 9); a stuck payment returned "Error: Payment failed with status 504 at chargeCard (./app/server.mjs:55:22)" (`evidence/probes-charged-no-order.txt`, part G). Semgrep `stack-trace-to-client` at line 174.
- **Fix:** Log the error with a request id and send a plain message (`{"error":"Something went wrong","requestId":…}`).
- **Who:** Developer
- **Status:** Open

### SEC-07 · Medium · Confirmed: No security headers, and any website may call the shop from a visitor's browser

- **Impact:** Weaker protection against injected scripts and against other sites framing the shop page.
- **Where:** `app/server.mjs:29-32` (`access-control-allow-origin: *` on every API answer) and `app/server.mjs:66-77` (pages without security headers). **Evidence:** Header check on the local copy: Content-Security-Policy, X-Content-Type-Options and frame protection missing; CORS `*` on the API (`scans/headers.json`, `scans/headers-api.json`). Semgrep `cors-wildcard` at line 30.
- **Evidence:** Header check on the local copy: Content-Security-Policy, X-Content-Type-Options and frame protection missing; CORS `*` on the API (`scans/headers.json`, `scans/headers-api.json`). Semgrep `cors-wildcard` at line 30.
- **Fix:** Add Content-Security-Policy, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, Referrer-Policy and HSTS (at the host); drop the CORS header, since the page calls its own server.
- **Who:** Developer
- **Status:** Open

### ARC-09 · Medium · Confirmed: Orders can be paid without a shipping address

- **Impact:** Paid orders that cannot be shipped; support has to contact and refund those customers.
- **Where:** `app/server.mjs:105` and `:114` (`address ?? ''`); no check on the address, the product id or the price type. **Evidence:** Carol's purchase without an address was confirmed (`evidence/probes-access.txt`, step 4). AC-11 failed in all three runs (HTTP 200 instead of 400).
- **Evidence:** Carol's purchase without an address was confirmed (`evidence/probes-access.txt`, step 4). AC-11 failed in all three runs (HTTP 200 instead of 400).
- **Fix:** Check every field on the server (address required with a sensible length, product id an existing number) and answer 400 when one is wrong.
- **Who:** Developer
- **Status:** Open

### ARC-10 · Medium · Confirmed: Settings are written in the code or ignored, and the app starts with wrong ones

- **Impact:** The team may believe it can switch off test routes and demo data and set secrets for production; none of those switches exist. A wrong payment address is noticed only when the first customer pays.
- **Where:** `app/server.mjs:8-10` reads only `PORT` and `PAYMENT_URL`; `run.mjs:17-25` also sets `PAYMENT_SECRET_KEY`, `TOKEN_SECRET`, `ADMIN_TOKEN`, `DEMO_LOGIN`, `ENABLE_TEST_ROUTES` and `SEED_DEMO_DATA`, which the app never reads. The README says the app reads its other settings from the environment.. **Evidence:** Started with `PAYMENT_URL=http://127.0.0.1:1`: the server started normally and the first purchase failed with HTTP 500 "fetch failed" (`evidence/probes-restarts.txt`, part I). A search for `process.env` in the code (system map).
- **Evidence:** Started with `PAYMENT_URL=http://127.0.0.1:1`: the server started normally and the first purchase failed with HTTP 500 "fetch failed" (`evidence/probes-restarts.txt`, part I). A search for `process.env` in the code (system map).
- **Fix:** Read every setting in one place, check them at start-up and refuse to start in production with missing, placeholder or test values; delete the unused ones; list them in the README.
- **Who:** Developer
- **Status:** Open

### ARC-11 · Medium · Confirmed: The confirmation email is sent while the shopper waits

- **Impact:** Every purchase takes a quarter of a second longer, and when the email service is slow or down a paid order answers with an error, so shoppers try again.
- **Where:** `app/server.mjs:116` (`await sendConfirmationEmail(...)` inside `POST /api/buy`), `app/server.mjs:59-63`. **Evidence:** The code; Semgrep `email-in-request-path` at line 116.
- **Evidence:** The code; Semgrep `email-in-request-path` at line 116.
- **Fix:** Write the email to an outbox table together with the order and send it from a background worker that retries.
- **Who:** Developer
- **Status:** Open

### PERF-02 · Medium · Confirmed: Past its limit the site makes everyone wait instead of turning some people away politely

- **Impact:** When more people arrive than it can serve, everyone waits longer (about 8 seconds at twice the target), and thousands of page loads are never served at all, instead of a clear "you are in line" page.
- **Where:** `app/server.mjs:13` opens the database without a time limit for getting a connection; no request time limits; no "busy" answer (429 or 503) or waiting page. **Evidence:** At 200% of the target, 13,385 and 13,404 page requests were never sent because every simulated shopper was stuck waiting, with no 429 or 503 answers (`peak-traffic/run1`, `peak-traffic/run2`).
- **Evidence:** At 200% of the target, 13,385 and 13,404 page requests were never sent because every simulated shopper was stuck waiting, with no 429 or 503 answers (`peak-traffic/run1`, `peak-traffic/run2`).
- **Fix:** Set a time limit for getting a database connection and answer 503 with Retry-After when it runs out; put a virtual waiting room in front of the sale.
- **Who:** Developer, with the hosting provider
- **Status:** Open

### PERF-03 · Medium · Confirmed: No limits on request size or waiting time

- **Impact:** A handful of very large requests can use up the server's memory, and the server is not tuned for whatever load balancer it will sit behind.
- **Where:** `app/server.mjs:34-40` (bodies read with no size limit), `app/server.mjs:165-178` (no request, header or keep-alive time-outs set), `app/server.mjs:66-77` (page files read from disk on every request). **Evidence:** A 20 MB sign-in request was accepted with HTTP 200 (`evidence/probes-restarts.txt`, part H); the app's memory grew from 66 MB to 201 MB during one two-minute load run (`peak-traffic/run1/cpu.csv`). Semgrep `sync-io-in-request-handler` at lines 68, 72, 76.
- **Evidence:** A 20 MB sign-in request was accepted with HTTP 200 (`evidence/probes-restarts.txt`, part H); the app's memory grew from 66 MB to 201 MB during one two-minute load run (`peak-traffic/run1/cpu.csv`). Semgrep `sync-io-in-request-handler` at lines 68, 72, 76.
- **Fix:** Limit request bodies (for example 10 kB, answer 413), set the server's request, header and keep-alive time-outs to fit the host's load balancer, and keep page files in memory or on a CDN.
- **Who:** Developer
- **Status:** Open

### HAR-01 · Medium · Confirmed: AI coding assistants get no project rules

- **Impact:** The next AI-written change will not know the business rules (stock, one per customer, the price comes from the server) or the lessons from the pilot, so the same bugs are likely to come back.
- **Where:** No `AGENTS.md`, `CLAUDE.md` or similar file at the root of the repository. **Evidence:** The repository's file list (commit `bb6c41e`). Assumed: AI assistants wrote or will change the code (see scope).
- **Evidence:** The repository's file list (commit `bb6c41e`). Assumed: AI assistants wrote or will change the code (see scope).
- **Fix:** Add an instruction file: how to run and test, the business rules, where money and secrets are handled, files never edited by hand, and one rule per recurring problem (see Quality history), each pointing at the test that enforces it.
- **Who:** Developer
- **Status:** Open

### HAR-02 · Medium · Confirmed: Delivered with a failing test suite and nothing that runs the tests on each change

- **Impact:** Changes reach the client without anyone running the tests; the failing suite shows the tests were not run before hand-over.
- **Where:** No CI configuration, linter, type checker, secret scan or dependency scan in the repository; the acceptance suite fails on the delivered commit. **Evidence:** `npx playwright test --repeat-each=3` on commit `bb6c41e`: 21 failed, 15 passed (`logs/acceptance-run.txt`, `acceptance/ACCEPTANCE.md`); no `.github/` or other CI files.
- **Evidence:** `npx playwright test --repeat-each=3` on commit `bb6c41e`: 21 failed, 15 passed (`logs/acceptance-run.txt`, `acceptance/ACCEPTANCE.md`); no `.github/` or other CI files.
- **Fix:** Add CI that runs the acceptance suite, the race test, the Semgrep rules, Gitleaks and OSV-Scanner on every change, and protect the main branch; add a linter and type checks.
- **Who:** Developer
- **Status:** Open

### HAR-03 · Medium · Confirmed: The tests miss failure paths and things that should disappear

- **Impact:** The crash, lost-orders and sign-in-box problems from the pilot would pass the suite again.
- **Where:** `acceptance/tests/flash-sale.spec.mjs`: no test sends a malformed request, restarts the app, calls the admin routes without credentials, or buys twice as the same customer in separate visits; AC-02 and AC-10 do not check that the sign-in box disappears; AC-07 has no test in the repository. **Evidence:** AC-02 passed in all three runs while its own screenshot shows the sign-in box still on screen (`evidence/acceptance/AC-02-test-finished-1.png`).
- **Evidence:** AC-02 passed in all three runs while its own screenshot shows the sign-in box still on screen (`evidence/acceptance/AC-02-test-finished-1.png`).
- **Fix:** Add tests: a malformed body and a bad Host answer 400 and the site keeps answering; orders survive a restart; admin routes refuse anonymous callers; a second purchase by the same customer is refused; the sign-in form is hidden after sign-in; commit the race test with the traffic brief.
- **Who:** Developer
- **Status:** Open

### HIS-01 · Medium · Confirmed: Tickets were closed without a fix, and the problems came back

- **Impact:** Known bugs reach customers because a ticket is closed when the symptom goes away, not when the cause is fixed and tested.
- **Where:** Issue tracker export `handover/issues.json`: #1 closed "could not reproduce by clicking once", #5 closed "restarted, working again", #13 closed "works for me"; #2, #6 and #14 report the same problems again. Open tickets have no severity, owner or due date.. **Evidence:** `handover/issues.json`; `history/history.md`. **Tickets:** #1, #5, #13.
- **Evidence:** `handover/issues.json`; `history/history.md`.
- **Fix:** Close a bug only with a fix that adds a test which fails without it; give every open ticket a severity, an owner and a due date; review the recurring kinds of problem before each release.
- **Who:** Product owner, with the developer
- **Status:** Open

### HIS-02 · Low · Confirmed: The sign-in box stays on screen after signing in

- **Impact:** Shoppers see the sign-in box next to "Signed in as …" and may think signing in failed (reported twice, on a computer and on an Android phone).
- **Where:** `shared/public/style.css:6` (`form { display: flex }` overrides the `hidden` attribute that `shared/public/app.js:67` sets on the sign-in form). **Evidence:** AC-02 screenshot (`evidence/acceptance/AC-02-test-finished-1.png`). **Tickets:** #13, #14.
- **Evidence:** AC-02 screenshot (`evidence/acceptance/AC-02-test-finished-1.png`).
- **Fix:** Add `[hidden] { display: none !important; }` to the stylesheet and a test that the form is hidden after sign-in.
- **Who:** Developer
- **Status:** Open

## Appendix B. Checklist results by area

Every criterion in the standard, including those that don't apply to this product (`review-pack.mjs status` counts only the mandatory ones).

| Area | Meet | Don't meet | Can't verify | Don't apply |
|---|---|---|---|---|
| R Reviewability | 2 | 7 | 0 | 0 |
| H Harness | 0 | 12 | 1 | 0 |
| A Architecture | 1 | 11 | 0 | 0 |
| D Data and business rules | 1 | 12 | 0 | 0 |
| S Security | 1 | 10 | 0 | 4 |
| P Performance | 3 | 7 | 0 | 0 |
| O Operations | 0 | 9 | 1 | 0 |
| Q Quality history | 4 | 4 | 1 | 0 |
| U Acceptance and report | 4 | 2 | 2 | 0 |

## Appendix C. Glossary

- **race test:** Many simulated shoppers press Buy at the same instant, to see whether the shop sells more than it has or charges anyone twice.
- **load test:** Simulated visitors arriving at a set rate, stepped up to and beyond the expected crowd, to measure how fast the site answers.
- **95th percentile:** 95% of requests were faster than this time.
- **idempotency key:** A unique code sent with a payment so that if the same request arrives twice, the provider charges only once.
- **SQL injection:** Typing database commands into a form or address so the server runs them.
- **token:** The proof of sign-in the browser sends with each request. Here it is just the email address, so anyone can make one.
- **staging copy:** A separate copy of the shop, set up like the real one, for testing without risk.
- **CI:** Continuous integration: a service that runs the tests and checks automatically on every change.
- **rate limit:** A cap on how many requests one person or address may make in a short time.
- **waiting room:** A queue page that lets visitors into the sale a few at a time when too many arrive.
- **reconciliation:** Comparing the payment provider's charges with the shop's orders and flagging any difference.
- **graceful shutdown:** When the server is told to stop, it finishes the requests in progress before exiting.
- **health check:** An address the hosting platform calls to see whether the app is running and can reach what it needs.
- **Semgrep:** A tool that searches code for risky patterns.
- **Gitleaks:** A tool that searches code and its history for passwords and keys.
- **k6:** The tool used to run the load and race tests.
- **Lighthouse:** A Google tool that measures how fast a page loads on a simulated phone.
- **axe:** A tool that checks a page for accessibility problems.
- **SIGTERM:** The signal a hosting platform sends to tell the app to stop, for example during a deploy.
- **CORS:** A browser rule about which other websites may call the shop's server from a visitor's browser.
