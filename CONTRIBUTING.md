# Contributing

Thanks for helping make AI-built software safer to launch. Contributions of every size are welcome: a better sentence in a checklist is as useful as a new rule.

## Most valuable contributions

1. **Report a false alarm or a miss.** If a skill flagged something that wasn't a problem, or missed a real one, open an issue with the *"Review result was wrong"* template. These reports are how the checklists and rules get better.
2. **Add a pitfall for a stack you know** (Supabase, Firebase, Next.js, Rails, Django, Laravel, Shopify apps, mobile backends…) to the relevant checklist in `.claude/skills/*/references/`.
3. **Add or improve a Semgrep rule** (see below).
4. **Improve plain-language wording.** The readers are product managers and founders: if a message needs an engineer to understand it, it needs rewriting.

## Development setup

- Node.js ≥ 22.13 (the demo uses the built-in `node:sqlite`)
- [Semgrep](https://semgrep.dev/docs/getting-started/) for the rule tests (`pipx install semgrep`)
- Optional: [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/), [Gitleaks](https://github.com/gitleaks/gitleaks), [OSV-Scanner](https://github.com/google/osv-scanner)

```bash
npm test                                   # script unit tests + Semgrep rule fixtures
cd demo/flash-sale/acceptance && npm ci
VARIANT=fixed npx playwright test          # demo acceptance suite (should pass)
```

## Ground rules

### Semgrep rules
- **Write them yourself.** Don't copy rules from the Semgrep registry or other repositories: registry rules are under the Semgrep Rules License, which restricts commercial use, and this project must stay usable in paid client work. Ideas are fine; text is not.
- Every rule needs fixtures in `tests/semgrep/` (or a new file pair): at least one `// ruleid: <id>` line that must match and one `// ok: <id>` line that must not. `npm test` runs them.
- Messages explain the business impact and the fix in plain language. Add `owasp`/`cwe` metadata only when you're sure.
- Prefer a rule that misses some cases to one that floods users with false alarms. Every hit is a lead that someone has to read.

### Checklists and skills
- Cite an authoritative source for factual claims (official docs, OWASP, vendor documentation), not blog posts.
- Keep `SKILL.md` files short and push detail into `references/`, so Claude only loads what a task needs.
- Never weaken the safety rules (no testing of systems the user doesn't own, no production load tests without written permission, redact secrets).

### The demo
- `demo/flash-sale/naive/` is **intentionally vulnerable**. If you add a planted issue, add it to `demo/flash-sale/ANSWER_KEY.md`. Don't add comments to the naive code that give issues away; the review has to find them.
- If you change a skill materially, run it on the demo with a fresh session that hasn't seen the answer key, and compare its findings against `ANSWER_KEY.md`. Include the before/after in the pull request.

## Pull requests
- One topic per pull request, with a short description of what changed and why.
- `npm test` passes.
- New rules come with fixtures; new checklist items come with a source.

## Releasing (maintainers)
1. In `CHANGELOG.md`, give the changes since the last release a `## <version> (<date>)` heading and merge that to `main`.
2. In the Actions tab, run the **Release** workflow on `main` with the version number (for example `0.2.0`). It creates the tag `v<version>` and a GitHub release whose notes are that changelog section.
