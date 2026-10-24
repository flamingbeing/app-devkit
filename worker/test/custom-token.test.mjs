import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customToken, claimsShape, serviceKey, randomUid, TOKEN_AUD } from '../custom-token.js';
import { makeKeys, decode } from './keys.mjs';

const k = await makeKeys();
const sa = { email: 'signer@demo-kit.iam.gserviceaccount.com', key: k.pem };

test('custom token: RS256, signed by the key, the fields Firebase expects', async () => {
  const t = await customToken(sa, 'u1', { m: 'link', g: { _: 'member' }, x: 2000000000, v: 3 }, 1000);
  const [h, b, s] = t.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${b}`));
  assert.equal(ok, true);
  assert.deepEqual(decode(t), { iss: sa.email, sub: sa.email, aud: TOKEN_AUD, iat: 1000, exp: 4600, uid: 'u1',
    claims: { m: 'link', g: { _: 'member' }, x: 2000000000, v: 3 } });
});

test('custom token: no claims key when there are none', async () => {
  assert.equal('claims' in decode(await customToken(sa, 'u1')), false);
});

test('custom token: a key pasted with escaped new lines still works', async () => {
  const pasted = k.pem.replace(/\n/g, '\\n');
  await serviceKey(pasted);
  assert.ok(await customToken({ ...sa, key: pasted }, 'u1', {}));
});

test('custom token: refuses a missing key or a bad uid', async () => {
  await assert.rejects(customToken({ email: sa.email }, 'u1'), /key/);
  await assert.rejects(customToken(sa, ''), /uid/);
  await assert.rejects(customToken(sa, 'x'.repeat(129)), /uid/);
});

test('claims shape: keeps m, g, x, v and refuses anything else', () => {
  assert.deepEqual(claimsShape({}), {});
  assert.deepEqual(claimsShape({ g: { a: 'admin', b: 'member' }, v: 0 }), { g: { a: 'admin', b: 'member' }, v: 0 });
  assert.throws(() => claimsShape({ email: 'a@example.com' }), /unknown key email/);
  assert.throws(() => claimsShape({ admin: true }), /unknown key/);
  assert.throws(() => claimsShape({ m: 'sms' }), /m must be/);
  assert.throws(() => claimsShape({ g: [] }), /g must be/);
  assert.throws(() => claimsShape({ g: { 'a/b': 'admin' } }), /bad group id/);
  assert.throws(() => claimsShape({ g: { a: '' } }), /bad role/);
  assert.throws(() => claimsShape({ g: { a: 1 } }), /bad role/);
  assert.throws(() => claimsShape({ x: 1.5 }), /x must be/);
  assert.throws(() => claimsShape({ x: Date.now() }), /x must be/); // milliseconds by mistake
  assert.throws(() => claimsShape({ v: -1 }), /v must be/);
});

test('claims shape: at most 20 groups and 1000 bytes', () => {
  const g = (n, len = 4) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`g${i}`.padEnd(len, 'x'), 'member']));
  assert.equal(Object.keys(claimsShape({ g: g(20) }).g).length, 20);
  assert.throws(() => claimsShape({ g: g(21) }), /21 groups/);
  assert.throws(() => claimsShape({ g: g(20, 60) }), /bytes/);
});

test('random uid: prefix and 24 hex characters, different each time', () => {
  assert.match(randomUid('g'), /^g[0-9a-f]{24}$/);
  assert.notEqual(randomUid(), randomUid());
});
