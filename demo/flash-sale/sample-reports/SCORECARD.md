# Scorecard: what the skills caught on the demo

## How this was measured
- **Launch review**: for every version, a fresh Claude Code agent ran the `launch-review` skill. It wasn't allowed to read the answer key, the other variant or the acceptance test code, and had to write its findings *before* seeing the test results. Every Critical was reproduced against a local instance. The most surprising claims were re-run independently afterwards (marked ✔︎).
- **Peak traffic**: `peak-traffic-test` with the brief in `demo/flash-sale/peak-brief.json`: a 600 req/s target, steps from 50% to 200%, plus 1,000 double-clicking buyers racing for 100 pairs.
- **Acceptance**: `acceptance-test`, each test run 3× without retries. Criteria v1.0 had 10 criteria; v1.1 (round 2) rewords one and adds three.

| | naive | fixed, round 1 | fixed, round 2 |
|---|---|---|---|
| Launch review | **NO-GO**: 10 Critical, 6 High ([report](naive/launch-review/REPORT.md)) | **NO-GO**: 1 Critical, 6 High ([report](fixed-round1/launch-review/REPORT.md)) | **NO-GO**: 0 Critical, 1 High; 16 of 23 round-1 findings fixed and verified ([report](fixed-round2/launch-review/REPORT.md)) |
| Load test (600 req/s target) | Breaks at 50% ([summary](naive/launch-review/peak-traffic/load-summary.md)) | Holds 200% ([summary](fixed-round1/launch-review/peak-traffic/load-summary.md)) | Target passes in 3 of 3 runs; 200% in 2 of 3 ([all runs](fixed-round2/launch-review/peak-traffic/RUNS.md)) |
| Oversell race (100 pairs) | **1,962 sold**, 963 charged twice | 96 sold, 0 double ([summary](fixed-round1/launch-review/peak-traffic/oversell-summary.md)) | 100 sold, 0 double, nothing stuck ([summary](fixed-round2/launch-review/peak-traffic/oversell-summary.md)) |
| Slow payment provider (~3 s) | n/a (no timeout at all) | **57 payments for 39 pairs** ✔︎ | 40 for 40 ✔︎ and 60 for 60; repeat clicks refused |
| Acceptance | 3 Must criteria fail ([matrix](naive/launch-review/acceptance/ACCEPTANCE.md)) | All 10 pass ([matrix](fixed-round1/launch-review/acceptance/ACCEPTANCE.md)), but AC-08 encoded a risky behaviour | All 13 pass, v1.1 ([matrix](fixed-round2/launch-review/acceptance/ACCEPTANCE.md)) |

## Naive: 19 of 20 planted issues found

| Planted ([answer key](../ANSWER_KEY.md)) | Found as | |
|---|---|---|
| P1 Overselling | PERF-01 (Critical) | ✅ |
| P2 Duplicate orders | PERF-02 (Critical) | ✅ |
| P3 Charging before reserving | Inside PERF-01's fix and ARC-01 (non-transactional checkout) | ✅ (not a separate finding) |
| P4 N+1, no cache | PERF-05, PERF-07 | ✅ |
| P5 No payment timeout | PERF-03 | ✅ |
| P6 Email inside the request | PERF-06 | ✅ |
| P7 `readFileSync` per request | PERF-07 | ✅ |
| P8 Pool waits forever | PERF-04 | ✅ |
| P9 No rate limit | SEC-08 | ✅ |
| S1 Hard-coded payment key | SEC-06 (escalated: rotate now) | ✅ |
| S2 Forgeable token | SEC-02 | ✅ |
| S3 SQL injection | SEC-01 | ✅ |
| S4 IDOR on orders | SEC-04 | ✅ |
| S5 Open admin endpoints | SEC-03 | ✅ |
| S6 Price from the browser | SEC-05 | ✅ |
| S7 Malformed JSON crashes the server | SEC-07 | ✅ |
| S8 Stack traces to the client | SEC-09 | ✅ |
| S9 No security headers, CORS `*` | SEC-10, SEC-11 | ✅ |
| S10 PII in API responses and logs | SEC-04, OPS-04 | ✅ |
| O1 No health check / graceful shutdown / server timeouts | not reported | ❌ missed: the operations checklist didn't list these (since added) |

