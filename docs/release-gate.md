# The release gate: core lessons

The ideas behind this project, on one page. They apply whether the gate is run with these skills, with other tools, or by people alone. They come from building the skills and running them on the [demo](../demo/flash-sale/), so treat them as working lessons and update them when real projects teach something new.

## The situation
More and more code is written by product managers and others with AI tools. The authors differ, the AI tools and models differ, and so does the quality. The last line of defence before customers is a release gate. It has to work no matter who, or what, wrote the code.

## Three principles

1. **Judge the evidence, not the author or the tool.** Treat every submission like code from an unknown contractor and apply the same gate every time. "The AI says it's production-ready" or "all tests pass" is a claim, not evidence.
2. **The reviewer is independent of the author.** That means a different person, model or session, one that didn't write the code and doesn't grade its own homework. After fixes, review again with fresh eyes, not only re-test.
3. **"Ready" is a set of evidence, not a feeling.** It's written down below, and a named person signs it.

## The minimum review: seven questions
If any answer is "we don't know", the release waits. Go deeper as the risk grows ([risk tiers](../.claude/skills/launch-review/references/intake.md)).

| # | Question | In practice | Details |
|---|---|---|---|
| 1 | **What exactly are we shipping?** | A map of every entry point (pages, APIs, webhooks, scheduled jobs, admin and test routes, browser-to-database access), every data store and every outside service. Unlisted routes are where back doors hide. | [launch-review Phase 1](../.claude/skills/launch-review/SKILL.md) |
| 2 | **Who can do what?** | Every entry point checks identity and ownership on the server. Nothing important is trusted from the browser (price, role, user id). Secrets never reach the browser. | [security](../.claude/skills/launch-review/references/security.md) |
| 3 | **Can the data become wrong?** | Database constraints; transactions for steps that belong together; protection against double submission; atomic updates for limited stock or balances; money in whole cents; versioned migrations that never destroy data. | [architecture](../.claude/skills/launch-review/references/architecture.md) |
| 4 | **What happens when things go wrong?** | Time limits on every outside call. A timed-out payment counts as *unknown*, not *failed*. Bad input gets a rejection, not a crash. Errors fail closed, never with fake success. AI-written code is weakest here. | [architecture](../.claude/skills/launch-review/references/architecture.md), [security A10](../.claude/skills/launch-review/references/security.md) |
| 5 | **Will it hold the expected traffic, and stay correct?** | A traffic number agreed with the business, measured with headroom over more than one run, and a race test on anything in limited supply. | [peak-traffic-test](../.claude/skills/peak-traffic-test/SKILL.md) |
| 6 | **Can we recover?** | Backups with a restore actually tested; a rollback that works with the new database; alerts that reach a person; a pause switch; safe restarts; a runbook whose every step was tried once. | [operations](../.claude/skills/launch-review/references/operations.md) |
| 7 | **Is the configuration safe?** | Separate test and production; production refuses test settings and placeholder secrets; one source of truth for launch-day settings (sale times, prices); no secrets in git history; no vulnerable or made-up packages. | [architecture](../.claude/skills/launch-review/references/architecture.md), [security A03](../.claude/skills/launch-review/references/security.md) |

## Definition of ready
Release when all of these hold:

- [ ] **Acceptance:** every "Must" criterion, agreed *before* testing, passes 3 runs in a row with no retries.
- [ ] **Findings:** no open Critical or High; every Medium has an owner and a date ([severity rules](../.claude/skills/launch-review/references/severity.md)).
- [ ] **Measured:** the target load passes with headroom in more than one run; the race test on limited stock passes.
- [ ] **Recovery exercised:** a restore, a rollback and one alert were each tried for real.
- [ ] **Coverage written down:** whatever wasn't checked is listed and accepted by a named person.
- [ ] **Re-reviewed after fixes:** changed code got a fresh review, not just a re-test.
- [ ] **Signed:** a named person signs off on a specific commit.

## How the gate runs
1. **The author brings a submission pack.** It has four parts: a system map (question 1), the agreed acceptance criteria, how to run the app on staging, and the known limits. Sending back a submission without one is the cheapest rejection there is.
2. **Automated checks run on every submission:** secret scanning, vulnerable dependencies, risky code patterns and tests. They're cheap and repeatable, but they only produce leads.
3. **An independent review answers the seven questions.** A person judges every Critical and High finding.
4. **Measure** traffic and concurrency where it matters, and run acceptance tests against the agreed criteria.
5. **Decide and sign** against the definition of ready.
6. **Learn from escapes.** Every problem that reaches customers anyway becomes a new checklist item, rule or test.

## The evidence behind these lessons
From the demo ([scorecard](../demo/flash-sale/sample-reports/SCORECARD.md)):
- **Passing tests isn't the same as ready.** The first "fixed" version passed the load test, the oversell race and all 10 acceptance criteria. It still crashed on one malformed request and charged customers twice when payments were slow.
- **Fixes introduce new bugs.** Each round of fixes introduced at least one new serious problem, and only a fresh review caught it.
- **Independent review works.** A reviewer that never saw the answer key found 19 of 20 planted problems, plus a real one nobody had planted.
- **Each layer catches different things.** Scanners caught the leaked key. The review caught logic and failure handling. The load test measured capacity. The race test caught overselling. Acceptance screenshots revealed a UI bug that two review rounds had missed.
