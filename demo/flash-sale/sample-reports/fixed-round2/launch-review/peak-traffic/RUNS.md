# Load-test runs for round 2 (all kept; none discarded)

All runs: same plan (`plan.json`), same 4-core machine running the app, the payment simulator and k6 together.

| Run | Code | Result | Worst step |
|---|---|---|---|
| 1 (`load-summary.md`) | round 2 | **FAIL at 150%**: 481 product-page requests not sent (1.2%) during a latency spike (p99 448 ms) | 150%: p95 206 ms |
| 2 (`load-summary-run2.md`) | round 2 | PASS to 200% | 200%: p95 33 ms, p99 140 ms |
| 3 (`load-summary-run3.md`) | round 2 | PASS to 200% | 200%: p95 67–79 ms, p99 163–199 ms |
| Baseline (`load-summary-round1-code-same-day.md`) | round 1 (commit `448562b`) | PASS to 200% | 200%: p95 73–84 ms, p99 287–299 ms |

Reading: round 2 is not slower than round 1 on the same day (its tail latency is equal or better). The run-to-run spread comes from everything sharing one machine. Safe conclusion: **the expected peak (100%) passes in every run with p95 ≤ 5 ms; headroom above 150% is not reliably established on this machine.** Re-test on production-sized infrastructure with k6 on a separate machine before relying on 2× headroom.
