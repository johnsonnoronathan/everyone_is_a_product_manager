# Severity and verdict rules

## Severity

Judge **realistic impact × how easy it is to trigger**, for this product and its risk tier.

| Severity | Meaning | Typical examples |
|---|---|---|
| **Critical** | Can be triggered now by an outsider or ordinary user (or happens on its own at launch) and causes a data breach, loss of money, takeover, or an outage of the core flow. | SQL injection on a public endpoint; database readable with the public key (no RLS); secret key in the repo or browser bundle; any user can read others' orders; price taken from the browser; overselling under load; one malformed request crashes the server; admin endpoints without auth. |
| **High** | Serious harm, but needs specific conditions (a logged-in attacker, a slow partner, peak traffic), or harms one user at a time. | Missing rate limiting on login (credential stuffing); no timeout on payment calls; IDOR needing a guessable id after login; double charge on double-click; app falls over below expected peak; no backups. |
| **Medium** | Weakens defences or degrades service, harm is limited or unlikely. | Missing security headers; verbose errors; no audit log for admin actions; N+1 queries that are slow but survive the target load; in-memory state that breaks only with multiple servers. |
| **Low** | Hygiene, defence in depth, future risk. | Outdated dependency without a reachable vulnerability; version headers; minor logging gaps. |
| **Info** | Observations, good practices seen, things to monitor. | |

Adjust by one level up or down when the context clearly warrants it (e.g. tier 3 data, or a feature behind an internal VPN) and say why in the finding.

**Confidence**: *Confirmed* (reproduced, or traced end-to-end with no mitigation found) or *Likely* (strong code evidence, not reproduced). A Critical/High that stays *Likely* after the verification pass must say what would confirm it.

## Verdict

| Verdict | Rule |
|---|---|
| **NO-GO** | Any open Critical. Or (tier 2) any open High that the owner has not explicitly accepted in writing with a fix date. Or (tier 3) any open High. Or a core flow was never tested at all (e.g. payments untested for a shop). |
| **GO WITH CONDITIONS** | No open Critical; Highs fixed or (tier 1–2 only) risk-accepted with a date; Mediums have an owner and a date. List the conditions explicitly (e.g. "rotate key X before launch", "on-call person during the sale", "replace the in-memory queue within 2 weeks"). Also use this verdict when important areas could not be checked; list them. |
| **GO** | No open Critical or High, Mediums planned, coverage complete for the risk tier. |

The verdict is about the checks performed. Always pair it with the coverage table; never present it as a guarantee.
