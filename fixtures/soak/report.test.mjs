import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarisePlaywright, renderBody, cleanCount, hasFailures, collect, runUrl } from '../../tools/soak-report.mjs';

const report = {
  suites: [{ file: 'a.spec.mjs', specs: [], suites: [{ specs: [
    { title: 'adds an item', file: 'a.spec.mjs', tests: [{ status: 'expected' }, { status: 'unexpected' }, { status: 'flaky' }] },
    { title: 'skipped one', file: 'a.spec.mjs', tests: [{ status: 'skipped' }] },
  ] }] }],
};

test('counts runs and failures per spec, flaky included, skipped ignored', () => {
  const s = summarisePlaywright(report);
  assert.equal(s.runs, 3);
  assert.deepEqual([...s.failed], [['a.spec.mjs › adds an item', 2]]);
});

test('failing body lists tests with counts and resets the clean count', () => {
  const r = { rows: [{ source: 'normal', runs: 3, failed: [['a.spec.mjs › adds an item', 2]] }], notes: ['chaos seed 7 failed'] };
  assert.equal(hasFailures(r), true);
  const body = renderBody(r, { run: 'https://x/run/1', date: '2026-10-28 UTC', clean: 0 });
  assert.match(body, /adds an item: 2 of 3 runs \(normal\)/);
  assert.match(body, /chaos seed 7 failed/);
  assert.equal(cleanCount(body), 0);
});

test('clean body carries the count the next night reads back', () => {
  const r = { rows: [{ source: 'normal', runs: 20, failed: [] }], notes: [] };
  assert.equal(hasFailures(r), false);
  const body = renderBody(r, { run: 'u', date: 'd', clean: 3 });
  assert.equal(cleanCount(body), 3);
  assert.match(body, /3 of 7/);
});

test('per-batch Playwright files are merged into one row per source', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { collect } = await import('../../tools/soak-report.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'soak-'));
  writeFileSync(join(dir, 'normal.b1.json'), JSON.stringify(report));
  writeFileSync(join(dir, 'normal.b2.json'), JSON.stringify(report));
  const { rows } = collect(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'normal');
  assert.equal(rows[0].runs, 6);
  assert.deepEqual(rows[0].failed, [['a.spec.mjs › adds an item', 4]]);
});

test('a batch whose Playwright run errored out (top-level errors, no suites) is not a clean night', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soak-'));
  const ok = { suites: [{ file: 'a.spec.js', specs: [{ title: 't', tests: [{ status: 'expected' }] }] }], errors: [] };
  const died = { suites: [], errors: [{ message: 'Error: timed out waiting for the auth emulator\n    at setup' }] };
  writeFileSync(join(dir, 'normal.b1.json'), JSON.stringify(ok));
  writeFileSync(join(dir, 'normal.b2.json'), JSON.stringify(died));
  const r = collect(dir);
  assert.equal(hasFailures(r), true);
  assert.deepEqual(r.notes, ['normal.b2.json: Error: timed out waiting for the auth emulator']);
});

test('a night of only unit and model steps that passed is clean, not "no results" (1.13.7)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soak-'));
  writeFileSync(join(dir, 'model.log'), 'model seeds 24920000 .. 24929999: ok\n');
  writeFileSync(join(dir, 'unit.ok.txt'), 'unit: 50 of 50 runs passed\n');
  writeFileSync(join(dir, 'model.ok.txt'), 'model: SOAK_SEED_N=24920 passed\n');
  const r = collect(dir);
  assert.equal(hasFailures(r), false);
  assert.match(renderBody(r, { run: 'r', date: 'd', clean: 1 }), /Clean tonight \(model: SOAK_SEED_N=24920 passed, unit: 50 of 50 runs passed\)/);
});

test('run link comes from the API, so a renamed repo links its current name', () => {
  const env = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/old-name', GITHUB_RUN_ID: '9' };
  let asked;
  const url = runUrl(env, (...a) => { asked = a; return 'o/new-name\n'; });
  assert.equal(url, 'https://github.com/o/new-name/actions/runs/9');
  assert.equal(asked[1], 'repos/o/old-name');
});

test('run link falls back to the built one when the API fails', () => {
  const env = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9' };
  assert.equal(runUrl(env, () => { throw new Error('403'); }), 'https://github.com/o/r/actions/runs/9');
});
