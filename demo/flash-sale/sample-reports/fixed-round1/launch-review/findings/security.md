# Security findings

Commit `d572634` · 2026-10-16 · lens: `references/security.md` (OWASP Top 10:2025, API Top 10:2023) · inputs: `00-scope.md`, `01-system-map.md`, `scans/`
Reproductions ran only against a local instance started by the reviewer (`PORT=3100 PAYMENT_PORT=4200 node demo/flash-sale/run.mjs fixed`). Demo secrets are redacted (`demo…`).

### SEC-01 · Critical · Confirmed: One malformed web address crashes the whole shop
- **Where:** `demo/flash-sale/fixed/server.mjs:346` (`new URL(req.url, …)` runs before the `try` block that starts at line 353, inside an `async` request handler)
- **Impact:** Anyone can take the sale offline with a single request to `https://<shop>//`. No sign-in, no tools, one line. Bots and vulnerability scanners send addresses like this every day, so it can also happen by accident at midnight. Each crash drops every shopper who is mid-checkout, and with one server there is nothing to take over until it restarts. Payments in flight at that moment end up stuck (ARC-02), and if the production start-up keeps today's seed step, the restart wipes the orders (ARC-05).
- **Evidence:**
  ```
  $ curl -s http://127.0.0.1:3100/healthz
  {"ok":true,"db":{"poolSize":10,"inUse":0,"waiting":0}}
  $ curl -s -o /dev/null -w '%{http_code}' --path-as-is 'http://127.0.0.1:3100//'
  000            (curl exit 52: empty reply)
  $ curl -s http://127.0.0.1:3100/healthz
  (curl exit 7: connection refused, server is gone)
  -- server log --
  TypeError: Invalid URL
      at Server.<anonymous> (file:///…/demo/flash-sale/fixed/server.mjs:346:15)
    code: 'ERR_INVALID_URL', input: '//', base: 'http://localhost'
  Node.js v22.22.0
  process exited with code 1
  ```
  The rejected promise of the async handler is unhandled; Node 22 terminates the process on unhandled rejections and there is no `process.on('unhandledRejection')` handler. Other request targets that throw the same way (checked with `new URL(x, 'http://localhost')`): `///`, `//[`, `//@`, `//:99999`, `/\\`. The only possible mitigation outside the code is a load balancer that rewrites `//` before forwarding; most forward the path unchanged. Confirm on staging through the real load balancer.
- **Fix:** Parse the URL inside the `try` (or wrap it and answer 400 `Bad request`). Add a `process.on('unhandledRejection')` / `uncaughtException` handler that logs with a request id. Run the app under a supervisor that restarts it (and see ARC-05 so a restart is harmless). Add a regression test that sends `GET //` and then `GET /healthz`. Effort: S
- **Reference:** OWASP A10:2025 Mishandling of Exceptional Conditions · CWE-248 Uncaught Exception

### SEC-02 · High · Confirmed: A one-call "delete every order" admin endpoint ships to production
- **Where:** `demo/flash-sale/fixed/server.mjs:303-312` (`POST /api/admin/reset`), `:129-133` (`requireAdmin`, one shared static header token); the load-test configuration in the repo calls it as its setup step: `demo/flash-sale/peak-brief.json:31-36, 43-47`
- **Impact:** Anyone holding the shared admin token (a staff member, a CI job, or a load test pointed at the wrong address) can, with one request, permanently delete every order (the emails and shipping addresses of customers who already paid) and put all 100 pairs back on sale. Nothing records who did it. It is also the only "pause" lever (OPS-02), so using it in an emergency destroys the order book.
- **Evidence:** Local instance:
  ```
  POST /api/buy (dana@example.com)            → 200 {"orderId":1,"amountCents":4999}
  GET  /api/my-orders (dana)                  → [{"id":1,…,"status":"paid",…}]
  POST /api/admin/reset  x-admin-token: demo… → 200 {"ok":true}
  GET  /api/my-orders (dana)                  → []
  GET  /api/admin/stats                       → {"initialStock":100,"stockRemaining":100,"paidOrders":0,…}
  ```
  Code: `seed()` (`server.mjs:54`) runs `DELETE FROM products; DELETE FROM users; DELETE FROM reviews; DELETE FROM orders;` through `db.exec`, which bypasses the pool, before re-inserting. Against a real provider the subsequent `fetch(PAYMENT_URL/reset)` (line 310) would fail, but only after the data is gone. Positives: the token compare is timing-safe and a wrong token gets a 404 (verified: no token / wrong token → 404).
