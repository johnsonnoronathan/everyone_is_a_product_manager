# Scorecard: what the skills caught on the demo

## How this was measured
- **Launch review**: two fresh Claude Code agents each ran the `launch-review` skill on one variant (commit `d572634`). They were not allowed to read the answer key, the other variant or the acceptance test code, and had to write their findings *before* seeing the load-test and acceptance results. Every Critical was reproduced against a local instance; the most surprising claims were re-run independently afterwards (marked ✔︎ below).
- **Peak traffic**: `peak-traffic-test` scripts (k6) with the brief in `demo/flash-sale/peak-brief.json`: 600 req/s target, steps 50–200%, plus 1,000 double-clicking buyers racing for 100 pairs.
- **Acceptance**: `acceptance-test` with 10 agreed criteria, each test run 3× without retries.

| | naive | fixed |
|---|---|---|
| Launch review | **NO-GO**: 10 Critical, 6 High, 12 Medium, 2 Low ([report](naive/launch-review/REPORT.md)) | **NO-GO**: 1 Critical, 6 High, 11 Medium, 5 Low ([report](fixed/launch-review/REPORT.md)) |
| Load test (600 req/s target) | Breaks at 50%: product page p95 2.6 s, requests piling up ([summary](naive/launch-review/peak-traffic/load-summary.md)) | Holds 200% (1,200 req/s): product page p95 ≤ 6 ms, checkout p95 ≤ 128 ms ([summary](fixed/launch-review/peak-traffic/load-summary.md)) |
| Oversell test (100 pairs) | **1,962 sold**, 963 buyers charged twice ([summary](naive/launch-review/peak-traffic/oversell-summary.md)) | 96 sold, 0 double charges ([summary](fixed/launch-review/peak-traffic/oversell-summary.md)) |
| Acceptance (10 criteria × 3 runs) | Not ready: AC-03, AC-04, AC-06 (Must) and AC-08 fail ([matrix](naive/launch-review/acceptance/ACCEPTANCE.md)) | Ready for sign-off ([matrix](fixed/launch-review/acceptance/ACCEPTANCE.md)), but see below |

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
| O1 No health check / graceful shutdown / server timeouts | not reported | ❌ missed: the operations checklist didn't list these (fixed, see below) |

**Real problems it found that we had not planted** (all genuine): a malformed `Host` header crashes the server ✔︎ (part of SEC-07); every start-up deletes all orders (ARC-02); the "midnight" start isn't enforced (ARC-05); no database constraints (ARC-03). None of the 30 findings was a false alarm on inspection.

## Fixed: what three passing test layers missed

The "fixed" variant passed the load test at 2× target, the oversell race and every acceptance criterion. The review still said **NO-GO**, and the two most serious findings hold up:

- **SEC-01 (Critical) ✔︎:** one request to `GET //` crashes the only server (`new URL()` throws outside the `try`, an unhandled rejection ends the process). We introduced it while "fixing" the naive version's Host-header crash. No test sent a malformed URL.
- **ARC-01 (High) ✔︎:** when the payment provider answers in about 3 s, the app times out, tells the shopper "try again" and releases the pair, but the provider may already have charged. Our independent re-run: **57 payments for 39 pairs** (the reviewer's run: 41 for 39). The load and oversell tests couldn't see this: the payment stub never completes a charge the app abandoned. Acceptance criterion AC-08 even *required* the risky behaviour ("the pair goes back on sale"). The review flagged the criterion itself.
- Also real: the page never collects a shipping address (ARC-03), nothing enforces the sale start (ARC-04), a busy database after a successful charge leaves a paid order stuck (ARC-02), and a shared-token "delete everything" admin endpoint would ship (SEC-02). A few findings depend on production wiring the demo doesn't have (start-up seeding, test-login gating); the reviewer correctly marked those *Likely* rather than *Confirmed*.

## What we changed in the skills after this run
- Operations checklist: health check, graceful shutdown, server timeouts and safe automatic restarts (the one planted miss).
- New Semgrep rule `url-parse-outside-try` (flags the crash line in both variants), plus a regression fixture, and a "try `GET //` and a bad Host header" step in the security checklist.
- "A timeout is *unknown*, not *failed*": added to the architecture checklist, peak-traffic anti-patterns (A5), the peak-traffic workflow (test a stub with latency around the timeout), and the acceptance-criteria guide.

## Takeaway
Each layer caught things the others couldn't. Scanners caught secrets and risky patterns. The review caught logic and failure modes. The load test measured capacity. The oversell race tested concurrency. Acceptance tests checked agreed behaviour and caught three Must failures on the naive version. On the fixed version three green test layers still hid a one-request crash and a double-charge path. A trustworthy "ready to launch" needs all of them, plus honest limits on what wasn't checked.

**Not done yet:** a second round of fixes for `fixed/` (and rewording AC-08 with the product owner). Its findings are open.
