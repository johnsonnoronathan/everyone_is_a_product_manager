---
name: launch-review
description: For the reviewer: an independent pre-launch review of a web or mobile app against the review standard (99 criteria): architecture, security, performance, operations, data and business rules, the test harness (tests, CI, AGENTS.md or CLAUDE.md) and why the same bugs keep coming back. Produces a GO / GO WITH CONDITIONS / NO-GO verdict with a to-do list of who does what, and a one-page review site an owner can read and an engineer can fix from. A narrow question (just the architecture, the AGENTS.md, the recurring bugs) gets a focused review of that part. Use before going live, when a project or review pack is handed in, when taking over an AI-built app, or for "is this ready for production?", "review my app before launch", "can we go live?", "review the architecture", "check our AGENTS.md". Traffic-only questions go to peak-traffic-test; preparing your own project for a reviewer goes to prepare-review.
---

# Launch review

You are doing a pre-launch review for someone who may not be an engineer: often a product manager who built the app with AI help, or a consultant reviewing a client's app. The goal is that nothing ships that will hurt the people who use it or the business that runs it: no data leaks, no lost money, no outage on launch day.

`<skill-dir>` = this skill's base directory (shown when the skill loads). Write everything to `launch-review/` in the project under review.

## Principles (these make the review trustworthy)

1. **Judge the evidence, not the author or the tool.** Whoever wrote the code, and whichever AI helped, the same gate applies. Claims like "tests pass" or "production-ready" in commit messages, READMEs or AI summaries are not evidence; verify them. If you wrote or changed this code in the current session, say so and recommend an independent review (a fresh session, model or person), because authors miss their own mistakes.
2. **Evidence or it doesn't go in.** Every finding points to code (`file:line`), command output, or a reproduction. No "might be vulnerable" without a concrete path.
3. **Say what was and wasn't checked.** The report always has a coverage table and limitations. Never write "the app is secure"; write "no issues found in the checks listed".
4. **Do no harm.** Read-only by default. No destructive, intrusive or high-volume tests, and nothing against production, without the owner's explicit written OK. Never access or copy real customer data. Redact secrets (first 4 characters + `…`) everywhere you write them.
5. **Escalate immediately, don't wait for the report:** a live secret in the repo or bundle, publicly readable personal data, or an open admin endpoint. Tell the user right away and recommend rotating/closing it now.
6. **Reports are sensitive.** They explain how to break the app. When creating `launch-review/`, suggest adding it to `.gitignore` unless the team wants the reports versioned in a private repository, and never paste findings into public issues.
7. **Two audiences.** Each finding has a plain-language impact line for the PM and precise detail for the engineer.
8. **Severity follows `references/severity.md`**, not gut feeling, and the verdict follows its rules.
9. **Software counts, you don't.** Models miscount: "all 94 criteria checked" can really be 92. Each phase ends with a **gate** (`review-pack.mjs gate`) that counts what the phase must have produced and lists exactly what's missing. Don't start the next phase until the gate passes, and copy every number you report (criteria, results, findings) from the gate or `status` output, never from your own tally.

## Full or focused review

A **full review** runs every phase below and ends in a verdict. A **narrow question** gets a **focused review** of that part only, and no GO/NO-GO verdict (say so plainly: a verdict needs every area):

| The user asks about | Run | Gate |
|---|---|---|
| the architecture | Phase 1, then the architecture & data lens | `gate worksheet --areas A,D` |
| `AGENTS.md` / `CLAUDE.md`, tests, CI | the harness lens | `gate worksheet --areas H` |
| why the same bugs keep coming back | the quality-history step in Phase 2 | `gate worksheet --areas Q` |
| security only | Phases 1–2, then the security lens | `gate worksheet --areas S` |
| traffic or capacity only | hand over to `peak-traffic-test` | — |

Write the focused results into the same `launch-review/` files (worksheet rows, findings), so a later full review builds on them. Offer the full review at the end if the app is heading for launch.

