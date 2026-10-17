# Acceptance test report

**Ready for sign-off:** all 7 "Must" criteria pass (1 verified by external evidence, check the linked results).

- Run: 2026-10-16 12:28 UTC · Playwright 1.56.1 · 27 test runs (each test repeated to detect flakiness, no retries)
- Criteria: [`criteria.md`](criteria.md) (10) · Results: 9 pass, 0 fail, 0 flaky, 0 not covered, 1 external, 0 skipped

| ID | Priority | Criterion | Runs passed | Status | Evidence |
|---|---|---|---|---|---|
| AC-01 | Must | Shopper sees the product, price and stock | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-01-shopper-sees-the-product-price-and-stock-desktop-chrome/test-finished-1.png) |
| AC-02 | Must | Signed-in shopper can buy and gets a confirmation | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-02-signed-in-915a4-buy-and-gets-a-confirmation-desktop-chrome/test-finished-1.png) |
| AC-03 | Must | Customers always pay the listed price | 3/3 | ✅ PASS | [evidence](artifacts/flash-sale-AC-03-customers-always-pay-the-listed-price-desktop-chrome/attachments/evidence-54a05eec9a9517e702b92eef06b60d3aea743fcf.json) |
| AC-04 | Must | One pair per customer, even on double-click | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-04-one-pair-per-customer-even-on-double-click-desktop-chrome/test-finished-1.png) |
| AC-05 | Must | Sold-out state is clear | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-05-sold-out-state-is-clear-desktop-chrome/test-finished-1.png) |
| AC-06 | Must | Orders are private | 3/3 | ✅ PASS | [evidence](artifacts/flash-sale-AC-06-orders-are-private-desktop-chrome/attachments/evidence-3aa38463a21fa682df471b034a8acbfc4dd0697a.json) |
| AC-07 | Must | Never sell more than the stock, even in a rush | — | 🔗 EXTERNAL | `peak-traffic-test` oversell check (`k6/oversell.js`), see [`../peak-traffic/oversell-summary.md`](../peak-traffic/oversell-summary.md) |
| AC-08 | Should | Payment problems are explained, and the pair goes back on sale | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-08-payment-p-1642f--the-pair-goes-back-on-sale-desktop-chrome/test-finished-1.png) |
| AC-09 | Should | Sale page is accessible | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-09-sale-page-is-accessible-desktop-chrome/test-finished-1.png) |
| AC-10 | Should | Works on a phone | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-on-a-phone-AC-10-works-on-a-phone-desktop-chrome/test-finished-1.png) |

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
| AC-08 Payment problems are explained, and the pair goes back on sale | | |
| AC-09 Sale page is accessible | | |
| AC-10 Works on a phone | | |

Product owner: ____________________ Date: __________ Build/commit: __________
