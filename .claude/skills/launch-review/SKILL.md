---
name: launch-review
description: Thorough pre-launch review of a web or mobile app's architecture, security, performance and operations. Produces an evidence-backed GO / GO WITH CONDITIONS / NO-GO report that a product manager can act on and an engineer can fix from. Use before going live, before a big promotion, when taking over or handing over an AI-built ("vibe-coded") app, or when someone asks "is this ready for production?", "is it secure?", "review my app before launch", "production readiness", "security audit", "can we go live?".
---

# Launch review

You are doing a pre-launch review for someone who may not be an engineer: often a product manager who built the app with AI help, or a consultant reviewing a client's app. The goal is that nothing ships that will hurt the people who use it or the business that runs it: no data leaks, no lost money, no outage on launch day.

`<skill-dir>` = this skill's base directory (shown when the skill loads). Write everything to `launch-review/` in the project under review.

## Principles (these make the review trustworthy)

1. **Evidence or it doesn't go in.** Every finding points to code (`file:line`), command output, or a reproduction. No "might be vulnerable" without a concrete path.
2. **Say what was and wasn't checked.** The report always has a coverage table and limitations. Never write "the app is secure"; write "no issues found in the checks listed".
3. **Do no harm.** Read-only by default. No destructive, intrusive or high-volume tests, and nothing against production, without the owner's explicit written OK. Never access or copy real customer data. Redact secrets (first 4 characters + `…`) everywhere you write them.
4. **Escalate immediately, don't wait for the report:** a live secret in the repo or bundle, publicly readable personal data, or an open admin endpoint. Tell the user right away and recommend rotating/closing it now.
5. **Two audiences.** Each finding has a plain-language impact line for the PM and precise detail for the engineer.
6. **Severity follows `references/severity.md`**, not gut feeling, and the verdict follows its rules.

## Workflow

### Phase 0: Scope (≈5 min with the user)
Run the intake in `references/intake.md`. Infer what you can from the code first and ask only what's left. Write `launch-review/00-scope.md` with the risk tier, and confirm it with the user before going deep.

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

### Phase 3: Expert review (four lenses)
Review the code path behind every entry point in the system map against:
- **Security**: `references/security.md` (OWASP Top 10:2025, API and LLM risks, platform pitfalls for Supabase/Firebase/Next.js/Stripe…)
- **Architecture & data integrity**: `references/architecture.md`
- **Performance & scale**: use the `peak-traffic-test` skill if there's a launch, promotion or any expected spike; otherwise its `references/anti-patterns.md` for a static pass.
- **Operations & launch readiness**: `references/operations.md`

If the Agent tool is available, run the four lenses as parallel subagents (one message, four calls). Give each: the scope file, the system map, the relevant scan outputs, its checklist path, the finding format below, and the instruction "report only what you can point to in code or output; list what you could not check". Each writes `launch-review/findings/<lens>.md`. Otherwise do them one after another.

### Phase 4: Verify (the step that makes the report reliable)
For every Critical and High finding, take a second, sceptical pass (a fresh subagent if available):
- Trace from the entry point to the problem. Look for mitigations elsewhere: middleware, framework defaults, RLS policies, gateway rules, validation layers.
- Where safe, **reproduce** on a local or staging instance (a curl command, a small script, a failing test) and paste the output as evidence. Never reproduce against production or real data.
- Mark confidence: **Confirmed** (reproduced, or traced end-to-end with no mitigation) or **Likely** (code evidence, not reproduced). Drop or downgrade what doesn't hold.
- Merge duplicates: one root cause = one finding, listing all locations.

### Phase 5: Verdict and report
Apply `references/severity.md` and write `launch-review/REPORT.md` from `references/report-template.md`: verdict first, then the top actions, findings, coverage and limitations. Record the commit reviewed, date and tool versions so the result is reproducible. Tell the user in chat: the verdict, the blockers, and the report path.

### Phase 6: Fix and re-verify
Offer to fix blockers in priority order. After each fix, re-run the evidence (the reproduction, scanner, or test) and update the finding to **Fixed: verified on <date>, commit <sha>**. Never delete findings; change their status. Re-issue the verdict when blockers are closed.

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
Prefixes: `SEC` security, `ARC` architecture/data integrity, `PERF` performance, `OPS` operations. Effort: S (< 2 h), M (≤ 1 day), L (> 1 day). Only cite a standard/CWE you're sure of.
