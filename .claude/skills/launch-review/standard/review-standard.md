# The review standard

Version 1.0. A fixed format for handing a project in for review, and for writing the result. It exists so that:
- **the author** knows exactly what to hand in, and can check it's complete before anyone spends time on it;
- **the reviewer** fills in a form instead of a blank page, so no area is skipped and every review comes out the same shape;
- **the owner** gets a result they can read: a verdict first, then every area answered as *meets*, *does not meet*, *cannot verify* or *not applicable*, each with its evidence.

The rules behind it are in [The release gate](../../../../docs/release-gate.md): judge the evidence, not the author or the tool; review independently of the author; "ready" is a written set of evidence a named person signs.

## 1. What the author hands in

Three things, all in the repository at the commit under review:

| What | Where | Minimum |
|---|---|---|
| **README** | repository root | The nine items in §1.1. |
| **Review pack** | `review/review-pack.json`, with screenshots and other evidence in `review/evidence/` | The author's sections in §2, passing `review-pack.mjs validate --stage submission`. |
| **Review page** | `review/index.html` | Rendered from the pack by `review-pack.mjs render`. One self-contained file: it can be opened offline, attached to an email or hosted as is. |

The JSON pack is the record; the page is a view of it. Authors don't write HTML, and every project's page has the same sections in the same order.

**Entry rule.** If the pack doesn't pass the submission check, the review doesn't start. The reviewer sends back the page as rendered: its first section lists exactly what is missing. That page is the first report.

### 1.1 README minimum

| # | Item | It must say |
|---|---|---|
| 1 | What it is | What the product does, who uses it, and its status (prototype, beta, live). |
| 2 | Review page | A link to `review/index.html`, and to a live staging copy if there is one. |
| 3 | Quick start | Prerequisites with versions, then the commands that set it up and start it from a clean checkout, and the address to open. |
| 4 | Test access | Test accounts or how to create them, how to reset test data, and confirmation that payments, email and other side effects are in test mode. |
| 5 | Tests | The one command that runs all tests, and what they cover. |
| 6 | Settings | Every setting the app reads, or a link to the table in the review pack. |
| 7 | Architecture | One paragraph, with a link to the review page's architecture section. |
| 8 | Known problems | A link to the known problems register (review page §12). |
| 9 | For AI agents | A link to the agent instruction file (`AGENTS.md`, `CLAUDE.md` or equivalent) if agents work on the code. |

## 2. The review page: sections and formats

Sixteen sections, always in this order. **A** = the author fills it in before the review; **R** = the reviewer fills it in. Field names refer to `review-pack.json`; a blank template comes from `review-pack.mjs template`.

| § | Section | Who | Minimum content | Fields |
|---|---|---|---|---|
| 1 | Verdict | R | Decision (GO, GO WITH CONDITIONS, NO-GO), the reason in one or two plain sentences, blockers, conditions with owner and date, sign-off. The page adds results by area and any missing items. | `verdict`: `decision`, `reason`, `blockers[]` and `conditions[]` (`text`, `refs[]`, `owner`, `due`), `signedBy`, `signedOn` |
| 2 | Product | A | What it does and for whom, users, out of scope, risk tier with its reason, and the features that switch criteria on (§3). | `project`: `name`, `summary`, `repository`, `commit`, `date`, `author`, `riskTier`, `riskReason`, `features[]`; `product.users`, `product.outOfScope[]` |
| 3 | Demo | A | Each main user journey: who, numbered steps, the expected result, at least one screenshot or recording, and the acceptance criteria that prove it. | `product.journeys[]`: `id`, `name`, `who`, `steps[]`, `expected`, `evidence[]` (`path` or `url`, `caption`), `criteria[]` |
| 4 | How to run it | A | Prerequisites with versions; set-up, start, open, test and reset commands; staging address or `null`; test accounts; every setting. | `run`: `prerequisites[]`, `setup[]`, `start`, `open`, `test[]`, `reset`, `staging`, `accounts[]` (`role`, `how`), `settings[]` (`name`, `purpose`, `secret`, `production`, `example`) |
| 5 | Requirements | A | The standard the review judges against, with numbers: traffic, response times, acceptable data loss, recovery time, data rules, who agreed and when. | `requirements[]`: `id`, `text`, `target`, `agreedBy`, `agreedOn`, `source` |
| 6 | Architecture | A | Summary, diagram (Mermaid), components and their jobs, every entry point with who may call it, data stores, outside services with their time limits, major decisions. | `architecture`: `summary`, `diagram`, `components[]`, `entryPoints[]` (`entry`, `caller`, `guard`, `touches`), `dataStores[]`, `services[]` (`name`, `purpose`, `timeout`, `onFailure`), `decisions[]` (`title`, `why`, `alternatives`, `downsides`) |
| 7 | Business rules | A | Every rule the data must obey, how it is enforced and what proves it. | `rules[]`: `id`, `rule`, `enforcedBy`, `provenBy` |
| 8 | Harness | A | The agent instruction file (or `null`), every test suite with its command, coverage and last result, CI gates, other checks. | `harness`: `agentFile` (`path`, `summary`) or `null`, `suites[]` (`name`, `kind`, `covers`, `command`, `lastRun`, `inCI`), `ci[]`, `checks[]` |
| 9 | Performance | A, R | Target, test environment, every load-test run (failures too), results per step, race test, slow-partner test, conclusion. | `performance`: `target`, `environment`, `runs[]` (`label`, `result`, `pass`, `note`), `steps[]`, `race` (`summary`, `rows[]`), `slowPartner`, `conclusion` |
| 10 | Security | R | A plain-language summary; the criteria do the rest. | `areaNotes.S` |
| 11 | Operations | R | A plain-language summary; the criteria do the rest. | `areaNotes.O` |
| 12 | Quality history | A, R | Sources and period, defect counts, recurring problem classes with root cause and control, hotspots, and the known problems register. | `history`: `period`, `sources[]`, `stats[]`, `classes[]` (`name`, `occurrences[]`, `rootCause`, `control`, `controlCheck`, `agentRule`, `status`), `hotspots[]`, `known[]` (`id`, `text`, `severity`, `owner`, `due`, `status`) |
| 13 | Acceptance | A, R | The agreed criteria (version, who agreed), each with priority, result over three runs and its screenshots. | `acceptance`: `criteriaVersion`, `agreedBy`, `run`, `rows[]` (`id`, `priority`, `criterion`, `status`, `runs`, `evidence[]`, `note`) |
| 14 | Findings | R | Each problem found: severity, confidence, status, plain-language impact, where, fix. | `findings[]`: `id`, `severity`, `confidence`, `status`, `title`, `impact`, `where`, `fix` |
| 15 | Not checked | R | Everything the review did not or could not cover. | `notChecked[]` |
| 16 | Glossary | R | Every technical term used, in plain words. | `glossary[]` (`term`, `meaning`) |

