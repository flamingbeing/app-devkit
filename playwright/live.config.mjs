// Playwright config for the live sign-in smoke test (used by .github/workflows/live-smoke.yml; also fine by hand):
//   LIVE_URL=https://example.test LIVE_SPEC=e2e/live npx playwright test -c .devkit/playwright/live.config.mjs
// LIVE_SPEC is a spec file or folder, relative to where you run it. Plain object, so it needs no import.
import { resolve, dirname, basename } from 'node:path';
import { statSync } from 'node:fs';

const spec = resolve(process.cwd(), process.env.LIVE_SPEC || '.');
const isFile = (() => { try { return statSync(spec).isFile(); } catch { return false; } })();

export default {
  testDir: isFile ? dirname(spec) : spec,
  testMatch: isFile ? basename(spec) : '**/*.spec.mjs',
  workers: 1,
  retries: 1,   // one retry for a network blip; a second failure is real
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: resolve(process.cwd(), 'test-results'),
  use: {
    baseURL: process.env.LIVE_URL,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
};
