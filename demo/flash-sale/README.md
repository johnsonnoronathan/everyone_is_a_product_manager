# Demo: holiday flash sale

A one-page sneaker drop (100 pairs, one per customer) built twice:

- **`naive/`**: what a quick AI-assisted build often looks like. It works when you click through it alone, but it has 20 planted problems across security, correctness under load, performance and operations. They aren't marked in the code; the review has to find them. Spoilers in [`ANSWER_KEY.md`](ANSWER_KEY.md).
- **`fixed/`**: the same app after two rounds of review and fixes.
  - **Round 1** brought atomic stock reservation, idempotent orders, server-side prices, signed sessions, caching, timeouts and rate limits. It passed every test, and its review still found a one-request crash and double charges when payments are slow.
  - **Round 2** fixed those. It treats a payment timeout as "unknown" and reconciles with the provider. It also adds required shipping addresses, a server-side sale start and pause switch, versioned migrations, production safety checks, a durable email outbox and a [runbook](fixed/RUNBOOK.md).
  - Its review verified 16 of the 23 earlier findings as fixed and found new ones. The code here is round 2; round 1 is in git history (commit `448562b`).
  - See [`sample-reports/SCORECARD.md`](sample-reports/SCORECARD.md).

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

[`sample-reports/`](sample-reports/) holds the full output of every skill for `naive/`, `fixed-round1/` and `fixed-round2/`, produced by running the skills in this repository. The [scorecard](sample-reports/SCORECARD.md) compares them, and compares the naive review's findings with the answer key.

`fixed/` reads `SALE_STARTS_AT`, `NODE_ENV`, `DB_FILE` and other settings from the environment (see the top of `fixed/server.mjs`). `run.mjs` fills in demo defaults so it starts without setup.
