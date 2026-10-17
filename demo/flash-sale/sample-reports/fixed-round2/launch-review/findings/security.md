# Security findings (round 2)

Commit `fa296a2` · 2026-10-17 · lens: `references/security.md` (OWASP Top 10:2025, API Top 10:2023) · inputs: `00-scope.md`, `01-system-map.md`, `scans/`
Every round-1 finding is re-checked below with its new status, followed by new findings (SEC-06). Reproductions ran only against local instances started by the reviewer on ports 3100/4200. Scripts are in `verification/`; demo secrets are passed in through the environment and redacted here (`demo…`).

## Round-1 findings, re-verified

### SEC-01 · Critical · Confirmed: One malformed web address crashes the whole shop
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:603-610` (URL now parsed inside `handle()`'s `try`, invalid → `HttpError(400)`), `:631-636` (every request's promise has a `.catch` that logs and destroys the socket), `:644` (`unhandledRejection` handler logs and keeps serving)
- **Impact:** Round 1: anyone could take the sale offline with one request to `https://<shop>//`. That no longer works.
- **Evidence:** Local instance, default config:
  ```
  //        -> 400 {"error":"Bad request"}      ///  -> 400     //[  -> 400     //@ -> 400
  //:99999  -> 400                             /\\  -> 400     //%  -> 400
  HEAD / -> 404 · OPTIONS * -> 404 · Host: [ -> 200
  GET /healthz after all of them -> 200 {"ok":true}
  ```
  Remaining gap, not a finding: there is no `uncaughtException` handler. I found no synchronous throw outside a request handler or a `try`, so nothing reachable crashes the process today. Run under a restart supervisor anyway (RUNBOOK covers health checks, not restarts). Also add the regression test round 1 asked for (`GET //`, then `GET /healthz`). I could not find one outside the acceptance suite, which I did not open.
- **Fix:** Done. Keep a regression test. Effort: S
- **Reference:** OWASP A10:2025 Mishandling of Exceptional Conditions · CWE-248 Uncaught Exception

