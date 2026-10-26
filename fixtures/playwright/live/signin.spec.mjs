// Fixture for playwright/live.mjs + live.config.mjs: runs against a local static page with made-up credentials.
import { test, expect } from '@playwright/test';
import { liveUser, watchConsole, signInViaApi } from '../../../.devkit/playwright/live.mjs';

test('the live helpers read the user and see no console errors', async ({ page }) => {
  const { email, password } = liveUser();
  expect(email).toBe('test-bot@example.test');
  expect(password).not.toBe('');
  const errors = watchConsole(page);
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  expect(errors).toEqual([]);
});

test('watchConsole reports a page error and ignores a refused read', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.evaluate(() => { console.error('FirebaseError: permission-denied'); console.error('real problem'); });
  expect(errors).toEqual(['console: real problem']);
});

test('signInViaApi stores the user where the SDK looks for it (REST answer made up)', async ({ page }) => {
  await page.goto('/');
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ localId: 'u1', email: 'test-bot@example.test', idToken: 'a', refreshToken: 'r', expiresIn: '3600' }), { status: 200 });
  try { await signInViaApi(page, { apiKey: 'k', email: 'test-bot@example.test', password: 'x' }); } finally { globalThis.fetch = real; }
  const stored = await page.evaluate(() => new Promise(ok => {
    const o = indexedDB.open('firebaseLocalStorageDb', 1);
    o.onsuccess = () => { const g = o.result.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').get('firebase:authUser:k:[DEFAULT]'); g.onsuccess = () => ok(g.result?.value); };
  }));
  expect(stored.uid).toBe('u1');
  expect(stored.stsTokenManager.refreshToken).toBe('r');
});
