---
name: peak-traffic-test
description: Checks whether a web app will survive a traffic spike (flash sale, Black Friday, product launch, ticket drop, TV mention, marketing email blast) and still behave correctly. It turns business numbers into a target load, finds code patterns that collapse or oversell under load, runs a staged k6 load test plus a race-condition "oversell" test, and writes a plain-language verdict for non-engineers. Use when someone asks "will my site handle the traffic", "how many users can we take", "load test", "stress test", "QPS", "capacity", "flash sale", "we're launching / running a promotion", or when launch-review hands off its performance section.
---

# Peak-traffic test

Answer one question with evidence: **will this app handle the expected peak, and will it still be correct while doing it?**
The user is usually a product manager or founder, not an engineer. Speak in business terms (visitors, orders, seconds of waiting, oversold units) and explain every technical term the first time you use it.

Code review alone can't answer the question. Reading code finds *likely* bottlenecks; only a load test measures the real limit. Do both, and never present a guess as a measurement.

`<skill-dir>` below means this skill's base directory (shown when the skill loads). Put all outputs in `launch-review/peak-traffic/` in the project being tested.

## Safety rules (non-negotiable)

1. **Never load-test production, or any URL, without explicit written confirmation from the user** that (a) they own or are authorised to test it and (b) it's OK if it slows down or breaks. Default target is a staging/preview environment. A load test against someone else's site is a denial-of-service attack.
2. **Third parties must be in test mode.** Payment (Stripe/PayPal test keys), email/SMS (sandbox or disabled), analytics, webhooks. Otherwise you create real charges, spam real people, or get the account suspended. Check env vars/config before running; ask if unsure.
3. **Check the host's rules.** Some hosting/CDN plans forbid or rate-limit load tests, or need notice. Say so if you can't confirm.
4. **Start small.** Always run a 10-second smoke test at low rate first, check it produced sane responses (not 401/404/redirects to login), then run the full plan.
5. **Data:** load tests create orders/users. Use a test product and a resettable environment. Never run the oversell test against real inventory.

## Workflow

### 1. Understand the event → traffic brief
Run the short interview in `references/capacity-interview.md` (≤ 8 questions, business language). Explore the code first so you can propose answers instead of asking blank questions (find the routes the user journey hits, the frontend calls each page makes, polling intervals, auth flow).

**Requests must mirror what the real frontend sends** (same path, headers, body fields). Read the frontend code or a browser HAR for each journey step. A load test that sends different requests measures a different system.

Write `launch-review/peak-traffic/brief.json`, then:
```bash
node <skill-dir>/scripts/capacity.mjs launch-review/peak-traffic/brief.json launch-review/peak-traffic/plan.json
```
Show the printed plan table to the user and get a "yes, those numbers are right" before testing. If they can't estimate, use the conservative defaults in the interview guide and label them as assumptions in the report.

### 2. Static review for peak-traffic anti-patterns
- If `semgrep` is installed: `semgrep scan --metrics=off --disable-version-check --config <skill-dir>/semgrep/ --json -o launch-review/peak-traffic/semgrep.json <src-dirs>`. These are our own rules (safe for commercial use). Treat hits as leads.
- Then review the hot path by reading code (every handler in the journey, plus what it calls) against `references/anti-patterns.md`. That catalogue covers what rules can't see: missing caching, connection-pool limits, serverless + database connection storms, hot rows/documents, third-party rate limits, in-memory state that breaks with more than one server, cache stampedes.
- For every finding record: file:line, what happens at peak in one plain sentence, severity, and the fix. Confirm each by reading the surrounding code; drop anything you can't confirm.

### 3. Load test (needs k6 and a safe target)
Check `k6 version`. If missing, give install options (`brew install k6`, `winget install k6`, `choco install k6`, Docker `grafana/k6`, or the binary from github.com/grafana/k6/releases) and continue with the static review meanwhile.

```bash
# smoke test first: 10 s at 2 req/s per request type; must say "requests look sane"
k6 run -q -e SMOKE=1 -e PLAN=$PWD/launch-review/peak-traffic/plan.json <skill-dir>/k6/load.js
# full staged test
k6 run -q -e PLAN=$PWD/launch-review/peak-traffic/plan.json -e OUT_DIR=$PWD/launch-review/peak-traffic <skill-dir>/k6/load.js
```
- Exit code 99 means thresholds were crossed, i.e. the app failed some step. That's a result, not a tool error. Read `load-summary.md` / `load-summary.json`.
- The test runs each step (50/100/150/200% of target by default) at a fixed arrival rate and judges each request type against its speed budget and error budget. It reports the highest step that passed and why the next one failed.
- **Run it more than once.** Run the full plan at least twice (three times if the results differ), keep every summary, and judge on the worst run. Before calling a slowdown a regression, run the previous version under the same conditions on the same day: shared machines are noisy.
- **Watch the load generator.** If the machine running k6 is above ~80% CPU, the numbers are about the laptop, not the app. Sample it while the test runs, for example `vmstat 5` (Linux and macOS: the `id` column is the idle share) or `top -l 0 -s 5` on macOS, and keep the output with the results. One laptop can usually generate a few thousand simple requests/second. For bigger targets run k6 from a cloud VM near the app or use Grafana Cloud k6, and say so in the report.
- While it runs, ask the user (or check yourself if you have access) to watch the app's dashboards: CPU, memory, DB connections, DB CPU, error logs. Note which resource ran out first; that is the bottleneck to fix.

**Slow partners:** if the test stack uses a stub for payments/email, also run one short test with the stub's latency set just around the app's timeout (e.g. 2.9–3.1 s for a 3 s timeout), then compare the provider's charge count with paid orders. If the app has no time limit at all, use two settings instead: about 3 s (slow) and 12–18 s (longer than people wait before clicking again). Stubs that never complete abandoned calls hide double charges (anti-pattern A5).

### 4. Oversell / double-order test (when anything has limited stock or "one per customer")
Add an `oversell` section to the brief (see the interview guide), regenerate the plan, then:
```bash
k6 run -q -e PLAN=$PWD/launch-review/peak-traffic/plan.json -e OUT_DIR=$PWD/launch-review/peak-traffic <skill-dir>/k6/oversell.js
```
It fires N buyers (each double-clicking) at the same instant against a small stock and checks: sold ≤ stock, nobody charged twice, and (if a stats/admin endpoint or DB query is available) that the database agrees. **Any oversell or double charge is a launch blocker**, however fast the site is. If there's no stats endpoint, query the database yourself after the run and add the numbers to the report.

### 5. Fix → re-test loop
Offer to fix findings in priority order (correctness first, then the first bottleneck the load test hit). After fixes, re-run the same plan unchanged so before/after numbers are comparable. Never edit thresholds or the plan to make a failing result pass.

### 6. Report
Write `launch-review/peak-traffic/REPORT.md` from `references/report-template.md`. Rules:
- Lead with the verdict in one sentence a PM can forward: "Handles 2× the expected peak" or "Breaks at 40% of the expected peak; checkout takes 8 s and 1,869 customers would be sold sneakers that don't exist".
- Every number must come from `load-summary.json` / `oversell-summary.json` / semgrep output / code you read. If something wasn't tested, say "not tested" and why.
- State the test conditions: environment, its size versus production, where k6 ran, which third parties were mocked. Results from a smaller staging environment don't transfer linearly to production; say so.
- End with the 3 most valuable fixes, each with expected effect and rough effort (hours/days).

## When used from launch-review
Return: the verdict line, a findings list (severity, file:line, plain-language impact, fix), and links to the summaries. launch-review folds these into its overall go/no-go.
