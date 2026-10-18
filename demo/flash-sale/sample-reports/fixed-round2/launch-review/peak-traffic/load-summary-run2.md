# Load test: Midnight sneaker drop (demo)

**PASS: handled the target load (600 req/s).**

- Holds up to **200% of target** (1200 req/s) with every request type inside its speed budget.
- Did not break within the tested range. Headroom above the highest step is unknown.

Target: 3000 visitors in 60 s with 3× peaks = 600 req/s. Each step ran 20 s against http://127.0.0.1:3000.

| Step | Request | Target req/s | Achieved req/s | Median | p95 (budget) | p99 | Errors | 5xx | Timeouts | Not sent | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50% | Product page | 225 | 225.1 | 1 ms | 3 ms (500 ms) | 27 ms | 0.0% | 0 | 0 | 0 | PASS |
| 50% | Buy | 75 | 75.1 | 1 ms | 131 ms (1.50 s) | 210 ms | 0.0% | 0 | 0 | 0 | PASS |
| 100% | Product page | 450 | 450.1 | 1 ms | 1 ms (500 ms) | 5 ms | 0.0% | 0 | 0 | 0 | PASS |
| 100% | Buy | 150 | 150.1 | 1 ms | 2 ms (1.50 s) | 4 ms | 0.0% | 0 | 0 | 0 | PASS |
| 150% | Product page | 675 | 675.1 | 1 ms | 9 ms (500 ms) | 47 ms | 0.0% | 0 | 0 | 0 | PASS |
| 150% | Buy | 225 | 225.1 | 1 ms | 6 ms (1.50 s) | 26 ms | 0.0% | 0 | 0 | 0 | PASS |
| 200% | Product page | 900 | 900.1 | 1 ms | 33 ms (500 ms) | 140 ms | 0.0% | 0 | 0 | 0 | PASS |
| 200% | Buy | 300 | 300.1 | 1 ms | 23 ms (1.50 s) | 116 ms | 0.0% | 0 | 0 | 0 | PASS |

How to read this: *p95* = 95% of requests were faster than this. *Errors* = share of requests that failed (5xx, timeouts, or unexpected status codes). *Not sent* = requests k6 could not start because every simulated shopper was stuck waiting, which is a sign the site had stopped keeping up.
