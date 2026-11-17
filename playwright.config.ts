import { defineConfig } from '@playwright/test';
import { settings } from './config/env';

export default defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./src/globalSetup'),
  timeout: 120_000,
  fullyParallel: true,
  // Kept low on purpose: this suite targets shared environments, not load testing.
  workers: settings.workers,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'reports/html' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['junit', { outputFile: 'reports/junit.xml' }],
    ['allure-playwright', { resultsDir: 'reports/allure-results', detail: true, suiteTitle: false }],
  ],
  use: {
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'vimtv-api-tests/1.0 (Playwright)' },
  },
});
