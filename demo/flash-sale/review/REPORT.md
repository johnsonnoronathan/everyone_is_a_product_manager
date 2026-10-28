# Pre-delivery inspection: Holiday sneaker drop

Version `fa296a2` (the app's code hasn't changed since; later commits touch only documentation and tests) · inspected 2026-10-17; extended 2026-10-27 with checks of the tests, the AI-coding instructions and past problems by Claude Code (launch-review skill), in sessions that hadn't written the code · risk tier 3. Generated from `review-pack.json`; the review page shows the same record with all the evidence.

## 1. Summary: evidence and conclusions

**Verdict: NO-GO.** Don't launch yet: four things block it. The most serious is that the opening time can silently be wrong, so the sale could open hours early or stay shut at midnight. And the shop has never taken a real card payment: the connections to the real payment provider, sign-in and database aren't built yet. The previous review found 23 problems; 16 are now fixed and verified, and 7 are still open in some form (partly fixed, accepted as a risk, or waiting on a condition). Together with the new problems this review found, the open ones are listed under What to fix.

**If it were delivered or launched now:** The sale might open before the email goes out, letting bots and early visitors take the pairs, or stay shut while 3,000 people wait. Nobody knows whether a real card payment goes through, so the first real customer is the first test. Customers get no confirmation email. If something breaks during the sale, the documented way back (rollback) fails, and nobody is named to be woken up.

*These answers measure how complete the testing and the inspection are, not whether the app is ready: the verdict says that.*

| Question | Answer | Evidence |
|---|---|---|
| 1. Is the test harness properly set up? | **No** | 2 of 13 harness checks met; of the 6 kinds of problem that came back, 3 have no automatic test that would catch them and 3 are only partly caught |
| 2. Are the performance tests comprehensive? | **Partly** | 4 of 8 kinds of performance test run; 4 passed, 0 failed |
| 3. Does the architecture review cover hidden problems? | **Yes** | 9 of 9 places examined; 12 hidden problems found |

- The test harness is not set up: 10 of 13 checks are not met and 1 could not be verified, and of the 6 kinds of problem that came back, 3 have no automatic test that would catch them and 3 are only partly caught. Expect the same bugs to return after the next change.
- The performance tests are not fully comprehensive: 4 of 8 kinds this product needs were not run (beyond capacity, long run, page speed on phones, on a production-like setup). All 4 that were run passed.
- The review looked in all 9 places where hidden problems usually sit. It found 12 problems there.

**Before delivery (4 blockers):**

1. Make the opening time impossible to set wrong: one place where it's set, only full times with a time zone, and the time in force shown in the admin answer and in the log.
2. Connect the real database, sign-in and card payment, make production refuse to start without them, have a reviewer check them, then make one small real purchase and refund.
3. Show that backups can be restored, that an alert reaches a named person, and who is on call on launch night.
4. Build the operator tools the launch-night runbook relies on, try each once, and make the way back to the previous version work.

**When it could be delivered:** An estimate, not a promise: about two to three weeks of developer work once the providers are chosen, most of it connecting real payments, plus the time to book a security test. Set the sale date after that.

## 2. How the inspection was done

### Sources of evidence

| Source | Used | What was used, or why not |
|---|---|---|
| The code, at the version inspected | Yes | `demo/flash-sale/fixed/` at commit `fa296a2`, with the shared simulators in `shared/`. |
| Change history | Yes | 10 commits of `demo/flash-sale/` (2026-10-16 to 2026-10-18), scanned with `history-scan.mjs`. The fixes are bundled a round at a time, so the review reports are the defect record. |
| Issue tracker or tickets | No | None exists for the demo. In a real project this is the first place to look for problems that came back. |
| Reports from users and support | No | The shop hasn't launched, so there are no users or support tickets yet. |
| Earlier reviews and incident notes | Yes | Three review reports: the first version (30 problems), round 1 (23) and round 2 (the 23 re-checked, plus 13 new), in `sample-reports/`. |
| The project's own tests, run again | Yes | The acceptance suite (12 browser tests, each run 3 times) and the race test, as CI runs them. |
| The running app, used by the inspector | Yes | Run locally with `run.mjs`; the journeys tried by hand and through the browser tests, with screenshots. |
| Load, race and speed measurements | Yes | Load test (3 runs and a baseline), race test and slow-partner test; see Performance. |
| Automatic scans | Yes | Gitleaks, OSV-Scanner and Semgrep with this project's rules; every rule that fired is accounted for under Security. |
| Answers from the owner and the team | Yes | The owner's brief (`peak-brief.json`): the crowd, the speed budgets and the sale rules. A demo, so no interview with a real owner. |

