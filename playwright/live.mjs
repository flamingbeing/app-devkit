// Helpers for a live sign-in smoke test: the deployed site, a test user, no app data. Plain ES module, no dependencies.
// The `live-smoke.yml` workflow sets LIVE_URL, LIVE_TEST_EMAIL and LIVE_TEST_PASSWORD and runs live.config.mjs.
//
//   import { liveUser, watchConsole, signInViaApi } from '../.devkit/playwright/live.mjs';
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

// For an app with no email + password form: signs the test user in through the Identity Toolkit REST API and stores the
// result where the Firebase JS SDK keeps a signed-in user (IndexedDB, `firebase:authUser:<apiKey>:<appName>`), so the
// app starts signed in. Go to a page of the site first (`await page.goto('/')`), call this, then `page.reload()`.
// apiKey is the web config's public key; the password only goes to Google's sign-in endpoint and is never logged.
export async function signInViaApi(page, { apiKey, email, password, appName = '[DEFAULT]', authDomain = '' }) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API sign-in failed: ${j.error?.message || res.status}`);
  const now = Date.now();
  const user = {
    uid: j.localId, email: j.email, emailVerified: false, isAnonymous: false, apiKey, appName, authDomain,
    providerData: [{ providerId: 'password', uid: j.email, email: j.email, displayName: null, phoneNumber: null, photoURL: null }],
    stsTokenManager: { refreshToken: j.refreshToken, accessToken: j.idToken, expirationTime: now + Number(j.expiresIn || 3600) * 1000 },
    createdAt: String(now), lastLoginAt: String(now),
  };
  await page.evaluate(({ key, value }) => new Promise((ok, fail) => {
    const open = indexedDB.open('firebaseLocalStorageDb', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
      tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value });
      tx.oncomplete = () => { open.result.close(); ok(); };
      tx.onerror = () => fail(tx.error);
    };
  }), { key: `firebase:authUser:${apiKey}:${appName}`, value: user });
  return { uid: j.localId, email: j.email };
}
