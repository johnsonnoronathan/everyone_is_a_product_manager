// Acceptance-test configuration. Copy into <project>/acceptance/.
//   BASE_URL=https://staging.example.com npx playwright test --repeat-each=3
//   START_COMMAND="npm run dev --prefix .." BASE_URL=http://localhost:3000 npx playwright test --repeat-each=3
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  // Tests that share app data must not run at the same time. Raise only if every test uses its own data.
  workers: 1,
  fullyParallel: false,
  // No retries: a test that only passes on retry is flaky, and the report must say so.
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: 'results/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'results/results.json' }],
    ['html', { outputFolder: 'results/html', open: 'never' }],
  ],
  use: {
    baseURL,
    screenshot: 'on', // end-state screenshot of every test = sign-off evidence
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } }],
  ...(process.env.START_COMMAND
    ? { webServer: { command: process.env.START_COMMAND, url: baseURL, reuseExistingServer: true, timeout: 120_000 } }
    : {}),
});
