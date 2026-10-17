# Launch-night runbook: holiday flash sale

One page for whoever is on call during the drop. Keep it next to the dashboards.

## Before the sale (T-1 day)
- [ ] `SALE_STARTS_AT` set in production (ISO time **with time zone**, e.g. `2026-11-27T00:00:00-05:00`). The server refuses to start without it.
- [ ] `NODE_ENV=production`; `DEMO_LOGIN`, `ENABLE_TEST_ROUTES` and `SEED_DEMO_DATA` unset (the server refuses to start otherwise).
- [ ] Secrets (`PAYMENT_SECRET_KEY`, `TOKEN_SECRET`, `ADMIN_TOKEN`) are long random values from the secret store. Live payment key only in production.
- [ ] Database backups on, with point-in-time recovery, and **one restore tested this week**.
- [ ] Error tracking and alerts reach the on-call person's phone. Alert on: 5xx rate > 1 %, any `ALERT_payment_stuck` log line, `paid orders ≠ provider charges`.
- [ ] Load balancer: health check on `/healthz` (liveness; doesn't depend on the database), idle timeout below 65 s, `//` paths forwarded or rejected (the app answers 400).
- [ ] Stock loaded with the audited admin script; sale paused until the final check (`POST /api/admin/sale {"paused": true}`).
- [ ] Waiting room / bot protection configured if the expected rush is more than 2× what the last load test passed.
- [ ] Email "sign in now" sent ~1 hour before opening (sessions last 12 hours, so nobody waits for a magic link at midnight).

## During the sale
| Signal | Where | Normal | Action if not |
|---|---|---|---|
| Error rate | dashboard / `request_failed` logs | < 1 % | Check the logs for the request id; pause if checkout fails broadly |
| Orders awaiting payment confirmation | `GET /api/admin/stats` → `pendingOrders` | a few, falling to 0 within a minute | If rising: the payment provider is slow. Keep the sale open (no double charges by design); check the provider's status page |
| `ALERT_payment_stuck` | logs | none | Look the order's `payment_key` up in the provider dashboard; mark paid or release by hand (two people) |
| Stock | `stats.stockRemaining` | falls to 0 | Never manually "add stock back" during the sale |

## Levers
- **Pause the sale** (no deploy, no data loss): `POST /api/admin/sale {"paused": true}` with the admin token. Resume with `false`.
- **Move the opening time**: `POST /api/admin/sale {"startsAt": "2026-11-27T00:15:00-05:00"}`.
- **Roll back**: redeploy the previous release. Migrations are additive, so the old code runs against the new schema. Restarts never wipe data.
- **Leaked key**: rotate in the provider dashboard, update the secret store, redeploy. Never paste keys into tickets or chat.

## After the sale
- Compare provider charges with `paid` orders (the reconciler should leave nothing pending); refund any orphan charge.
- Confirm every paid order has a confirmation email sent (`email_outbox.sent_ms` set).
- Export shipping addresses through the audited admin path, not ad-hoc database queries.

## Known limits (accepted for launch day)
- Rate limits are per server. Run **one** instance, or move them to Redis before adding a second.
- The "one per customer" rule uses email and shipping address. A determined scalper with many addresses and cards can still buy several pairs; the waiting room / bot protection is the mitigation.