- **Fix:** Don't register `/api/admin/reset` in production: register test routes only when an explicit `ENABLE_TEST_ROUTES=1` is set, and refuse to start with that flag when `NODE_ENV=production`. Give admins personal identities through the identity provider (MFA) instead of a shared header token, log every admin call (OPS-01), and keep load-test configs pointed only at staging. Effort: S
- **Reference:** OWASP A01:2025 Broken Access Control (test/reset routes in production) · CWE-749 Exposed Dangerous Method or Function

### SEC-03 · Medium · Confirmed: "One pair per customer" is really "one pair per email address", and nothing slows bots down
- **Where:** `demo/flash-sale/fixed/server.mjs:50` (unique index on `(product_id, customer)` where customer = email), `:234` (rate limit keyed by email), `:216-217` (demo issuer only lowercases); no bot protection, CAPTCHA, waiting room or per-IP limit anywhere in the code
- **Impact:** Anyone with a Gmail account can buy several pairs using `name+1@gmail.com`, `name+2@gmail.com`… (all arrive in the same inbox), and a reseller with their own domain can create unlimited addresses. Scripts aren't slowed down by anything, so resellers can take a large share of the 100 pairs while real fans see "Sold out". The product page promises "One per customer".
- **Evidence:**
  ```
  POST /api/buy as alice@example.com    → 200 {"orderId":1,"amountCents":4999}
  POST /api/buy as alice@example.com    → 409 {"error":"You already have an order for this item"}
  POST /api/buy as alice+2@example.com  → 200 {"orderId":2,"amountCents":4999}
  GET  /api/admin/stats → {"stockRemaining":98,"paidOrders":2,"distinctCustomers":2,…}
  ```
  Server side confirmed. In production it also depends on the identity provider not merging such addresses; most magic-link providers treat them as different users. Severity is Medium (no data or money lost); the owner may want to rate it higher because the limit is the main promise of this sale.
- **Fix:** Normalise the customer key (lowercase; strip `+tag`; strip dots for gmail.com/googlemail.com) before the uniqueness check. Add a second limit on a normalised shipping address and, with real cards, on the provider's card fingerprint. Put bot protection (e.g. Turnstile/hCaptcha) on sign-in and buy, or a virtual waiting room (see the peak-traffic report). Effort: M
- **Reference:** OWASP A06:2025 Insecure Design · OWASP API6:2023 Unrestricted Access to Sensitive Business Flows