### Skills and tools used

| Skill or tool | What it did |
|---|---|
| `launch-review` (this repository) | This inspection: the checklist, the scanners, the quality history and this page. |
| `peak-traffic-test` (this repository) | The load plan from the brief, the staged load test, the race test and the slow-partner test. |
| `acceptance-test` (this repository) | The agreed criteria as browser tests, each run three times, with screenshots. |
| Gitleaks 8.28.0, OSV-Scanner 2.2.3, Semgrep 1.181.0, k6, Playwright 1.56.1 | The scanners and test runners the skills call. |

**How the answers are worked out.** Software counts them from the record: everything done is Yes, at least half is Partly, less than half is No. Every checklist result carries its evidence grade: A, the inspector ran or measured it; B, the inspector read the code or settings; C, a statement only, which never counts as proof.

## 3. Results

### 3.1 Is the test harness properly set up? No

*The tests, automatic checks and AI-agent instructions that stop the next change, by a person or an AI agent, from breaking something or bringing an old bug back.*

**Evidence.** 2 of 13 harness checks met.

In place: H-09 Tests are reliable; H-13 Changes get an independent review.

Missing or unproven:

- H-01 Agent instructions exist (does not meet). Found: No AGENTS.md, CLAUDE.md or similar anywhere in the repository, although an AI coding assistant wrote and fixed the code.
- H-02 Agent instructions are true (does not meet). Found: There is no instruction file whose commands could be checked.
- H-03 Agents know the rules and boundaries (does not meet). Found: The business rules and boundaries exist only in review reports and code; agents aren't told them.
- H-04 Lessons are recorded for agents (does not meet). Found: None of the six recurring problems (Quality history) is recorded where an agent would read it.
- H-05 Agent instructions are lean and safe (does not meet). Found: No instruction file.
- H-06 Every promise has a test (does not meet). Fix: Add a test that two different addresses can each buy, and that one address can't buy twice.
- H-07 Tests check outcomes (does not meet). Found: Tests check orders, charges and messages, but not what should disappear: the sign-in box stayed visible for three rounds.
- H-08 Failure paths are tested (does not meet). Found: Covered: tampered price, double click, other users' orders, slow and failing payments, missing address, too early, paused. Not covered: malformed requests and restarts, two of the recurring problems under Quality history.
- H-10 Every change goes through CI (cannot verify). Needed to verify: The branch protection settings for `main` (repository settings, owner access).
- H-11 Lint and type checks pass (does not meet). Found: No linter, formatter or type checker for the app code.
- H-12 Security checks are automated (does not meet). Fix: Run Gitleaks, OSV-Scanner and Semgrep in CI on every change.

6 kinds of problem came back during the project; 3 have no automatic test that would catch them and 3 are only partly caught. The kind of test that would catch each:

| Kind of test | In the project | Would catch these problems that came back |
|---|---|---|
| Unit tests | **No** | Bad input crashes the app or is quietly accepted (6 times); Business rules checked in code instead of enforced by the database (6 times) |
| Integration tests | Yes: Review scripts | Outside calls whose outcome is unknown (4 times); Settings and data that must survive restarts and deploys (7 times); Business rules checked in code instead of enforced by the database (6 times) |
| End-to-end tests in a browser | Yes: Acceptance tests | — |
| Visual tests | **No** | Screen behaviour no test looked at closely (5 times) |
| Self-checks | Yes: Start-up checks (in the app) | Settings and data that must survive restarts and deploys (7 times); Operations promised on paper but not in tools (5 times) |
| Load and race tests | Yes: Race test, Load test | — |
| Automatic scans | **No** | Bad input crashes the app or is quietly accepted (6 times) |

**Conclusion.** The test harness is not set up: 10 of 13 checks are not met and 1 could not be verified, and of the 6 kinds of problem that came back, 3 have no automatic test that would catch them and 3 are only partly caught. Expect the same bugs to return after the next change.

### 3.2 Are the performance tests comprehensive? Partly

*Whether every kind of performance test this product needs was run. Whether the app passed each one is shown beside it.*

