import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIdToken, admin, handleClaims, toValue, fromValue } from '../claims.js';
import { makeKeys, decode } from './keys.mjs';

const P = 'demo-kit';
const NOW = 2000000000;
const k = await makeKeys('k1');
const other = await makeKeys('k1'); // same kid, different key
const good = (over = {}) => ({ iss: `https://securetoken.google.com/${P}`, aud: P, sub: 'u1', iat: NOW - 10, exp: NOW + 3000,
  auth_time: NOW - 10, firebase: { sign_in_provider: 'google.com' }, ...over });
const verify = (t, o = {}) => verifyIdToken(t, { project: P, now: NOW, keys: k.keys, ...o });

test('ID token: a good one passes and returns its payload', async () => {
  assert.equal((await verify(await k.idToken(good()))).sub, 'u1');
});

test('ID token: refused when expired, for another project, or from another issuer', async () => {
  await assert.rejects(verify(await k.idToken(good({ exp: NOW }))), /expired/);
  await assert.rejects(verify(await k.idToken(good({ aud: 'demo-other' }))), /audience/);
  await assert.rejects(verify(await k.idToken(good({ iss: 'https://securetoken.google.com/demo-other' }))), /issuer/);
  await assert.rejects(verify(await k.idToken(good({ sub: '' }))), /subject/);
  await assert.rejects(verify(await k.idToken(good({ iat: NOW + 120 }))), /future/);
  await assert.rejects(verify(await k.idToken(good({ auth_time: NOW + 120 }))), /future/);
});

test('ID token: refused when not signed by a current Google key', async () => {
  await assert.rejects(verify(await other.idToken(good())), /signature/);
  await assert.rejects(verify(await k.idToken(good(), { alg: 'RS256', kid: 'k9' })), /unknown key/);
  const t = await k.idToken(good());
  const [h, , s] = t.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify(good({ sub: 'someone-else' }))).toString('base64url')}.${s}`;
  await assert.rejects(verify(forged), /signature/);
  await assert.rejects(verify('abc'), /JWT/);
});

test('ID token: unsigned (alg none) only in emulator mode, and emulator mode only for demo- projects', async () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b({ alg: 'none' })}.${b(good())}.`;
  await assert.rejects(verify(unsigned), /alg none/);
  assert.equal((await verify(unsigned, { emulator: true })).sub, 'u1');
  const real = `${b({ alg: 'none' })}.${b(good({ aud: 'prod-app', iss: 'https://securetoken.google.com/prod-app' }))}.`;
  await assert.rejects(verifyIdToken(real, { project: 'prod-app', now: NOW, emulator: true }), /demo-/);
  assert.throws(() => admin({ project: 'prod-app', emulator: { auth: 'x', firestore: 'y' } }), /demo-/);
});

test('Firestore values round-trip', () => {
  const v = { s: 'a', n: 3, d: 1.5, b: true, z: null, t: new Date('2026-01-01T00:00:00Z'), a: [1, 'x'], m: { r: 'admin' } };
  assert.deepEqual(fromValue(toValue(v)), v);
});

// a fetch that records calls and answers from a table
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    const hit = answers.find(([m]) => String(url).includes(m));
    const [, status, body] = hit || ['', 404, {}];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  };
  return { f, calls };
}

test('admin: a signed OAuth grant, cached, then accounts:update with the claims shape', async (t) => {
  const { f, calls } = fakeFetch([['oauth2', 200, { access_token: 'at1', expires_in: 3599 }], ['accounts:update', 200, {}]]);
  t.mock.method(globalThis, 'fetch', f);
  const a = admin({ project: P, sa: { email: 'signer@x', key: k.pem } });
  await a.setClaims('u1', { g: { _: 'member' }, v: 2 });
  await a.setClaims('u1', {});
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1);
  const grant = new URLSearchParams(calls[0].body);
  assert.equal(grant.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(decode(grant.get('assertion')).iss, 'signer@x');
  const up = calls.filter((c) => c.url.includes('accounts:update'));
  assert.equal(up[0].url, `https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:update`);
  assert.equal(up[0].headers.Authorization, 'Bearer at1');
  assert.deepEqual(JSON.parse(up[0].body), { localId: 'u1', customAttributes: '{"g":{"_":"member"},"v":2}' });
  assert.deepEqual(JSON.parse(up[1].body), { localId: 'u1', customAttributes: '{}' });
  await assert.rejects(a.setClaims('u1', { email: 'a@example.com' }), /unknown key/);
  await assert.rejects(a.markRevoked('a/b'), /bad uid/);
  assert.throws(() => admin({ project: P }), /service account/);
});