**Real problems found that we hadn't planted**: a malformed `Host` header crashes the server ✔︎; every start-up deletes all orders; the "midnight" start isn't enforced; no database constraints. None of the 30 findings was a false alarm on inspection.

## Fixed, round 1: what three passing test layers missed
The first "fixed" version passed the load test at 2× target, the oversell race and every acceptance criterion. The review still said NO-GO:
- **SEC-01 (Critical) ✔︎:** one `GET //` crashes the only server. The bug was introduced while fixing the naive version's Host-header crash.
- **ARC-01 (High) ✔︎:** when the payment provider answers in about 3 s, the app times out and tells the shopper to retry, but the provider has already charged. Result: 57 payments for 39 pairs. The tests couldn't see this because the payment stub never completed a charge the app had abandoned. Acceptance criterion AC-08 even *required* the risky behaviour.
- Also: no shipping address collected, no enforced start time, stuck paid orders when the database was busy, a shared-token "delete everything" endpoint, and a start-up that wiped data.

## Fixed, round 2: the fix-and-verify loop
All 23 round-1 findings were re-checked against the new code with evidence:
- **16 fixed and verified.** These include the crash (7 malformed paths now get 400), double charges (40/40 and 60/60; repeat clicks get 409), stuck orders (0 of 3 runs), missing addresses, early opening, and the start-up wipe (orders survive a restart).
- **5 partially fixed:**
  - email normalisation applies only to the test login;
  - emails are queued durably, but sending is still simulated;
  - logs have no request ids;
  - sessions don't survive a new tab;
  - backups and alerting are still unverified.
- **2 left as conditions:** production safety depends on `NODE_ENV`; run one server only.

The fresh review then found **13 new issues in the new and old code**:
- **ARC-11 (High) ✔︎:** changing `SALE_STARTS_AT` after the first start does nothing while the log claims it did, and `"Nov 27"` is accepted as 27 Nov 2001.
- **PERF-04 ✔︎:** a countdown longer than about 25 days overflows the browser timer and reloads non-stop.
- **ARC-15 ✔︎ (found from the acceptance screenshots):** the sign-in form never hides, because a CSS rule overrides `hidden`. It had been there since the very first version; neither round-1 review nor any test caught it.
- **The runbook's rollback fails against the new schema**, and the runbook relies on operator tools that don't exist.

Verdict: still **NO-GO**, for two reasons:
- One High (ARC-11, a small fix).
- The production card-payment and sign-in integrations aren't in the demo, so the real payment flow has never been tested. Under the severity rules that blocks GO for a shop, and **no demo can clear it**: only a real integration and a real test purchase can.

## What we changed in the skills after each run
- **After round 1:**
  - health check, graceful shutdown, timeouts and safe restarts added to the operations checklist;
  - a new Semgrep rule `url-parse-outside-try`;
  - "a timeout is *unknown*, not *failed*" added across the checklists, anti-patterns and the acceptance guide.
- **After round 2:**
  - run load tests more than once and keep every run; compare against the previous version on the same day before calling a regression;
  - the oversell check understands orders awaiting payment confirmation;
  - settings that must be right on the day: single source of truth, strict time-zone-aware parsing;
  - browser timer overflow added to the anti-patterns;
  - acceptance tests should also assert what should *disappear*;
  - every runbook step must be backed by a tool that exists and has been tried.

## Skill and reading tests (27 October 2026)

After the review standard and the `prepare-review` skill were added, we checked two things. Do the skills produce these results when someone else runs them? Can the people they are written for understand the output? Every tester was a fresh Claude Code agent with no access to the answer key or the reference review.

**Trigger test.** 16 plain requests ("is this ready to go live?", "get my project ready to hand in", "will it survive Black Friday?"…), each checked for which skill it starts. All 16 started the right skill, 5 of them with only medium confidence. That led to two changes: descriptions now say which skill is for the author and which for the reviewer, and narrow questions ("just the architecture") get a focused review.

