// Acceptance tests for the flash-sale demo.
//   VARIANT=naive npx playwright test --repeat-each=3
//   VARIANT=fixed npx playwright test --repeat-each=3
import { defineConfig, devices } from '@playwright/test';

const variant = process.env.VARIANT ?? 'fixed';

export default defineConfig({
  testDir: './tests',
  // Tests share one app instance and reset its data, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  // No retries: a test that only passes on retry is reported as flaky, not as passing.
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: `results/${variant}/artifacts`,
  reporter: [
    ['list'],
    ['json', { outputFile: `results/${variant}/results.json` }],
    ['html', { outputFolder: `results/${variant}/html`, open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    // Evidence for sign-off: a screenshot of every test's end state, full trace on failure.
    screenshot: 'on',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ../run.mjs ${variant}`,
    url: 'http://127.0.0.1:3000/',
    reuseExistingServer: false,
    // Payment hangs are off for deterministic runs; AC-08 turns them on explicitly. Short hangs
    // and a fast reconciler keep AC-08 under 15 seconds.
    env: { PAYMENT_HANG_RATE: '0', PAYMENT_HANG_MS: '6000', RECONCILE_INTERVAL_MS: '1000' },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
