# A formal report for the owner

Use this guide when the owner wants more than the generated report: a formal report to sign off, pass to their manager or keep on file. It also helps when a review is revised several times, or when it looks into why the same defects keep coming back.

The formal report is written from the same review pack as `REPORT.md` and the review page. It changes how the results are presented and adds a few things the owner asks for. It never changes the results. Copy every count from `REPORT.md`, `status` or a gate, as you would anywhere else. If the formal report and the generated report disagree, the record is right and the formal report is wrong.

It came out of a recurring-defect audit of a production backend. The owner rejected early versions because they were "too detailed for me" and "looks informal". The rules below are what fixed that over several revisions. The examples are set in the demo shop, and their numbers are made up to illustrate the format.

## 1. The owner's page comes first

The first reader is the owner, usually not an engineer. After the first page they should be able to say why the problems happen, what it costs the business, what is done first (by whom, how big, by when), and how anyone will know it worked. Write it in this order:

| Part | What it says | Where it comes from |
|---|---|---|
| The question | What this report answers, in one sentence: "Why do fixed bugs come back in the shop, and what stops them?" | The scope |
| The finding | One or two sentences that answer it | `verdict.decision`, `verdict.reason` |
| What it means for the business | Quality, speed and risk, each as one number with its source and grade ("12 of the last 40 fixes were for problems fixed before; issue tracker, all closed issues since March") | `history.stats`, measurements |
| The state of each area | For each area the owner cares about: failing, weak, missing or working, and one line on why | The three questions in `REPORT.md`, the area notes |
| What to do first | A short list. Each item has who, how big, when, and how anyone can tell it is done | `verdict.blockers`, `verdict.conditions` |
| How you'll know it worked | Measures the owner can watch, each with a baseline (and where the baseline came from) and a target | Section 3 below |
| What is still unknown | What the review couldn't establish, and what would settle it | `notChecked`, the observed-but-not-verified list (section 4) |

Keep commit hashes, file paths, framework names and criterion codes off this page. They belong further down, where the engineers will look for them.

## 2. Make it look like a formal document

Start with a document control table:

| Field | Example |
|---|---|
| Report | Flash-sale launch review, revision 3 |
| Date | 2026-11-04 |
| Subject | The flash-sale shop, backend and checkout |
| Period covered | Issues and changes from 2026-03-01 to 2026-10-31 |
| Code reviewed | Commit and branch |
| Standard and skill | launch-review version and commit |
| Prepared by | The reviewer (a role or name) |
| Distribution | Who may read it (private, team, client) |
| Changed in this revision | One line |
| Previous revision | Its number, and how this one relates to it |

- **Revisions.** Number every published revision. Only one can be "current". Older ones stay available, labelled with their number. A correction to how something was counted is a correction to the report, not a change in the product's quality, so say so in "Changed in this revision".
- **Numbered sections and tables.** Number sections (1, 1.1). Put findings, controls, timelines and actions in tables, not cards. Show severity as a small marker plus the word. Leave out big decorative numbers, coloured badges and shadows.
- **Tone.** State what the review established: "The review established that…", "Observed:". Don't ask the reader questions or coach them. Say exactly what is missing: "Backend tests not run: Java is not installed on the review machine". Don't write vague disclaimers.
- **On screen.** Lay it out for a laptop in landscape: a contents column on the left, the document on the right, and a single column on a phone. Show everything expanded. Use system fonts only, so the page opens without outside requests.

## 3. One chain per problem class

A finding describes one problem. The owner pays for problem *classes*: "money handled twice", "a fix that never reached the branch customers use". For every class in `history.classes`, write one chain, in this order:

