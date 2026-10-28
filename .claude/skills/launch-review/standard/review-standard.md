# The review standard

Version 1.0. A fixed format for handing a project in for review, and for writing the result. It exists so that:
- **the author** knows exactly what to hand in, and can check it's complete before anyone spends time on it;
- **the reviewer** fills in a form instead of a blank page, so no area is skipped and every review comes out the same shape;
- **the owner** gets a result they can read: a verdict first, then every area answered as *meets*, *does not meet*, *cannot verify* or *not applicable*, each with its evidence.

The rules behind it are in [The release gate](../../../../docs/release-gate.md): judge the evidence, not the author or the tool; review independently of the author; "ready" is a written set of evidence a named person signs.

**Who is who.** The *author* hands the project in (often a product manager working with an AI assistant). The *reviewer* judges it and must not be the author. The *owner* (the product owner or client) agrees the requirements and acceptance criteria and signs the result. A plain-language guide for authors is [Handing your project in](../../../../docs/hand-in-guide.md).

## 1. What the author hands in

Three things, all in the repository at the commit under review:

| What | Where | Minimum |
|---|---|---|
| **README** | repository root | The nine items in §1.1. |
| **Review pack** | `review/review-pack.json`, with screenshots and other evidence in `review/evidence/` | The author's sections in §2, passing the submission gate (`review-pack.mjs gate submission`, §6). |
| **Review page** | `review/index.html` | Rendered from the pack by `review-pack.mjs render`. One self-contained file: it can be opened offline, attached to an email or hosted as is. |

The JSON pack is the record; the page is a view of it. Authors don't write HTML, and every project's page has the same sections in the same order.

**Entry rule.** If the pack doesn't pass the submission gate, the review doesn't start. The reviewer sends back the page as rendered: its first section lists exactly what is missing. That page is the first report.

### 1.1 README minimum

| # | Item | It must say |
|---|---|---|
| 1 | What it is | What the product does, who uses it, and its status (prototype, beta, live). |
| 2 | Review page | A link to `review/index.html`, and to a live staging copy if there is one. |
| 3 | Quick start | Prerequisites with versions, then the commands that set it up and start it from a clean checkout, and the address to open. |
| 4 | Test access | Test accounts or how to create them, how to reset test data, and confirmation that payments, email and other side effects are in test mode. |
| 5 | Tests | The one command that runs all tests, and what they cover. |
| 6 | Settings | Every setting the app reads, or a link to the table in the review pack. |
| 7 | Architecture | One paragraph, with a link to the review page's Architecture section. |
| 8 | Known problems | A link to the known problems register (review page, Quality history section). |
| 9 | For AI agents | A link to the agent instruction file (`AGENTS.md`, `CLAUDE.md` or equivalent) if agents work on the code. |

## 2. The review page and the written report

A finished review is an **inspection report**, read in this order: the evidence and conclusions first, then how they were reached, the results, the recommendations, and the evidence behind them. The page (`review-pack.mjs render`) and the written report `REPORT.md` (`review-pack.mjs report`) are both generated from `review-pack.json`, so every inspection reads the same way and no count is typed by hand.

**The three questions.** Every inspection answers them in its first section, as Yes, Partly or No with the evidence in numbers. The software counts the answers: everything done is Yes, at least half is Partly, less than half is No.

1. **Is the test harness properly set up?** Counted from the harness checklist (H). The problems that came back (Quality history) show which kinds of test are missing; each names the kinds of test that would catch it.
2. **Are the performance tests comprehensive?** Counted from the kinds of performance test this product needs, each passed, failed or not run.
3. **Does the architecture review cover hidden problems?** Counted from the places hidden problems usually sit, each examined (problems found or none found) or not checked.

The lists behind them (kinds of performance test, places hidden problems sit, kinds of automatic test, sources of evidence, and the skills the report recommends) are in [`criteria.md`](criteria.md).

The sections below are listed in the order of a finished review. **A** = the author fills it in before the review; **R** = the reviewer fills it in. Field names refer to `review-pack.json`; a blank template comes from `review-pack.mjs template`. Before the review, the page leads with the author's sections instead: status, what to fix, product, demo, how to run it, requirements, then the rest.

