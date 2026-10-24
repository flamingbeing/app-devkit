// The kit's shared cases for the multi-group example (with the claims-or-doc fallback), plus its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suite } from '../../suite.mjs';

const emu = suite({
  project: 'demo-rules-multi',
  rules: readFileSync(new URL('firestore.rules', import.meta.url), 'utf8'),
  roles: ['owner', 'member', 'viewer'],
  collections: [
    { path: 'groups/{g}/items/i1', read: ['owner', 'member', 'viewer'], write: ['owner', 'member'],
      data: { name: 'milk', qty: 2 }, stamp: 'lenient' },
  ],
  fallback: { role: 'viewer', seed: (uid, g) => [[`groups/${g}/members/${uid}`, { role: 'viewer' }]] },
});

test('fallback user (no claim): the doc read plus the revoked check, 2 lookups', async () => {
  await emu.clear();
  await emu.seed('groups/g1/items/i1', { name: 'milk', qty: 2 });
  await emu.seed('groups/g1/members/u-old', { role: 'member' });
  const u = emu.as('u-old', {});
  assert.equal(await emu.lookups(() => u.get('groups/g1/items/i1')), 2);
  assert.equal((await u.get('groups/g1/items/i1')).ok, true);
});

test('role changes follow the doc, not the claim', async () => {
  await emu.clear();
  await emu.seed('groups/g1/members/u-own', { role: 'owner' });
  await emu.seed('groups/g1/members/u-ex', { role: 'member' });
  // a stale owner claim on someone whose doc says member is not enough
  const stale = emu.as('u-ex', { g: { g1: 'owner' } });
  assert.equal((await stale.update('groups/g1/members/u-own', { role: 'viewer' })).ok, false);
  const owner = emu.as('u-own', { g: { g1: 'owner' } });
  assert.equal((await owner.update('groups/g1/members/u-ex', { role: 'viewer' })).ok, true);
});
