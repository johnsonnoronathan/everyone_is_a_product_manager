# Acceptance criteria: Holiday flash sale

- Version: 1.0 (agreed with the product owner before tests were written)
- Scope: sale page, sign-in, checkout, order privacy
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

### AC-08 · Should · Payment problems are explained, and the pair goes back on sale
- **Given** the payment provider is not responding
- **When** a signed-in shopper clicks "Buy now"
- **Then** within 5 seconds they see a message that the payment did not go through
- **And** the pair is available again for other shoppers

### AC-09 · Should · Sale page is accessible
- **When** the sale page is checked with axe (WCAG 2.1 A/AA rules)
- **Then** there are no serious or critical violations

### AC-10 · Should · Works on a phone
- **Given** a shopper on a phone-sized screen (Pixel 7)
- **When** they open the sale page
- **Then** the page fits the screen without sideways scrolling and the buy button is visible
