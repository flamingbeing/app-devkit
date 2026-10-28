import test from 'node:test';
import assert from 'node:assert/strict';
import { summarisePlaywright, renderBody, cleanCount, hasFailures } from '../../tools/soak-report.mjs';

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