**Reading tests, two rounds.** Agents read the review page, README and demo in a given role: product owner, executive, developer, newcomer to the README, author of a project. They answered what they would do next, and pointed at whatever stopped them.
- **Round 1** found errors in our own reference example:
  - it said "everything is fixed" when 16 of 23 problems were;
  - counts typed in prose disagreed with the tables;
  - the known-problems register left some findings out.
- The developer reader also found **a counting bug in the race test** (erratum below).
- Round 1 led to:
  - the page leading with what the owner must do: who, how big, when, and what happens if they launch anyway;
  - a README rewritten for newcomers;
  - a plain-language [hand-in guide](../../../docs/hand-in-guide.md).
- **Round 2** (owner and developer) led to:
  - every count on the page computed from the data;
  - a list of decisions only the owner can make;
  - a card under What to fix for every blocker.

**Author test.** An agent used `prepare-review` to hand in the `naive/` version. The submission gate passed: 6 journeys with screenshots, 27 evidence files, and the README's nine items. The hand-in was honest: 7 of 13 acceptance criteria failing and 14 known problems declared. The agent also reported 17 problems with the skill itself (unclear steps, commands that failed, missing fields), all fixed.

**Reviewer test 1: the fixed version, from scratch.**
- **Verdict:** NO-GO, the same as the reference review, and a result for all 95 mandatory criteria.
- **Agreement with the reference:**
  - 68 of 95 criteria (72%) got the same result;
  - on the 44 clear-cut criteria (ones the reference measured, or where it confirmed a problem), 34 matched (77%).
- **Problems:** it found every major problem the reference had, plus one new High (ARC-16): production starts without `DB_FILE` or `PAYMENT_URL`, so a restart loses every order. We added ARC-16 to the reference and corrected the reference rows it showed to be wrong.

**Reviewer test 2: the naive version, from the author's hand-in.**
- **Verdict:** NO-GO. The review gate passed: 95 of 95 mandatory criteria judged, 20 of 20 open Critical and High findings listed as blockers, and 18 of 18 blockers with a card. It made 23 findings.
- **What it added to the hand-in:**
  - SQL injection;
  - one malformed request crashing the server;
  - shutdown that loses paid orders;
  - load results: the shop breaks at 50% of the target, sold 1,948 orders for 100 pairs, and charged 37 of 60 slow-payment buyers twice.
- **Against the [answer key](../ANSWER_KEY.md): 19 of 20 planted problems found**, the same score as the first review, but it missed a different one:

| Planted | Found as |
|---|---|
| P1 Overselling | ARC-02 (Critical) |
| P2 Duplicate orders | ARC-03 (Critical) |
| P3 Charging before reserving | ARC-02's fix, and the history section; not a separate finding |
| P4 N+1, no cache | PERF-01 |
| P5 No payment timeout | ARC-04 |
| P6 Email inside the request | criterion A-05 (no finding card) |
| P7 `readFileSync` per request | ❌ **missed**: Semgrep flagged it and the system map described it, but it never reached the report |
| P8 Pool waits forever | criterion P-07 (no finding card) |
| P9 No rate limit | SEC-06 |
| S1 Hard-coded payment key | SEC-04 |
| S2 Forgeable token | SEC-01 |
| S3 SQL injection | SEC-03 |
| S4 IDOR on orders | SEC-02 |
| S5 Open admin endpoints | SEC-05 |
| S6 Price from the browser | ARC-01 |
| S7 Malformed JSON crashes the server | ARC-06 |
| S8 Stack traces to the client | SEC-08 |
| S9 No security headers, CORS `*` | SEC-07 |
| S10 PII in API responses and logs | SEC-02, SEC-09 |
| O1 No health check / graceful shutdown / server timeouts | ✅ criteria O-01, O-09 and OPS-02: missed by the first review, found now that the checklist has them |

P7 is a dropped lead, not a lack of knowledge, so the review gate now counts it. It reads the scanner output and fails if any rule that fired has no entry saying what became of it: reported (with the finding) or dismissed (with a reason). Run against this review, the gate lists 14 rules without an entry, P7's among them.

**Other changes from the tests:**
- the README check runs when the project is handed in, not at the end of the review;
- the history scan says when there is too little history to learn from (the naive version has one commit);
- the skill now gives the Lighthouse command for the phone page-speed check.

