# Acceptance test report

**Not ready:** 3 "Must" criteria are not passing: AC-03 (FAIL), AC-04 (FAIL), AC-06 (FAIL).

- Run: 2026-10-16 12:27 UTC · Playwright 1.56.1 · 27 test runs (each test repeated to detect flakiness, no retries)
- Criteria: [`criteria.md`](criteria.md) (10) · Results: 5 pass, 4 fail, 0 flaky, 0 not covered, 1 external, 0 skipped

| ID | Priority | Criterion | Runs passed | Status | Evidence |
|---|---|---|---|---|---|
| AC-01 | Must | Shopper sees the product, price and stock | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-01-shopper-sees-the-product-price-and-stock-desktop-chrome/test-finished-1.png) |
| AC-02 | Must | Signed-in shopper can buy and gets a confirmation | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-02-signed-in-915a4-buy-and-gets-a-confirmation-desktop-chrome/test-finished-1.png) |
| AC-03 | Must | Customers always pay the listed price | 0/3 | ❌ FAIL | [evidence](artifacts/flash-sale-AC-03-customers-always-pay-the-listed-price-desktop-chrome/attachments/evidence-7bc9ed98023c882f416ae621d2e4b4d5dd4225d0.json) · [trace](artifacts/flash-sale-AC-03-customers-always-pay-the-listed-price-desktop-chrome/trace.zip) |
| AC-04 | Must | One pair per customer, even on double-click | 0/3 | ❌ FAIL | [screenshot](artifacts/flash-sale-AC-04-one-pair-per-customer-even-on-double-click-desktop-chrome/test-failed-1.png) · [trace](artifacts/flash-sale-AC-04-one-pair-per-customer-even-on-double-click-desktop-chrome/trace.zip) |
| AC-05 | Must | Sold-out state is clear | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-05-sold-out-state-is-clear-desktop-chrome/test-finished-1.png) |
| AC-06 | Must | Orders are private | 0/3 | ❌ FAIL | [evidence](artifacts/flash-sale-AC-06-orders-are-private-desktop-chrome/attachments/evidence-d84285bed8fea658ed72a823b3317671094721a7.json) · [trace](artifacts/flash-sale-AC-06-orders-are-private-desktop-chrome/trace.zip) |
| AC-07 | Must | Never sell more than the stock, even in a rush | — | 🔗 EXTERNAL | `peak-traffic-test` oversell check (`k6/oversell.js`), see [`../peak-traffic/oversell-summary.md`](../peak-traffic/oversell-summary.md) |
| AC-08 | Should | Payment problems are explained, and the pair goes back on sale | 0/3 | ❌ FAIL | [screenshot](artifacts/flash-sale-AC-08-payment-p-1642f--the-pair-goes-back-on-sale-desktop-chrome/test-failed-1.png) · [trace](artifacts/flash-sale-AC-08-payment-p-1642f--the-pair-goes-back-on-sale-desktop-chrome/trace.zip) |
| AC-09 | Should | Sale page is accessible | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-AC-09-sale-page-is-accessible-desktop-chrome/test-finished-1.png) |
| AC-10 | Should | Works on a phone | 3/3 | ✅ PASS | [screenshot](artifacts/flash-sale-on-a-phone-AC-10-works-on-a-phone-desktop-chrome/test-finished-1.png) |

## What needs attention

### AC-03 · Must · ❌ FAIL: Customers always pay the listed price

- **Given** a signed-in shopper
- **When** the purchase request is tampered with to say the price is $0.01
- **Then** the order is either refused or charged at the listed $49.99, never at the tampered price

What the test saw:
- `Error: charged amount expect(received).toBe(expected) // Object.is equality Expected: 4999 Received: 1`

Tests: `AC-03 customers always pay the listed price`

### AC-04 · Must · ❌ FAIL: One pair per customer, even on double-click

- **Given** a signed-in shopper
- **When** they double-click "Buy now"
- **Then** exactly one order exists for them

What the test saw:
- `Error: orders for this customer expect(received).toHaveLength(expected) Expected length: 1 Received length: 2`

Tests: `AC-04 one pair per customer, even on double-click`

### AC-06 · Must · ❌ FAIL: Orders are private

- **Given** shopper A has placed an order
- **When** shopper B (or a logged-out visitor) requests A's order by its number
- **Then** they get "not found" and none of A's details

What the test saw:
- `Error: Bob must be refused (HTTP 401/403/404) when asking for Alice's order expect(received).toBeGreaterThanOrEqual(expected) Expected: >= 400 Received:    200`

Tests: `AC-06 orders are private`

### AC-08 · Should · ❌ FAIL: Payment problems are explained, and the pair goes back on sale

- **Given** the payment provider is not responding
- **When** a signed-in shopper clicks "Buy now"
- **Then** within 5 seconds they see a message that the payment did not go through
- **And** the pair is available again for other shoppers

What the test saw:
- `Error: expect(locator).toHaveText(expected) failed Locator: getByTestId('message') Expected pattern: /payment did not go through/i Received string:  "Placing your order…"`

Tests: `AC-08 payment problems are explained and the pair goes back on sale`

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