| Section | Who | Minimum content | Fields |
|---|---|---|---|
| Summary: evidence and conclusions | R | For the owner, in plain words: the decision (GO, GO WITH CONDITIONS, NO-GO) and why; what would happen if it were delivered anyway; the three questions with their answers and evidence; the blockers; when it could be delivered; who signs. | `verdict`: `decision`, `reason`, `ifLaunchedNow` (required unless GO), `blockers[]` and `conditions[]` (`text`, `who` (required), `effort`, `when` (conditions), `why`, `refs[]`; every blocker refers to a finding), `decisions[]` (`text`, `refs[]`: what only the owner can decide), `estimate`, `noticeable[]`, `signer`, `signedBy`, `signedOn` |
| How the inspection was done | R | The version inspected, by whom and when; every source of evidence in the standard list, each used (with what: which version, how many, which period) or not (with why); the skills and tools used. | `method`: `sources[]` (`source`, `used`, `detail`), `skills[]` (`name`, `how`) |
| Results: the three questions | R | For each question: the evidence, the conclusion and the recommendation. Worked out by the software from the fields below; nothing is typed here. | From `worksheet[]` (H), `harness.suites[].type`, `history.classes[].catchWith[]`, `performance.coverage[]`, `architecture.hiddenChecks[]` |
| Recommendations | R | One list of what has to happen, each with who, how big and when (blockers before delivery, conditions at the time shown); the kinds of test to add or strengthen, worked out from the problems that came back; the skills and tools that help; decisions only the owner can make; what customers would notice. | `verdict.blockers[]`, `verdict.conditions[]`, `verdict.decisions[]`, `verdict.noticeable[]`; the rest is worked out |
| What to fix | R | For the developer: every problem found, blockers first, each with severity, who fixes it, where, the fix and how anyone can tell it's done; problems already fixed listed at the end. | `findings[]`: `id`, `severity`, `confidence`, `status`, `title`, `impact`, `who` (required while open), `where`, `fix` (required while open), `doneWhen` (required for open Critical and High), `dependsOn[]`, `when` (otherwise worked out: blockers block launch, Lows can wait), `accepted` (`by`, `until`: a High the owner accepted in writing, tiers 1–2 only) |
| Harness | A | The agent instruction file (or `null`), every test suite with its command, coverage and last result, CI gates, other checks. Each suite has a type from the kinds of automatic test. | `harness`: `agentFile` (`path`, `summary`) or `null`, `suites[]` (`name`, `type`, `kind`, `covers`, `command`, `lastRun`, `inCI`), `ci[]`, `checks[]` |
| Performance | A, R | Target, test environment, every load-test run (failures too), results per step, race test, slow-partner test, conclusion; and every kind of performance test the product needs, passed, failed or not run, with one line on what it showed or why it wasn't run. | `performance`: `target`, `environment`, `runs[]` (`label`, `result`, `pass`, `note`), `steps[]`, `race` (`summary`, `rows[]`), `slowPartner`, `conclusion`, `coverage[]` (`kind`, `result`: `pass`, `fail` or `not-run`, `by`: `author` or `reviewer`, `note`) |
| Architecture | A, R | Summary, diagram (Mermaid), components and their jobs, every entry point with who may call it, data stores, outside services with their time limits, major decisions. The reviewer adds where hidden problems were looked for: every place in the standard list, with how the review looked and what it found. | `architecture`: `summary`, `diagram`, `components[]`, `entryPoints[]` (`entry`, `caller`, `guard`, `touches`), `dataStores[]`, `services[]` (`name`, `purpose`, `timeout`, `onFailure`), `decisions[]` (`title`, `why`, `alternatives`, `downsides`); `hiddenChecks[]` (R: `area`, `result`: `found`, `none-found` or `not-checked`, `how`, `refs[]` (the findings, for `found`)) |
| Business rules | A | Every rule the data must obey, how it is enforced and what proves it. | `rules[]`: `id`, `rule`, `enforcedBy`, `provenBy` |
| Security | R | A plain-language summary; the criteria do the rest; and what became of each automated-scanner hit. | `areaNotes.S`; `scans`: `output` (the scanner folder, relative to the pack), `triage[]` (`tool`, `rule`, `where`, `outcome`: `reported` with `ref`, or `dismissed` with `reason`) |
| Operations | R | A plain-language summary; the criteria do the rest. | `areaNotes.O` |
| Quality history | A, R | The author declares known problems; the reviewer adds sources and period, defect counts, recurring problem classes with root cause, control and the kinds of test that would catch the next one, and hotspots. | `history`: `period`, `sources[]`, `stats[]`, `classes[]` (`name`, `occurrences[]` (`ref`, `text`, `byFix`), `rootCause`, `control`, `controlCheck`, `agentRule`, `catchWith[]` (kinds of automatic test), `status`: `controlled`, `partly controlled` or `open`), `hotspots[]`, `known[]` (`id`, `text`, `severity`, `owner`, `due`, `status`). The page counts kinds, problems introduced by a fix, and how many kinds are caught automatically from these fields; don't type those counts. |
| Product | A | What it does and for whom, users, out of scope, risk tier with its reason, and the features that switch criteria on (§3). | `project`: `name`, `summary`, `repository`, `commit`, `date`, `author`, `riskTier`, `riskReason`, `features[]`; `product.users`, `product.outOfScope[]` |
| Demo | A | Each main user journey: who, numbered steps, the expected result, what actually happened in the latest run, at least one screenshot, recording or saved answer, and the acceptance criteria that prove it. | `product.journeys[]`: `id`, `name`, `who`, `steps[]`, `expected`, `actual`, `evidence[]` (`path` or `url`, `caption`), `criteria[]` |
| How to run it | A | Prerequisites with versions; set-up, start, open, test and reset commands; staging address or `null`; test accounts; every setting. | `run`: `prerequisites[]`, `setup[]`, `start`, `open`, `test[]`, `reset`, `staging`, `accounts[]` (`role`, `how`), `settings[]` (`name`, `purpose`, `secret`, `production` (yes, no or "Unknown"), `example`) |
| Requirements | A | The standard the review judges against, with numbers: traffic, response times, acceptable data loss, recovery time, data rules, who agreed and when. Unknown is written "Not agreed yet", never guessed. | `requirements[]`: `id`, `text`, `target`, `agreedBy`, `agreedOn`, `source` |
| Acceptance | A, R | The author gives the agreed criteria (version, who agreed) and the latest results; the reviewer re-runs them: each with priority, result over three runs and its screenshots. | `acceptance`: `criteriaVersion`, `agreedBy`, `run`, `rows[]` (`id`, `priority`, `criterion`, `status`, `runs`, `evidence[]`, `note`) |
| Not checked | R | Everything the review did not or could not cover. | `notChecked[]` |
| Glossary | A, R | Every technical term used, in plain words; the author may start it, the reviewer completes it. The page also underlines each term where it first appears in a section, with the meaning on hover or tap. | `glossary[]` (`term`, `meaning`) |

