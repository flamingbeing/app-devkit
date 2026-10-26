// Helpers for a live sign-in smoke test: the deployed site, a test user, no app data. Plain ES module, no dependencies.
// The `live-smoke.yml` workflow sets LIVE_URL, LIVE_TEST_EMAIL and LIVE_TEST_PASSWORD and runs live.config.mjs.
//
//   import { liveUser, watchConsole } from '../.devkit/playwright/live.mjs';
//   const { email, password } = liveUser();
//   const errors = watchConsole(page);   // after the test: expect(errors).toEqual([])

// The test user from the environment; use with `test.skip(!liveUser().email || !liveUser().password, ...)`.
export function liveUser() {
  return { email: process.env.LIVE_TEST_EMAIL || '', password: process.env.LIVE_TEST_PASSWORD || '' };
}

// Collects page errors and console errors. Firestore refusing a user that has no data is expected there (403 /
// permission-denied), so those do not count; add more patterns with `ignore`. Returns the live array.
export function watchConsole(page, { ignore = [] } = {}) {
  const errors = [];
  const skip = [/Failed to load resource/i, /permission-denied/i, /Missing or insufficient permissions/i, ...ignore];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !skip.some(re => re.test(m.text()))) errors.push(`console: ${m.text()}`);
  });
  return errors;
}
