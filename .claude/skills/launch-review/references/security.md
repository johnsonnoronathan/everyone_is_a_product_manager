# Security checklist

Organised by the **OWASP Top 10:2025**, plus API, AI/LLM and platform-specific checks. For each item: what to look for and how to check it. Scanner hits (`scans/semgrep.json`, `gitleaks-*.json`, `osv.json`, `data-access-rules.md`) are leads for the items marked *(scan)*.

Work entry point by entry point from the system map. For each one ask: **who can call this, and what stops everyone else?**

## A01 Broken Access Control (most common, highest impact)
- **Object-level access (IDOR/BOLA).** Every read/update/delete by id must also check ownership or tenant: `WHERE id = ? AND user_id = ?`, or RLS. Check: for each route with an id parameter, find the ownership check. Try: user A requests user B's id on a local instance.
- **Function-level access.** Admin/staff/internal routes require an admin role on the server, not just a hidden button. *(scan: admin-route-inventory)* Test/debug/seed/reset routes must not exist in production.
- **Property-level access / mass assignment.** Updates don't blindly save the request body (`update(req.body)`) where a user could set `role`, `isAdmin`, `price`, `ownerId`, `credits`. Responses don't return fields the caller shouldn't see (password hashes, other users' emails, internal notes).
- **Database reachable from the browser** (Supabase, Firebase): RLS on every public table with owner-scoped policies; Firebase rules not open / not in test mode. *(scan: data-access-rules)* Postgres views bypass RLS unless created with `security_invoker = true`; `SECURITY DEFINER` functions exposed via RPC need their own checks.
- **SSRF** (now part of A01): any feature that fetches a user-supplied URL (link previews, webhooks, image import, "import from URL") must block internal addresses (169.254.169.254, localhost, private ranges) and non-HTTP schemes.
- **CORS** only allows known origins for anything using cookies or returning personal data. *(scan: cors-wildcard; live: check-headers)*
- **Multi-tenant apps**: every query is scoped by organisation/tenant; ids from the client never select the tenant.

