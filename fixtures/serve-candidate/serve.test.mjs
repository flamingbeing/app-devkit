// serve-candidate: the preload swaps core.example.test/sync/<any>/ and /update/<any>/ for local folders in every browser
// context, and report.mjs fails a row unless the page really ran the candidate's VERSION.
// Needs Playwright with Chromium (PLAYWRIGHT_PATH, else the 'playwright' package).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.resolve(here, '../../serve-candidate');

function run(mode) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), 'log.jsonl');
  const env = { ...process.env, NODE_OPTIONS: `--import ${path.join(kit, 'patch.mjs')}`, SERVE_CANDIDATE_SYNC: path.join(here, 'candidate'), SERVE_CANDIDATE_UPDATE: path.join(here, 'update'), SERVE_CANDIDATE_LOG: log, SERVE_CANDIDATE_ORIGIN: 'https://core.example.test' };
  const out = execFileSync(process.execPath, [path.join(here, 'run.mjs'), mode], { env, encoding: 'utf8' });
  return { got: JSON.parse(out.trim().split('\n').pop()), log };
}
const report = (log, ...args) => spawnSync(process.execPath, [path.join(kit, 'report.mjs'), log, '--row', 'fixture', '--expect', '9.9.9-test', ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });

test('a plain script loads the candidate under the pinned URLs; the row passes', () => {
  const { got, log } = run('load');
  assert.deepEqual(got, { VERSION: '9.9.9-test', part: 'candidate', label: 'candidate update' });
  const r = report(log);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /fixture \| pass \| 9\.9\.9-test/);
});

test('an older engine served for the pinned URL (a stale cache, a fallback) fails the row', () => {
  const { got, log } = run('stale');
  assert.equal(got.VERSION, '0.0.1-old');
  const r = report(log);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /0\.0\.1-old/);
});

test("a service worker's own install fetches get the candidate too (not the live engine)", () => {
  const { got, log } = run('sw');
  assert.deepEqual(got, { VERSION: '9.9.9-test', part: 'candidate', label: 'sw' });
  assert.equal(report(log).status, 0);
});

test('an engine file the candidate lacks fails the row (it answers 404, never the live copy)', () => {
  const { got, log } = run('missing');
  assert.equal(got.VERSION, '9.9.9-test');
  const r = report(log);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not in the candidate: sync\/src\/gone\.js/);
});

test('a run that never loads the engine fails the row (nothing proves the candidate ran)', () => {
  const { log } = run('none');
  const r = report(log);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /never loaded/);
});

test('shell.mjs lists the engine files a service worker misses or names wrongly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sw-'));
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(path.join(dir, 'app/sw.js'), "const SHELL = ['./', 'https://core.example.test/sync/0.6.3/index.js', 'https://core.example.test/sync/0.6.3/src/gone.js'];");
  const r = spawnSync(process.execPath, [path.join(kit, 'shell.mjs'), '--files', path.join(here, 'candidate/files.json'), '--origin', 'https://core.example.test', '--row', 'fixture', dir], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  assert.equal(r.status, 0);   // reports, never blocks (unless --strict)
  assert.match(r.stdout, /app\/sw\.js \| 0\.6\.3 \| missing: src\/part\.js \| not in the build: src\/gone\.js/);
});
