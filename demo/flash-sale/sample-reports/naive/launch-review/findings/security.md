# Security findings

Commit `d572634`. All reproductions were run against a local instance started with `PORT=3000 PAYMENT_PORT=4100 node demo/flash-sale/run.mjs naive`. Secrets are redacted (first 4 chars + `…`).

Three of these were escalated to the owner immediately: the hard-coded `pay_live_…` key (SEC-06), the publicly readable customer orders (SEC-04), and the open admin reset endpoint (SEC-03).

---

### SEC-01 · Critical · Confirmed: SQL injection lets anyone read and change the whole database
- **Where:** `demo/flash-sale/naive/server.mjs:98` (`GET /api/search`), with the same string-built-SQL pattern in `demo/flash-sale/naive/server.mjs:23-25` (`seed()`), reachable through the open admin reset (SEC-03).
- **Impact:** A visitor can read every customer's email and shipping address, change prices and stock, or destroy data, just by crafting a URL. No login needed.
- **Evidence:** The search query is built by pasting the `q` parameter straight into SQL: `` `SELECT id, name, price_cents FROM products WHERE name LIKE '%${q}%'` ``. Dumping all orders anonymously:
  ```
  $ curl -sG 'localhost:3000/api/search' --data-urlencode \
      "q=' UNION SELECT id, customer || ' | ' || address, amount_cents FROM orders--"
  [{"id":1,"name":"Limited Edition Holiday Sneakers","price_cents":4999},
   {"id":3,"name":"victim@example.com | 42 Private Lane, Springfield","price_cents":4999}]
  ```
  Via the unauthenticated reset, the interpolated `stock` runs arbitrary statements (`db.exec` runs multiple): sending `{"stock":"100, 100); CREATE TABLE pwned (note TEXT); --"}` created table `pwned`, confirmed by a second injection reading `sqlite_master`.
- **Fix:** Use parameterised queries everywhere (`WHERE name LIKE ?` with the bound value; never interpolate into `exec`). Node's `node:sqlite`/Postgres drivers all support placeholders — the app already uses them for most queries, so this is a consistency fix. Effort: S
- **Reference:** OWASP A05:2025 Injection · CWE-89
- **Status:** Open

---

### SEC-02 · Critical · Confirmed: Anyone can sign in as anyone; the login token is forgeable
- **Where:** `demo/flash-sale/naive/server.mjs:79-83` (`POST /api/login`) and `demo/flash-sale/naive/server.mjs:42-47` (`currentUser`).
- **Impact:** There is no real authentication. The "token" is just the email address base64-encoded and never signed or verified, so an attacker can act as any customer — buy as them, and read their orders and address — without ever receiving the login email.
- **Evidence:** Login returns `base64({"email": <whatever you sent>})` with no verification, and `currentUser` just base64-decodes the header. A hand-made token works:
  ```
  $ T=$(printf '{"email":"victim@example.com"}' | base64 -w0)   # never issued by the server
  $ curl -s localhost:3000/api/my-orders -H "authorization: Bearer $T"
  [{"id":3,"customer":"victim@example.com","address":"42 Private Lane, Springfield", ...}]
  ```
- **Fix:** Make the magic-link real: email a single-use, short-lived, random (CSPRNG) code/link; create a signed session (e.g. HMAC-signed cookie or a signed JWT with a server-side `TOKEN_SECRET`) only after the user clicks it; verify the signature on every request and reject anything unsigned. Set the cookie `HttpOnly; Secure; SameSite`. Effort: M
- **Reference:** OWASP A07:2025 Authentication Failures · CWE-287, CWE-345
- **Status:** Open

---

### SEC-03 · Critical · Confirmed: Admin endpoints are open to the public
- **Where:** `demo/flash-sale/naive/server.mjs:132-137` (`POST /api/admin/reset`) and `demo/flash-sale/naive/server.mjs:139-150` (`GET /api/admin/stats`).
- **Impact:** Anyone can wipe every order, reset the stock to any number, and read live sales figures — mid-sale, without logging in. A competitor or prankster could delete the night's orders or set stock to 0 (instant "sold out") or 1,000,000.
- **Evidence:** Neither handler checks any token or role.
  ```
  $ curl -s -X POST localhost:3000/api/admin/reset -d '{"stock":1000000}'
  {"ok":true}
  $ curl -s localhost:3000/api/products/1 | grep -o '"stock":[0-9]*'
  "stock":1000000
  $ curl -s localhost:3000/api/admin/stats
  {"initialStock":100,"stockRemaining":97,"paidOrders":3,"distinctCustomers":2,...}
  ```
  The reset also deleted order #3 (confirmed `{"error":"Order not found"}` afterwards) and is the delivery path for the SEC-01 injection.
