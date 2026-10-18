# Capacity interview: from business plan to requests per second

Goal: get from "we're doing a Black Friday drop" to a target load the PM agrees with. Ask in business language, propose numbers from what you found in the code, and confirm. Don't ask more than ~8 questions; use defaults for the rest and label them as assumptions.

## Questions (ask what you can't infer)

1. **What's the event and when?** (Flash sale at midnight, email blast at 9:00, TV spot, launch on Product Hunt...)
2. **How many people do you expect at the peak, and how quickly do they arrive?**
   Help them estimate: email list size × open rate (20–40%) × click rate (5–15%); social followers × reach; last year's analytics peak × growth; ticketing/sneaker drops often see 10–50× normal traffic in the first minute.
   → `visitors`, `windowSeconds` (the period in which most of them arrive: 60 s for a drop, 300–900 s for an email blast).
3. **What does a visitor do?** Walk through the journey and map each step to the requests the frontend actually makes (read the frontend code: page loads, API calls, polling such as "stock left" refreshing every 2 s, which multiplies load).
   → `journey[]` with `perVisitor` = how many times a visitor makes that request during the window. Count refreshes: in a drop, people hit refresh 3–10 times.
4. **How fast must each step feel?** Default speed budgets (95% of requests faster than): pages/API reads 500–800 ms, add-to-cart 1 s, checkout/payment 2–3 s.
   → `p95Ms` per step.
5. **Is anything limited?** (stock, seats, coupons, "one per customer", first-come-first-served)
   → enables the oversell test (`oversell` section).
6. **What does login look like?** (needed to generate test users) → `auth` section, or none if the journey is anonymous.
7. **Where can we test safely?** Staging URL, how to reset test data, payment/email in test mode? → `baseUrl`, `setup`.
8. **What happens if it fails?** (lost revenue per minute, brand damage, refunds) Use it to set severity, not the test.

## Defaults when the PM can't estimate

| Parameter | Default | Why |
|---|---|---|
| `peakFactor` | 3 | Arrivals bunch up; the busiest second is typically 2–5× the average over the window. Use 5 for hard-start drops. |
| `stages` | 0.5, 1, 1.5, 2 | Find the breaking point and confirm headroom. Production should hold 2× the expected peak. |
| `stageSeconds` | 30 | Long enough for queues to build up. Use 60–120 for a final pre-launch run. |
| `maxErrorRate` | 0.01 | More than 1% failures is a visibly broken sale. |
| `requestTimeoutSeconds` | 10 | Real people give up after ~10 s. |

## Brief format (`launch-review/peak-traffic/brief.json`)

```json
{
  "event": "Black Friday drop",
  "baseUrl": "https://staging.example.com",
  "visitors": 20000,
  "windowSeconds": 120,
  "peakFactor": 3,
  "journey": [
    { "name": "Product page", "method": "GET", "path": "/api/products/42", "perVisitor": 4, "p95Ms": 600 },
    { "name": "Add to cart", "method": "POST", "path": "/api/cart", "perVisitor": 1, "p95Ms": 1000,
      "auth": true, "body": { "productId": 42, "qty": 1 } },
    { "name": "Checkout", "method": "POST", "path": "/api/checkout", "perVisitor": 0.6, "p95Ms": 2500,
      "auth": true, "body": { "productId": 42, "price": 4999 }, "okStatuses": [409, 410] }
  ],
  "auth": {
    "method": "POST", "path": "/api/test-login",
    "body": { "email": "{{user}}@loadtest.example" },
    "tokenField": "token", "header": "Authorization", "prefix": "Bearer ", "poolSize": 500
  },
  "setup": { "method": "POST", "path": "/api/test/reset", "headers": { "x-admin-token": "..." }, "body": { "stock": 100 } },
  "oversell": {
    "stock": 100, "buyers": 1000, "clicksPerBuyer": 2,
    "buy": { "method": "POST", "path": "/api/checkout", "auth": true, "body": { "productId": 42, "price": 4999 } },
    "setup": { "method": "POST", "path": "/api/test/reset", "headers": { "x-admin-token": "..." }, "body": { "stock": 100 } },
    "stats": { "method": "GET", "path": "/api/test/stats", "headers": { "x-admin-token": "..." },
               "fields": { "sold": "paidOrders", "remaining": "stockRemaining", "customers": "distinctCustomers", "initial": "initialStock" } }
  }
}
```

Notes:
- `{{user}}` and `{{n}}` are replaced per request (a test-user id and a counter); use them anywhere in paths, headers or bodies.
- `okStatuses`: business "no" answers that are *correct* behaviour under load (409 already ordered, 410 sold out, 429 rate limited) so they aren't counted as errors. Never add 5xx here.
- `auth.poolSize` test users are signed in before the test starts (not measured). If the app has no test-login endpoint, options: a staging-only endpoint, pre-generated tokens loaded from a file (edit `setup` in `k6/load.js`), or Supabase/Firebase admin APIs to mint test-user tokens. Never weaken production auth for testing.
- `setup` runs once before the test (e.g. reset stock). `oversell.stats` is optional; without it, query the database after the run.
- Asynchronous payments: by default the oversell check counts HTTP 200/201/202 as accepted orders (`oversell.successStatuses`), with 202 meaning "accepted, payment still being confirmed" (`oversell.pendingStatuses`). If the stats endpoint reports such orders (`fields.pending`), the check waits up to `oversell.settleSeconds` (default 60) for them to settle, then verifies sold + pending + remaining = starting stock.
- The oversell check counts **distinct orders** per buyer, using the order id in each successful response (`oversell.orderIdField`, a dotted path, default `orderId`). A shop that correctly answers a double-click with the same order twice is therefore not reported as charging twice. Responses without an id are counted separately and flagged.
- Use `{{n}}` to make values that must be unique per buyer unique (e.g. `"address": "{{n}} Test Street"` when the shop limits one order per address).
- Bodies must match what the real frontend sends, including fields the server *shouldn't* trust (e.g. `price`).

## Worked example (sanity-check your arithmetic)

20,000 visitors in 120 s, product page 4× each → average 667 req/s → × peakFactor 3 → **2,000 req/s** target on the product page. Checkout 0.6× each → 100 req/s average → **300 req/s** target. The plan tests 50/100/150/200% of those.