## A02 Security Misconfiguration
- Debug mode, stack traces, verbose errors off in production. *(scan: stack-trace-to-client, python-debug-or-tls-off)*
- Security headers on HTML: CSP, `X-Content-Type-Options: nosniff`, frame protection, HSTS, Referrer-Policy. *(live: check-headers)*
- Nothing sensitive served publicly: `.env`, `.git`, backups, source maps with secrets, admin panels. *(live: check-headers)*
- Storage buckets (S3, Supabase Storage, Firebase Storage) private unless meant to be public; signed URLs for private files.
- Preview/staging deployments not publicly indexable and not connected to production data (Vercel: deployment protection).
- Default credentials, sample accounts and seed admin users removed.
- Browser-exposed env vars contain no secrets (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`). *(scan: secret-in-browser-env-var)* Also grep the built JS bundle for `sk_live`, `service_role`, `-----BEGIN`.

## A03 Software Supply Chain Failures
- Known-vulnerable dependencies: triage `osv.json`; prioritise vulnerabilities reachable from the app's code and in runtime (not dev) dependencies. *(scan)*
- Lockfile committed; installs reproducible (`npm ci`).
- **Packages that don't exist or are typosquats.** AI assistants sometimes invent package names, and attackers register them ("slopsquatting"). For unfamiliar dependencies check the registry page: real project, real maintainers, downloads, age.
- CI/CD: secrets not printed in logs; third-party GitHub Actions pinned (ideally to a commit SHA); deploy keys scoped.

## A04 Cryptographic Failures
- Secrets (API keys, DB passwords, JWT/session secrets) are not in code or git history. *(scan: gitleaks; history counts even if the file was later deleted)* If found: **rotate**, then remove.
- Passwords (if the app stores them) hashed with bcrypt/scrypt/argon2, never plain or fast hashes (MD5/SHA-1/SHA-256).
- Tokens, reset codes and ids that must be unguessable come from a CSPRNG. *(scan: insecure-randomness-for-secrets)*
- HTTPS everywhere; TLS verification never disabled. *(scan: tls-verification-disabled)*
- Session/JWT secrets long and random, not `secret`, `changeme` or a copy from a tutorial.

## A05 Injection
- SQL/NoSQL: parameterised queries only. *(scan: sql-built-from-strings-*)* Also check ORM "raw" escapes and MongoDB queries built from request objects (`{ $where }`, operator injection via `req.body`).
- Command injection / `eval`. *(scan: command-injection-js, shell-true-python)*
- XSS: user content (names, reviews, messages, **AI output**) rendered as text, not HTML. *(scan: react-dangerously-set-html)* Markdown renderers sanitised. Links from users can't be `javascript:`.
- Template injection, path traversal (`../` in file names), header injection, open redirects (`?next=https://evil.com`).

## A06 Insecure Design (business logic; tools rarely catch these)
- **Money comes from the server**: price, totals, discounts, currency, shipping. *(scan: price-from-client is a lead only)*
- **Workflow can't be skipped**: can someone mark an order paid, or get the download, without paying? Payment confirmation must come from the provider (webhook or server-side verification), never from a browser redirect.
- **Limits enforced server-side**: quantity ≥ 1 and ≤ max, one coupon per customer, coupon not reusable, free-trial abuse, referral self-dealing.
- **Race conditions** on anything limited (stock, coupons, balances, seats). Hand off to `peak-traffic-test` for the oversell check.
- **Abuse & cost**: sign-up/contact forms protected against bots; SMS/email sending can't be triggered in bulk (SMS-pumping fraud); expensive operations (AI calls, exports, uploads) have per-user quotas.
- User enumeration: login/reset messages don't reveal whether an email exists (if that matters for this product).

## A07 Authentication Failures
- Identity comes from a **verified** token/session, never from a request field (`userId` in the body) or an unsigned/decoded token. *(scan: unverified-token-decode)*
- Every protected route and **every server action / API handler** checks auth itself. Next.js: middleware-only auth is fragile (CVE-2025-29927 allowed bypassing middleware with an `x-middleware-subrequest` header; fixed in 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3, so check the version).
- Brute-force protection on login, OTP and reset endpoints (rate limit / lockout / CAPTCHA).
- Password reset tokens single-use and short-lived; reset doesn't log in a different account; email change requires confirmation.
- Sessions expire; logout invalidates server-side sessions; cookies `HttpOnly; Secure; SameSite`. *(scan: cookie-without-flags; live)*
- OAuth/magic-link redirect URLs validated against an allow-list.
- Admin accounts use MFA (hosting, database, payment, email provider dashboards too).

## A08 Software or Data Integrity Failures
- **Webhooks verify signatures** (Stripe `constructEvent` with the endpoint secret, GitHub HMAC, etc.) and are idempotent (providers retry).
- No unsafe deserialisation (`pickle.loads`, `yaml.load` without SafeLoader, `node-serialize`) of user data.
- Client-side checks are always repeated on the server.

## A09 Security Logging & Alerting Failures
- Sign-ins, failed sign-ins, password/email changes, admin actions and payment events are logged with user id, time and IP.
- Logs don't contain passwords, tokens, full card data or unnecessary personal data.
- Someone gets alerted on spikes of errors/failed logins (see `operations.md`).

## A10 Mishandling of Exceptional Conditions
- Malformed input returns 400; it doesn't crash the process. *(scan: json-parse-in-stream-callback, url-parse-outside-try)* Try it on a local instance: invalid JSON, a `null` body, `GET //` (`curl --path-as-is`), a bad `Host` header. Then check the server still answers. Global handlers for unhandled rejections/exceptions log and keep serving (or restart cleanly).
- **Fail closed**: if the auth check, payment verification or permission lookup errors, the answer is "no", not "yes".
- No fake success: errors aren't swallowed and reported as success. *(scan: swallowed-error-fake-success)*
- Resource limits: request body size, upload size, pagination limits, timeouts on outgoing calls.

## AI / LLM features (OWASP Top 10 for LLM Applications 2025), if the app calls an AI model
- **API keys server-side only**; the browser never calls the model provider with your key.
- **Prompt injection**: assume any user text, uploaded document, web page or email the model reads can contain instructions. The model must not have tools/permissions that let injected text do damage (send emails, change data, reveal other users' data) without checks or confirmation (**excessive agency**).
- **System prompt leakage**: no secrets, keys or internal-only rules in prompts.
- **Improper output handling**: model output is treated as untrusted input: escaped before rendering as HTML, never executed as SQL/shell/code.
- **Sensitive information disclosure**: retrieval (RAG) only returns documents the current user may see.
- **Unbounded consumption (denial of wallet)**: per-user rate limits and quotas, `max_tokens`, spending alerts and a hard budget at the provider.

## Platform pitfalls (check the ones in the stack)
- **Supabase**: RLS on every table in exposed schemas, with policies scoped to `auth.uid()`; `service_role` key only on the server; Storage bucket policies; views with `security_invoker`; run the dashboard's **Security Advisor**.
- **Firebase**: Firestore/Storage/Realtime rules not open or in test mode; Admin SDK only on the server; App Check for abuse-prone apps.
- **Next.js / Vercel**: server actions are public endpoints and need auth checks; no secrets in `NEXT_PUBLIC_*`; data passed to client components doesn't include private fields; preview deployments protected; framework version patched.
- **Stripe / payments**: Checkout or PaymentIntents created server-side with server prices; webhook signature verified; fulfil orders from the webhook, not the success-page redirect; live keys only in production.
- **File uploads**: type and size validated server-side; stored outside the web root / in private buckets; never served as HTML/SVG from your main domain; filenames not trusted.
- **Email**: SPF, DKIM, DMARC set for the sending domain (otherwise receipts land in spam and the domain can be spoofed).
