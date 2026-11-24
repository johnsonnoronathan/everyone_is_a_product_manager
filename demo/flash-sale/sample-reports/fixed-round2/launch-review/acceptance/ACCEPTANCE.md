# Acceptance test report

**Ready for sign-off:** all 10 "Must" criteria pass (1 verified by external evidence, check the linked results).

- Run: 2026-10-17 20:34 UTC · Playwright 1.56.1 · 36 test runs (each test repeated to detect flakiness, no retries)
- Criteria: [`criteria.md`](criteria.md) (13) · Results: 12 pass, 0 fail, 0 flaky, 0 not covered, 1 external, 0 skipped

| ID | Priority | Criterion | Runs passed | Status | Evidence |
|---|---|---|---|---|---|
| AC-01 | Must | Shopper sees the product, price and stock | 3/3 | ✅ PASS | [screenshot](artifacts/AC-01/test-finished-1.png) |
| AC-02 | Must | Signed-in shopper can buy and gets a confirmation | 3/3 | ✅ PASS | [screenshot](artifacts/AC-02/test-finished-1.png) |
| AC-03 | Must | Customers always pay the listed price | 3/3 | ✅ PASS | [evidence](artifacts/AC-03/attachments/evidence.json) |
| AC-04 | Must | One pair per customer, even on double-click | 3/3 | ✅ PASS | [screenshot](artifacts/AC-04/test-finished-1.png) |
| AC-05 | Must | Sold-out state is clear | 3/3 | ✅ PASS | [screenshot](artifacts/AC-05/test-finished-1.png) |
| AC-06 | Must | Orders are private | 3/3 | ✅ PASS | [evidence](artifacts/AC-06/attachments/evidence.json) |
| AC-07 | Must | Never sell more than the stock, even in a rush | — | 🔗 EXTERNAL | `peak-traffic-test` oversell check (`k6/oversell.js`), see [`../peak-traffic/oversell-summary.md`](../peak-traffic/oversell-summary.md) |
| AC-08 | Must | Slow or failing payments never charge twice or lose the pair | 3/3 | ✅ PASS | [screenshot](artifacts/AC-08/test-finished-1.png) · [evidence](artifacts/AC-08/attachments/evidence.json) |
| AC-09 | Should | Sale page is accessible | 3/3 | ✅ PASS | [screenshot](artifacts/AC-09/test-finished-1.png) |
| AC-10 | Should | Works on a phone | 3/3 | ✅ PASS | [screenshot](artifacts/AC-10/test-finished-1.png) |
| AC-11 | Must | Every order has a shipping address | 3/3 | ✅ PASS | [screenshot](artifacts/AC-11/test-finished-1.png) · [evidence](artifacts/AC-11/attachments/evidence.json) |
| AC-12 | Must | Nobody can buy before the sale opens | 3/3 | ✅ PASS | [screenshot](artifacts/AC-12/test-finished-1.png) · [evidence](artifacts/AC-12/attachments/evidence.json) |
| AC-13 | Should | The sale can be paused without losing orders | 3/3 | ✅ PASS | [evidence](artifacts/AC-13/attachments/evidence.json) |

## Verified outside this test run

- **AC-07** Never sell more than the stock, even in a rush: `peak-traffic-test` oversell check (`k6/oversell.js`), see [`../peak-traffic/oversell-summary.md`](../peak-traffic/oversell-summary.md). Attach or link the result before sign-off.

## Sign-off

| Criterion | Decision (Accept / Reject / Accept with note) | Note |
|---|---|---|
| AC-01 Shopper sees the product, price and stock | | |
| AC-02 Signed-in shopper can buy and gets a confirmation | | |
| AC-03 Customers always pay the listed price | | |
| AC-04 One pair per customer, even on double-click | | |
| AC-05 Sold-out state is clear | | |
| AC-06 Orders are private | | |
| AC-07 Never sell more than the stock, even in a rush | | |
| AC-08 Slow or failing payments never charge twice or lose the pair | | |
| AC-09 Sale page is accessible | | |
| AC-10 Works on a phone | | |
| AC-11 Every order has a shipping address | | |
| AC-12 Nobody can buy before the sale opens | | |
| AC-13 The sale can be paused without losing orders | | |

Product owner: ____________________ Date: __________ Build/commit: __________
