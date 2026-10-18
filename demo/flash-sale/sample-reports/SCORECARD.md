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

## Takeaways
- **Each layer catches what the others can't.** Scanners catch secrets and patterns. The review catches logic, failure modes and operations. The load test measures capacity. The oversell race tests concurrency. Acceptance tests check agreed behaviour, and their screenshots are evidence a reviewer can read.
- **Fixes need re-review, not just re-testing.** Each round of fixes introduced at least one new problem that only a fresh, sceptical review found.
- **A verdict is only as good as its coverage.** The round-2 report says exactly what would turn NO-GO into GO WITH CONDITIONS, and what it couldn't check.
