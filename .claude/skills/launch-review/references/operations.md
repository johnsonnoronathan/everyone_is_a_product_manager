# Operations & launch-readiness checklist

The question here is: when something goes wrong after launch (and something will), will anyone notice, and can it be fixed quickly without losing data? Prefix findings `OPS`. Many items are answered by asking the user or checking dashboards, not code. Mark them *asked* / *verified* in the report.

## Recover
- **Backups are on** for every database and file store, with point-in-time recovery for the main database if the plan supports it.
- **A restore has actually been tested** (into a scratch database). An untested backup counts as "unknown".
- **Rollback**: the previous version can be redeployed in minutes (hosting "instant rollback", tagged releases). Database migrations in this release are backward-compatible or have a rollback script.
- **Kill switches**: a way to pause sign-ups, a promotion, payments, or an expensive feature without a deploy (feature flag, env var, maintenance page).

## Notice
- **Error tracking** (Sentry, Rollbar, Bugsnag, hosting's built-in) on both server and browser, with source maps uploaded privately.
- **Uptime check** on the home page and one critical API/flow (Better Stack, UptimeRobot, Checkly, hosting monitors), alerting a person, not just an inbox nobody reads.
- **Logs** are kept long enough (≥ 7 days), searchable, and include a request id to connect a user's report to the error.
- **Dashboards** for the basics: request rate, error rate, latency, database CPU/connections, queue depth.
- **Alerts** on error-rate spikes and payment failures reach someone who can act, with an owner for launch week.
- **Spending alerts** on cloud, AI and messaging providers.

## Respond
- **Who's on call** during launch and the first week, and how they're reached.
- **A one-page runbook**: how to roll back, how to put up a maintenance page, how to rotate a leaked key, who has admin access to which dashboard, contact routes for the hosting/payment providers.
- **Status/support channel** for customers (status page, support email, in-app banner).
- **Access hygiene**: the founders/PM aren't the only people with production access; access is via personal accounts with MFA, not shared passwords; departed contractors removed.

## Launch logistics
- Domain and TLS certificates auto-renew; DNS TTLs lowered before any cut-over.
- Transactional email domain authenticated (SPF, DKIM, DMARC) and tested to Gmail/Outlook (not spam).
- Production uses live payment keys; a real small purchase and refund have been tested end-to-end.
- Analytics and consent banner work (where required).
- Load expectations checked (→ `peak-traffic-test`), autoscaling/plan limits raised before a promotion, and the team knows the expected peak time.

## Legal & privacy basics (flag, don't certify)
- Privacy policy and terms published and matching what the app actually collects.
- Cookie/analytics consent where the audience requires it (EU/UK).
- A way to handle data access/deletion requests.
- Personal data not sent to third parties (analytics, AI providers, error trackers) beyond what the privacy policy says.
- Accessibility: core flows usable by keyboard and screen reader (→ `acceptance-test` runs an automated accessibility check).
