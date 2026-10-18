# Intake: scope and risk tier

Read the code first (README, package files, routes, env examples, migrations) and pre-fill answers. Then ask the user only what you couldn't infer, in one short message, in business language.

## Questions

1. **What does the product do and who uses it?** Public consumers, business customers, internal staff? How many at launch, and in a year?
2. **What data does it hold?** Emails/names/addresses (personal data), passwords, payment details, health, financial, children's data, location, uploaded files, private messages.
3. **Does money move?** Payments, subscriptions, refunds, payouts, credits, coupons. Through a hosted checkout (Stripe Checkout, Paddle) or handled in the app?
4. **How do people sign in?** Provider (Supabase Auth, Clerk, Auth0, Firebase, NextAuth, custom) and roles (user / admin / staff).
5. **Where does it run?** Hosting, database, environments available (is there a staging copy?), who can deploy.
6. **Launch details:** date, expected traffic, any promotion or spike (→ `peak-traffic-test`).
7. **Rules that apply:** GDPR/UK GDPR (EU/UK users), CCPA/CPRA (California), HIPAA (US health), PCI DSS (cards), COPPA (children under 13 in the US), sector rules. Flag them; you don't certify compliance.
8. **Out of scope / known issues:** anything the user already knows about or explicitly doesn't want reviewed.
9. **Live checks allowed?** May we run light read-only checks against a URL? Which one? (Production only with explicit OK.)

## Risk tier

| Tier | When | What it changes |
|---|---|---|
| **1: Low** | Internal tool or prototype, no personal data beyond staff emails, no money | Standard review; Medium findings rarely block |
| **2: Standard** | Public users with accounts or personal data, or payments via a hosted checkout | Full review; Critical blocks, High blocks unless risk-accepted in writing |
| **3: High** | Handles payments/cards in-app, health/financial/children's data, regulated sector, large launch (≥ 10k users in week one or a paid promotion), or anything where a breach makes the news | Full review **plus** a recommendation for an independent human penetration test before or soon after launch; High findings always block; operational readiness (backups, monitoring, incident plan) is mandatory |

## Output: `launch-review/00-scope.md`

```markdown
# Scope
- Product: …
- Users / scale: …
- Sensitive data: …
- Money flows: …
- Auth & roles: …
- Stack & hosting: …
- Environments: … (live checks allowed against: … / not allowed)
- Launch: date …, expected peak …
- Regulations to keep in mind: …
- Out of scope: …
- **Risk tier: 2 (Standard)**, because …
- Commit reviewed: `abc1234` (branch …)
```
