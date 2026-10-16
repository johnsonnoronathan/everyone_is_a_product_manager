# Load test: Midnight sneaker drop (demo)

**FAIL: did not handle the target load (600 req/s).**

- Did not pass even the first (lowest) step.
- Breaks at **50% of target** (300 req/s): Product page: too slow (p95 2.63 s > 500 ms); 473 requests never sent (all virtual users stuck waiting) / Buy: 1.8% errors

Target: 3000 visitors in 60 s with 3× peaks = 600 req/s. Each step ran 20 s against http://127.0.0.1:3000.

| Step | Request | Target req/s | Achieved req/s | Median | p95 (budget) | p99 | Errors | 5xx | Timeouts | Not sent | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50% | Product page | 225 | 201.4 | 1.86 s | 2.63 s (500 ms) | 2.65 s | 0.0% | 0 | 0 | 473 | FAIL: too slow (p95 2.63 s > 500 ms); 473 requests never sent (all virtual users stuck waiting) |
| 50% | Buy | 75 | 75.1 | 807 ms | 1.01 s (1.50 s) | 10.00 s | 1.8% | 0 | 27 | 0 | FAIL: 1.8% errors |
| 100% | Product page | 450 | 209.7 | 4.49 s | 5.30 s (500 ms) | 5.32 s | 0.0% | 0 | 0 | 4808 | FAIL: too slow (p95 5.30 s > 500 ms); 4808 requests never sent (all virtual users stuck waiting) |
| 100% | Buy | 150 | 150.1 | 734 ms | 1.57 s (1.50 s) | 1.62 s | 0.97% | 0 | 29 | 0 | FAIL: too slow (p95 1.57 s > 1.50 s) |
| 150% | Product page | 675 | 229.2 | 6.69 s | 6.86 s (500 ms) | 6.86 s | 0.0% | 0 | 0 | 8917 | FAIL: too slow (p95 6.86 s > 500 ms); 8917 requests never sent (all virtual users stuck waiting) |
| 150% | Buy | 225 | 225.1 | 486 ms | 503 ms (1.50 s) | 509 ms | 0.0% | 0 | 0 | 0 | PASS |
| 200% | Product page | 900 | 229.1 | 7.54 s | 7.71 s (500 ms) | 7.74 s | 0.0% | 0 | 0 | 13420 | FAIL: too slow (p95 7.71 s > 500 ms); 13420 requests never sent (all virtual users stuck waiting) |
| 200% | Buy | 300 | 300.1 | 548 ms | 569 ms (1.50 s) | 601 ms | 0.0% | 0 | 0 | 0 | PASS |

How to read this: *p95* = 95% of requests were faster than this. *Errors* = share of requests that failed (5xx, timeouts, or unexpected status codes). *Not sent* = requests k6 could not start because every simulated shopper was stuck waiting, which is a sign the site had stopped keeping up.