1. **How far it was looked for.** Every similar place (full scan), a sample (say how it was chosen), or an experiment. Say which.
2. **Observed.** What the review saw, with the occurrences.
3. **Why.** Ask "why" until you reach something that is a gap in the design or process, not the last bug. Usually that takes three or more levels. Label any level you could not verify as an assumption. The last level is the root cause (`rootCause`).
4. **The lasting fix.** The control that catches the next one automatically (`control`), and the one-line rule for the agent instruction file (`agentRule`).
5. **What can be done now.** A smaller step that reduces the harm before the lasting fix is in place.
6. **Why it can be finished.** Who owns it, and the tool or skill that already exists for it.
7. **How the cause is checked.** See section 4.
8. **Measures.** Positive measures that show the class is under control, each with a baseline, where the baseline came from, and a target. Example: "share of fixes for problems fixed before: baseline 12 of 40 (issue tracker, March to October), target under 1 in 10 over the next three months".

Every finding belongs to at least one chain or one remediation item, so nothing is left without a plan.

## 4. Check the cause, not only the example

A control that fails on one known bad example has not yet shown that it is the cause of the catch, or that it is safe to switch on. For every control the report relies on, run three checks and record each result (issue #9 proposes the same for criterion Q-04):

1. **The bad example fails** with the control in place.
2. **The same example gets through without the control** (remove it, or use the commit before it). This shows the control is what catches it.
3. **Correct code produces no finding**, including code that only looks similar. This shows it won't block good pull requests on its first day.

If the control was written from the known examples, also try it on examples you did not use while writing it, and report that result separately.

Where only observation is possible, write "observed", never "proved". Keep a separate list, **Observed but not verified**: each item with what was seen, why it couldn't be verified, and what would verify it (the material, the access, the person). Where a fact rests only on the author's word or documentation (grade C), say so where the conclusion uses it.

## 5. Remediation and roadmap

- **Remediation items.** Each has an id, a priority, the findings it addresses, the role responsible, when, how anyone can tell it is done, and the skills or tools that help: this repository's skills, the team's own, or others the team already uses.
- **The roadmap sets the dates.** Group the items into phases. Each item's "when" is its phase, so there is only one place to change a date.
- **Fix the tests before you switch on blocking.** A new CI gate that fails on today's code gets switched off. Make the tests and the control pass on correct code first, then make the gate block.

## 6. Before you publish: a hostile read

Before the owner sees it, have someone who did not write it read the report and try to break it: another reviewer, or a subagent told to look for faults. Give them three angles:

1. **Evidence and conclusions.** Does every sentence say no more than its evidence? Do the numbers match the record?
2. **Method and cause.** Is anything that was only observed written as proved? Does every cause have the three checks from section 4, or an "observed" label?
3. **Readers and safety.** Can the owner act on page one? Is anything in it unsafe to share?

Fix what they find. In an appendix, list each point, what was changed, and what was left and why.

## 7. If the report goes beyond the team

The skill's rule stands: reports explain how to break the app, so share them privately. If the owner still wants a version for a wider audience, prepare it and check it before it leaves:

- no links to private repositories, and no local paths;
- no details of defences that are not fixed yet;
- no names, emails, account ids or keys (redact as the skill describes); refer to tickets by a sample number, not their tracker id;
- no customer data; screenshots use made-up data.

Search the finished file for email addresses, key patterns and local paths before you hand it over, and record that you did.

## Checklist

- [ ] The owner's page answers the question, gives the finding, its business impact with sources, the state of each area, what to do first (who, how big, when, done when), measures with baselines and targets, and what is unknown. It has no commit hashes or file paths.
- [ ] The document control table is filled in, and only one revision is current.
- [ ] Every count matches `REPORT.md`, `status` or a gate.
- [ ] Every problem class has a chain, ending in a root cause, with assumptions labelled.
- [ ] Every control the report relies on has its three check results, or is listed as observed but not verified.
- [ ] Every finding maps to a chain or a remediation item. Every remediation item has a role, a phase from the roadmap and a "done when".
- [ ] A hostile read was done, and its points are recorded.
- [ ] If the report is shared beyond the team, it was checked for the items in section 7.
