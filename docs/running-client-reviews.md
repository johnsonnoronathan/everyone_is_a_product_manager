# Running a launch review for a client

A one-page playbook for consultants and agencies who use these skills to review and acceptance-test apps for clients, often product managers or founders who built the app with AI help. It's practical advice, not legal advice. The principles behind it are in [The release gate](release-gate.md).

## 1. Get written permission first
Before running anything beyond reading code, get a short written authorisation from someone entitled to give it. It should cover:
- **What**: repositories, environments and URLs in scope, and what's explicitly out of scope.
- **Which tests**: code review and scans; light live checks (a few GET requests); load tests (target URL, maximum request rate, time window); the oversell race (test data only).
- **When and who**: the time window, a contact who can stop the test, and who to call if something breaks.
- **Data**: you won't access real customer data; payments and email stay in test mode.

A load test without this is indistinguishable from an attack. The skills ask for confirmation, but the paper trail is yours.

## 2. Set expectations in the kickoff
- Run the intake (`launch-review` Phase 0) together and agree the **risk tier**. It decides what blocks launch.
- Say up front what the result is and isn't. The result is evidence-backed findings and a GO / GO WITH CONDITIONS / NO-GO verdict, plus a list of what wasn't checked. It is **not** a guarantee of security, and not a compliance certification (GDPR, PCI DSS, HIPAA: you flag, you don't certify). For tier 3 apps, recommend an independent penetration test as well.
- Agree acceptance criteria with the product owner **before** anyone writes tests, and get the "v1.0 agreed" line in writing.

## 3. Run the review
Ask Claude for a launch review. It runs the scanners, reviews every entry point, verifies Critical and High findings, and calls `peak-traffic-test` and `acceptance-test` where they apply. Before the report goes out, read it yourself: you are signing it.

**Escalate immediately, don't wait for the report:** live secrets in code or in the browser bundle, personal data readable by anyone, or an open admin endpoint. Tell the client the same day and help them rotate or close it.

## 4. Deliver
- `launch-review/REPORT.md`: the verdict and the blockers, for the decision-maker.
- `launch-review/peak-traffic/REPORT.md` and `launch-review/acceptance/ACCEPTANCE.md`: evidence and the sign-off table.
- Walk the product owner through the blockers on a call; most people skim reports.
- **Share privately.** Reports explain how to break the app. Keep them out of public repositories (add `launch-review/` to `.gitignore` unless the client wants them versioned privately) and out of public tickets.

## 5. Fix, then re-review (not just re-test)
- Re-verify every finding against the new code and change its status. Never delete findings.
- Do a fresh review of the changed code. In this repository's demo, *each* round of fixes introduced at least one new serious problem that only a fresh review caught: a one-request crash, double charges on slow payments, a start time that silently stayed wrong.

## 6. Close the engagement
- The final verdict, with open conditions as a list of **owner + date** items.
- Signed acceptance table, with the commit reviewed and tool versions recorded so the result can be reproduced.
- Recommended re-checks: before the next big promotion, after major changes, and a load re-test on production-like infrastructure.

## Licensing in paid work
As configured, the toolchain is fine for commercial use. Our own rules are MIT. Gitleaks, OSV-Scanner, Playwright and axe-core are permissively licensed. k6 (AGPL) is run as a separate tool. The Semgrep CE engine is LGPL. **Semgrep's registry rules** need a commercial licence if you charge for scanning with them, so they're off by default (`SEMGREP_REGISTRY=1` turns them on, for your own code only).