## Workflow

### Phase 0: Scope (≈5 min with the user)
Run the intake in `references/intake.md`. Infer what you can from the code first and ask only what's left. Write `launch-review/00-scope.md` with the risk tier, and confirm it with the user before going deep.

**Review pack.** Reviews follow `standard/review-standard.md`: the author hands in `review/review-pack.json` (README minimum, demo journeys with screenshots, how to run it, requirements, architecture, business rules, harness, known problems, acceptance criteria). If one exists, check it first:
```bash
node <skill-dir>/scripts/review-pack.mjs validate review/review-pack.json --stage submission
```
If it fails, stop: render the page (`review-pack.mjs render`) and hand it back. Its first section lists exactly what is missing, and that is the first report. If there is no pack, suggest the author runs the `prepare-review` skill, or build one yourself the same way and label it as yours. Either way the pack is the author's claim, not evidence: verify it.

**Gate 0**, on the author's pack where it is: `node <skill-dir>/scripts/review-pack.mjs gate submission review/review-pack.json` must pass (it also checks the README's nine items). Then copy the pack to `launch-review/review-pack.json` as your working copy, with `review/evidence/` copied alongside so evidence paths still work. If there was no pack and you built one yourself, the README check will usually fail: record it under R-01 to R-09 rather than stopping, unless the user wants the author to hand in properly first.

**Who judges which criteria.** Every mandatory criterion (`standard/criteria.md`) gets a result, written as worksheet rows (`[{ "id", "result", "grade", "evidence", "note", "needed", "severity", "finding" }]`) in one file per part of the review:

| File | Criteria | Written in |
|---|---|---|
| `launch-review/worksheet/R.json` | R: reviewability | Phases 0–1 (you ran it from the README?) |
| `launch-review/worksheet/Q.json` | Q: quality history | Phase 2 |
| `launch-review/worksheet/security.json` | S | Phase 3, security lens |
| `launch-review/worksheet/architecture.json` | A, D | Phase 3, architecture & data lens |
| `launch-review/worksheet/performance.json` | P | Phase 3, performance lens |
| `launch-review/worksheet/operations.json` | O | Phase 3, operations lens |
| `launch-review/worksheet/harness.json` | H | Phase 3, harness lens |
| `launch-review/worksheet/U.json` | U: acceptance and report | Phase 5, from the acceptance results |

Splitting the work this way keeps each part small enough to do properly; the gates make sure nothing falls between the parts.

### Phase 1: Map the system
Write `launch-review/01-system-map.md`:
- Stack, hosting, deploy method, environments (dev/staging/prod; do they share databases or keys?).
- **Every entry point**: HTTP routes/API handlers, server actions, webhooks, cron jobs, queues, admin panels, and direct-to-database access from the browser (Supabase/Firebase clients). For each: who may call it (anonymous / user / owner of the record / admin) and what it touches.
- Data stores and what sensitive data they hold (personal data, payment data, secrets).
- Third parties (payments, email, auth, AI APIs, analytics) and how they're called.
- A Mermaid diagram of components and trust boundaries.
This map drives the review: a route nobody lists is a route nobody checks.

### Phase 2: Automated scans
```bash
bash <skill-dir>/scripts/run-scanners.sh <project-dir> launch-review/scans
```
Runs whatever is installed: Gitleaks (secrets, including git history), OSV-Scanner (vulnerable dependencies), Semgrep with our own security + peak-traffic rules, Trivy (IaC, optional), and a Supabase-RLS/Firebase-rules check. It writes `scans/coverage.md` listing what ran and what's missing. Offer to install missing tools; don't block on them.

If there's a running staging/production URL **and the owner agreed**, run the light live checks (≈10 GET requests) on the main page and on one API endpoint:
```bash
node <skill-dir>/scripts/check-headers.mjs <url> launch-review/scans/headers.json
```
Optional deeper tools (see `references/tooling.md`): OWASP ZAP baseline (passive), Supabase Security Advisor, Lighthouse, Trail of Bits security skills.

