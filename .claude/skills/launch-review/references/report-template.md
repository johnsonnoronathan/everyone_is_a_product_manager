# The inspection report

`REPORT.md` is not written by hand. It is generated from the review pack, after Gate 5:

```bash
node <skill-dir>/scripts/review-pack.mjs report launch-review/review-pack.json launch-review/REPORT.md
```

It always has this order, like an audit or a release-gate report: the evidence and conclusions first, then how they were reached.

1. **Summary: evidence and conclusions.** The verdict and why; what would happen if it were delivered now; the three questions, each answered Yes, Partly or No with its evidence in numbers and a one-sentence conclusion; the blockers; when it could be delivered.
2. **How the inspection was done.** Every source of evidence in the standard list (code, change history, issue tracker, user reports, earlier reviews, the project's tests, the running app, measurements, scans, the owner and team), each used with what, or not with why; the skills and tools used.
3. **Results.** For each question: the evidence, the conclusion and, for the harness, which kinds of test would have caught the problems that came back.
4. **Recommendations.** What has to happen (who, how big, when); the kinds of test to add or strengthen; the performance tests still to run; the places not yet examined; the skills and tools the team can use; decisions only the owner can make.
5. **Limits.** What was not checked.
6. **Appendices.** Every open problem, checklist results by area, glossary.

The review page (`review.html`) shows the same record in the same order, with all the evidence. To change what the report says, change the record: the worksheet, the findings, `method`, `performance.coverage`, `architecture.hiddenChecks`, `history.classes[].catchWith` and `harness.suites[].type`. The fields are described in `standard/review-standard.md` §2.
