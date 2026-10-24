// Each helper in rules/common.rules, exercised through a tiny probe rule in the emulator.
// Run: firebase emulators:exec --only firestore --project demo-rules-kit --config fixtures/rules/firebase.json \
//        "node --test rules/test/"
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRules } from '../../tools/build-rules.mjs';
import { emulator } from '../suite.mjs';

const common = readFileSync(new URL('../common.rules', import.meta.url), 'utf8');
const probe = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // devkit:common
    function memberDoc() { return get(/databases/$(database)/documents/members/$(request.auth.uid)).data.get('role', ''); }
    match /signedIn/{id} { allow get: if isSignedIn(); }
    match /role/{gid}/is/{want} { allow get: if role(gid) == want; }
    match /roleBlank/{gid} { allow get: if role(gid) == ''; }
    match /inGroup/{gid} { allow get: if inGroup(gid); }
    match /hasRole/{gid}/r/{r} { allow get: if hasRole(gid, [r, 'owner']); }
    match /hasRoleBlank/{gid} { allow get: if hasRole(gid, ['']); }
    match /live/{id} { allow get: if live(); }
    match /notRevoked/{id} { allow get: if notRevoked(); }
    match /can/{gid}/r/{r} { allow get: if can(gid, [r]); }
    match /roleOrDoc/{gid}/is/{want} { allow get: if roleOrDoc(gid, memberDoc()) == want; }
    match /inline/{gid}/is/{want} { allow get: if (role(gid) != '' ? role(gid) : memberDoc()) == want; }
    match /twoDocs/{id} { allow get: if exists(/databases/$(database)/documents/a/1) || !exists(/databases/$(database)/documents/b/2); }
    match /stamped/{id} { allow create: if stamped(); }
    match /stampOk/{id} { allow create: if stampOk(); }
  }
}`;

const emu = emulator({ project: 'demo-rules-helpers' });
const now = () => Math.floor(Date.now() / 1000);
const ok = async (c, path) => (await c.get(path)).ok;
const anon = () => emu.anon();
const as = (claims, uid = 'u1') => emu.as(uid, claims);

before(async () => {
  await emu.loadRules(buildRules(probe, common, 'probe.app.rules'));
  await emu.clear();
});

test('isSignedIn: any token yes, none no', async () => {
  assert.equal(await ok(anon(), 'signedIn/a'), false);
  assert.equal(await ok(as({}), 'signedIn/a'), true);
});

test('role(gid): the claim for that group, else empty', async () => {
  const u = as({ g: { h1: 'admin', h2: 'guest' } });
  assert.equal(await ok(u, 'role/h1/is/admin'), true);
  assert.equal(await ok(u, 'role/h2/is/guest'), true);
  assert.equal(await ok(u, 'role/h1/is/guest'), false);
  assert.equal(await ok(u, 'roleBlank/h3'), true, 'no entry -> empty');
  assert.equal(await ok(as({}), 'roleBlank/h1'), true, 'no g claim -> empty');
  assert.equal(await ok(anon(), 'roleBlank/h1'), true, 'signed out -> empty, not an error');
  assert.equal(await ok(as({ g: { _: 'member' } }), 'role/_/is/member'), true, "single-group key '_'");
});

test('inGroup(gid): any role in that group', async () => {
  assert.equal(await ok(as({ g: { h1: 'guest' } }), 'inGroup/h1'), true);
  assert.equal(await ok(as({ g: { h1: 'guest' } }), 'inGroup/h2'), false);
  assert.equal(await ok(anon(), 'inGroup/h1'), false);
});

test('hasRole(gid, roles): role in the list; an empty role never matches', async () => {
  const u = as({ g: { h1: 'member' } });
  assert.equal(await ok(u, 'hasRole/h1/r/member'), true);
  assert.equal(await ok(u, 'hasRole/h1/r/admin'), false);
  assert.equal(await ok(u, 'hasRole/h2/r/member'), false);
  assert.equal(await ok(as({}), 'hasRoleBlank/h1'), false, "[''] does not let a no-role user in");
  assert.equal(await ok(anon(), 'hasRole/h1/r/member'), false);
});

test('live(): no x -> yes; x in the future -> yes; x past -> no; signed out -> no', async () => {
  assert.equal(await ok(as({}), 'live/a'), true);
  assert.equal(await ok(as({ x: now() + 600 }), 'live/a'), true);
  assert.equal(await ok(as({ x: now() - 5 }), 'live/a'), false);
  assert.equal(await ok(as({ x: 'soon' }), 'live/a'), false, 'a non-number x fails closed');
  assert.equal(await ok(anon(), 'live/a'), false);
});

test('notRevoked(): a revoked/{uid} doc refuses that uid only, at one lookup', async () => {
  await emu.seed('revoked/u-gone', { at: new Date() });
  assert.equal(await ok(as({}, 'u-gone'), 'notRevoked/a'), false);
  assert.equal(await ok(as({}, 'u-here'), 'notRevoked/a'), true);
  assert.equal(await ok(anon(), 'notRevoked/a'), false);
  assert.equal(await emu.lookups(() => as({}, 'u-here').get('notRevoked/a')), 1);
});

test('can(gid, roles): role, live and not revoked; no lookup when the role is wrong', async () => {
  await emu.seed('revoked/u-gone', { at: new Date() });
  assert.equal(await ok(as({ g: { h1: 'admin' } }), 'can/h1/r/admin'), true);
  assert.equal(await ok(as({ g: { h1: 'admin' }, x: now() - 5 }), 'can/h1/r/admin'), false);
  assert.equal(await ok(as({ g: { h1: 'admin' } }, 'u-gone'), 'can/h1/r/admin'), false);
  assert.equal(await ok(as({ g: { h1: 'member' } }), 'can/h1/r/admin'), false);
  assert.equal(await emu.lookups(() => as({ g: { h1: 'admin' } }).get('can/h1/r/admin')), 1);
  assert.equal(await emu.lookups(() => as({ g: { h1: 'member' } }).get('can/h1/r/admin')), 0);
});

test('roleOrDoc(gid, docRole): the claim when present, else the doc role', async () => {
  await emu.seed('members/u-doc', { role: 'admin' });
  assert.equal(await ok(as({}, 'u-doc'), 'roleOrDoc/h1/is/admin'), true, 'no claim -> doc');
  assert.equal(await ok(as({ g: { h1: 'guest' } }, 'u-doc'), 'roleOrDoc/h1/is/guest'), true, 'claim wins');
  assert.equal(await ok(as({ g: { h1: 'guest' } }, 'u-doc'), 'roleOrDoc/h1/is/admin'), false);
  assert.equal(await ok(as({}, 'u-none'), 'roleOrDoc/h1/is/admin'), false, 'no claim, no doc');
  assert.equal(await emu.lookups(() => as({}, 'u-doc').get('roleOrDoc/h1/is/admin')), 1, 'no claim: one doc read');
  // arguments are evaluated first, so the doc is read even when the claim decides
  assert.equal(await emu.lookups(() => as({ g: { h1: 'guest' } }, 'u-doc').get('roleOrDoc/h1/is/guest')), 1);
});

test('the inline form (role(gid) != "" ? role(gid) : <doc role>) skips the doc read when a claim exists', async () => {
  await emu.seed('members/u-doc', { role: 'admin' });
  assert.equal(await ok(as({}, 'u-doc'), 'inline/h1/is/admin'), true);
  assert.equal(await ok(as({ g: { h1: 'guest' } }, 'u-doc'), 'inline/h1/is/guest'), true);
  assert.equal(await emu.lookups(() => as({ g: { h1: 'guest' } }, 'u-doc').get('inline/h1/is/guest')), 0);
  assert.equal(await emu.lookups(() => as({}, 'u-doc').get('inline/h1/is/admin')), 1);
});

test('lookups() counts distinct documents per request', async () => {
  assert.equal(await emu.lookups(() => as({}).get('twoDocs/a')), 2);
  assert.equal(await emu.lookups(() => as({}).get('signedIn/a')), 0);
});

test('stamped(): serverAt must be request.time', async () => {
  const u = as({});
  assert.equal((await u.create('stamped/a', { n: 1 }, { serverAt: true })).ok, true);
  assert.equal((await u.create('stamped/b', { n: 1 })).ok, false, 'missing');
  assert.equal((await u.create('stamped/c', { n: 1, serverAt: new Date(Date.now() - 1000) })).ok, false, 'client time');
});

test('stampOk(): serverAt optional, but if present it must be request.time', async () => {
  const u = as({});
  assert.equal((await u.create('stampOk/a', { n: 1 }, { serverAt: true })).ok, true);
  assert.equal((await u.create('stampOk/b', { n: 1 })).ok, true, 'missing is fine (old clients)');
  assert.equal((await u.create('stampOk/c', { n: 1, serverAt: new Date(Date.now() - 1000) })).ok, false);
});
