// Demo journeys for the review page. One test per journey, tagged @journey so the acceptance report doesn't list it
// as an unlinked test. Each step saves a screenshot to review/evidence/ BEFORE checking anything, so a journey that
// goes wrong is still shown. Copy into the acceptance suite (acceptance/tests/) and adapt; run it on its own:
//   npx playwright test tests/journeys.spec.mjs --output=results/journeys
// (use the address and port settings your acceptance config already uses, e.g. BASE_URL or APP_PORT)
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const EVIDENCE = new URL('../../review/evidence/', import.meta.url).pathname; // <project>/review/evidence/
mkdirSync(EVIDENCE, { recursive: true });
const shot = (page, journey, step) => page.screenshot({ path: `${EVIDENCE}${journey}-${step}.png`, fullPage: false });

test.beforeEach(async ({ request }) => {
  // Put the app in a known state: reset test data, open the sale, and so on.
});

test('J1 Buy one item', { tag: '@journey' }, async ({ page }) => {
  await page.goto('/');
  await shot(page, 'j1', '1-start');

  // Act like the user: labels and roles, never sleeps.
  // await page.getByLabel('Email').fill('shopper@example.test');
  // await page.getByRole('button', { name: 'Sign in' }).click();
  // await page.getByRole('button', { name: 'Buy now' }).click();
  // await page.waitForLoadState('networkidle');

  // Screenshot first, then check: if the promised result doesn't appear, the picture shows what did.
  await shot(page, 'j1', '2-result');
  // await expect(page.getByRole('status')).toContainText('confirmed');
  // In the pack, write what the screenshot shows in the journey's "actual" field, especially if it isn't "expected".
});

// J2, J3…: one test per journey, including the "must not happen" cases (sold out, too early, someone else's data).
// A journey with no screen (an API answer, an email) saves the answer as JSON instead:
//   writeFileSync(`${EVIDENCE}j4-answer.json`, JSON.stringify(await response.json(), null, 2));