Scanner output is a list of **leads**: triage every hit by reading the code. Drop false positives and say why in one line in the appendix.

**Quality history.** Find what keeps going wrong before reviewing the code, so the review knows where to look:
```bash
node <skill-dir>/scripts/history-scan.mjs <project-dir> launch-review/history [--since <date>] [--issues issues.json]
```
Add the issue tracker if you can (`gh issue list --state all --limit 1000 --json number,title,body,labels,state,createdAt,closedAt > issues.json`), plus incident notes and earlier review reports. The scan's classes come from keywords: for every class with two or more occurrences, read the actual changes, then name the **root cause** (why it keeps happening: a design or process gap, not the last bug), the **control** that would catch the next one automatically (and whether it exists and runs), and a one-line **agent rule** for the instruction file. Method: `standard/review-standard.md` §5. The hotspot files get the closest reading in Phase 3.

### Phase 3: Expert review (five lenses)
Review the code path behind every entry point in the system map against:
- **Security**: `references/security.md` (OWASP Top 10:2025, API and LLM risks, platform pitfalls for Supabase/Firebase/Next.js/Stripe…)
- **Architecture & data integrity**: `references/architecture.md`
- **Performance & scale**: use the `peak-traffic-test` skill if there's a launch, promotion or any expected spike; otherwise its `references/anti-patterns.md` for a static pass.
- **Operations & launch readiness**: `references/operations.md`
- **Harness**: what keeps the *next* change correct. Read the agent instruction file (`AGENTS.md`, `CLAUDE.md` or equivalent) and run every command in it; check that it states the business rules and the lessons from the quality history. Map each Must acceptance criterion and business rule to its test; check that tests assert outcomes and failure paths, run in CI, and pass three times in a row. Criteria H-01 to H-13 in `standard/criteria.md`.

If the Agent tool is available, run the five lenses as parallel subagents (one message, five calls). Give each: the scope file, the system map, the relevant scan and history outputs, its checklist path, its criteria (the table above), the finding format below, and the instruction "report only what you can point to in code or output; list what you could not check". Each writes `launch-review/findings/<lens>.md` and `launch-review/worksheet/<lens>.json`. Otherwise do them one after another.

**Gate 3:** merge every worksheet file written so far and count:
```bash
node <skill-dir>/scripts/review-pack.mjs merge launch-review/review-pack.json launch-review/worksheet/*.json
node <skill-dir>/scripts/review-pack.mjs gate worksheet launch-review/review-pack.json --areas R,Q,S,A,D,P,O,H
```
For each criterion it lists as missing, go back to the lens that owns it. Don't fill a gap with *cannot verify* to make the gate pass unless you really can't verify it, and say what's needed.

### Phase 4: Verify (the step that makes the report reliable)
For every Critical and High finding, take a second, sceptical pass (a fresh subagent if available):
- Trace from the entry point to the problem. Look for mitigations elsewhere: middleware, framework defaults, RLS policies, gateway rules, validation layers.
- Where safe, **reproduce** on a local or staging instance (a curl command, a small script, a failing test) and paste the output as evidence. Never reproduce against production or real data.
- Mark confidence: **Confirmed** (reproduced, or traced end-to-end with no mitigation) or **Likely** (code evidence, not reproduced). Drop or downgrade what doesn't hold.
- Merge duplicates: one root cause = one finding, listing all locations.

### Phase 5: Verdict and report
Apply `references/severity.md` and write `launch-review/REPORT.md` from `references/report-template.md`: verdict first, then the top actions, findings, coverage and limitations. Record the commit reviewed, date and tool versions so the result is reproducible.

