---
name: prepare-review
description: For the author, the person handing a project in: prepares it for an independent review or for a client under the review standard. Writes the README's nine required items and a review pack (review/review-pack.json) that renders as a one-page demo and review site: the main user journeys with screenshots, how to run it, requirements, architecture, business rules, tests and agent instructions, and known problems, checked complete by software. It does not judge the project; launch-review does that. Use when someone says "prepare my project for review", "get this ready to hand in" or "hand over", "make my app reviewable", "write the review pack", "the reviewer sent our hand-in back", "make a demo page for the client", or before running launch-review on your own project.
---

# Prepare a project for review

You are helping the **author** (often a product manager who built the app with AI) hand the project in so that an independent reviewer can work from the README alone. The result is the author's side of the review standard: `<launch-review>/standard/review-standard.md`, where `<launch-review>` is the `launch-review` skill's directory, next to this one.

`<skill-dir>` = this skill's directory. Tool: `node <launch-review>/scripts/review-pack.mjs`.

## Rules

1. **Write only what you can point to.** Every statement in the pack is a claim the reviewer will check. If something isn't known or agreed (a recovery time, a traffic number, who owns a problem, a severity), write `"Not agreed yet"`, `"Unknown"` or `"Not assessed"`. Never invent a number, a test result or a screenshot. If the owner can't be asked, make the most reasonable choice and write it as `"Assumed: …"` so the reviewer and the owner can see it.
2. **Run things before you describe them.** Start the app from a clean checkout with the commands you write down; run the tests before you report their results; take screenshots from the code you hand in. `project.commit` is the commit those screenshots and results come from: commit the code first, then commit the pack on top of it.
3. **Leave the reviewer's parts empty:** the verdict, the worksheet, the findings, area notes, and the recurring-problem analysis. Known problems are the author's to declare; the reviewer works out why they keep coming back.
4. **Software counts, you don't.** Finish with the gate (step 9). Report the numbers it prints, not your own tally.
5. **Plain words.** The reader may be a client who isn't an engineer. Name things the way a user would, and explain any technical term in the glossary.

## Steps

