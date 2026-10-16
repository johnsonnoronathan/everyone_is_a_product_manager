# Demo: holiday flash sale

A one-page sneaker drop (100 pairs, one per customer) built twice:

- **`naive/`**: what a quick AI-assisted build often looks like. It works when you click through it alone, but it has 20 planted problems across security, correctness under load, performance and operations. They aren't marked in the code; the review has to find them. Spoilers in [`ANSWER_KEY.md`](ANSWER_KEY.md).
- **`fixed/`**: the same app after a launch review: atomic stock reservation, idempotent orders, server-side prices, signed sessions, caching, timeouts, rate limits, safe error handling.

Both share `shared/` (frontend, sample data, and simulated infrastructure: a database layer that behaves like a hosted Postgres with network latency and a 10-connection pool, and a fake payment provider that occasionally hangs, like real ones on Black Friday).

## Run it

Requires Node.js ≥ 22.13 (uses the built-in `node:sqlite`).

```bash
node demo/flash-sale/run.mjs naive     # or: fixed
# open http://127.0.0.1:3000
```

## Try the skills on it

In Claude Code, from the repository root:

- *"Run a launch review of demo/flash-sale/naive"* → `launch-review` skill
- *"Will demo/flash-sale/naive survive the midnight drop? 3,000 visitors in 60 seconds"* → `peak-traffic-test` skill
- *"Write acceptance tests for the flash sale and tell me if it's ready"* → `acceptance-test` skill

Or run the pieces by hand:

```bash
# Peak traffic (needs k6). Start the app first.
node .claude/skills/peak-traffic-test/scripts/capacity.mjs demo/flash-sale/peak-brief.json /tmp/plan.json
k6 run -q -e PLAN=/tmp/plan.json -e OUT_DIR=/tmp .claude/skills/peak-traffic-test/k6/load.js
k6 run -q -e PLAN=/tmp/plan.json -e OUT_DIR=/tmp .claude/skills/peak-traffic-test/k6/oversell.js

# Automated scanners (installed ones only)
bash .claude/skills/launch-review/scripts/run-scanners.sh demo/flash-sale/naive /tmp/scans

# Acceptance tests (starts the app itself; don't run it at the same time)
cd demo/flash-sale/acceptance && npm install
VARIANT=naive npx playwright test --repeat-each=3
node ../../../.claude/skills/acceptance-test/scripts/ac-report.mjs results/naive/results.json criteria.md results/naive/ACCEPTANCE.md
```

## Sample outputs

[`sample-reports/`](sample-reports/) holds the full output of each skill for both variants, produced by running the skills in this repository, including the scorecard comparing the review's findings with the answer key.
