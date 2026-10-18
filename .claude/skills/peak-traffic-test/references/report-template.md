# Peak-traffic report template

Copy into `launch-review/peak-traffic/REPORT.md` and fill in. Remove guidance in *italics*. Keep it short enough to read in 3 minutes; link to the raw summaries for detail.

---

# Will it survive [event]? Peak-traffic report for [product]

**Verdict:** *[One sentence a PM can forward. Examples: "Ready: handles 2× the expected peak and never oversold." / "Not ready: slows to 8-second page loads at 40% of the expected peak and sold 1,969 units of a 100-unit stock."]*

| Check | Result | Evidence |
|---|---|---|
| Handles expected peak (*N req/s*) | ✅ / ❌ *holds up to X% of target* | `load-summary.md` |
| Never oversells / double-charges | ✅ / ❌ / not tested *(why)* | `oversell-summary.md` |
| Code patterns that fail under load | *N critical, N high, N medium* | findings below |

## What we tested
- **Expected traffic:** *visitors, window, peak factor → target req/s per step of the journey (table from capacity.mjs). Say which numbers came from the PM and which are assumptions.*
- **Environment:** *URL, how it compares to production (instance size/count, DB tier), what was mocked (payments in test mode, email disabled...).*
- **Load generator:** *where k6 ran, and that it stayed below ~80% CPU.*
- **Not tested:** *e.g. login under load, third-party rate limits, CDN behaviour, multi-region. Say why.*

## Results in plain language
*3–6 bullets. Translate numbers into customer experience: "At the expected peak, 95% of product pages loaded within 30 ms." / "At 1.5× peak, checkout took more than 5 s for most shoppers and 2% got an error page." Name the resource that ran out first if you saw it (database connections, CPU, partner API).*

## Findings (most important first)

| # | Severity | What happens at peak (plain language) | Where | Fix | Effort |
|---|---|---|---|---|---|
| 1 | Critical | *Customers can buy items that are already sold out* | `server.js:112` | *Atomic stock update* | *2 h* |

## Top 3 actions before launch
1. *Action, expected effect, owner if known.*
2. …
3. …

*Also recommend operational safety nets where headroom is thin: waiting room, pre-scaling, kill switch, on-call person and dashboard during the event.*

## Re-test
*After fixes: same plan, same environment. Show before → after for the headline numbers.*

---
*Glossary (include only the terms used above):* **req/s**: requests per second the site receives. **p95**: 95% of requests were faster than this. **Error rate**: share of requests that failed. **Oversell**: confirming more orders than there is stock. **Staging**: a copy of the site for testing.