### 1. Start the pack
Work out the risk tier with `<launch-review>/references/intake.md` (ask the owner what you can't infer) and the features that apply: `aiAssisted`, `accounts`, `personalData`, `money`, `limitedStock`, `adminArea`, `browserDatabase`, `webhooks`, `uploads`, `ai`, `launchSpike` (meanings in `standard/criteria.json`).
```bash
node <launch-review>/scripts/review-pack.mjs template review/review-pack.json --tier 2 --features accounts,money,aiAssisted
```
Fill in `project` (name, plain-language summary, repository, the exact commit (rule 2), date, author, tier and why). If the app's own server charges cards or calls a payment provider's charge API, that counts as taking payments in the app (tier 3), even with no card form.

### 2. Product and Demo sections
Agree 3 to 6 **main journeys** with the owner: the things users come to do, plus the most important "it must not happen" cases (sold out, too early, someone else's data). For each: who, numbered steps, the expected result, and **evidence from the running app**.

For a web app, script the journeys with Playwright so the screenshots can be taken again on every hand-in: copy `<skill-dir>/templates/journeys.spec.mjs` into the project's acceptance suite (the `acceptance-test` skill sets one up) and adapt one test per journey, tagged `@journey` (the acceptance report then leaves it out). It saves `review/evidence/<journey>-<step>.png` **before** checking anything, so a journey that goes wrong is still shown. Run it on its own (`npx playwright test tests/journeys.spec.mjs --output=results/journeys`), then write what the screenshots show in the journey's `actual` field, especially when it differs from `expected`. A journey with no screen (an API answer, an email) saves the answer as a JSON or text file instead of a screenshot of raw data. For a non-web app, use a screen recording or a terminal transcript saved as a text file. Link each journey to the acceptance criteria that prove it.

**Test data only.** The page goes to people outside the team. Run the journeys with test accounts, made-up names and addresses (email addresses at `example.com` or a `.test` domain) and test-mode payments, never a copy of real customer data. Then look at every screenshot for anything real (a name, an email address, an address, a key or token) and retake it if you find one. The submission gate reads saved text evidence for real-looking email addresses and keys; nothing reads pictures, so that check is yours.

### 3. How to run it
On a clean checkout (for example `git clone . /tmp/<project>-check`, run from there, then delete it), follow your own instructions and fix them until they work. Record prerequisites with versions, set-up, start, the address to open, the test command, how to reset test data, test accounts per role, and the staging address (or `null`).

List **every setting** the app reads. Find them by searching, not from memory, for example:
```bash
grep -rnoE "process\.env\.[A-Z0-9_]+|os\.environ(\.get)?\(?\[?['\"][A-Z0-9_]+|getenv\(['\"][A-Z0-9_]+" \
  --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.ts' --include='*.tsx' \
  --include='*.py' --include='*.go' --include='*.rb' --include='*.php' --exclude-dir=node_modules .
```
No output usually means the search is wrong, not that there are no settings: check by hand. Also look for values written straight into the code (keys, addresses, prices): they are settings too, and a key in the code is a known problem. Where "needed in production" isn't known, write `"Unknown"`.

### 4. Requirements
Ask the owner for the numbers the review will judge against: expected traffic (visitors in what time window), response-time budgets, acceptable data loss and recovery time, money and stock rules. Write who agreed and when. If there is no number, write `"Not agreed yet"`: the reviewer will flag it, which is better than a made-up target.

### 5. Architecture
Components and their jobs; **every entry point** (pages, API routes, webhooks, scheduled jobs, admin and test routes, browser-to-database access), found from the router and job definitions rather than memory, with who may call each and what it touches; data stores and what sensitive data they hold; outside services with their time limits and what happens when they fail; the main decisions with why, the alternatives and the downsides. A Mermaid diagram if it helps.

### 6. Business rules
Every rule the data must obey ("never sell more than the stock", "one per customer", "the price comes from the server"), where it is enforced (database constraint, transaction, code), and which test proves it. Write "none" where there is no test.

### 7. Harness and performance
The agent instruction file (`AGENTS.md`, `CLAUDE.md`…) path, or `null` if there is none. Every test suite: its `type` (`unit`, `integration`, `end-to-end`, `visual`, `self-check`, `load` or `scan`), what it covers, the command, the result of a run you just did, and whether CI runs it. The review report shows which of these kinds the project has, against the bugs that came back. CI gates and other checks (lint, types, scans).

If there is no agent instruction file and AI writes the code, offer to create one from `<skill-dir>/templates/AGENTS.md`: how to set up, run and test; the business rules; where money and secrets are handled; files never edited by hand; and one line per known recurring problem. Write its rules as rules ("must"), not as claims about the code.

**Performance:** write the traffic target from the requirements. If you ran a load test, add every run; otherwise write "not run". For each kind of performance test you ran (`<launch-review>/standard/criteria.md`, Kinds of performance test), add an entry to `performance.coverage` with `"by": "author"`, its result and one line on what it showed. The reviewer fills in the rest.

### 8. Known problems and acceptance
- **Known problems:** anything you know is wrong or risky: failing tests, open bugs from the issue tracker, TODOs that matter, limits, and things you noticed while running the app. Each with severity (or `"Not assessed"`), owner and date if there is one. Run `node <launch-review>/scripts/history-scan.mjs . review/history` and list it under `history.sources`; the reviewer works out what keeps coming back and why.
- **Acceptance:** copy the agreed criteria (id, priority, plain-language criterion), with the result of the latest run and its screenshots. Playwright empties its results folder on every run, so copy the screenshots you link into `review/evidence/acceptance/`. Mark a criterion `external` only if the other test that proves it was run and passed; otherwise `not-run`. If no criteria are agreed yet, use the `acceptance-test` skill first: reviewing without agreed criteria is guessing.

### 9. README and gate
Add a **Review** section to the README with the nine items (template: `<skill-dir>/templates/readme-section.md`), then:
```bash
node <launch-review>/scripts/review-pack.mjs gate submission review/review-pack.json
node <launch-review>/scripts/review-pack.mjs render review/review-pack.json review/index.html
```
The gate counts what the checker needs, checks that every screenshot file exists and that the README has all nine items and links to the page, and lists anything missing. Repeat until it passes.

Tell the user: where the page is, what you couldn't fill in (everything marked "Not agreed yet" or "Unknown" and who should answer it), and that the reviewer will treat the pack as the author's claim and check it.
