# Acceptance criteria: Holiday flash sale

- Version: 1.1. v1.0 was agreed with the product owner before tests were written. v1.1 follows the first launch review: AC-08 is reworded (v1.0 required releasing the pair when a payment timed out, which can charge customers twice), and AC-11 to AC-13 cover gaps the review found. In a real engagement the product owner approves each change before tests are updated.
- Scope: sale page, sign-in, checkout, order privacy, sale schedule
- Environment: local demo (`node demo/flash-sale/run.mjs <naive|fixed>`), payments in test mode

### AC-01 · Must · Shopper sees the product, price and stock
- **Given** the sale is live with 100 pairs in stock
- **When** a shopper opens the sale page
- **Then** they see the product name, the price $49.99 and "100 left"

### AC-02 · Must · Signed-in shopper can buy and gets a confirmation
- **Given** a signed-in shopper and stock available
- **When** they click "Buy now"
- **Then** they see "Order #… confirmed — $49.99 charged"
- **And** the order appears in their order history for $49.99

### AC-03 · Must · Customers always pay the listed price
- **Given** a signed-in shopper
- **When** the purchase request is tampered with to say the price is $0.01
- **Then** the order is either refused or charged at the listed $49.99, never at the tampered price

### AC-04 · Must · One pair per customer, even on double-click
- **Given** a signed-in shopper
- **When** they double-click "Buy now"
- **Then** exactly one order exists for them

### AC-05 · Must · Sold-out state is clear
- **Given** the product is sold out
- **When** a shopper opens the sale page
- **Then** they see "Sold out" and cannot press the buy button

### AC-06 · Must · Orders are private
- **Given** shopper A has placed an order
- **When** shopper B (or a logged-out visitor) requests A's order by its number
- **Then** they get "not found" and none of A's details

### AC-07 · Must · Never sell more than the stock, even in a rush
- **Given** 100 pairs and 1,000 shoppers buying at the same moment (each double-clicking)
- **Then** at most 100 orders are confirmed and nobody is charged twice
- **Evidence:** external: `peak-traffic-test` oversell check (`k6/oversell.js`), see `../sample-reports/`

### AC-08 · Must · Slow or failing payments never charge twice or lose the pair
- **Given** the payment provider is not responding
- **When** a signed-in shopper clicks "Buy now"
- **Then** within 5 seconds they see that their payment is being confirmed (they are not asked to pay again)
- **And** once the provider recovers, they have exactly one paid order and were charged exactly once

### AC-09 · Should · Sale page is accessible
- **When** the sale page is checked with axe (WCAG 2.1 A/AA rules)
- **Then** there are no serious or critical violations

### AC-10 · Should · Works on a phone
- **Given** a shopper on a phone-sized screen (Pixel 7)
- **When** they open the sale page
- **Then** the page fits the screen without sideways scrolling and the buy button is visible

### AC-11 · Must · Every order has a shipping address
- **Given** a signed-in shopper
- **When** they try to buy without entering a shipping address (on the page, or with a direct request)
- **Then** they are asked for the address and no order is created

### AC-12 · Must · Nobody can buy before the sale opens
- **Given** the sale opens in the future
- **When** a signed-in shopper opens the sale page
- **Then** they see when the sale opens and cannot press the buy button
- **And** a direct purchase request is refused

### AC-13 · Should · The sale can be paused without losing orders
- **Given** a shopper has already bought a pair
- **When** the team pauses the sale
- **Then** new purchases are refused with a "paused" message and the existing order is still there
- **And** after resuming, shoppers can buy again