The evidence sections (Harness to Acceptance, and How to run it) each end with the checklist for their area: the items that need attention first, then the full list (folded away), each with its result. The reviewer records these in `worksheet[]` (§3). Optional plain-language summaries per area go in `areaNotes` (keys `R`, `H`, `A`, `D`, `S`, `P`, `O`, `Q`, `U`).

Text fields accept `` `code` `` and `**bold**`; everything else is shown as written. Evidence paths are relative to the pack file; images are embedded in the page.

## 3. The worksheet: how each criterion is judged

The criteria are listed in [`criteria.md`](criteria.md) (generated from [`criteria.json`](criteria.json)): 99 criteria in nine areas. Only those that fit the product apply: an app without payments skips the payment criteria, so a given review usually has fewer than 99.

| Code | Area | The question it answers |
|---|---|---|
| R | Reviewability | Can a reviewer start work from the README alone? |
| H | Harness | Will the next change, by a person or an AI agent, keep the project correct? |
| A | Architecture | Is the structure sound for the agreed requirements? |
| D | Data and business rules | Can the data become wrong? |
| S | Security | Who can do what, and can anything leak? |
| P | Performance | Will it hold the expected traffic and stay correct? |
| O | Operations | Will we see problems, and can we recover? |
| Q | Quality history | What has gone wrong before, and is it fixed for good? |
| U | Acceptance and report | Does it do what we agreed, and can the owner understand the result? |

