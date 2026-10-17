# Load test: Midnight sneaker drop (demo)

**PASS: handled the target load (600 req/s).**

- Holds up to **100% of target** (600 req/s) with every request type inside its speed budget.
- Breaks at **150% of target** (900 req/s): Product page: 481 requests never sent (all virtual users stuck waiting)

Target: 3000 visitors in 60 s with 3× peaks = 600 req/s. Each step ran 20 s against http://127.0.0.1:3000.

| Step | Request | Target req/s | Achieved req/s | Median | p95 (budget) | p99 | Errors | 5xx | Timeouts | Not sent | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50% | Product page | 225 | 225.1 | 1 ms | 3 ms (500 ms) | 14 ms | 0.0% | 0 | 0 | 0 | PASS |
| 50% | Buy | 75 | 75.1 | 1 ms | 128 ms (1.50 s) | 201 ms | 0.0% | 0 | 0 | 0 | PASS |
| 100% | Product page | 450 | 450.1 | 1 ms | 5 ms (500 ms) | 22 ms | 0.0% | 0 | 0 | 0 | PASS |
| 100% | Buy | 150 | 150.1 | 1 ms | 5 ms (1.50 s) | 22 ms | 0.0% | 0 | 0 | 0 | PASS |
| 150% | Product page | 675 | 651 | 1 ms | 206 ms (500 ms) | 448 ms | 0.0% | 0 | 0 | 481 | FAIL: 481 requests never sent (all virtual users stuck waiting) |
| 150% | Buy | 225 | 225.1 | 1 ms | 104 ms (1.50 s) | 182 ms | 0.0% | 0 | 0 | 0 | PASS |
| 200% | Product page | 900 | 900 | 1 ms | 187 ms (500 ms) | 562 ms | 0.0% | 0 | 0 | 1 | PASS |
| 200% | Buy | 300 | 300.1 | 1 ms | 110 ms (1.50 s) | 259 ms | 0.0% | 0 | 0 | 0 | PASS |

How to read this: *p95* = 95% of requests were faster than this. *Errors* = share of requests that failed (5xx, timeouts, or unexpected status codes). *Not sent* = requests k6 could not start because every simulated shopper was stuck waiting, which is a sign the site had stopped keeping up.
