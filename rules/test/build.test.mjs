// tools/build-rules.mjs: pastes common.rules at the marker, keeps the indent, and --check catches a stale file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildRules } from '../../tools/build-rules.mjs';

const tool = new URL('../../tools/build-rules.mjs', import.meta.url).pathname;
const app = "rules_version = '2';\nservice cloud.firestore {\n  match /d/{x} {\n    // devkit:common\n    match /a/{id} { allow read: if f(); }\n  }\n}\n";
const common = '// helpers\nfunction f() { return true; }\n\n';

test('pastes common at the marker, indented, with a header', () => {
  const out = buildRules(app, common, 'x.app.rules');
  assert.match(out, /^\/\/ Built by app-devkit tools\/build-rules\.mjs from x\.app\.rules/);
  assert.match(out, /\n    \/\/ helpers\n    function f\(\) \{ return true; \}\n    match \/a/);
  assert.doesNotMatch(out, /devkit:common/);
});

test('refuses no marker or two', () => {
  assert.throws(() => buildRules('service x {}', common), /found 0/);
  assert.throws(() => buildRules('// devkit:common\n// devkit:common', common), /found 2/);
});

test('CLI writes <name>.rules and --check fails when stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-'));
  writeFileSync(join(dir, 'firestore.app.rules'), app);
  writeFileSync(join(dir, 'common.rules'), common);
  const run = (...a) => execFileSync('node', [tool, join(dir, 'firestore.app.rules'), '--common', join(dir, 'common.rules'), ...a]);
  run();
  assert.equal(readFileSync(join(dir, 'firestore.rules'), 'utf8'), buildRules(app, common, 'firestore.app.rules'));
  run('--check');
  writeFileSync(join(dir, 'common.rules'), common + 'function g() { return false; }\n');
  assert.throws(() => run('--check'), (e) => e.status === 1 && /out of date/.test(String(e.stderr)));
});

test('the default common.rules is the kit copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-'));
  writeFileSync(join(dir, 'firestore.app.rules'), app);
  execFileSync('node', [tool, join(dir, 'firestore.app.rules')]);
  assert.match(readFileSync(join(dir, 'firestore.rules'), 'utf8'), /function notRevoked\(\)/);
});
