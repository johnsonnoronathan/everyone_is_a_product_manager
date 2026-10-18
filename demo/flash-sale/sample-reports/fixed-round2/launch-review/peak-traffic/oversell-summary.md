# Oversell check

**PASS:** 1000 buyers each clicked "buy" 2× at the same moment, competing for 100 units.

- ✅ Never sold more than the stock, and nobody was charged twice.

| Measure | Value |
|---|---|
| Units in stock | 100 |
| Accepted purchases (seen by buyers) | 100 |
| …of which "confirming payment" at checkout | 2 |
| Buyers charged twice | 0 |
| Rejected (sold out / already ordered / rate limited) | 1998 |
| Server errors or timeouts | 0 |
| Orders in database | 100 |
| Orders still awaiting payment confirmation | 0 |
| Stock counter in database | 0 |
| Distinct customers with orders | 100 |
