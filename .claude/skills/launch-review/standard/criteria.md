# Review criteria

Standard 1.0. Generated from `criteria.json` by `scripts/review-pack.mjs criteria`; edit the JSON, not this file.

Each criterion is **mandatory from** the risk tier shown, and recommended below it. Criteria with a condition apply only to products with that feature. **Lowest grade** is the weakest evidence that can support a "meets": A = the reviewer ran, reproduced or measured it; B = the reviewer inspected the thing itself; C = a statement only.

## R: Reviewability (9)

*Can a reviewer start work from the README alone?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| R-01 | **Purpose is stated** | The README says in plain words what the product does, who uses it and which user journeys matter most. | The README. | Tier 1 | B |
| R-02 | **Runs from a clean checkout** | Following only the README, a reviewer gets the app running locally or on a staging copy within 30 minutes. No undocumented steps. | The reviewer's own run: commands and output. | Tier 1 | A |
| R-03 | **Review page is complete** | A review page in this standard's format exists, is linked from the README, and passes the validator for the submission stage. | Validator output. | Tier 1 | A |
| R-04 | **Every setting is documented** | Every setting the app reads is listed with its purpose, whether it is secret, an example value and whether production needs it. | The settings table compared with a search of the code for every setting it reads. | Tier 1 | B |
| R-05 | **Test access is ready** | Test accounts for every role and a way to reset test data are documented. Payments, email and other side effects run in test mode.<br>*Only if the product users sign in or takes payments, issues refunds or credits, or holds balances.* | The reviewer used the accounts and the reset. | Tier 2 | A |
| R-06 | **A staging copy exists** | A staging environment, separate from production with its own database and keys, is available to the reviewer. | Staging address and its configuration. | Tier 2 | B |
| R-07 | **Requirements are agreed** | The requirements the review judges against are written down with numbers (traffic, response times, acceptable data loss, recovery time) and agreed by a named person. | The requirements section, with who agreed and when. | Tier 1 | B |
| R-08 | **Known limits are declared** | The author lists known problems, limitations and what is out of scope. | Known problems register and out-of-scope list. | Tier 1 | B |
| R-09 | **Versions are pinned** | Runtime and tool versions are stated, and dependency lockfiles are committed. | README, version files, lockfiles. | Tier 1 | B |

## H: Harness (13)

*Will the next change, by a person or an AI agent, keep the project correct?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| H-01 | **Agent instructions exist** | An instruction file at the root (AGENTS.md, CLAUDE.md or equivalent) tells coding agents how to set up, build, test and run the project.<br>*Only if the product AI coding agents or assistants write or change the code.*<br>*Source: agents.md format; Claude Code memory files* | The file. | Tier 1 | B |
| H-02 | **Agent instructions are true** | Every command in the instruction file works as written, and every path and rule it mentions matches the code.<br>*Only if the product AI coding agents or assistants write or change the code.* | The reviewer ran each command. | Tier 1 | A |
| H-03 | **Agents know the rules and boundaries** | The instruction file states the rules that must never be broken (the business rules, where money and secrets are handled, files never edited by hand such as applied migrations) and the module boundaries.<br>*Only if the product AI coding agents or assistants write or change the code.* | The file compared with the business rules section. | Tier 2 | B |
| H-04 | **Lessons are recorded for agents** | Each recurring problem from the quality history appears in the instruction file as a short rule, linked to the test or check that enforces it.<br>*Only if the product AI coding agents or assistants write or change the code.* | The file compared with the recurring problems. | Tier 2 | B |
| H-05 | **Agent instructions are lean and safe** | The instruction file is short enough to be read in full every time (details linked out), contains no secrets and doesn't contradict itself or the code.<br>*Only if the product AI coding agents or assistants write or change the code.* | The file. | Tier 2 | B |
| H-06 | **Every promise has a test** | Every Must acceptance criterion and every business rule has an automated test. | A table from each criterion and rule to its test. | Tier 1 | B |
| H-07 | **Tests check outcomes** | Tests assert the business result (stock, balance, order state, what the user sees, including what should disappear), not only status codes or that a page loaded. | A sample of tests. | Tier 2 | B |
| H-08 | **Failure paths are tested** | Tests cover invalid input, unauthorised access, double submission, timeouts and slow or failing partners, not only the happy path. | The test list, by failure type. | Tier 2 | B |
| H-09 | **Tests are reliable** | The whole suite passes three runs in a row with retries turned off. | Three run logs. | Tier 2 | A |
| H-10 | **Every change goes through CI** | Tests and checks run automatically on every change, and the main branch accepts only changes that pass. | CI configuration and recent runs, branch protection. | Tier 2 | B |
| H-11 | **Lint and type checks pass** | A linter or formatter and, where the language has one, a type checker are configured and pass. | The reviewer's run. | Tier 2 | A |
| H-12 | **Security checks are automated** | Secret scanning and vulnerable-dependency checks run in CI or before every commit. | CI configuration or hooks, and a recent run. | Tier 2 | B |
| H-13 | **Changes get an independent review** | Changes, AI-generated ones included, are reviewed before merging by someone other than their author: a person or a separate agent session. | Recent pull requests and their reviews. | Tier 2 | B |

