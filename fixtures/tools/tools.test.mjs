// Small tools: check-links anchors, check-pins non-tag pins, fsAdmin timestamps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fsAdmin } from '../../playwright/helpers.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const node = (script, ...args) => spawnSync(process.execPath, [join(root, script), ...args], { encoding: 'utf8' });

const links = anchor => {
  const dir = mkdtempSync(join(tmpdir(), 'links-'));
  writeFileSync(join(dir, 'README.md'), `# Doc\n\n## The claims_shape helper\n\n## _Emphasis_ title\n\nSee [it](#${anchor}).\n`);
  return node('tools/check-links.mjs', dir);
};
test('check-links keeps underscores inside words, as GitHub anchors do', () => {
  assert.equal(links('the-claims_shape-helper').status, 0);
  assert.equal(links('emphasis-title').status, 0);
  assert.notEqual(links('the-claimsshape-helper').status, 0);
});

test('check-pins counts a pin on @main as not on the latest tag', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pins-'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/ci.yml'), 'jobs:\n  t:\n    steps:\n      - uses: flamingbeing/app-devkit/setup-node@main\n');
  const r = node('scripts/check-pins.mjs', dir, '--latest', 'v1.13.2');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /STALE .*setup-node@main/);
});

test('fsAdmin seeds a Date as a Firestore timestamp and reads it back as a Date', async () => {
  let sent;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PATCH') { sent = JSON.parse(init.body); return new Response('{}'); }
    return new Response(JSON.stringify(sent));
  };
  try {
    const db = fsAdmin('demo-x'), at = new Date('2026-01-01T00:00:00Z');
    await db.put('revoked/u1', { at, gone: undefined });
    assert.deepEqual(sent.fields, { at: { timestampValue: '2026-01-01T00:00:00.000Z' }, gone: { nullValue: null } });
    assert.deepEqual(await db.get('revoked/u1'), { at, gone: null });
  } finally { globalThis.fetch = real; }
});

test('fsAdmin list follows nextPageToken: a collection over one page comes back whole', async () => {
  const doc = n => ({ name: `x/d${n}`, fields: { n: { integerValue: String(n) } } });
  const urls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    urls.push(String(url));
    const second = String(url).includes('pageToken=t1');
    return new Response(JSON.stringify(second ? { documents: [doc(3)] } : { documents: [doc(1), doc(2)], nextPageToken: 't1' }));
  };
  try {
    assert.deepEqual((await fsAdmin('demo-x').list('spaces/_/items')).map(d => d.n), [1, 2, 3]);
    assert.equal(urls.length, 2);
  } finally { globalThis.fetch = real; }
});