- **Fix:** Require an admin credential checked server-side (e.g. compare a constant-time `x-admin-token` against the `ADMIN_TOKEN` env var — the launcher already defines one) on every `/api/admin/*` route, and remove the destructive `reset` from production entirely (it is a test fixture). Fail closed if the token is missing. Effort: S
- **Reference:** OWASP A01:2025 Broken Access Control (function-level) · CWE-284, CWE-306
- **Status:** Open

---

### SEC-04 · Critical · Confirmed: Any visitor can read any customer's order (name-less, but email + address)
- **Where:** `demo/flash-sale/naive/server.mjs:120-124` (`GET /api/orders/:id`).
- **Impact:** Every order — customer email, shipping address, amount, status — can be downloaded by anyone, logged in or not, just by changing the number in the URL. 100 orders means 100 home addresses leaked.
- **Evidence:** The handler looks the order up by id only, with no ownership or auth check:
  ```
  $ curl -s localhost:3000/api/orders/3        # not logged in
  {"id":3,"product_id":1,"customer":"victim@example.com","amount_cents":4999,
   "address":"42 Private Lane, Springfield","status":"paid","created_at":"2026-10-16 12:40:28"}
  ```
  Ids are sequential (`AUTOINCREMENT`), so `1,2,3,…` enumerates everyone.
- **Fix:** Require a verified session (SEC-02) and scope the lookup to the signed-in customer: `WHERE id = ? AND customer = ?`; return 404 otherwise. Effort: S
- **Reference:** OWASP A01:2025 Broken Access Control (IDOR/BOLA) · CWE-639
- **Status:** Open

---

### SEC-05 · Critical · Confirmed: The price is taken from the browser
- **Where:** `demo/flash-sale/naive/server.mjs:105-117` (`POST /api/buy`) and the client that sends it (`demo/flash-sale/shared/public/app.js:56`).
- **Impact:** The customer's browser tells the server how much to charge. Anyone can buy the $49.99 sneakers for one cent — or for a negative amount, which the app happily records and "charges".
- **Evidence:** `const { productId, price, address } = await readBody(req)` then `await chargeCard(price, …)` and stores `price`; the product's real `price_cents` is never consulted.
  ```
  $ curl -s -X POST localhost:3000/api/buy -H "authorization: Bearer $T" \
         -d '{"productId":1,"price":1,"address":"1 Evil St"}'
  {"orderId":1,"amountCents":1}
  $ curl -s -X POST localhost:3000/api/buy -H "authorization: Bearer $T" \
         -d '{"productId":1,"price":-4999}'
  {"orderId":2,"amountCents":-4999}
  ```
- **Fix:** Ignore any client-supplied price. Read `price_cents` from the `products` row on the server and charge that. Validate quantity/product server-side. Effort: S
- **Reference:** OWASP A06:2025 Insecure Design (business logic) · CWE-602, CWE-840
- **Status:** Open

---

### SEC-06 · Critical · Confirmed: Live payment secret key hard-coded in the source (and in git history)
- **Where:** `demo/flash-sale/naive/server.mjs:10` — `const PAYMENT_SECRET_KEY = 'pay_…'` (redacted; a `pay_live_`-prefixed key).
- **Impact:** The key that authorises charges to the payment provider is written into the code and committed to git. Anyone with read access to the repo (or a leaked copy) can charge, refund or read payments on the merchant account. Because it is hard-coded, dev, test and production all share one key.
- **Evidence:** Gitleaks flagged it in current files and in history (commit `2f9131a`): `generic-api-key … server.mjs:10`. Value begins `pay_…` (redacted). The launcher passes `PAYMENT_SECRET_KEY` as an env var (`run.mjs:20`) but the app ignores it and uses the constant.
- **Fix (escalated — do now):** Treat the committed key as compromised: **rotate it at the provider immediately**. Then read it from `process.env.PAYMENT_SECRET_KEY`, refuse to start if it is missing, and keep live keys only in production secrets. Removing the line does not undo the leak — rotation is required because git history keeps it. Effort: S
- **Reference:** OWASP A04:2025 Cryptographic Failures · CWE-798
- **Status:** Open

---

