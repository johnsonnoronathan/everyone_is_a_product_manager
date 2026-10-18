# Oversell check

**FAIL:** 1000 buyers each clicked "buy" 2× at the same moment, competing for 100 units.

- ❌ Oversold: 1962 purchases confirmed for 100 units (1862 customers were promised items that don't exist).
- ❌ Double orders: 963 buyers got two confirmed orders from one double-click.
- ❌ Database shows 1962 orders for 100 units.
- ❌ Inventory doesn't add up: 1962 sold + 92 remaining ≠ 100 starting stock.
- ❌ 963 orders belong to customers who already had one.
- ⚠️ 38 of 2000 requests (1.9%) failed with a server error or timeout.

| Measure | Value |
|---|---|
| Units in stock | 100 |
| Confirmed purchases (seen by buyers) | 1962 |
| Buyers charged twice | 963 |
| Rejected (sold out / already ordered / rate limited) | 0 |
| Server errors or timeouts | 38 |
| Orders in database | 1962 |
| Stock counter in database | 92 |
| Distinct customers with orders | 999 |
