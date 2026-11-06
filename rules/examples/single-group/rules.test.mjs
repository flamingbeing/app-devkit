// The kit's shared cases for the single-group example, plus one of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suite } from '../../suite.mjs';

const emu = suite({
  project: 'demo-rules-single',
  rules: readFileSync(new URL('firestore.rules', import.meta.url), 'utf8'),
  roles: ['admin', 'member', 'guest'],
  collections: [
    { path: 'notes/n1', read: ['admin', 'member', 'guest'], write: ['admin', 'member'], data: { text: 'hello' },
      stamp: 'strict', list: { roles: ['admin', 'member', 'guest'] } },
    // an owner path: each test user at its own people/<uid>/, someone else's refused
    { path: 'people/{uid}/notes/n1', read: ['admin', 'member', 'guest'], write: ['admin', 'member'], data: { text: 'mine' },
      stamp: 'strict', list: { roles: ['admin', 'member', 'guest'] } },
  ],
});

// app-specific cases sit beside the shared ones
test('only an admin deletes a note', async () => {
  await emu.clear();
  await emu.seed('notes/n1', { text: 'hello' });
  assert.equal((await emu.as('m', { g: { _: 'member' } }).delete('notes/n1')).ok, false);
  assert.equal((await emu.as('a', { g: { _: 'admin' } }).delete('notes/n1')).ok, true);
});

test('a person deletes their own note; nobody else does, admins included', async () => {
  await emu.clear();
  await emu.seed('people/m/notes/n1', { text: 'mine' });
  assert.equal((await emu.as('a', { g: { _: 'admin' } }).delete('people/m/notes/n1')).ok, false);
  assert.equal((await emu.as('m', { g: { _: 'member' } }).delete('people/m/notes/n1')).ok, true);
});
