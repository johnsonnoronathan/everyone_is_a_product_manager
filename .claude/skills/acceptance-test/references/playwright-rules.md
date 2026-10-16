# Playwright rules for trustworthy acceptance tests

## Structure
- One file per feature area; one `test()` per criterion path; title starts with the id and the tag repeats it: `test('AC-02 shopper can buy', { tag: '@AC-02' }, async ({ page, request }) => { … })`.
- `retries: 0` and run with `--repeat-each=3`. Keep `screenshot: 'on'` and `trace: 'retain-on-failure'` for evidence.
- Shared app state → `workers: 1`. Fully isolated data (unique users per test) → parallel is fine.

## Locators and waiting
- Prefer what a user perceives: `getByRole('button', { name: 'Buy now' })`, `getByLabel('Email')`, `getByText(...)`. Use `data-testid` only for things with no accessible name (and suggest adding a name instead; that's an accessibility issue).
- Use web-first assertions that wait: `await expect(locator).toHaveText(...)`, `toBeVisible()`, `toBeDisabled()`, `expect.poll(...)`. **Never** `waitForTimeout`/sleep. Fixed sleeps are the top cause of flaky tests.
- Avoid CSS/XPath tied to layout (`div:nth-child(3) > span`).

## Test data and state
- Each test sets up what it needs: reset endpoint, seed script, or API calls; unique emails (`name-${Date.now()}-${n}@test`).
- Sign in through the UI once per flow under test; elsewhere sign in via API or `storageState` to keep tests fast.
- Clean up or reset in `beforeEach`, not `afterEach` (a failed test may never reach its cleanup).
- Never point tests at production data, real payment keys, or real customers' inboxes.

## Assert the outcome
- Pair UI assertions with a check of the source of truth for money, counts, permissions and data: `request.get('/api/my-orders')`, an admin/test endpoint, or a DB query in a fixture.
- Give assertions a message that reads as the business rule: `expect(orders, 'orders for this customer').toHaveLength(1)`. The report shows it.
- API-only tests have no screenshot; save what was sent and received as an `evidence` attachment (`test.info().outputPath('evidence.json')` + `test.info().attach('evidence', { path, contentType: 'application/json' })`).

## Testing failure modes deliberately
- Third-party down/slow: use the provider's test mode (e.g. Stripe test cards for declines), a test switch on a stub (as the demo's fake payment provider does), or `page.route('**/api/payment', r => r.fulfill({ status: 503 }))` for browser-side calls. Note that `page.route` only affects requests the *browser* makes, not server-to-server calls.
- Slow network: `page.route` with a delayed `route.continue()` for specific calls.
- Double-click: `locator.dblclick()`, then check the server-side result.

## Accessibility and devices
- `@axe-core/playwright`: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()`, then fail on `serious`/`critical` impacts and list the rule ids in the assertion so the report explains itself.
- Phones: `test.use(devices['Pixel 7'])` (Chromium) or `devices['iPhone 14']` (WebKit; needs `npx playwright install webkit`). Check for horizontal overflow and that key buttons are visible.

## When a test fails
1. Open the trace (`npx playwright show-trace <trace.zip>`) or the screenshot.
2. Decide: product bug / test bug / unclear criterion (see SKILL.md step 5).
3. If you change test code, change only how it finds or waits for things, never what it expects, and note the change in the report.

## Flakiness checklist
Fixed sleeps · shared data between tests · depending on test order · animations (use `toBeVisible` / `toHaveText`, which wait) · time-of-day/time-zone dependencies (freeze or set the clock with `page.clock`) · real third parties · caches (assert on the source of truth, wait for TTL, or bypass the cache) · random data without a seed. If a FLAKY result survives all of these, suspect a real race condition in the product and report it.
