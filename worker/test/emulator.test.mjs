// The Worker modules against the Auth and Firestore emulators, with the single-group example's rules (built from
// rules/common.rules). Run: firebase emulators:exec --only auth,firestore --project demo-claims-kit
//   --config fixtures/claims/firebase.json "node --test worker/test/emulator.test.mjs"
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { customToken } from '../custom-token.js';
import { admin, handleClaims } from '../claims.js';
import { emulator } from '../../rules/suite.mjs';
import { makeKeys, decode } from './keys.mjs';

const P = 'demo-claims-kit';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const emu = emulator({ project: P, host: FS });
const adm = admin({ project: P, emulator: { auth: AUTH, firestore: FS } });
const sa = { email: 'signer@demo-claims-kit.iam.gserviceaccount.com', key: (await makeKeys()).pem };

const post = async (path, body) => {
  const r = await fetch(`http://${AUTH}/${path}?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};
const signInCustom = async (token) => post('identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken', { token, returnSecureToken: true });
const signUp = async (email) => post('identitytoolkit.googleapis.com/v1/accounts:signUp', { email, password: 'not-a-real-password', returnSecureToken: true });
const refresh = async (refreshToken) => (await post('securetoken.googleapis.com/v1/token', { grant_type: 'refresh_token', refresh_token: refreshToken })).id_token;
// read notes/n1 as the holder of this ID token: true = the rules let it through
const reads = async (idToken) => {
  const r = await fetch(`http://${FS}/v1/projects/${P}/databases/(default)/documents/notes/n1`, { headers: { authorization: `Bearer ${idToken}` } });
  if (![200, 403].includes(r.status)) throw new Error(`read ${r.status}`);
  return r.status === 200;
};
const claimsOf = (t) => { const { m, g, x, v } = decode(t); return JSON.parse(JSON.stringify({ m, g, x, v })); };

// the app's part: the role doc members/{uid} is the source of truth
const loadClaims = async ({ uid, admin: a }) => {
  const doc = await a.getDoc(`members/${uid}`);
  return doc ? { g: { _: doc.role }, v: doc.v } : null;
};
const callClaims = (idToken) => handleClaims(new Request('https://app.example.com/api/claims', { method: 'POST',
  headers: { Authorization: `Bearer ${idToken}`, Origin: 'https://app.example.com' } }),
  { admin: adm, loadClaims, origin: 'https://app.example.com', emulator: true });

before(async () => {
  await emu.loadRules(readFileSync(new URL('../../rules/examples/single-group/firestore.rules', import.meta.url), 'utf8'));
  await emu.clear();
  await fetch(`http://${AUTH}/emulator/v1/projects/${P}/accounts`, { method: 'DELETE' });
  await emu.seed('notes/n1', { text: 'hello' });
});

test('custom token: developer claims reach the ID token and stay after a refresh', async () => {
  const s = await signInCustom(await customToken(sa, 'link-1', { m: 'link', g: { _: 'guest' }, x: 4000000000, v: 1 }));
  const want = { m: 'link', g: { _: 'guest' }, x: 4000000000, v: 1 };
  assert.deepEqual(claimsOf(s.idToken), want);
  const again = await refresh(s.refreshToken);
  assert.deepEqual(claimsOf(again), want);
  assert.equal(await reads(again), true);
});

test('custom token: an x in the past is refused by the rules', async () => {
  const s = await signInCustom(await customToken(sa, 'link-2', { m: 'link', g: { _: 'guest' }, x: 1000000000, v: 1 }));
  assert.equal(await reads(s.idToken), false);
});

test('custom token: developer claims win over claims written on the account (so /api/claims refuses them)', async () => {
  const s = await signInCustom(await customToken(sa, 'link-3', { m: 'link', g: { _: 'guest' }, v: 1 }));
  await adm.setClaims('link-3', { g: { _: 'admin' }, v: 9 });
  assert.deepEqual(claimsOf(await refresh(s.refreshToken)).g, { _: 'guest' });
  assert.equal((await callClaims(s.idToken)).status, 409);
});

test('/api/claims: a member gets claims on the next refresh, the rules then let them read', async () => {
  const s = await signUp('member@example.com');
  assert.equal(await reads(s.idToken), false); // no claims yet
  await adm.setDoc(`members/${s.localId}`, { role: 'member', v: 1 });
  const r = await callClaims(s.idToken);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { claims: { m: 'password', g: { _: 'member' }, v: 1 } });
  const fresh = await refresh(s.refreshToken); // the page's getIdToken(true)
  assert.deepEqual(claimsOf(fresh), { m: 'password', g: { _: 'member' }, v: 1 });
  assert.equal(await reads(fresh), true);
  // and they last: a later refresh still carries them
  assert.deepEqual(claimsOf(await refresh(s.refreshToken)).g, { _: 'member' });
});

test('revocation: refused at once on the old token, cleared claims after refresh, back after re-adding', async () => {
  const s = await signUp('removed@example.com');
  await adm.setDoc(`members/${s.localId}`, { role: 'member', v: 1 });
  await callClaims(s.idToken);
  const withClaims = await refresh(s.refreshToken);
  assert.equal(await reads(withClaims), true);

  // removed: the role doc goes and the app's server calls revoke()
  await adm.deleteDoc(`members/${s.localId}`);
  await adm.revoke(s.localId);
  assert.notEqual(await adm.getDoc(`revoked/${s.localId}`), null);
  assert.equal(await reads(withClaims), false); // the old token still says member; revoked/{uid} stops it
  // (the Auth emulator does not enforce validSince, so the refresh below still works there; production refuses it)
  assert.equal(claimsOf(await refresh(s.refreshToken)).g, undefined);
  const r = await callClaims(withClaims);
  assert.deepEqual(await r.json(), { claims: {} }); // still not a member: nothing re-issued
  assert.notEqual(await adm.getDoc(`revoked/${s.localId}`), null);

  // added back: /api/claims re-issues and deletes revoked/{uid}
  await adm.setDoc(`members/${s.localId}`, { role: 'member', v: 2 });
  assert.equal((await callClaims(withClaims)).status, 200);
  assert.equal(await adm.getDoc(`revoked/${s.localId}`), null);
  const back = await refresh(s.refreshToken);
  assert.equal(decode(back).v, 2);
  assert.equal(await reads(back), true);
});

test('clients cannot read or write revoked/ themselves', async () => {
  const s = await signInCustom(await customToken(sa, 'link-4', { g: { _: 'admin' } }));
  const r = await fetch(`http://${FS}/v1/projects/${P}/databases/(default)/documents/revoked/link-4`, { method: 'DELETE', headers: { authorization: `Bearer ${s.idToken}` } });
  assert.equal(r.status, 403);
});