| Kind of test | Result | What it showed |
|---|---|---|
| Load at the target and above it | Passed | The product page held the target in 3 of 3 runs and 200% in 2 of 3 (one failed at 150%), all on one 4-core machine shared with the test tools, so the capacity number itself is not proven. Most buy answers in the load test were "sold out", so buying under a rush is judged by the race test instead. |
| Repeated runs, all kept | Passed | Three runs and a same-day run of the previous version, all kept, including the one that failed. |
| Rush on something limited | Passed | 1,000 buyers × 2 clicks for 100 pairs: 100 sold, nobody charged twice, nothing left pending. CI runs it on every change. |
| Slow or failing partner | Passed | Payment provider answering in about 3 seconds: 40 charges for 40 orders, then 60 for 60; repeat clicks refused. |
| Beyond capacity | Not run | No test past 200% of the target, and no waiting room to measure. |
| Long run | Not run | No run longer than a few minutes. |
| Page speed on phones | Not run | No Lighthouse run on a phone profile. |
| On a production-like setup | Not run | Everything ran on one laptop with SQLite standing in for the hosted database; there is no staging copy. |

**Conclusion.** The performance tests are not fully comprehensive: 4 of 8 kinds this product needs were not run (beyond capacity, long run, page speed on phones, on a production-like setup). All 4 that were run passed.

### 3.3 Does the architecture review cover hidden problems? Yes

*The places where problems usually hide from tests: two things at once, restarts, settings, time and the rest. The review looks in each and says what it found there.*

| Where hidden problems sit | Result | How the review looked | Problems |
|---|---|---|---|
| Two things at once | Looked, none found | Read the buy route and the payment and email jobs, and ran the race test (1,000 buyers × 2 clicks for 100 pairs): 100 sold, nobody charged twice. |  |
| Slow, failing or repeated outside calls | Problems found | Read every call to the payment provider and ran it slow (about 3 s), very slow and failing; followed a charge that never resolves. | ARC-10 |
| Restarts, deploys and rollbacks | Problems found | Started the app in production mode without its settings and restarted it mid-sale; tried the runbook's rollback against the new database. | ARC-16, OPS-09 |
| Settings and environments | Problems found | Listed every setting the app reads, changed the opening time between starts, and started the shop without `NODE_ENV=production`. | ARC-11, SEC-04 |
| Unexpected input | Problems found | Sent malformed paths and bodies (all refused with 400) and shipping addresses in Japanese, Russian and Greek. | ARC-12 |
| What runs out first | Problems found | Read the pool, queue and rate-limit settings, and sent unlimited signed-in reads during checkout. | ARC-06, PERF-03 |
| Data that can become wrong | Problems found | Compared each business rule with where it is enforced, and bought a second pair with another mailbox for the same address. | SEC-03 |
| Time and dates | Problems found | Tried opening times without a time zone and as text like "Nov 27", and a countdown more than 25 days long. | ARC-11, PERF-04 |
| Background jobs and queues | Problems found | Read the email and settlement jobs: queued emails are never sent, and one failing email would block the rest once sending is added. | ARC-07, ARC-13 |

The 12 hidden problems, most serious first:

- ARC-16 (High) Production starts without a database or payment address, and a restart then loses every order
- ARC-11 (High) The opening time can silently be wrong
- ARC-10 (Medium) A payment that never resolves stays "confirming" forever
- OPS-09 (Medium) Rolling back to the previous release fails
- SEC-04 (Medium) Production safety depends on one setting nobody sets
- ARC-06 (Medium) Rate limits live in one server
- PERF-03 (Medium) One signed-in script can tie up the database
- SEC-03 (Medium) One person can still buy several pairs, and nothing slows bots
- PERF-04 (Medium) The page reloads non-stop if the sale is more than ~25 days away
- ARC-07 (Medium) Confirmation emails are queued but never sent
- ARC-12 (Low) Different non-Latin addresses collide
- ARC-13 (Low) One failing email would block the rest

**Conclusion.** The review looked in all 9 places where hidden problems usually sit. It found 12 problems there.

## 4. Recommendations

### What has to happen