## A: Architecture (12)

*Is the structure sound for the agreed requirements?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| A-01 | **The system map is complete** | Every entry point (pages, APIs, webhooks, scheduled jobs, admin and test routes, browser-to-database access) is listed with who may call it and what it touches. The reviewer found none missing. | The map compared with the code's routes and jobs. | Tier 1 | B |
| A-02 | **Responsibilities are clear** | Each component has one stated job. Business rules live in one place on the server, not repeated in the browser or across services. | Component list and the code behind each rule. | Tier 2 | B |
| A-03 | **Decisions are recorded** | Major design choices (database, hosting, payments, where state is kept) are written down with the reason, the alternatives and the known downsides. | Decision records. | Tier 2 | B |
| A-04 | **Outside calls are bounded** | Every call to another service has a timeout, limited retries with back-off, and a defined outcome when it fails or doesn't answer.<br>*Source: AWS Well-Architected, Reliability pillar* | The code for each outside call. | Tier 1 | B |
| A-05 | **Slow work is off the request path** | Email, file processing, reports and similar work run in the background through a durable queue or outbox, so a slow partner doesn't slow the user. | The code path for each slow task. | Tier 2 | B |
| A-06 | **Scales out, or states its limit** | App servers keep nothing in their own memory that must be shared or survive (sessions, counters, rate limits, queues), or the one-server limit is documented and accepted.<br>*Source: Twelve-Factor App, VI Processes* | In-memory state found in the code, and the decision record. | Tier 2 | B |
| A-07 | **Environments are separated** | Development, staging and production use separate databases, keys and accounts.<br>*Source: Twelve-Factor App, X Dev/prod parity* | Configuration per environment. | Tier 1 | B |
| A-08 | **Configuration is safe** | Settings come from the environment, not the code. Production refuses to start with missing, placeholder or test settings.<br>*Source: Twelve-Factor App, III Config* | A start attempt with bad settings. | Tier 2 | A |
| A-09 | **Launch settings have one source of truth** | Values that must be right on the day (opening times, prices, stock, switches) are set in one place, parsed strictly (full date, time and time zone), and the value in force is visible. | Change the setting, restart, and read the value in force. | Tier 2 | A |
| A-10 | **Database changes are versioned** | Schema changes run through versioned migrations. Nothing deletes data at start-up. Destructive changes have a backup and a plan. | Migrations and start-up code. | Tier 1 | B |
| A-11 | **Dependencies are real and needed** | Every dependency exists in the official registry under that exact name, is maintained, and is needed.<br>*Source: OWASP Top 10:2025 A03 Software Supply Chain Failures* | Dependency list checked against the registry. | Tier 1 | B |
| A-12 | **Partner limits are known** | Rate limits, quotas and costs of each outside service are known and fit the expected peak. | Provider documentation compared with the target load. | Tier 3 | B |

## D: Data and business rules (13)

