# Architecture & data-integrity checklist

Draws on the AWS Well-Architected Framework (reliability, security, performance, cost pillars), the Twelve-Factor App, and Google SRE production-readiness practice, trimmed to what typically goes wrong in apps built quickly with AI help. Prefix findings `ARC`.

## Shape of the system
- **Environments are separate.** Dev/staging/prod use different databases, keys and payment modes. Staging never points at the production database.
- **Config and secrets come from the environment** (or a secret manager), not code. The app refuses to start without required secrets rather than silently using defaults.
- **The app tier is stateless** or the state is deliberate: sessions, carts, uploads, rate-limit counters, job queues and caches that must be consistent live in a shared store (DB/Redis/object storage), so the app survives restarts, redeploys and more than one instance.
- **No single point of failure that matters on day one**, or it's known and accepted (single DB instance without failover is common and OK for many launches; write it down).
- **Dependencies on preview/beta/free-tier services** that have hard limits (connections, requests/day, storage) are identified, with the limit compared to expected usage.

## Data integrity
- **Constraints in the database**, not only in code: primary keys, foreign keys, `NOT NULL`, `UNIQUE` (email, one-order-per-customer, idempotency keys), `CHECK (stock >= 0)`.
- **Money as integers (cents) or DECIMAL**, never floating point. Currency stored alongside amounts.
- **Multi-step writes are transactional** (create order + reserve stock + record payment); partial failure leaves a consistent state or is compensated.
- **Idempotency** for anything retried: payment calls, webhooks, form submissions, queue jobs. The idempotency key belongs to the *purchase attempt*, reused on every retry, not regenerated per request.
- **A timeout is "unknown", not "failed".** When a call that moves money (or sends something irreversible) times out, it may have succeeded. Don't release stock and tell the customer to retry; keep the order pending, confirm with the provider (lookup or webhook), and run a reconciliation job (provider charges vs paid orders) with alerts.
- **Work after money moved must not be abandoned**: once a charge succeeded, the follow-up writes retry until they land (or go to an outbox); fail-fast load shedding applies only before the charge.
- **Concurrency**: limited resources use atomic updates or locks (see `peak-traffic-test` → anti-patterns A1–A4).
- **Time**: stored in UTC; time zones applied at display. Sale start/end times tested across time zones.
- **Settings that must be right on the day** (sale start/end, prices, stock, feature flags): one source of truth (not "env var on first boot, database afterwards"), strict parsing (full ISO timestamps *with* a time-zone offset; reject "Nov 27", bare dates and numbers; booleans as booleans), and the value actually in force is logged and visible to the team.
- **Migrations are versioned and repeatable** (checked into the repo, applied by a tool, not by hand in a dashboard). Destructive migrations have a backup and rollback plan.
- **Deletion**: what happens to related data when a user or record is deleted (cascades, orphans, legal retention)?

## Dependencies on other services
- Every outgoing call has a **timeout**, limited **retries with backoff**, and a defined behaviour when the partner is down (queue and retry later, degrade, or fail clearly).
- **Slow or non-essential work is asynchronous** (emails, PDFs, image processing, analytics, webhooks out) via a durable queue.
- Partner **rate limits and quotas** are known and fit the expected load.

## Code health that affects launch risk
- **AI-generated leftovers**: mock data or hard-coded fallbacks in production paths (e.g. `catch → return sample data`), TODO/FIXME in security-relevant code, commented-out auth checks, "temporary" bypasses (`if (process.env.NODE_ENV !== 'production') skipAuth()`), test endpoints, `console.log` of personal data or tokens.
- **Duplicated business rules** (price computed in three places) that will drift.
- **Critical paths have tests**: at least sign-up/login, the money flow, and permission checks. CI runs them on every change.
- **Error handling is consistent**: one place that turns errors into responses and logs them.

## Cost and abuse
- Usage-based services (serverless, AI APIs, SMS, email, maps, bandwidth) have **budgets/alerts and per-user limits**. A bot or a viral moment can otherwise turn into a five-figure bill ("denial of wallet").
- Expensive endpoints (search, exports, AI) are rate-limited and paginated.

## Output for the report
Include the Mermaid system map from Phase 1, and for each finding the plain-language consequence ("if the email provider is down, orders fail" / "a second server would give every shopper different rate limits").