const req = (headers = {}, method = 'POST') => new Request('https://app.example.com/api/claims', { method, headers });
const fakeAdmin = () => {
  const log = [];
  return { log, project: P, setClaims: async (uid, c) => log.push(['set', uid, c]), clearRevoked: async (uid) => log.push(['clear', uid]) };
};
const opts = (over = {}) => ({ admin: fakeAdmin(), origin: 'https://app.example.com', verify: (t) => verify(t),
  loadClaims: async ({ uid }) => (uid === 'u1' ? { g: { _: 'member' }, v: 4 } : null), ...over });

test('/api/claims: writes the claims from loadClaims and clears revoked/{uid}', async () => {
  const o = opts();
  const r = await handleClaims(req({ Authorization: `Bearer ${await k.idToken(good())}` }), o);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { claims: { m: 'google', g: { _: 'member' }, v: 4 } });
  assert.deepEqual(o.admin.log, [['set', 'u1', { m: 'google', g: { _: 'member' }, v: 4 }], ['clear', 'u1']]);
});

test('/api/claims: no longer a member -> claims cleared, revoked/{uid} left alone', async () => {
  const o = opts();
  const r = await handleClaims(req({ Authorization: `Bearer ${await k.idToken(good({ sub: 'u2' }))}` }), o);
  assert.deepEqual(await r.json(), { claims: {} });
  assert.deepEqual(o.admin.log, [['set', 'u2', {}]]);
});

test('/api/claims: an older ask finishing its write last does not leave older claims', async () => {
  const role = { g: { _: 'member' }, v: 1 };
  let stored, calls = 0, release;
  const gate = new Promise((r) => { release = r; });
  const admin = { project: P, clearRevoked: async () => {},
    setClaims: async (uid, c) => { const mine = ++calls; if (mine === 1) await gate; stored = c; if (mine === 2) release(); } };
  let loads = 0;
  // ask A reads the doc before the role exists, ask B after; A's write is held back until B's is in
  const loadClaims = async () => (++loads === 1 ? null : role);
  const tok = `Bearer ${await k.idToken(good())}`;
  const [a, b] = await Promise.all([handleClaims(req({ Authorization: tok }), opts({ admin, loadClaims })),
    (async () => { await new Promise((r) => setTimeout(r, 20)); return handleClaims(req({ Authorization: tok }), opts({ admin, loadClaims })); })()]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(stored, { m: 'google', g: { _: 'member' }, v: 1 });
  assert.deepEqual((await a.json()).claims, stored);
});

test('/api/claims: refusals', async () => {
  const tok = `Bearer ${await k.idToken(good())}`;
  assert.equal((await handleClaims(req({}, 'GET'), opts())).status, 405);
  assert.equal((await handleClaims(req({ Authorization: tok }), opts({ admin: null }))).status, 503);
  assert.equal((await handleClaims(req({ Authorization: tok, Origin: 'https://evil.example' }), opts())).status, 403);
  assert.equal((await handleClaims(req({}), opts())).status, 401);
  assert.equal((await handleClaims(req({ Authorization: `Bearer ${await other.idToken(good())}` }), opts())).status, 401);
  const custom = `Bearer ${await k.idToken(good({ firebase: { sign_in_provider: 'custom' } }))}`;
  assert.equal((await handleClaims(req({ Authorization: custom }), opts())).status, 409);
  const limited = opts({ limit: { limit: async () => ({ success: false }) } });
  assert.equal((await handleClaims(req({ Authorization: tok }), limited)).status, 429);
  const bad = opts({ loadClaims: async () => ({ g: { _: 'member' }, email: 'a@example.com' }) });
  const r = await handleClaims(req({ Authorization: tok }), bad);
  assert.equal(r.status, 500);
  assert.deepEqual(bad.admin.log, []);
});
