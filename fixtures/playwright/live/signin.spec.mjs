// Fixture for playwright/live.mjs + live.config.mjs: runs against a local static page with made-up credentials.
import { test, expect } from '@playwright/test';
import { liveUser, watchConsole } from '../../../.devkit/playwright/live.mjs';

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