| # | What has to happen | Who | How big | When |
|---|---|---|---|---|
| 1 | **Blocker:** Make the opening time impossible to set wrong: one place where it's set, only full times with a time zone, and the time in force shown in the admin answer and in the log. (ARC-11, A-09) | Developer | Small: a few hours | Before delivery |
| 2 | **Blocker:** Connect the real database, sign-in and card payment, make production refuse to start without them, have a reviewer check them, then make one small real purchase and refund. (INT-01, ARC-16, S-06, D-13) | Developer, with the providers you choose; you make the test purchase | One to two weeks, depending on the providers | Before delivery |
| 3 | **Blocker:** Show that backups can be restored, that an alert reaches a named person, and who is on call on launch night. (OPS-04, O-03, O-05, O-10) | Hosting provider or developer; you name the on-call person | About a day, once recovery targets are agreed | Before delivery |
| 4 | **Blocker:** Build the operator tools the launch-night runbook relies on, try each once, and make the way back to the previous version work. (OPS-08, OPS-09) | Developer | Medium: one to two days | Before delivery |
| 5 | **Condition:** Set up a test copy of the shop (staging) with its own database, keys and test payments, so the runbook and the real payment can be rehearsed safely. (R-06) | Hosting provider or developer | About a day | Before launch |
| 6 | **Condition:** Run one copy of the app only, and set the load balancer's idle timeout below 65 seconds. (A-06, O-09) | Hosting provider or developer | Small | At launch |
| 7 | **Condition:** Start production with a real start command that sets `NODE_ENV=production`. (SEC-04, A-08) | Developer | Small | Before launch |
| 8 | **Condition:** Repeat the load test on production-sized machines, with the load generator on its own machine. (P-02) | Developer | Half a day | Before launch |
| 9 | **Condition:** Add instructions for the AI coding assistant, and tests for bad input and restarts, before the next round of AI-written fixes. (HAR-01, HAR-02, HIS-01) | Developer | One to two days | Before the next change |
| 10 | **Condition:** Book an independent security test (penetration test). (S-15) | Product owner | External: typically a few days of a security firm's time | Before or soon after launch |

### Strengthen the test harness

So the problems that came back can't come back again unnoticed. Most needed first:

1. **Run the integration tests on every change (CI), and extend them.** Would catch: Outside calls whose outcome is unknown; Settings and data that must survive restarts and deploys; Business rules checked in code instead of enforced by the database. Integration tests catch parts that work alone but not together: database rules and transactions, a stand-in payment provider that is slow or fails. Skills and tools: test-driven-development.
2. **Add unit tests.** Would catch: Bad input crashes the app or is quietly accepted; Business rules checked in code instead of enforced by the database. Unit tests catch a rule or calculation that is wrong: prices, limits, reading input, dates. Skills and tools: test-driven-development.
3. **Run the self-checks on every change (CI), and extend them.** Would catch: Settings and data that must survive restarts and deploys; Operations promised on paper but not in tools. Self-checks catch the app checking itself: refusing to start with missing or unsafe settings, a health check that tests what matters, a quick test after every deploy. Skills and tools: verification-before-completion.
4. **Add automatic scans.** Would catch: Bad input crashes the app or is quietly accepted. Automatic scans catch leaked keys, risky code patterns, libraries with known security holes. Skills and tools: launch-review.
5. **Add visual tests.** Would catch: Screen behaviour no test looked at closely. Visual tests catch a screen that looks wrong although it works: something that should disappear stays, things overlap, a layout breaks on a phone. Skills and tools: acceptance-test, webapp-testing, Playwright screenshot comparison.

### Complete the performance tests

Run these tests:

- **Beyond capacity.** Past its limit it turns people away politely and recovers, instead of crashing.
- **Long run.** An hour or more at normal traffic without slowing down, filling up or running out of memory.
- **Page speed on phones.** People on mid-range phones get the page quickly.
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

- Choose the payment provider, sign-in provider and email provider (or decide to launch without confirmation emails).
- Agree how much order data you could afford to lose, and how fast the shop must be back after a failure (for example: at most 5 minutes of orders, back within 30 minutes).
- Set the sale date. If the sale page goes live more than 25 days before it, the page reloads itself non-stop until PERF-04 is fixed.
- Decide how long a payment may stay "confirming" before the pair goes back on sale and the shopper is told.
- Accept, in writing and until a date, running only one copy of the app on launch night.
- Decide whether to remove the page's mentions of an order history and an email, or have them built.
- Sign this page once the blockers are done.

## 5. Limits: what was not checked

