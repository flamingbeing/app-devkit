// Helpers for browser tests that use the Firebase emulators. Plain Node (fetch only), no dependencies.
//
//   import { emulatorServer, waitForEmulators, waitFor, createTestUser, fsAdmin } from './.devkit/playwright/helpers.mjs';

// Poll until fn() returns something truthy (returns it), instead of sleeping a fixed time.
export async function waitFor(fn, { timeout = 10_000, interval = 100, message = 'condition' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out after ${timeout} ms waiting for ${message}`);
    await new Promise(r => setTimeout(r, interval));
  }
}

// Wait in the page for a state (window property, DOM) instead of a sleep: waitForState(page, () => window.app?.ready)
export const waitForState = (page, fn, arg, options) => page.waitForFunction(fn, arg, options);

const hosts = () => ({
  firestore: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
  auth: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
});

// Playwright `webServer` entry that starts the emulators and reuses a running set. `url` is the first emulator's address.
//   webServer: emulatorServer({ project: 'demo-app', only: 'firestore,auth', cwd: 'app', url: 'http://127.0.0.1:9099' })
export function emulatorServer({ project, only = 'firestore,auth', cwd = '.', url = `http://${hosts().auth}`, firebaseTools = '15.33.0' } = {}) {
  if (!project) throw new Error('emulatorServer needs a project id (use a demo- one)');
  if (!project.startsWith('demo-')) throw new Error(`'${project}' is not a demo- project: tests must never touch a live project`);
  return {
    command: `npx -y firebase-tools@${firebaseTools} emulators:start --only ${only} --project ${project}`,
    cwd,
    url,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },   // firebase stops its emulators itself; a kill leaves Java running
  };
}

// For globalSetup: wait until the named emulators answer ('firestore', 'auth').
export async function waitForEmulators(which = ['firestore', 'auth'], { timeout = 120_000 } = {}) {
  if (process.env.PW_NO_EMULATOR) return;
  const h = hosts();
  for (const name of which) {
    if (!h[name]) throw new Error(`unknown emulator '${name}'`);
    await waitFor(async () => (await fetch(`http://${h[name]}/`)).status < 500, { timeout, interval: 250, message: `the ${name} emulator at ${h[name]}` });
  }
}

// Make (or sign in) a made-up account in the Auth emulator; returns { uid, idToken, email }.
export async function createTestUser(project, email, password = 'test-password-1') {
  const base = `http://${hosts().auth}/identitytoolkit.googleapis.com/v1/accounts`;
  const body = JSON.stringify({ email, password, returnSecureToken: true });
  const headers = { 'content-type': 'application/json' };
  let r = await fetch(`${base}:signUp?key=fake`, { method: 'POST', headers, body });
  if (!r.ok) r = await fetch(`${base}:signInWithPassword?key=fake`, { method: 'POST', headers, body });
  if (!r.ok) throw new Error(`test user ${email}: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return { uid: j.localId, idToken: j.idToken, email };
}

// Firestore emulator "admin door" (skips the rules): seed and clear documents per test.
const val = v => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: fields(v) } };
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
const unval = v => 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(unval)
  : 'mapValue' in v ? unfields(v.mapValue.fields || {}) : undefined;
const unfields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unval(v)]));

export function fsAdmin(project) {
  const root = `http://${hosts().firestore}/v1/projects/${project}/databases/(default)`;
  const headers = { Authorization: 'Bearer owner' };
  const ok = async (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.status} ${await r.text()}`); return r; };
  return {
    async put(path, o) { await ok(await fetch(`${root}/documents/${path}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(o) }) }), `seed ${path}`); },
    async get(path) { const r = await fetch(`${root}/documents/${path}`, { headers }); return r.ok ? unfields((await r.json()).fields || {}) : null; },
    async list(path) { const r = await fetch(`${root}/documents/${path}?pageSize=300`, { headers }); const j = r.ok ? await r.json() : {}; return (j.documents || []).map(d => unfields(d.fields || {})); },
    async del(path) { await ok(await fetch(`${root}/documents/${path}`, { method: 'DELETE', headers }), `delete ${path}`); },
    // wipe everything in the emulator (between suites; per-test data should use its own ids instead)
    async clear() { await ok(await fetch(`${root}/documents`, { method: 'DELETE', headers }), 'clear'); },
  };
}
