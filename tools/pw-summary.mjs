// Short summary of a Playwright JSON report (pw-run.sh): one line per browser with pass/fail counts, then the failing
// tests (file:line, title, first error line), at most MAX lines in all. Exit 1 when anything failed or was flaky.
//   node tools/pw-summary.mjs <report.json> [max lines, default 20]
import { readFileSync } from 'node:fs';

const [file, maxArg] = process.argv.slice(2);
const MAX = Number(maxArg) || 20;
const report = JSON.parse(readFileSync(file, 'utf8'));
const browserOf = name => (name.match(/-(chromium|firefox|webkit)$/) || [, name || 'default'])[1];
const per = new Map();
const fails = [];

function walk(suite, path) {
  for (const s of suite.suites || []) walk(s, s.title && !/\.m?[jt]s$/.test(s.title) ? [...path, s.title] : path);
  for (const spec of suite.specs || []) for (const t of spec.tests || []) {
    const b = browserOf(t.projectName);
    const c = per.get(b) || { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    const k = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' }[t.status] || 'failed';
    c[k]++; per.set(b, c);
    if (k === 'failed' || k === 'flaky') {
      const err = (t.results || []).flatMap(r => r.errors || [r.error]).find(Boolean);
      const msg = (err?.message || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').find(l => l.trim()) || '';
      fails.push(`${b} ${k}: ${spec.file}:${spec.line} ${[...path, spec.title].join(' > ')}${msg ? ` | ${msg.trim().slice(0, 140)}` : ''}`);
    }
  }
}
walk(report, []);

const lines = [...per].map(([b, c]) => `${b}: ${c.passed} passed, ${c.failed} failed${c.flaky ? `, ${c.flaky} flaky` : ''}${c.skipped ? `, ${c.skipped} skipped` : ''}`);
for (const e of report.errors || []) fails.push(`run error: ${(e.message || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 160)}`);
const room = Math.max(MAX - lines.length, 1);
const uniq = [...new Map(fails.map(f => [f, (fails.filter(x => x === f).length)])).entries()].map(([f, n]) => n > 1 ? `${f} (x${n})` : f);
lines.push(...uniq.slice(0, room));
if (uniq.length > room) lines[lines.length - 1] = `... and ${uniq.length - room + 1} more failing (see the log)`;
if (!per.size) lines.unshift('no tests ran');
console.log(lines.join('\n'));
process.exit(fails.length || !per.size ? 1 : 0);