*Can the data become wrong?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| D-01 | **Business rules are written down** | The business rules are listed in plain words, for example "never sell more than the stock", "one per customer", "every paid order has exactly one payment". | The business rules section. | Tier 1 | B |
| D-02 | **Rules can't be bypassed** | Each rule is enforced where it can't be skipped: a database constraint, a transaction or an atomic update. A check followed by a separate write does not count.<br>*Source: OWASP Top 10:2025 A06 Insecure Design* | Schema and code for each rule. | Tier 1 | B |
| D-03 | **The server decides prices and permissions** | Prices, totals, discounts, roles and ownership are worked out on the server from trusted data, never taken from the browser. | The code, and a tampered request. | Tier 1 | B |
| D-04 | **Money is exact** | Amounts are stored as whole minor units (cents) or a decimal type. Rounding and currency rules are stated.<br>*Only if the product takes payments, issues refunds or credits, or holds balances.* | Schema and calculations. | Tier 1 | B |
| D-05 | **Repeats are safe** | Creating orders, charges and other one-off actions is idempotent: a double click, a retry or a replayed request never creates a second one. | A double-submit and a retry test. | Tier 1 | A |
| D-06 | **Steps that belong together complete together** | Steps that belong together (reserve, charge, record) all happen, or are undone or completed by a recovery path. Money never moves without a record.<br>*Only if the product takes payments, issues refunds or credits, or holds balances.* | The code path and a test that interrupts it. | Tier 1 | B |
| D-07 | **Unknown outcomes are settled** | When a payment or other outside action times out, the outcome is treated as unknown, not failed, and a background job settles it with the provider.<br>*Only if the product takes payments, issues refunds or credits, or holds balances.* | A slow-partner test. | Tier 2 | A |
| D-08 | **Input is validated at the edge** | Every input is checked for type, range, length and format, and rejected rather than silently corrected. Malformed requests get a 4xx answer, never a crash.<br>*Source: OWASP Top 10:2025 A10 Mishandling of Exceptional Conditions* | Malformed requests sent by the reviewer. | Tier 1 | A |
| D-09 | **Time is handled explicitly** | Times are stored in UTC. Business times (opening hours, deadlines) carry a time zone. Date parsing is strict. | Code, and attempts with ambiguous dates. | Tier 2 | B |
| D-10 | **Changes leave an audit trail** | Changes to money, stock and admin settings record who, what and when.<br>*Only if the product takes payments, issues refunds or credits, or holds balances or has admin or staff functions.* | Logs or audit table after an admin change. | Tier 2 | B |
| D-11 | **Personal data has a lifecycle** | What personal data is kept, why, for how long, and how it is deleted on request is stated and implemented.<br>*Only if the product stores personal data (names, emails, addresses, messages, health, financial).* | Privacy notes and the deletion path. | Tier 2 | B |
| D-12 | **Records are reconciled** | A routine check compares records with reality (charges with orders, stock with sales) and alerts on any difference.<br>*Only if the product takes payments, issues refunds or credits, or holds balances or sells or allocates something limited (stock, seats, coupons, slots).* | The check, run once. | Tier 3 | A |
| D-13 | **Real payments work end to end** | The real payment flow has been exercised with the real provider: a purchase, a decline and a refund in the provider's test mode, and one small real purchase and refund in production before launch.<br>*Only if the product takes payments, issues refunds or credits, or holds balances.* | The provider's records of those transactions, matched to the app's orders. | Tier 2 | A |

## S: Security (15)

*Who can do what, and can anything leak?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| S-01 | **No secrets are exposed** | No secrets in the code, git history, logs or anything sent to the browser.<br>*Source: CWE-798* | Secret scan of files and history, and of the browser bundle. | Tier 1 | A |
| S-02 | **Every entry point checks who is asking** | Identity and ownership are checked on the server at every entry point. Nobody can read or change another user's data by changing an id.<br>*Source: OWASP Top 10:2025 A01 Broken Access Control* | Requests as another user and as nobody. | Tier 1 | A |
| S-03 | **Admin and test routes are closed** | Admin functions need an admin role with personal accounts, not a shared password. Test, debug and seed routes don't exist in production. | Requests to every admin and test route. | Tier 1 | A |
| S-04 | **Database rules deny by default** | Where the browser talks to the database directly, access rules deny by default and are tested for each table.<br>*Only if the product the browser talks to the database directly (Supabase, Firebase and similar).* | Rules file and test queries with the public key. | Tier 1 | A |
| S-05 | **No injection** | Database queries are parameterised. No shell command, template or HTML is built from user input without encoding.<br>*Source: OWASP Top 10:2025 A05 Injection* | Code scan and review. | Tier 1 | B |
| S-06 | **Sign-in is done properly** | Sign-in uses a proven provider or library. Passwords are hashed with a slow algorithm. Session cookies are Secure, HttpOnly and SameSite. Signing out ends the session.<br>*Only if the product users sign in.*<br>*Source: OWASP Top 10:2025 A07 Authentication Failures* | Code and a sign-in session. | Tier 1 | B |
| S-07 | **Abuse is limited** | Sign-in, sign-up, password reset, checkout and other costly endpoints have rate limits or bot protection. | Repeated requests until the limit applies. | Tier 2 | A |
| S-08 | **Safe defaults on the wire** | HTTPS everywhere, security headers set, cross-site access (CORS) limited to known sites.<br>*Source: OWASP Top 10:2025 A02 Security Misconfiguration* | Header check against the running site. | Tier 2 | A |
| S-09 | **Errors don't leak internals** | Users never see stack traces, SQL or internal paths. | Requests that cause errors. | Tier 1 | A |
| S-10 | **No known exploitable vulnerabilities** | Dependencies are scanned for known vulnerabilities and every hit is triaged.<br>*Source: OWASP Top 10:2025 A03 Software Supply Chain Failures* | Dependency scan output and triage notes. | Tier 1 | A |
| S-11 | **Webhooks are verified** | Incoming webhooks check the sender's signature and ignore replays.<br>*Only if the product receives webhooks from other services.* | A forged and a replayed webhook. | Tier 2 | B |
| S-12 | **Uploads are contained** | Uploaded files are checked for type and size, stored outside the web root and served safely.<br>*Only if the product accepts file uploads.* | Upload attempts with bad files. | Tier 2 | B |
| S-13 | **AI features are fenced** | Features that call an AI model resist prompt injection, can't reveal other users' data, and have cost and rate limits.<br>*Only if the product calls an AI model at runtime.*<br>*Source: OWASP Top 10 for LLM Applications (2025)* | Injection attempts and the limits in code. | Tier 2 | B |
| S-14 | **Personal data is protected** | Personal data is kept to what is needed, travels only over encrypted connections, and stays out of logs and error reports.<br>*Only if the product stores personal data (names, emails, addresses, messages, health, financial).* | Logs from a test run, and the data model. | Tier 2 | B |
| S-15 | **An independent security test is booked** | An independent penetration test is done, or booked before or soon after launch. | Test report or booking. | Tier 3 | B |

