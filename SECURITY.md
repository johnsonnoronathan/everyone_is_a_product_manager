# Security policy

## Reporting a vulnerability

Please report security problems **privately** through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for them.

You can expect an acknowledgement within a few days. Once a fix is available, the advisory will be published with credit to you, unless you'd rather stay anonymous.

## In scope
- The skills' scripts (`.claude/skills/*/scripts/`, `k6/`): for example, a script that could execute untrusted code from the project being reviewed, leak secrets into reports, or send data somewhere unexpected.
- Guidance in the skills that would lead a user into an unsafe action (for example, advice that weakens authentication or encourages testing systems without permission).
- The GitHub Actions workflows in this repository.

## Out of scope
- **`demo/flash-sale/naive/` is deliberately insecure.** It exists to be found and fixed, so its planted vulnerabilities (listed in `demo/flash-sale/ANSWER_KEY.md`) are not reportable. Never deploy it. The key in it is fake.
- Vulnerabilities in third-party tools the skills call (Semgrep, Gitleaks, OSV-Scanner, k6, Playwright). Please report those upstream.
- Findings a skill reported, or failed to report, about *your* application. Those are review-quality issues: use the *"Review result was wrong"* issue template.
