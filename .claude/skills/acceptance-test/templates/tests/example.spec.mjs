// Pattern for acceptance tests: one test per criterion, tagged with its id.
// Replace the example steps with the product's real flows.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// API-level checks have no screenshot: save what was sent/received as evidence.
async function attachEvidence(data) {
  const file = test.info().outputPath('evidence.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  await test.info().attach('evidence', { path: file, contentType: 'application/json' });
}

test.beforeEach(async ({ request }) => {
  // Reset or seed test data here (test-only endpoint, seed script, or unique data per test).
});

test('AC-01 <outcome>', { tag: '@AC-01' }, async ({ page, request }) => {
  await page.goto('/');
  // Act like the user: role/label locators, no sleeps.
  // await page.getByLabel('Email').fill('shopper@example.test');
  // await page.getByRole('button', { name: 'Continue' }).click();

  // Assert what the user sees...
  // await expect(page.getByRole('status')).toHaveText(/Order #\d+ confirmed/);

  // ...and the source of truth when money, counts, permissions or data are involved.
  // const orders = await (await request.get('/api/my-orders')).json();
  // await attachEvidence({ orders });
  // expect(orders, 'orders for this customer').toHaveLength(1);
});

test('AC-0X page has no serious accessibility violations', { tag: '@AC-0X' }, async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`)).toEqual([]);
});