## P: Performance (10)

*Will it hold the expected traffic and stay correct?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| P-01 | **The traffic target is agreed** | The target load is worked out from business numbers (visitors, time window, peak factor) and agreed: requests per second per endpoint and response-time budgets. | The worked target and who agreed it. | Tier 2 | B |
| P-02 | **Load tested at and above target** | A stepped load test reaches at least 150% of target on a production-like setup, with results per step (rate achieved, p95 response time, errors). | Load test results. | Tier 2 | A |
| P-03 | **Load tests are repeated and kept** | The load test was run at least twice, and every run is kept, failures included. | All run results. | Tier 2 | A |
| P-04 | **Limited things survive a rush** | Stock, seats, coupons and balances survive many simultaneous buyers: never oversold, nobody charged twice.<br>*Only if the product sells or allocates something limited (stock, seats, coupons, slots) or takes payments, issues refunds or credits, or holds balances.* | A race test result. | Tier 1 | A |
| P-05 | **Slow partners are tested** | Behaviour is measured with the slowest realistic partner (payment, email, AI): responses of 3 to 10 seconds and time-outs cause no double actions and no pile-up.<br>*Only if the product takes payments, issues refunds or credits, or holds balances or calls an AI model at runtime.* | A slow-partner test result. | Tier 2 | A |
| P-06 | **Hot paths are efficient** | Database queries on the busiest paths use indexes and no query-per-item loops. Hot reads are cached with a stated freshness. | Query plans or code review of the hot paths. | Tier 2 | B |
| P-07 | **Resources are bounded** | Connection pools, queues and request bodies have limits and time-outs. Work fails fast instead of waiting forever. | Configuration and code. | Tier 2 | B |
| P-08 | **Overload is graceful** | Beyond capacity, the app sheds load (a queue page, 'try again', 429 or 503) instead of crashing or slowing everyone down. | A test beyond capacity. | Tier 3 | A |
| P-09 | **Pages are fast for people** | Key pages meet the Core Web Vitals 'good' thresholds on a mid-range phone.<br>*Source: web.dev Core Web Vitals* | Lighthouse or field data. | Tier 3 | A |
| P-10 | **Scaling is planned** | It is written down what to scale first, how quickly it can be scaled, and what peak costs. | The capacity plan. | Tier 3 | B |

## O: Operations (10)