**Erratum.** The round-2 race test reported "1,998 rejected" for 2,000 clicks with 100 accepted (in `fixed-round2/…/oversell-summary.md` and `findings/architecture.md`, kept as originally produced). The script counted every accepted click that wasn't "awaiting payment" as rejected as well, so 98 accepted clicks were counted twice. The correct count is 1,900 rejected. The verdict (no overselling) was right, because it rests on the orders in the database. The script now puts each response in exactly one bucket and flags a problem if accepted + rejected + errors doesn't equal the clicks sent.

**Limits of these tests.** The testers are AI agents playing a role, so their reading is a minimum bar, not proof that a real owner understands the page. All three test apps come from this repository. The scores are single runs, and a second run would vary. Reviewer agents weren't allowed to write some report files in this environment, so they returned that text to us. That is a limit of the test setup, not of the skill.

## Inspection test (28 October 2026)

The review was rebuilt as a pre-delivery inspection: three questions answered first and counted by software, then how the inspection was done, the results, the recommendations and the evidence, with `REPORT.md` generated instead of written by hand. A fresh agent then inspected `naive/` with the new skill, as the demo README suggests, with no access to the answer key or earlier reviews. This time it also had [`pilot-issues.json`](../pilot-issues.json), 16 simulated tickets from a pilot sale. The tickets point at many planted problems, so this run tested the report, not detection, and its findings aren't compared with the answer key.

- **Result:** NO-GO, and every count in the final gate passed (22 checks).
- **The three answers:**
  - test harness: No, 0 of 13 checks met;
  - performance tests: Partly, 6 of 8 kinds run, 1 passed and 5 failed;
  - hidden problems: Yes, 9 of 9 places examined.
- **The tickets** became 7 recurring problems, each with the kinds of test that would catch it. Three tickets had been closed as "could not reproduce" and filed again. The report recommended unit, integration, browser, visual, self-check, load and race tests and automatic scans, each with the skills that help.
- **Cost:** about 33 minutes and 400,000 tokens.

**What it exposed, and what changed:**
- **The report said more than the evidence.** It claimed every hidden problem had been missed by the tests, but the project's failing tests had caught some. It counted a check that couldn't be verified as not met, and it showed the "needed to verify" text as if it were evidence. All three are fixed.
- **Green answers next to a NO-GO read as good news.** The report now says the answers measure how complete the testing and the inspection are, not whether the app is ready.
- **The harness recommendations ran together.** They are now numbered, most needed first. The wording also separates "add", "strengthen" and "run in CI".
- **The developer appendix couldn't be acted on.** It had no location, evidence or "done when". Each finding now has all of them, on the page too.
- **The ticket scan dropped tickets.** It read only 11 of the 16, dropping those labelled security, performance or ui, and filed double charges under display problems because they mentioned "page" or "button". It now reads all 16 and groups them sensibly; the reviewer still regroups them by root cause.
- **The race test exited "success" even when it failed,** so a CI job built on it would pass. It now fails on overselling or double charges.
- **The load test passed buying although it was measuring "sold out" answers.** It now warns when most answers in a step were expected refusals. Our own reference example had the same blind spot: in its load test 93–100% of buy answers were "sold out". The example now says buying under a rush is judged by the race test.
- **Unclear instructions, now spelled out:**
  - how to build the record when nothing was handed in (a review template lays out every field);
  - when to treat a project as AI-built;
  - which results are "doesn't meet" and which "can't verify";
  - that quoting measurements is fine;
  - scanner rules with mixed hits;
  - what checks on a local copy prove;
  - settings for a slow partner when the app has no time limit;
  - a command to watch the load generator.

## Takeaways
- **Each layer catches what the others can't.** Scanners catch secrets and patterns. The review catches logic, failure modes and operations. The load test measures capacity. The oversell race tests concurrency. Acceptance tests check agreed behaviour, and their screenshots are evidence a reviewer can read.
- **Fixes need re-review, not just re-testing.** Each round of fixes introduced at least one new problem that only a fresh, sceptical review found.
- **A verdict is only as good as its coverage.** The round-2 report says exactly what would turn NO-GO into GO WITH CONDITIONS, and what it couldn't check.
