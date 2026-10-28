# Instructions for coding agents

This repository holds Claude Code skills that check whether an app built with AI is ready to launch, the review standard they work to, and a demo shop to test them on. The people who read the output are product managers and founders, so write in plain English, and only in English.

## Run it
- Test everything: `npm test` (unit tests and Semgrep rule fixtures; needs Semgrep). All tests must pass before you hand back a change. Never weaken or skip a test to make it pass.
- Check the plugin manifest: `claude plugin validate .`
- Start the demo: `node demo/flash-sale/run.mjs fixed`, then open http://127.0.0.1:3000. The acceptance suite is described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Rules that must never be broken
- `demo/flash-sale/naive/` is vulnerable on purpose. Don't fix it, and don't add comments that give its problems away. A new planted problem goes in `demo/flash-sale/ANSWER_KEY.md`.
- `demo/flash-sale/sample-reports/` holds what the skills produced at the time. Don't edit those files; correct them in `SCORECARD.md`.
- `.claude/skills/launch-review/standard/criteria.json` is the source of the criteria. After changing it, regenerate the list with `node .claude/skills/launch-review/scripts/review-pack.mjs criteria .claude/skills/launch-review/standard/criteria.md`.
- Never type a count by hand ("99 criteria", "95 apply"). A test compares the counts in the documents with the catalogue; take numbers from `review-pack.mjs status` or a gate.
- The worked example must stay a complete review. After changing the pack format, the checker or the example, run `node .claude/skills/launch-review/scripts/review-pack.mjs gate review demo/flash-sale/review/review-pack.json` and re-render `demo/flash-sale/review/index.html` with `render`.
- Write Semgrep rules here; never copy them from the Semgrep registry. Each needs `ruleid` and `ok` fixtures in `tests/semgrep/`.
- Never weaken the skills' safety rules: no testing of systems the user doesn't own, no load test on production without written permission, secrets redacted.

## Where care is needed
- The gates in `review-pack.mjs` exist because AI miscounts. A change that lets a gate pass more easily needs a test showing it still fails on what it should catch.
- A skill's description (the front matter of its `SKILL.md`) decides when the skill starts. Keep it under 1,024 characters and say whether the skill is for the author or the reviewer.

## Lessons from past problems
- Counts typed into prose were wrong more than once. Counts are now computed by the page or checked by a test.
- The race test counted accepted clicks as rejected. Every response goes into exactly one bucket, and the summary checks the buckets add up to the clicks sent.
- A review saw a problem in its own scanner output and never reported it. The review gate now counts every scanner rule that fired.
- An open Critical finding didn't lower the verdict. The verdict ceiling now counts open findings as well as failing checklist items.

## Before you finish
- Run `npm test` and say what you ran.
- Add the change to `CHANGELOG.md` under `## Unreleased` at the top (create the heading if it isn't there).
- If you changed a skill's behaviour, run it on the demo in a fresh session that hasn't seen the answer key, as [CONTRIBUTING.md](CONTRIBUTING.md) describes.
