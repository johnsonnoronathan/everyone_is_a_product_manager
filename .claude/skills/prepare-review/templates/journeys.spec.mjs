// Demo journeys for the review page. One test per journey; each step saves a screenshot to review/evidence/,
// so the demo can be taken again for every hand-in. Copy into the acceptance suite (acceptance/tests/) and adapt.
//   BASE_URL=http://localhost:3000 npx playwright test tests/journeys.spec.mjs
import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const EVIDENCE = new URL('../../review/evidence/', import.meta.url).pathname; // <project>/review/evidence/
mkdirSync(EVIDENCE, { recursive: true });
const shot = (page, journey, step) => page.screenshot({ path: `${EVIDENCE}${journey}-${step}.png`, fullPage: false });

test.beforeEach(async ({ request }) => {
  // Put the app in a known state: reset test data, open the sale, and so on.
});

test('J1 Buy one item', async ({ page }) => {
  await page.goto('/');
  await shot(page, 'j1', '1-start');

  // Act like the user: labels and roles, never sleeps.
  // await page.getByLabel('Email').fill('shopper@example.test');
  // await page.getByRole('button', { name: 'Sign in' }).click();
  // await page.getByRole('button', { name: 'Buy now' }).click();

  // Wait for the result the journey promises, then capture it.
  // await expect(page.getByRole('status')).toContainText('confirmed');
  await shot(page, 'j1', '2-result');
});

// J2, J3…: one test per journey, including the "must not happen" cases (sold out, too early, someone else's data).
