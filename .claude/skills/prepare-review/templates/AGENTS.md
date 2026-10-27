# Instructions for coding agents

Read this before changing anything. Keep it short: link to details instead of copying them here.

## Run it
- Set up: `<command>`
- Start: `<command>` then open <address>
- Test everything: `<command>`. All tests must pass before you hand back a change. Never weaken or skip a test to make it pass.

## Rules that must never be broken
<!-- The business rules from the review pack (Business rules section), each with the test that proves it. -->
- <Never sell more than the stock.> Enforced by <the atomic update in …>; proved by `<test>`.
- <Prices come from the server, never from the browser.> Proved by `<test>`.

## Where care is needed
- Money: <files>. Every call to an outside service must have a time limit and a repeat-safe key, and a time-out must be treated as "unknown" and settled later, never as failed.
- Secrets must come from environment variables; never put them in code, logs or anything sent to the browser.
- <If the app has database migrations:> never edit one that has been applied; add a new one.

## Lessons from past problems
<!-- One line per problem that came back (review page, Quality history): the rule, and the check that enforces it. -->
- <Bad input crashed the server twice.> Parse input once, strictly, at the edge; add new inputs to `<malformed-input test>`.
- <Settings were ignored after a restart.> Any change to start-up or settings needs a test that starts the app twice on the same data.

## Before you finish
- Run the full test suite and say what you ran.
- One fix per commit, with the test that would have caught it.
- If you changed a journey, a rule or a setting, update `review/review-pack.json` and run `node <launch-review>/scripts/review-pack.mjs gate submission review/review-pack.json`.