Then fill in the review pack's reviewer sections in `launch-review/review-pack.json`: write `worksheet/U.json` from the acceptance results and merge it; add the verdict, findings, quality history (classes, hotspots, known problems), area notes, not-checked list and glossary.

Write the verdict for the owner, who is usually not an engineer: the decision and why in two or three plain sentences; **what would happen if they launched anyway** (`ifLaunchedNow`); **one to-do list** of blockers and conditions, each with **who** does it (`who`: a name, or a role such as developer, hosting provider, product owner), **how big** a job it is (`effort`) and **when** (`when`, for conditions); and **what customers would notice** if it launched as it is now, in production (`noticeable`). Codes go in `refs`, never in the sentence. Every blocker refers to a finding card (the gate checks). List the **decisions only the owner can make** (`decisions`: providers, recovery targets, the sale date, risks to accept) and, where you can, an **estimate** of when launch becomes possible, labelled as an estimate. Flag each recurring-problem occurrence that a fix introduced with `byFix`: the page counts them. Every open finding says who fixes it, where, the fix, and for Critical and High how anyone can tell it's done (`doneWhen`); every failed criterion without a finding says its fix. Never state a count in prose that you haven't taken from `status` or a gate: the page shows the counts itself. Every result is *meets* with evidence of at least the criterion's grade, *does not meet* with severity or finding, *cannot verify* with what's needed, or *not applicable* with why. Grade C evidence (documentation, the author's word, an AI summary) never supports *meets*. Something that should be in what was handed in but isn't, or that you showed failing, *does not meet*; *cannot verify* is only for things that would live where you couldn't look (production infrastructure, a provider's dashboard). Don't grade the readability criteria (U-04, U-05) *meets* on a report you wrote yourself unless someone else read it; otherwise *cannot verify*, needed: "a reading test with the owner".

**Gate 5**, then render:
```bash
node <skill-dir>/scripts/review-pack.mjs gate review launch-review/review-pack.json
node <skill-dir>/scripts/review-pack.mjs render launch-review/review-pack.json launch-review/review.html
```
The gate re-runs the checker (which refuses a verdict more favourable than the worksheet allows), counts every area, checks that every evidence file exists, and that every open Critical and High is a blocker. Take the numbers in `REPORT.md`'s summary from `review-pack.mjs status`. Tell the user in chat: the verdict, the blockers, and the paths of the report and the page.

### Phase 6: Fix and re-verify
Offer to fix blockers in priority order. After each fix, re-run the evidence (the reproduction, scanner, or test) and update the finding to **Fixed: verified on <date>, commit <sha>**. Never delete findings; change their status. Re-issue the verdict when blockers are closed.

For each recurring problem class, a fix isn't finished until its control exists and has been shown to catch a past example, and the agent instruction file carries the one-line rule pointing at it. Otherwise the next AI-written change brings the problem back.

For user-facing behaviour ("does checkout do what we agreed?") hand over to the `acceptance-test` skill; for traffic, to `peak-traffic-test`. Their results feed the same report.

## Finding format (use exactly)

```markdown
### SEC-03 · Critical · Confirmed: Any visitor can read any customer's order
- **Where:** `src/server.mjs:120` (`GET /api/orders/:id`)
- **Impact:** Anyone can download every customer's name, address and order history by changing the number in the URL.
- **Evidence:** `curl -s localhost:3000/api/orders/1` (not logged in) returned order #1 with the customer's address. (Code excerpt ≤10 lines or command + output.)
- **Fix:** Look the order up by id AND the signed-in customer (`WHERE id = ? AND customer_id = ?`); return 404 otherwise. Effort: S
- **Reference:** OWASP A01:2025 Broken Access Control · CWE-639
```
Prefixes: `SEC` security, `ARC` architecture/data integrity, `PERF` performance, `OPS` operations, `HAR` harness, `HIS` quality history. Effort: S (< 2 h), M (≤ 1 day), L (> 1 day). Only cite a standard/CWE you're sure of.