*Will we see problems, and can we recover?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| O-01 | **Health checks are honest** | A liveness check (the process is up) and a readiness check (its dependencies answer) exist and expose nothing internal.<br>*Source: Google SRE: production readiness* | Calls to both, with a dependency down. | Tier 2 | A |
| O-02 | **Restarts and deploys are safe** | On shutdown the app finishes the requests in progress. A deploy or restart drops no requests and loses no data.<br>*Source: Twelve-Factor App, IX Disposability* | A restart under load. | Tier 2 | A |
| O-03 | **Backups restore** | Backups run automatically and a restore has been tried. Possible data loss is within the agreed limit. | Restore log. | Tier 1 | A |
| O-04 | **Rollback works** | Going back to the previous release has been tried against the current database. | Rollback log. | Tier 2 | A |
| O-05 | **Problems reach a person** | Errors, response times and capacity are monitored, and alerts reach a named person who can act.<br>*Source: OWASP Top 10:2025 A09 Security Logging and Alerting Failures* | A test alert, received. | Tier 2 | A |
| O-06 | **Logs are useful and clean** | Logs are structured, carry a request id, and contain no secrets or personal data. | Logs from a test run. | Tier 2 | B |
| O-07 | **The runbook has been tried** | A launch and incident runbook exists, and every step was tried once with tools that exist. | The runbook and a rehearsal log. | Tier 2 | A |
| O-08 | **Risky features can be paused** | Checkout, sign-up or a promotion can be paused without a deploy and without losing data.<br>*Only if the product expects a launch, promotion or other traffic spike or takes payments, issues refunds or credits, or holds balances.* | Pause and resume, then compare data. | Tier 2 | A |
| O-09 | **Server settings fit the platform** | Keep-alive and time-out settings fit the load balancer, and request size limits are set. | Server and load balancer settings. | Tier 2 | B |
| O-10 | **People are ready** | An on-call contact, an escalation path and a way to tell customers about problems are arranged for launch. | The rota and contact list. | Tier 3 | B |

## Q: Quality history (9)

*What has gone wrong before, and is it fixed for good?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| Q-01 | **Defect history is collected** | Defects from git history (fix commits, reverts), the issue tracker, incidents and earlier reviews are collected for the period under review. | History scan output and the sources used. | Tier 1 | B |
| Q-02 | **Recurring problems are identified** | Defects are grouped into problem classes, and every class with two or more occurrences is listed. | The problem classes with their occurrences. | Tier 1 | B |
| Q-03 | **Root causes are named** | Each recurring class has a root cause that explains why it keeps happening (a design or process gap, not 'a typo'), found by reading the actual changes.<br>*Source: Google SRE: postmortem culture* | Root cause per class, with the commits or reports read. | Tier 1 | B |
| Q-04 | **Controls prevent a repeat** | Each recurring class has a control that catches the next occurrence automatically: a test, a code-scanning rule, a database constraint, a type, a CI gate, or an agent rule backed by one of these. | The control, run against a known example. | Tier 1 | A |
| Q-05 | **Fixes come with regression tests** | Each bug fix adds a test that fails without the fix. | A sample of fix commits. | Tier 2 | B |
| Q-06 | **Hotspots are examined** | Files with the most fixes were reviewed in depth, and a refactor or extra tests are planned where needed. | Hotspot list and notes. | Tier 2 | B |
| Q-07 | **Known problems are registered** | Every open known problem is listed with severity, owner and due date. | The register. | Tier 1 | B |
| Q-08 | **Fixes of fixes are explained** | Reverts and repeated fixes in the same place are explained, and their cause is covered by a control. | The reverts and repeat fixes, with notes. | Tier 2 | B |
| Q-09 | **The trend is measured** | Defects per problem class are compared with the previous review, to show the controls work.<br>*Source: DORA: change failure rate* | Counts from both reviews. | Tier 3 | A |

## U: Acceptance and report (8)

*Does it do what we agreed, and can the owner understand the result?*

| ID | Criterion | Standard | Evidence | Mandatory from | Lowest grade |
|---|---|---|---|---|---|
| U-01 | **Criteria are agreed first** | Acceptance criteria are numbered, versioned and agreed by the product owner before testing. Changes are approved again. | The criteria file and its approvals. | Tier 1 | B |
| U-02 | **Must criteria pass reliably** | Every Must criterion passes three runs in a row with no retries. | The acceptance run. | Tier 1 | A |
| U-03 | **Evidence can be seen** | User-visible behaviour has screenshots or recordings attached to each result. | The attachments. | Tier 1 | A |
| U-04 | **Verdict first, in plain words** | The first screen of the report gives the verdict, the reason and the blockers in plain language. | The report. | Tier 1 | B |
| U-05 | **Every result is readable** | Each result has a plain-language impact. Numbers have units and the target beside them. Technical terms are in a glossary. | The report. | Tier 1 | B |
| U-06 | **Every claim links its evidence** | Each result links to its evidence, and whatever wasn't checked is listed. | The report. | Tier 1 | B |
| U-07 | **The review can be repeated** | The report records the commit, date, tool versions and reviewer, so the review can be repeated. | The report. | Tier 1 | B |
| U-08 | **Key pages are accessible** | Key pages have no serious or critical accessibility violations in automated WCAG 2.1 AA checks.<br>*Source: WCAG 2.1* | Accessibility scan output. | Tier 2 | A |