Sections 4 and 6 to 13 each end with **How this was judged**: the criteria for that area, each with its result. The reviewer records these in `worksheet[]` (§3). Optional plain-language summaries per area go in `areaNotes` (keys `R`, `H`, `A`, `D`, `S`, `P`, `O`, `Q`, `U`).

Text fields accept `` `code` `` and `**bold**`; everything else is shown as written. Evidence paths are relative to the pack file; images are embedded in the page.

## 3. The worksheet: how each criterion is judged

The criteria are listed in [`criteria.md`](criteria.md) (generated from [`criteria.json`](criteria.json)): 98 criteria in nine areas.

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

**Evidence grades.** Documentation describes intent, code shows what should happen, and only a running system shows what does. So evidence is graded:

| Grade | The reviewer… | Examples |
|---|---|---|
| **A** | ran, reproduced or measured it | a load test, a restore, a request as another user, the test suite run three times |
| **B** | inspected the thing itself | the code, the schema, the configuration, the README when the README is what's being judged |
| **C** | has only a statement | documentation, a slide, the author's word, an AI summary |

Each criterion names its lowest acceptable grade. Grade C never supports a "meets": a claim is not evidence. Where only C is available, the result is `cannot-verify`, and `needed` says what would turn it into A or B.

**Which criteria apply.** Every criterion has a tier from which it is mandatory (it's recommended below that tier), and some apply only when the product has a feature, listed in `project.features`:

`aiAssisted` (AI agents write code), `accounts`, `personalData`, `money`, `limitedStock`, `adminArea`, `browserDatabase`, `webhooks`, `uploads`, `ai` (calls an AI model at runtime), `launchSpike`.

A mandatory criterion with no result counts as "cannot verify".

## 4. Verdict rules

The verdict follows from the worksheet and [`severity.md`](../references/severity.md). The validator works out the most favourable verdict the worksheet allows and rejects a more favourable one:

| The worksheet has… | The verdict can be at most |
|---|---|
| any criterion that does not meet at **Critical** | NO-GO |
| any that does not meet at **High** (at tier 3, or not risk-accepted in writing at tiers 1–2) | NO-GO |
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

## 6. Tools

```bash
S=.claude/skills/launch-review
node $S/scripts/review-pack.mjs template review/review-pack.json --tier 2 --features accounts,money,aiAssisted
node $S/scripts/review-pack.mjs validate review/review-pack.json --stage submission   # author, before handing in
node $S/scripts/review-pack.mjs validate review/review-pack.json --stage review       # reviewer, before signing
node $S/scripts/review-pack.mjs render review/review-pack.json review/index.html
node $S/scripts/history-scan.mjs . review/history [--since 2025-01-01] [--issues issues.json]
```

A complete example is [`demo/flash-sale/review/`](../../../../demo/flash-sale/review/) in this repository.

## 7. Changing the standard

The standard is versioned (`standard` in `criteria.json` and in each pack). Add a criterion when a real problem escaped a review that followed the standard; remove one only when it never applies. Each change goes in the changelog.