### SEC-04 · Medium · Likely: Test sign-in and demo secrets can reach production with nothing to stop them
- **Where:** `demo/flash-sale/fixed/server.mjs:15` (`DEMO_LOGIN = process.env.DEMO_LOGIN === '1'`), `:213-218` (token for any email, no proof of ownership), `:24-31` (`requireEnv` only checks a value exists); `demo/flash-sale/run.mjs:20-23` (defaults `PAYMENT_SECRET_KEY=demo…`, `TOKEN_SECRET=demo…`, `ADMIN_TOKEN=demo…`, `DEMO_LOGIN=1`); `package.json` has no production `start` script
- **Impact:** One wrong environment variable (copied from a staging setup, or starting the app with the repo's demo script) turns on a sign-in that lets anyone become any customer without the magic link, see their orders and buy in their name. If a demo secret from the repo is used, anyone can forge sessions or call the reset endpoint (SEC-02). The server accepts all of this silently.
- **Evidence:** With `DEMO_LOGIN=1` (run.mjs's default), `POST /api/login {"email":"bob@example.com"}` returned a working session for Bob with no proof that the caller owns that mailbox (the same token was accepted by `/api/orders/:id` in the order-privacy test below). Default in the server is off (fail closed), which is good. Nothing checks secret length or rejects the demo values. Likely: it needs a configuration mistake to trigger.
- **Fix:** At start-up, refuse to run when `NODE_ENV=production` and `DEMO_LOGIN=1`; refuse `TOKEN_SECRET`/`ADMIN_TOKEN` shorter than 32 random bytes or equal to the demo values; add a production `start` script with no defaults; log a loud warning whenever the test login is on. Effort: S
- **Reference:** OWASP A02:2025 Security Misconfiguration · OWASP A07:2025 Authentication Failures

### SEC-05 · Low · Confirmed: A request body of `null` causes a 500 error instead of a 400
- **Where:** `demo/flash-sale/fixed/server.mjs:95-97` (`readBody` returns whatever `JSON.parse` gives), destructured at `:215`, `:235`, `:305`
- **Impact:** Junk requests produce "Something went wrong" and a full error with stack trace in the log instead of a clean "bad request". That's log noise and false alarms on sale night, not a crash.
- **Evidence:** `curl -X POST /api/buy -H 'authorization: Bearer …' -d 'null'` → `500 {"error":"Something went wrong","requestId":"361fbbf6-…"}`; same for `/api/login`. Invalid JSON (`{`) correctly gets 400.
- **Fix:** In `readBody`, reject anything that isn't a plain object with `HttpError(400)`; validate field types (`productId` integer, `address` object/string). Effort: S
- **Reference:** OWASP A10:2025 · CWE-20 Improper Input Validation

## Verified and holding up (no finding)
- **Order privacy (IDOR):** Bob requesting Alice's order `/api/orders/1` → 404; anonymous → 401; Alice → 200. Query is `WHERE id = ? AND customer = ?` (`server.mjs:287-290`). Order responses never include the address or email.
- **Price from the server:** buy with `{"productId":1,"price":1}` charged `amountCents: 4999` (`server.mjs:239-252, 266`).
- **Session tokens:** HMAC-SHA256, constant-time compare, expiry enforced (`server.mjs:107-127`); a token with Bob's payload and Alice's signature → 401.
- **Admin auth:** timing-safe compare, 404 on mismatch (no route disclosure).
- **Injection / XSS:** all SQL parameterised; search escapes LIKE wildcards and caps input at 100 chars (`server.mjs:227-228`); the front end writes only via `textContent`; CSP `default-src 'self'` blocks inline scripts.
- **Headers (local, `scans/headers.json`):** CSP with `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, no CORS, `/.env` and `/.git` not exposed. Static file map prevents path traversal.
- **Limits:** request body ≤ 10 kB, `requestTimeout` 15 s, `headersTimeout` 10 s, outbound payment timeout 3 s.
- **Secrets:** none in the reviewed files (gitleaks: 0 in `fixed/` and `shared/`); required secrets come from the environment and the server refuses to start without them.

## Could not check
- TLS, HSTS, HTTP→HTTPS redirect and path normalisation at the load balancer (local HTTP only).
- The production identity-provider integration: how it issues the `payload.signature` token this server expects, magic-link redirect allow-list, session lifetime, admin MFA. Managed providers usually issue RS256 JWTs, which `currentUser()` cannot verify, so the production sign-in code is not in this repo.
- The production card integration (card collection, 3-D Secure, declines, refunds, live vs test keys, webhook signatures); PCI DSS scope follows from it.
- Real secret values and their storage in the host's secret store.
- Gitleaks' history hit at `demo/flash-sale/naive/server.mjs:10` (commit `2f9131a`) is outside this scope (deliberately broken demo variant) and was not opened.
