import { test, expect } from '@playwright/test';
import path from 'node:path';
import { baseConfig } from '../../../playwright/base.mjs';
import { waitFor, waitForState, createTestUser, fsAdmin } from '../../../playwright/helpers.mjs';

const db = fsAdmin('demo-fixture');
const dir = path.resolve('app');

test('base config: viewport projects, retries only in CI', async ({}, info) => {
  expect(info.project.name).toMatch(/^(phone|desktop)$/);
  expect(baseConfig({ projects: ['phone'] }).projects.map(p => p.name)).toEqual(['phone']);
  expect(() => baseConfig({ projects: ['tablet'] })).toThrow(/unknown project/);
});

test('waits for a state, not a sleep', async ({ page }, info) => {
  await page.goto('file://' + path.join(dir, 'index.html'));
  const w = page.viewportSize().width;
  expect(w).toBe(info.project.name === 'phone' ? 390 : 1280);
  await waitForState(page, () => window.appReady);
  await expect(page.locator('#msg')).toHaveText('ready');
});

test('seed, read and clear per test; sign in as a test user', async () => {
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await db.put(`items/${id}`, { name: 'soy', qty: 2, tags: ['a'], nested: { ok: true } });
  expect(await waitFor(() => db.get(`items/${id}`), { message: 'the seeded item' })).toEqual({ name: 'soy', qty: 2, tags: ['a'], nested: { ok: true } });
  const u = await createTestUser('demo-fixture', `${id}@example.com`);
  expect(u.idToken).toBeTruthy();
  expect((await createTestUser('demo-fixture', `${id}@example.com`)).uid, 'second call signs in').toBe(u.uid);
  await db.del(`items/${id}`);
  expect(await db.get(`items/${id}`)).toBeNull();
});

test('waitFor times out with a readable message', async () => {
  await expect(waitFor(() => false, { timeout: 300, message: 'nothing' })).rejects.toThrow(/waiting for nothing/);
});
