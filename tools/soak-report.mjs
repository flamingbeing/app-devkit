// Nightly soak report (workflow soak.yml). Reads the results folder (Playwright JSON files, plus *.fail.txt notes and
// *.ok.txt lines from the other steps: a step that passed says so, or a night of only those would read as no results) and keeps ONE open issue titled "Nightly soak" in the repo, updated in place:
//   failures tonight -> issue opened or its body rewritten (failing tests with counts, run link), clean nights reset to 0
//   clean night      -> an open issue counts it; after 7 clean nights in a row the workflow closes the issue
// Usage: node soak-report.mjs <results-dir>   (GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL; SOAK_DRY=1 prints only)
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const TITLE = 'Nightly soak';
export const CLEAN_TO_CLOSE = 7;

// Playwright JSON report -> { runs, failed: Map(title -> count) }; a flaky test (failed then passed) counts as failed too
export function summarisePlaywright(report) {
  let runs = 0;
  const failed = new Map();
  const walk = suite => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status === 'skipped') continue;
        runs++;
        if (t.status === 'unexpected' || t.status === 'flaky') {
          const key = `${spec.file ?? suite.file ?? ''} › ${spec.title}`;
          failed.set(key, (failed.get(key) ?? 0) + 1);
        }
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  // top-level errors: the run died (global setup threw, a spec file failed to load), so it is not a clean batch
  const errors = (report.errors ?? []).map(e => String(e.message ?? e.value ?? 'run errored').split('\n')[0]);
  return { runs, failed, errors };
}

export function collect(dir) {
  const rows = [];   // { source, runs, failed: [[title, n]] }
  const notes = [];
  const passed = [];   // *.ok.txt lines: unit, chaos and model steps that ran and passed
  let files = [];
  try { files = readdirSync(dir).sort(); } catch { /* setup died before the folder existed */ }
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    if (f.endsWith('.json')) {
      let s;
      try { s = summarisePlaywright(JSON.parse(text)); } catch { notes.push(`${f}: report unreadable (the run died before it wrote one)`); continue; }
      notes.push(...s.errors.map(m => `${f}: ${m}`));
      const source = f.replace(/\.json$/, '').replace(/\.b\d+$/, '');   // normal.b1.json, normal.b2.json -> normal
      const row = rows.find(r => r.source === source);
      if (!row) { rows.push({ source, runs: s.runs, failed: [...s.failed] }); continue; }
      row.runs += s.runs;
      const merged = new Map(row.failed);
      for (const [title, n] of s.failed) merged.set(title, (merged.get(title) ?? 0) + n);
      row.failed = [...merged];
    } else if (f.endsWith('.fail.txt')) {
      notes.push(...text.split('\n').map(l => l.trim()).filter(Boolean));
    } else if (f.endsWith('.ok.txt')) {
      passed.push(...text.split('\n').map(l => l.trim()).filter(Boolean));
    }
  }
  if (!rows.length && !notes.length && !passed.length) notes.push('no results were written (setup or a test step died before reporting)');
  return { rows, notes, passed };
}

export function hasFailures({ rows, notes }) {
  return notes.length > 0 || rows.some(r => r.failed.length > 0);
}

export function renderBody({ rows, notes, passed = [] }, { run, date, clean }) {
  const lines = [`<!-- soak: clean=${clean} -->`, `Last run: ${date}, ${run}`, ''];
  if (hasFailures({ rows, notes })) {
    lines.push('Failing tonight:');
    for (const r of rows) for (const [title, n] of r.failed) lines.push(`- ${title}: ${n} of ${r.runs} runs (${r.source})`);
    for (const n of notes) lines.push(`- ${n}`);
    lines.push('', `Clean nights in a row: 0 (the workflow closes this issue after ${CLEAN_TO_CLOSE}).`);
  } else {
    lines.push(`Clean tonight (${[...rows.map(r => `${r.source}: ${r.runs} runs`), ...passed].join(', ') || 'no runs'}).`, '',
      `Clean nights in a row: ${clean} of ${CLEAN_TO_CLOSE}; the workflow closes this issue at ${CLEAN_TO_CLOSE}.`);
  }
  lines.push('', 'Fix by root cause (no retries, skips or longer timeouts). The weekly soak-fix session reads this issue.');
  return lines.join('\n');
}

export function cleanCount(body) {
  const m = /<!-- soak: clean=(\d+) -->/.exec(body ?? '');
  return m ? Number(m[1]) : 0;
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });

function main() {
  const dir = process.argv[2];
  const result = collect(dir);
  const failing = hasFailures(result);
  const repo = process.env.GITHUB_REPOSITORY;
  const run = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const date = new Date().toISOString().slice(0, 10) + ' UTC';
  const open = JSON.parse(gh('issue', 'list', '--repo', repo, '--state', 'open', '--search', `"${TITLE}" in:title`, '--json', 'number,title,body'))
    .find(i => i.title === TITLE);
  const prior = open ? cleanCount(open.body) : 0;
  const clean = failing ? 0 : prior + 1;
  const body = renderBody(result, { run, date, clean });
  console.log(body);
  if (process.env.SOAK_DRY === '1') return;
  if (failing) {
    if (open) gh('issue', 'edit', String(open.number), '--repo', repo, '--body', body);
    else gh('issue', 'create', '--repo', repo, '--title', TITLE, '--body', body);
  } else if (open) {
    if (clean >= CLEAN_TO_CLOSE) {
      gh('issue', 'edit', String(open.number), '--repo', repo, '--body', body);
      gh('issue', 'close', String(open.number), '--repo', repo, '--reason', 'completed', '--comment', `${CLEAN_TO_CLOSE} clean nights in a row: closing. ${run}`);
    } else gh('issue', 'edit', String(open.number), '--repo', repo, '--body', body);
  }
  if (failing) process.exitCode = 1;   // the run shows red; it is not a required check
}

if (import.meta.url === `file://${process.argv[1]}`) main();