- **Production sign-in and card payments.** Not in the repository. Card collection, 3-D Secure, declines, refunds and the provider's lookup API were not checked. This blocks launch until reviewed and a real purchase and refund are made.
- **Production database and infrastructure:** Postgres, backups, the load balancer (HTTPS, idle timeout), CDN and firewall.
- **The real database.** A local SQLite file stood in for hosted Postgres, so the database rules (stock, one per customer) were proven on SQLite only, and a real deployment needs a Postgres connection that isn't in the code.
- **Real capacity.** Everything ran on one machine against simulators; two app instances were not run.
- **Email sending:** not built.
- **Privacy and compliance:** privacy notice, consent, data deletion (GDPR, CCPA) and card-industry (PCI DSS) scope.
- **Accessibility** beyond the automated check on the sale page.
- **Method.** An AI-assisted review lowers risk; it doesn't prove there are no vulnerabilities. At tier 3 an independent penetration test is recommended.

An inspection lowers the risk; it does not prove there are no problems.

## Appendix A. Every open problem

### INT-01 · High · Confirmed: The real database, sign-in and card payment aren't connected

- **Impact:** The code talks only to stand-ins: a local SQLite file instead of the hosted Postgres database, a test sign-in that accepts any email, and a payment simulator. Card details, 3-D Secure, declines and refunds have never been handled, so the first real customer would be the first test.
- **Where:** Database: `shared/db.mjs` (SQLite stand-in). Sign-in: `POST /api/login` test stub. Payment: `fixed/server.mjs:299-310` (calls the simulator).
- **Fix:** Connect hosted Postgres, the chosen sign-in provider and the chosen payment provider (including the provider's lookup call and refunds); have a reviewer check them; then make a purchase, a decline and a refund in the provider's test mode, and one small real purchase and refund.
- **Done when:** The race test and acceptance tests pass against staging with the real database and the provider's test mode, and the provider's records match the shop's orders for one real purchase and refund.
- **Who:** Developer, with the providers the product owner chooses
- **Status:** Open

### ARC-11 · High · Confirmed: The opening time can silently be wrong

- **Impact:** If the opening time is changed after the first start, the server keeps the old one while its log shows the new one, so the sale can open hours early or stay shut at midnight. A date without a time zone, or text like "Nov 27" (read as 2001), opens the sale at once.
- **Where:** `fixed/server.mjs:111-114`, `:646`, `:24-25`, `:537-539`
- **Fix:** One source of truth, only full times with a time zone, and show the time in force in the log and the admin answer. Effort: small.
- **Done when:** A test starts the app twice on the same database with a changed opening time and sees the new time in force; "Nov 27", "1" and a date without a time zone are refused; both run in CI.
- **Who:** Developer
- **Status:** Open

### ARC-16 · High · Confirmed (found by an independent test review, 2026-10-27): Production starts without a database or payment address, and a restart then loses every order

- **Impact:** With no database setting the app keeps orders only in memory, and with no payment address it calls a test address on the same machine; production mode starts anyway. A restart during the sale then erases every paid order while the customers stay charged (reproduced: 0 paid orders, 1 charge).
- **Where:** `fixed/server.mjs:70` (database defaults to memory), `:12` (payment address defaults to localhost)
- **Fix:** In production, refuse to start without a real database connection and a payment address.
- **Done when:** Starting in production mode without either setting fails, and a restart test with production settings keeps every order.
- **Who:** Developer
- **Status:** Open

### ARC-10 · Medium · Confirmed: A payment that never resolves stays "confirming" forever

- **Impact:** A payment error that retrying can't fix keeps the pair reserved indefinitely: the whole stock could be locked with nothing sold. A warning is written to the log after 10 minutes, but nothing yet delivers log warnings to a person.
- **Where:** `fixed/server.mjs:294-387` (charge, settle, reconciler)
- **Fix:** Look the payment up instead of re-sending it, give "confirming" a deadline, then release the pair and tell the shopper.
- **Done when:** A test where the provider keeps failing ends with the pair released and the shopper told, within the agreed deadline.
- **Who:** Developer
- **Status:** Open

### SEC-03 · Medium · Confirmed: One person can still buy several pairs, and nothing slows bots

- **Impact:** A second mailbox or a re-spelt address buys another pair.
- **Where:** `fixed/server.mjs:411-415` (one per customer and per address)
- **Fix:** Firmer identity for the limit, and a waiting room or bot protection in front of the drop.
- **Done when:** A second mailbox or a re-spelt address can't buy a second pair in a test; a bot-protection or waiting-room service is in front of the drop.
- **Who:** Developer
- **Status:** Partly fixed

### SEC-04 · Medium · Confirmed: Production safety depends on one setting nobody sets

- **Impact:** Started without `NODE_ENV=production`, the shop runs with demo secrets, test sign-in and the reset route switched on.
- **Where:** `fixed/server.mjs:10-52`
- **Fix:** Make production the default: refuse to start with demo values unless demo mode is switched on explicitly, so forgetting one setting can't open the shop with demo settings. Add a real production start command.
- **Done when:** Starting without `NODE_ENV` and without an explicit demo switch fails.
- **Who:** Developer
- **Status:** Condition

### SEC-06 · Medium · Confirmed: One shared admin password, and no record of who used it

- **Impact:** Anyone with the token can open, move or pause the sale, and the log can't say who did.
- **Where:** `fixed/server.mjs:532-568` (admin routes)
- **Fix:** Personal admin accounts and an audit entry per change.
- **Done when:** Each admin signs in personally; every change to the sale is logged with who made it.
- **Who:** Developer
- **Status:** Open

### ARC-06 · Medium · Confirmed: Rate limits live in one server

- **Impact:** A second instance would halve the protection.
- **Where:** Rate limits in memory: `fixed/server.mjs:239-253`
- **Fix:** Run one instance (runbook), or move limits to a shared store first.
- **Done when:** Runbook and hosting settings run exactly one instance, or limits live in a shared store.
- **Who:** Hosting provider or developer
- **Status:** Accepted risk, not yet signed

### ARC-07 · Medium · Confirmed: Confirmation emails are queued but never sent

- **Impact:** Shoppers get no confirmation.
- **Where:** `fixed/server.mjs:389-408` (outbox sender)
- **Fix:** Connect the email provider, with retries per email.
- **Done when:** A test purchase produces a delivered confirmation email from the real provider.
- **Who:** Developer; product owner chooses the email provider
- **Status:** Partly fixed

### PERF-03 · Medium · Confirmed: One signed-in script can tie up the database

- **Impact:** Unlimited signed-in reads can starve checkout during the rush.
- **Where:** `fixed/server.mjs:503-518`
- **Fix:** Rate-limit signed-in reads (`GET /api/orders/:id`, `GET /api/my-orders`), for example 10 per 10 seconds per account.
- **Done when:** A load test with one account hammering reads leaves checkout times within budget.
- **Who:** Developer
- **Status:** Open

### PERF-04 · Medium · Confirmed: The page reloads non-stop if the sale is more than ~25 days away

- **Impact:** Browser timers overflow above about 25 days, so every open page reloads the product non-stop and hammers the server. The sale date isn't set yet: if the page goes live more than 25 days before the sale, this happens from day one.
- **Where:** `shared/public/app.js:46-47`
- **Fix:** Cap the countdown timer and re-check periodically.
- **Done when:** A page loaded 60 days before opening re-checks no more than once a minute.
- **Who:** Developer
- **Status:** Open

### OPS-03 · Medium · Confirmed: Signing in early doesn't survive a new tab

- **Impact:** Shoppers who sign in before midnight and open a new tab must sign in again during the rush.
- **Where:** `shared/public/app.js` (session in `sessionStorage`)
- **Fix:** Keep the session across tabs (for example in a cookie or `localStorage`), weighing the risk on shared computers.
- **Done when:** A shopper signed in early is still signed in in a new tab at midnight.
- **Who:** Developer
- **Status:** Partly fixed

### OPS-04 · Medium · Likely: The launch-night safety nets haven't been shown

- **Impact:** Backups, error tracking, alerts and on-call are listed in the runbook but not evidenced.
- **Where:** `fixed/RUNBOOK.md:9-10`
- **Fix:** Show a tested restore, a received test alert and the rota.
- **Done when:** A restore log, a received test alert, and the on-call rota are attached to the review.
- **Who:** Hosting provider or developer; product owner names the on-call person and agrees recovery targets
- **Status:** Partly fixed

### OPS-08 · Medium · Confirmed: The runbook relies on tools that don't exist

- **Impact:** Loading stock, resolving a stuck payment, exporting addresses and comparing charges with orders have no tool.
- **Where:** `fixed/RUNBOOK.md` steps for loading stock, resolving a stuck payment, exporting addresses and comparing charges with orders
- **Fix:** Build each tool and try it once.
- **Done when:** Each runbook step names a command that exists, and a rehearsal log shows each one run once.
- **Who:** Developer
- **Status:** Open

### OPS-09 · Medium · Confirmed: Rolling back to the previous release fails

- **Impact:** The rollback the runbook prescribes fails at start-up, so the shop stays down when things are already bad.
- **Where:** `fixed/RUNBOOK.md:27` (rollback step); start-up migrations in `fixed/server.mjs:73-115`
- **Fix:** Make the previous release start against the new schema, or roll forward with a tested fix.
- **Done when:** The previous release starts against the current database in a test, or the runbook replaces rollback with a tried roll-forward step.
- **Who:** Developer
- **Status:** Open

### HAR-01 · Medium · Confirmed: No instructions for the AI agents that write the code

- **Impact:** Every new session of the AI coding assistant starts without the project's rules and lessons, so the problems under Quality history can return. Several problems so far were introduced by fixes.
- **Where:** Repository root: no `AGENTS.md`, `CLAUDE.md` or equivalent
- **Fix:** Add a short AGENTS.md: how to start and test, the seven business rules, where money and secrets are handled, never edit applied migrations, and one rule per recurring problem linked to its test. Effort: small.
- **Done when:** `AGENTS.md` exists; every command in it works; it lists the business rules and one rule per recurring problem, each linked to a test.
- **Who:** Developer
- **Status:** Open

### HAR-02 · Medium · Confirmed: Two recurring problems have no test: bad input and restarts

- **Impact:** Bad input that crashed the app or was quietly accepted, and settings or data lost across restarts, came back again and again across three reviews (see the counts under Quality history); each time only a reviewer caught it.
- **Where:** `demo/flash-sale/acceptance/`, `.github/workflows/ci.yml`
- **Fix:** Move the review's malformed-input and restart scripts into the CI suite, and add a lint and type check for the server. Effort: medium.
- **Done when:** A malformed-input test and a start-twice test run in CI, and each fails on an earlier broken version.
- **Who:** Developer
- **Status:** Open

### HIS-01 · Medium · Confirmed: No kind of recurring problem is fully caught automatically yet

- **Impact:** Each depends, at least partly, on the next reviewer noticing.
- **Where:** Quality history section
- **Fix:** For each kind of recurring problem in Quality history, add an automatic check (test, code-scanning rule or database constraint) and prove it catches a past example.
- **Done when:** Every kind of recurring problem is marked "caught automatically".
- **Who:** Developer
- **Status:** Open

### OPS-01 · Low · Confirmed: No request ids, and admin actions are anonymous

- **Impact:** Harder to trace one shopper's problem.
- **Where:** `fixed/server.mjs:61-66` (logging)
- **Fix:** A request id per request, and admin identity in the log.
- **Done when:** Every log line carries a request id; admin actions name the admin.
- **Who:** Developer
- **Status:** Partly fixed

### ARC-12 · Low · Confirmed: Different non-Latin addresses collide

- **Impact:** A shopper with an address in Japanese, Russian or Greek can be refused because of someone else's address.
- **Where:** `fixed/server.mjs:414`
- **Fix:** Normalise with Unicode-aware rules.
- **Done when:** Two different addresses in Japanese or Greek can both order in a test.
- **Who:** Developer
- **Status:** Open

### ARC-13 · Low · Likely: One failing email would block the rest

- **Impact:** Once real sending is added, one failing email would block all later ones, and a second app copy would send every email twice.
- **Where:** `fixed/server.mjs:389-408`
- **Fix:** Retry per email.
- **Done when:** A test with one failing email still sends the rest, once each.
- **Who:** Developer
- **Status:** Open

### ARC-14 · Low · Confirmed: The page points to things that don't exist

- **Impact:** Shoppers are sent to an order history and an email that don't exist.
- **Where:** `shared/public/index.html`, `app.js`
- **Fix:** Remove the mentions of an order history and an email, or build them.
- **Done when:** Every link and promise on the page leads somewhere real.
- **Who:** Developer
- **Status:** Open

### ARC-15 · Low · Confirmed (seen in the test screenshots): The sign-in box never hides, and the stock count is stale after buying

- **Impact:** Confusing during a one-minute sale; some shoppers will sign in again.
- **Where:** `shared/public/style.css:6`, `app.js:67, 127, 139`
- **Fix:** Fix the CSS rule that overrides `hidden`, and add a test that it disappears.
- **Done when:** An acceptance test checks that the sign-in box disappears and the stock count drops after buying.
- **Who:** Developer
- **Status:** Open

### PERF-05 · Low · Confirmed: The product cache drops its last good copy when the database is slow

- **Impact:** Slow database means slow pages for everyone.
- **Where:** `fixed/server.mjs` product cache
- **Fix:** Serve the last good copy while refreshing.
- **Done when:** With a slow database, the page is served from the last good copy within budget.
- **Who:** Developer
- **Status:** Open

### OPS-10 · Low · Confirmed: Any `?v=` value is cached for a year

- **Impact:** A mixed-version deploy can pin old JavaScript.
- **Where:** `fixed/server.mjs:141-152, 611-617`
- **Fix:** Cache only the current hash.
- **Done when:** Only the current file version is cached for a year; other `?v=` values get a short cache.
- **Who:** Developer
- **Status:** Open

## Appendix B. Checklist results by area

Every criterion in the standard, including those that don't apply to this product (`review-pack.mjs status` counts only the mandatory ones).

| Area | Meet | Don't meet | Can't verify | Don't apply |
|---|---|---|---|---|
| R Reviewability | 7 | 2 | 0 | 0 |
| H Harness | 2 | 10 | 1 | 0 |
| A Architecture | 8 | 2 | 2 | 0 |
| D Data and business rules | 5 | 8 | 0 | 0 |
| S Security | 5 | 3 | 3 | 4 |
| P Performance | 6 | 1 | 3 | 0 |
| O Operations | 2 | 3 | 5 | 0 |
| Q Quality history | 5 | 4 | 0 | 0 |
| U Acceptance and report | 6 | 2 | 0 | 0 |

## Appendix C. Glossary

- **Evidence grade:** A: the reviewer ran or measured it. B: the reviewer read the code or configuration itself. C: someone's statement only, which never counts as proof.
- **Risk tier:** 1 low, 2 standard, 3 high. It decides which criteria are mandatory and which problems block launch.
- **p95:** 95% of requests were faster than this.
- **Race test:** Many simulated buyers press Buy at the same moment, to check that limited stock is never oversold.
- **Repeat-safe key (idempotency key):** A label sent with a payment so the provider charges once, even if the request is sent again.
- **Reconciler:** A background job that settles payments whose outcome is unknown.
- **Outbox:** A table of emails waiting to be sent, so none are lost on a restart.
- **Migration:** A numbered change to the database structure.
- **Rollback:** Going back to the previous release.
- **Load balancer:** The front door that passes requests to the app.
- **Agent instruction file:** AGENTS.md, CLAUDE.md or similar: what AI coding agents read before changing the code.
- **Hotspot:** A file that needed many fixes; bugs cluster there.
- **Root cause:** Why a kind of problem keeps happening, as opposed to the last instance of it.
- **Control:** An automatic check (test, rule, constraint) that catches the next instance of a problem.
- **Blocker:** Something that must be done before launch.
- **Condition:** Something else that's required, at the time shown, but not a reason to stop launch on its own.
- **Runbook:** A step-by-step guide for whoever looks after the shop during the sale: what to watch, and what to do when something goes wrong.
- **Staging:** A test copy of the shop with test data, separate from the live one.
- **Production:** The live shop that real customers use.
- **CI (continuous integration):** Automatic checks and tests that run on every change to the code.
- **Commit:** One saved version of the code. The review applies to exactly one.
- **Harness:** Everything that keeps the next change correct: tests, automatic checks, and the instructions AI coding assistants follow.
- **Instance:** One running copy of the app.
- **Penetration test:** Security specialists try to break into the app, with permission.
- **Confirmed / Likely:** Confirmed: the reviewer reproduced the problem or traced it fully. Likely: strong evidence in the code, not reproduced.
- **Accepted risk:** The owner knowingly accepts a problem until a set date.
- **Rate limit:** A cap on how often one person or program can do something, to stop abuse.
- **Magic link:** Signing in by clicking a link sent by email, instead of a password.