### SEC-02 · High · Confirmed: A one-call "delete every order" admin endpoint ships to production
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:571-585` (reset registered only when `ENABLE_TEST_ROUTES=1`), `:18-22` (production refuses `ENABLE_TEST_ROUTES`, `DEMO_LOGIN`, `SEED_DEMO_DATA`), `:223` (admin calls logged)
- **Impact:** Round 1: one request with the shared token deleted every order. In production the route no longer exists.
- **Evidence:**
  ```
  NODE_ENV=production … ENABLE_TEST_ROUTES=1   -> "Refusing to start: DEMO_LOGIN, ENABLE_TEST_ROUTES and SEED_DEMO_DATA must be off in production"
  NODE_ENV=production, flags off, strong random secrets, SALE_STARTS_AT set:
    server_started {"testRoutes":false,…}
    POST /api/admin/reset (correct admin token) -> 404 {"error":"Not found"}
    POST /api/login                             -> 404 {"error":"Not found"}
  Demo instance: POST /api/admin/reset without token -> 404; POST /api/admin/sale with a wrong token -> 404
  ```
  The load-test config still calls the reset (`demo/flash-sale/peak-brief.json:31-36, 43-47`), but only against `127.0.0.1:3000`. Pointed at production by mistake, it would get a 404. The shared admin token remains and now controls the sale switch: see SEC-06.
- **Fix:** Done for the destructive route. Personal admin identities → SEC-06. Effort: S
- **Reference:** OWASP A01:2025 Broken Access Control · CWE-749 Exposed Dangerous Method or Function

### SEC-03 · Medium · Confirmed: "One pair per customer" is still easy to get round, and nothing slows bots down
- **Status:** Partially fixed (open)
- **Where:** `demo/flash-sale/fixed/server.mjs:194-197, 432` (email normalisation, called **only** by the test login stub), `:446-448, 466, 474` (`/api/buy` uses `user.email` from the token as-is, for both the rate limit and the order), `:411-415` (address key: lower-case, keep `[a-z0-9]` only), `:86-87` (unique indexes per customer and per address key); `demo/flash-sale/fixed/RUNBOOK.md:13, 37` (bot protection/waiting room only "if the expected rush is more than 2×…")
- **Impact:** The new one-per-address rule helps against careless repeat buyers. But in production the email trick from round 1 still works, because the `+tag` stripping runs only in the test sign-in. And the same street spelled "St." instead of "Street" counts as a new address. A reseller with one Gmail account and one flat can still buy several pairs, and scripts face only a per-email limit that multiplies with every `+tag`.
- **Evidence:** `verification/verify-basics.mjs`. Tokens in the production format (signed `payload.HMAC`, as the identity provider is expected to issue them) were made with the local instance's secret:
  ```
  dana (test login) buys, 12 Main Street…                   -> 200 {"orderId":2,"status":"paid"}
  dana+2 via TEST login, other address                       -> 409 You already have an order for this item
  dana+2 via IdP-format token, other address                 -> 200 {"orderId":3,"status":"paid"}
  Dana+3 via IdP-format token, "12 Main St., Springfield…"  -> 200 {"orderId":4,"status":"paid"}
  dana+4 via IdP-format token, "12 Main Street…" (exact)    -> 409 This address already has an order…
  stats: paidOrders 3, distinctCustomers 3   (one mailbox, one street address)
  ```
  No CAPTCHA, Turnstile, per-IP limit or waiting room anywhere in `fixed/` or `shared/public/` (`grep -rniE 'turnstile|captcha|waiting|x-forwarded-for'` → only the runbook line).
- **Fix:** Normalise the email in `currentUser()` (or in `/api/buy`) for every token, not just the stub: lowercase, strip `+tag`, strip dots for gmail.com/googlemail.com. Normalise addresses more firmly (street-type abbreviations, or validate through an address API and use its canonical form), and with real cards add the provider's card fingerprint as a third key. Put bot protection on sign-in and buy, or a waiting room, unconditionally for a 3,000-in-60-s drop. Effort: M
- **Reference:** OWASP A06:2025 Insecure Design · OWASP API6:2023 Unrestricted Access to Sensitive Business Flows

### SEC-04 · Medium · Confirmed: Test sign-in and demo secrets can reach production with nothing to stop them
- **Status:** Condition (fixed in code when `NODE_ENV=production`; what remains is the deploy setting)
- **Where:** `demo/flash-sale/fixed/server.mjs:10` (`PRODUCTION = process.env.NODE_ENV === 'production'`), `:20-22, 26, 48-50` (every production guard depends on it); `package.json` (only `demo:naive` / `demo:fixed` scripts); no Dockerfile, Procfile or deploy config in the repo; `demo/flash-sale/fixed/RUNBOOK.md:7` (checklist item)
- **Impact:** With `NODE_ENV=production` the server now refuses test sign-in, test routes, demo seeding, placeholder secrets and a missing opening time, which is the round-1 fix. If production is started without that one variable, or with the repo's only start command (`npm run demo:fixed`), it starts with the demo secrets, test sign-in and reset route on, and the sale open immediately.
- **Evidence:**
  ```
  NODE_ENV=production (launcher defaults)              -> Refusing to start: PAYMENT_SECRET_KEY looks like a placeholder…
  production, strong secrets, launcher flags            -> Refusing to start: DEMO_LOGIN, ENABLE_TEST_ROUTES and SEED_DEMO_DATA must be off in production
  production, flags off, no SALE_STARTS_AT              -> Refusing to start: SALE_STARTS_AT is required in production
  production, ADMIN_TOKEN=demo…(36 chars)           -> Refusing to start: ADMIN_TOKEN looks like a placeholder…
  NODE_ENV unset (launcher defaults)                    -> server_started {"testRoutes":true,"saleStartsAt":null}
  ```
  No warning is logged when `DEMO_LOGIN=1` is on (`server_started` reports `testRoutes` only).
- **Fix:** Condition for launch: show the production deploy configuration setting `NODE_ENV=production`, and add a production start command with no defaults. Better: invert the default, so production behaviour applies unless an explicit `APP_ENV=development` is set, and log a warning line whenever `DEMO_LOGIN` is on. Effort: S
- **Reference:** OWASP A02:2025 Security Misconfiguration · OWASP A07:2025 Authentication Failures

### SEC-05 · Low · Confirmed: A request body of `null` causes a 500 error instead of a 400
- **Status:** Fixed: verified on 2026-10-17, commit `fa296a2`
- **Where:** `demo/flash-sale/fixed/server.mjs:182` (`readBody` rejects anything that isn't a plain object)
- **Impact:** Round 1: junk requests produced 500s and stack traces in the log. Now they get a clean 400.
- **Evidence:** `POST /api/buy` with bodies `null`, `[]`, `"x"`, `1` → `400 {"error":"Expected a JSON object"}`; `{` → `400 Invalid JSON`; 20 kB → `413 Request too large`; `POST /api/login` with `null` → 400. Field types are checked too: an address that is an object → `400 Please enter your full shipping address`. Minor: the buy rate limit is spent before the body is validated (`:448` before `:449`), so five malformed requests lock the shopper out for a few seconds.
- **Fix:** Done. Effort: S
- **Reference:** OWASP A10:2025 · CWE-20 Improper Input Validation

## New findings

### SEC-06 · Medium · Confirmed: One shared admin password opens, moves and pauses the sale, and the log can't say who used it
- **Status:** Open
- **Where:** `demo/flash-sale/fixed/server.mjs:219-224` (`requireAdmin`: one static `ADMIN_TOKEN` for everyone; logs only `{action}`), `:532-548` (`POST /api/admin/sale` accepts `paused` and `startsAt`), `demo/flash-sale/fixed/RUNBOOK.md:25-26` ("with the admin token")
- **Impact:** The reset endpoint is gone, but the token that remains is now the switch for the whole sale. Anyone who has it can open the sale hours early (`{"startsAt": null}`), and so can a contractor who has left or a script that leaked it. Bots then buy the stock before the email goes out. The log shows "admin_action sale_settings" and nothing about who did it or from where.
- **Evidence:** Local, demo token: `POST /api/admin/sale {"paused": true, "startsAt": null}` → `200 {"startsAt":null,"paused":true,…}`, then `{"paused": false}` → `200 {…,"open":true}`. Production-mode log lines for admin calls: `{"event":"admin_action","action":"stats"}` and `{"event":"admin_action","action":"sale_settings"}` (no identity, no IP). The token compare is timing-safe and a wrong token gets a 404 (good).
- **Fix:** Give admins personal identities through the identity provider (with MFA) and check an admin role on these routes. If that can't happen before launch, issue one token per person, log which token and the client IP on every admin call, keep the list of holders in the runbook, and rotate the tokens after the sale. Effort: M
- **Reference:** OWASP A01:2025 Broken Access Control · OWASP A09:2025 Security Logging & Alerting Failures

## Verified and holding up (no finding)
- **Order privacy:** Bob reading Alice's order → 404; anonymous → 401; Alice → 200 (`server.mjs:503-512`). Order responses never include the address or email.
- **Price from the server:** buy with `"price":1` charged `amountCents 4999` (`:459-466`).
- **Session tokens:** HMAC-SHA256, constant-time compare, expiry enforced (`:191-217`). An invalid token gets 401, and the page then asks the shopper to sign in again (ARC-08).
- **Production guards:** demo login, test routes, demo seeding, placeholder secrets (< 32 chars or `demo`/`changeme`/`example`/`secret`) and a missing opening time are all refused at start when `NODE_ENV=production` (SEC-04 evidence).
- **Injection / XSS:** all SQL parameterised; the front end writes only via `textContent`; CSP `default-src 'self'`.
- **Headers (local, `scans/headers.json`):** CSP with `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, no CORS, `/.env` and `/.git` not exposed.
- **Logs:** no emails or addresses in a full local run. Customers appear as a 12-hex HMAC reference (`:66`).
- **Secrets:** gitleaks finds none in `fixed/` or `shared/`. The only history hit is in the out-of-scope `naive/` variant.
- **Limits:** body ≤ 10 kB; outbound payment timeout 3 s; browser requests time out after 15 s. Note: `headersTimeout`/`requestTimeout` went from 10 s/15 s to 66 s (`:640-641`) to sit above the keep-alive timeout. That is still tighter than Node's defaults, but slow-header clients can now hold a socket about 4× longer. Rely on the load balancer to buffer requests.

## Test evidence folded in after the review (`acceptance/ACCEPTANCE.md`, criteria v1.1)
- AC-03 (listed price): tampered `"price":1` → `200 … amountCents 4999`, passes 3/3. AC-06 (orders are private): a logged-out visitor gets `401`, passes 3/3. AC-04 (one pair on double-click): passes 3/3. All consistent with the checks above. No new security finding from the tests. They don't cover the `+tag` / address-variant route round the one-per-customer rule (SEC-03) or the admin token (SEC-06).

## Could not check
- TLS, HSTS, HTTP→HTTPS redirect and `//` handling at the real load balancer (local HTTP only).
- The production identity-provider integration. Still not in the repo: the page's sign-in form posts to the test stub, which is a 404 in production. Not checked: how the provider issues the `payload.signature` token, its email normalisation, the redirect allow-list, session lifetime and admin MFA.
- The production card integration: card collection, 3-D Secure, declines, refunds, live keys, webhooks. Still not in the repo; the charge request carries only an amount and an email. PCI DSS scope follows from it.
- Real secret values and their storage in the host's secret store.
