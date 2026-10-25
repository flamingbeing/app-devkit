// tools/starter-drift.mjs on this folder (a template and an app filled from an older version of it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { drift, report } from '../../tools/starter-drift.mjs';

const at = p => fileURLToPath(new URL(p, import.meta.url));
const tool = fileURLToPath(new URL('../../tools/starter-drift.mjs', import.meta.url));

test('same, changed and missing files, after filling the template for the app', async () => {
  const d = await drift({ template: at('template'), app: at('app') });
  assert.deepEqual(d.same, ['app/index.html', 'vendor.js']);
  assert.deepEqual(d.changed, ['app/host.js']);
  assert.deepEqual(d.missing, ['app/new.txt']);
  assert.equal(d.behind, true);
  assert.match(report(d), /template 0\.2\.0 \(aaaaaaaa\); this app is on 0\.1\.0 \(bbbbbbbb\)/);
});

test('reports only: nothing in the app changes; --strict fails on drift', () => {
  const before = fs.readFileSync(at('app/app/host.js'), 'utf8');
  const out = execFileSync('node', [tool, '--template', at('template'), '--app', at('app')], { encoding: 'utf8' });
  assert.match(out, /1 changed here, 1 not here/);
  assert.equal(fs.readFileSync(at('app/app/host.js'), 'utf8'), before);
  assert.throws(() => execFileSync('node', [tool, '--template', at('template'), '--app', at('app'), '--strict'], { stdio: 'ignore' }));
});

test('an app without .starter.json is refused', async () => {
  await assert.rejects(drift({ template: at('template'), app: at('template/app') }), /no \.starter\.json/);
});