### SEC-07 · Critical · Confirmed: One malformed request crashes the whole site
- **Where:** `demo/flash-sale/naive/server.mjs:34-40` (`readBody` → `JSON.parse` in the stream `end` callback) and `demo/flash-sale/naive/server.mjs:166` (`new URL` on the raw Host header). No process-level handler.
- **Impact:** A single bad request — a truncated JSON body, or a Host header with a space — throws outside the per-request `try/catch` and takes the entire Node process down. On the planned single-process host the site goes fully offline until something restarts it; an attacker (or a buggy client at peak) can keep it down with one request each time.
- **Evidence:**
  ```
  $ curl -s -X POST localhost:3000/api/login -d '{"email":'   # truncated JSON
  curl: (52) Empty reply from server
  $ curl -s localhost:3000/api/products/1
  curl: (7) Failed to connect to 127.0.0.1 port 3000   # process is dead
  # server log: SyntaxError: Unexpected end of JSON input … readBody … process exited with code 1
  ```
  A second reproduction with `-H 'Host: a b'` produced `ERR_INVALID_URL` and the same crash.
- **Fix:** Wrap body parsing in try/catch and return 400 on bad JSON; guard the `new URL(...)` call; add `process.on('uncaughtException')`/`unhandledRejection` handlers that log and keep serving (and run under a supervisor that restarts). Effort: S
- **Reference:** OWASP A10:2025 Mishandling of Exceptional Conditions · CWE-248, CWE-20
- **Status:** Open

---

### SEC-08 · High · Confirmed: No rate limiting or bot protection on login or checkout
- **Where:** `demo/flash-sale/naive/server.mjs:79-83` (`/api/login`), `:102-118` (`/api/buy`) — no counter, lockout or CAPTCHA anywhere.
- **Impact:** A scalper-prone midnight drop with a passwordless login and no limits invites bots: automated accounts and checkout attempts can take the whole stock in seconds, and the login can be hit at any rate. Combined with SEC-02/SEC-05 a script can buy for nothing, at scale.
- **Evidence:** No rate-limiting code exists; 30 concurrent buy requests (SEC/PERF repro) were all accepted without throttling. Login accepts unlimited requests and any email.
- **Fix:** Per-IP and per-account rate limits on login and buy (in a shared store, not in-process — see ARC), a bot challenge (Turnstile/hCaptcha), and for a drop this size a virtual waiting room (Cloudflare Waiting Room, Queue-it). Return `429` with `Retry-After`. Effort: M
- **Reference:** OWASP A07:2025 Authentication Failures / A06 Insecure Design (abuse) · CWE-307, CWE-799
- **Status:** Open

---

### SEC-09 · Medium · Confirmed: Full stack traces returned to the client
- **Where:** `demo/flash-sale/naive/server.mjs:171-175` (catch handler sends `err.stack`).
- **Impact:** Errors reveal absolute file paths, framework internals and line numbers to anyone, which helps an attacker map the app. (The same errors are the ones that also crash the process — SEC-07.)
- **Evidence:** A bad `Authorization` header returned HTTP 500 with the body `SyntaxError: Unexpected token … at currentUser (file:///home/user/.../server.mjs:46:15) …`.
- **Fix:** Return a generic `500` JSON (`{"error":"Something went wrong"}`) and log the detail server-side with a request id. Effort: S
- **Reference:** OWASP A02:2025 Security Misconfiguration · CWE-209
- **Status:** Open

---

### SEC-10 · Medium · Confirmed: Missing security headers on HTML responses
- **Where:** `demo/flash-sale/naive/server.mjs:66-69` (HTML response) and `sendJson` (`:29-32`).
- **Impact:** No Content-Security-Policy, `X-Content-Type-Options`, clickjacking protection or Referrer-Policy. These are defence-in-depth; without them an injected script (or a framing attack) has fewer obstacles.
- **Evidence:** `check-headers.mjs` against `http://127.0.0.1:3000/` reported WARN for CSP, X-Content-Type-Options, clickjacking protection, and Referrer-Policy (see `scans/headers.json`). HSTS is terminated at the load balancer, so verify it there.
- **Fix:** Add `Content-Security-Policy` (start with `default-src 'self'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Referrer-Policy: no-referrer`, and ensure HSTS at the load balancer. Effort: S
- **Reference:** OWASP A02:2025 Security Misconfiguration
- **Status:** Open

---

### SEC-11 · Medium · Confirmed: CORS `*` on every response, including personal-data endpoints
- **Where:** `demo/flash-sale/naive/server.mjs:30` (`sendJson` sets `access-control-allow-origin: *` on every JSON response).
- **Impact:** Any website can read the JSON responses of this API in a visitor's browser, including `/api/orders/:id` and `/api/my-orders` (which already lack auth — SEC-04). A malicious page can harvest order/PII data cross-origin.
- **Evidence:** `check-headers.mjs` and a direct request both show `access-control-allow-origin: *` on `/api/products/1` and on the order endpoints.
- **Fix:** Don't send permissive CORS on endpoints that return personal data. If cross-origin access isn't needed, drop the header; if it is, allow only known origins. Effort: S
- **Reference:** OWASP A01:2025 Broken Access Control (CORS) · CWE-942
- **Status:** Open