Each row of `worksheet[]` is `{ id, result, grade, evidence, note, needed, severity, finding, owner, due, accepted }`.

**Four results, and what each needs:**

| Result | Meaning | Required with it |
|---|---|---|
| `meets` | The standard is met, and the evidence shows it. | `evidence`, and a `grade` at least the criterion's lowest grade. |
| `does-not-meet` | The standard is not met. | `evidence` (what was found) and a `severity`, directly or through a `finding`. An open Medium or Low also needs `owner` and `due` unless the verdict is NO-GO. |
| `cannot-verify` | There isn't enough to judge. This is a result, not a gap in the report. | `needed`: what would let the reviewer verify it (access, a test run, a document). |
| `not-applicable` | The criterion doesn't fit this product. | `note`: why. |

**Absent or out of reach?** When something the criterion needs should be in what was handed in (code, configuration, a document, a test) and isn't, or the reviewer showed it failing, the result is *does not meet*. Use *cannot verify* only when it would live somewhere the reviewer couldn't look: production infrastructure, a provider's dashboard, a person's diary. A missing sign-in or payment integration does not meet; an unseen backup cannot be verified.

**Evidence grades.** Documentation describes intent, code shows what should happen, and only a running system shows what does. So evidence is graded:

| Grade | The reviewer… | Examples |
|---|---|---|
| **A** | ran, reproduced or measured it | a load test, a restore, a request as another user, the test suite run three times |
| **B** | inspected the thing itself | the code, the schema, the configuration, the README when the README is what's being judged |
| **C** | has only a statement | documentation, a slide, the author's word, an AI summary |

Each criterion names its lowest acceptable grade. Grade C never supports a "meets": a claim is not evidence. Where only C is available, the result is `cannot-verify`, and `needed` says what would turn it into A or B.

**Risk tiers** decide how strict the review is (details in [`intake.md`](../references/intake.md)):

| Tier | When | What it changes |
|---|---|---|
| 1, low | Internal tool or prototype, no personal data, no money | Fewest mandatory criteria; Medium problems rarely block |
| 2, standard | Real users with accounts or personal data, or payments through a hosted checkout | Critical blocks; High blocks unless the owner accepts it in writing |
| 3, high | Takes payments in the app, holds health, financial or children's data, or launches with a big rush | Every criterion mandatory; any open High blocks; backups, alerts and on-call must be shown |

