# Oversell check

**PASS:** 1000 buyers each clicked "buy" 2× at the same moment, competing for 100 units.

- ⚠️ Undersold: only 96 of 100 units sold although 1000 buyers tried. The other 4 units are back in stock (typically released after failed payments); real shoppers would retry and buy them.
- ⚠️ 4 of 2000 requests (0.20%) failed with a server error or timeout.

| Measure | Value |
|---|---|
| Units in stock | 100 |
| Confirmed purchases (seen by buyers) | 96 |
| Buyers charged twice | 0 |
| Rejected (sold out / already ordered / rate limited) | 1900 |
| Server errors or timeouts | 4 |
| Orders in database | 96 |
| Stock counter in database | 4 |
| Distinct customers with orders | 96 |
