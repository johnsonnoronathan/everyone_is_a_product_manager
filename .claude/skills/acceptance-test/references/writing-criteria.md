# Writing acceptance criteria with a product owner

Good criteria are **observable** (someone can see whether it happened), **specific** (numbers, exact messages or their meaning), and **independent** (each can pass or fail on its own).

## Format

```markdown
### AC-04 · Must · One pair per customer, even on double-click
- **Given** a signed-in shopper
- **When** they double-click "Buy now"
- **Then** exactly one order exists for them
```
- Heading: `### AC-<number> · <Must|Should|Could> · <short outcome in plain words>` (the report parser relies on this).
- Must = launch blocker. Should = important, can launch with a dated plan. Could = nice to have.
- For things verified outside the browser suite add `- **Evidence:** external: <tool/report>`.
- Put a version line at the top and record who agreed it and when.

## Turn vague wishes into testable statements

| Vague | Testable |
|---|---|
| "Checkout is fast" | "After clicking Pay, the confirmation appears within 3 seconds on staging" |
| "Errors are user-friendly" | "If the card is declined, the shopper sees 'Your card was declined' and the cart is kept" |
| "Secure" | "A shopper cannot open another shopper's order page; they see 'not found'" |
| "Works on mobile" | "On a phone-sized screen the page has no sideways scrolling and the Buy button is visible" |
| "Admins can manage products" | "An admin can change a price; a normal user gets 'not allowed' on the same action" |

## Edge-case checklist (propose the ones that apply)

**Any form / action**: empty and invalid input; very long input; double-click / double-submit; browser back after submit; refresh mid-flow; session expired mid-flow.
**Sign-in & accounts**: wrong password message; password reset end-to-end; sign-out really signs out; signed-out user hitting a protected page is sent to sign-in; email already used.
**Permissions & privacy**: user A can't see/change user B's data; normal user can't reach admin features; logged-out visitor can't see private pages.
**Money**: price shown = price charged; discounts/coupons apply once; refund flow; receipt email content; currency and rounding.
**Limits & stock**: last item; sold out; per-customer limit; coupon expired; sale not started yet / ended (time zones!).
**Third parties failing**: payment declined; payment provider slow/down; email provider down. Agree what the user should see. Check these criteria with an engineer: for money, "slow" is not "failed" (a timed-out payment may have gone through), so the right outcome is usually "we're confirming your payment", not "try again".
**Lists & search**: empty state; one result; many results with pagination; special characters in search.
**Uploads**: wrong file type; too large; slow upload.
**Mobile & accessibility**: phone-sized screen; keyboard-only use of the core flow; no serious automated accessibility violations (axe, WCAG 2.1 AA).
**Content & AI features**: user content with HTML/emoji shows as text; AI answers don't reveal other users' data; AI failure shows a helpful message.

## Things a browser test can't prove: link them instead
- Behaviour under heavy traffic, overselling under concurrency → `peak-traffic-test`.
- Security beyond the visible permission checks → `launch-review`.
- Email delivery/inbox placement, real payment settlement → manual check in the provider's test dashboard, recorded with a screenshot.

## Agreeing the list
Send the product owner the list grouped by Must/Should/Could, in plain language, and ask three questions: *Is anything missing that would make you refuse the release? Is any "Must" actually negotiable? Is any wording open to two interpretations?* Record the answer and the date in the version line.