**Which criteria apply.** Every criterion has a tier from which it is mandatory (it's recommended below that tier), and some apply only when the product has a feature, listed in `project.features`:

`aiAssisted` (AI agents write code), `accounts`, `personalData`, `money`, `limitedStock`, `adminArea`, `browserDatabase`, `webhooks`, `uploads`, `ai` (calls an AI model at runtime), `launchSpike`.

A mandatory criterion with no result counts as "cannot verify".

## 4. Verdict rules

The verdict follows from the worksheet and [`severity.md`](../references/severity.md). The validator works out the most favourable verdict the worksheet allows and rejects a more favourable one:

| The worksheet has… | The verdict can be at most |
|---|---|
| any criterion that does not meet at **Critical** | NO-GO |
| any that does not meet at **High** (at tier 3, or not risk-accepted in writing at tiers 1–2) | NO-GO |
| any open **Critical** finding, or open **High** finding (at tier 3, or without `accepted` at tiers 1–2), whether or not a worksheet row points at it | NO-GO |
| any **mandatory** criterion that can't be verified or has no result | GO WITH CONDITIONS, and each must be listed as a condition or blocker |
| a High risk-accepted in writing (tiers 1–2 only) | GO WITH CONDITIONS |
| nothing of the above; open Mediums and Lows have owner and date | GO |

The reviewer may always choose a stricter verdict (for example NO-GO because a core flow was never tested), and says why.

## 5. Quality history: finding what keeps going wrong

Bugs that came back once will come back again unless the reason they happen is fixed. Section 12 records that work:

1. **Collect.** Run `history-scan.mjs` on the repository (fix commits, reverts, hotspots). Add the issue tracker (`--issues`, from `gh issue list --json ...`), incident notes and earlier review reports.
2. **Group.** Put each defect in a problem class: bad input and crashes; concurrency and double actions; outside services and time-outs; access and secrets; configuration and deploys; wrong data; performance; screens; tests and tooling. The scan proposes classes from keywords; the reviewer corrects them by reading the changes.
3. **Find the root cause** of every class with two or more occurrences: why does it keep happening? A root cause is a design or process gap ("payment outcomes were modelled as success or failure only; nothing represented *unknown*"), not the last bug ("a timeout was too short").
4. **Add a control** that catches the next one automatically: a test, a code-scanning rule, a database constraint, a type, a CI gate. Run it against a past example to prove it works.
5. **Teach the agents.** Add a one-line rule to the agent instruction file pointing at the control, so the next AI-written change doesn't repeat the mistake.
6. **Register what's still open** with severity, owner and date. At the next review, compare the counts per class.

## 6. Quality gates: software counts

An AI reviewer (or a tired person) that says "all 95 criteria checked" may have checked 93. So counting is done by software, at the end of each stage, and a stage isn't finished until its gate passes:

| Gate | When | It counts |
|---|---|---|
| `gate submission` | author, before handing in; reviewer, before starting | checker errors (must be 0), demo journeys with evidence, evidence files that really exist, saved text evidence with no real email addresses or keys (pictures are checked by eye), the README's nine items and its link to the page |
| `gate worksheet --areas …` | reviewer, after each part of the review | per area: mandatory criteria with a result, and exactly which are missing; with the area, the records behind the three questions: test suites with a type (H), kinds of performance test with a result (P), places hidden problems sit with a result (A), problems that came back with the kinds of test that would catch them (Q) |
| `gate review` | reviewer, before signing | all of the above for every area (except the README, which the R criteria judge), open Critical and High findings listed as blockers, each blocker with a card in What to fix, Must acceptance criteria with a result, every scanner rule that fired reported or dismissed, every source of evidence used or explained, and a verdict the results allow |

Each gate prints expected against found, lists what's missing, and exits with an error if anything is. Numbers in the report are copied from `status` or a gate, never counted by hand. The skills (`prepare-review`, `launch-review`) run the gates themselves.

## 7. Tools

```bash
S=.claude/skills/launch-review
node $S/scripts/review-pack.mjs template review/review-pack.json --tier 2 --features accounts,money,aiAssisted
node $S/scripts/review-pack.mjs gate submission review/review-pack.json            # author, before handing in
node $S/scripts/review-pack.mjs merge launch-review/review-pack.json launch-review/worksheet/*.json
node $S/scripts/review-pack.mjs gate worksheet launch-review/review-pack.json --areas S,A,D
node $S/scripts/review-pack.mjs status launch-review/review-pack.json              # results so far, per area
node $S/scripts/review-pack.mjs gate review launch-review/review-pack.json         # reviewer, before signing [--scans dir]
node $S/scripts/review-pack.mjs render launch-review/review-pack.json launch-review/review.html
node $S/scripts/review-pack.mjs report launch-review/review-pack.json launch-review/REPORT.md   # the written report, same record
node $S/scripts/history-scan.mjs . review/history [--since 2025-01-01] [--issues issues.json]
```
The gates are the pass/fail. `validate --stage submission|review` prints only the checker's messages, without the counts, which is handy while filling in the pack.

A complete example is [`demo/flash-sale/review/`](../../../../demo/flash-sale/review/) in this repository.

## 8. Changing the standard

The standard is versioned (`standard` in `criteria.json` and in each pack). Add a criterion when a real problem escaped a review that followed the standard; remove one only when it never applies. Each change goes in the changelog.
