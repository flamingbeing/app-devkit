// serve-candidate SHELL check: node shell.mjs --files <files.json> [--row <name>] [--strict] <dir>...
// For each sw.js under the folders, compares the engine files it names (core.anawj.com/sync/<v>/<file>) with the
// build's file list: "missing" ones are not stored for offline use, "not in the build" ones fail the install.
// Prints markdown table rows (and adds them to $GITHUB_STEP_SUMMARY). Reports only; --strict exits 1 on a gap.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i < 0 ? '' : args.splice(i, 2)[1]; };
const files = JSON.parse(fs.readFileSync(opt('files'), 'utf8'));
const row = opt('row') || 'app';
const strict = args.includes('--strict') ? (args.splice(args.indexOf('--strict'), 1), true) : false;
const SKIP = new Set(['node_modules', '.git', '.devkit', 'test-results', 'playwright-report']);
const sws = [];
const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name)); } else if (e.name === 'sw.js') sws.push(path.join(dir, e.name));
} };
const rows = [];
let gaps = 0;
for (const dir of args) {
  walk(dir);
  for (const sw of sws.splice(0)) {
    const text = fs.readFileSync(sw, 'utf8');
    const named = new Map();
    for (const [, v, rel] of text.matchAll(/https:\/\/core\.anawj\.com\/sync\/([^/'"`]+)\/([^'"`\s?#]+)/g)) (named.get(v) || named.set(v, new Set()).get(v)).add(rel);
    if (!named.size) { rows.push(`| ${row} | ${path.relative(dir, sw)} | - | no engine files listed | |`); continue; }
    for (const [v, rels] of named) {
      const missing = files.filter(f => !rels.has(f)), extra = [...rels].filter(f => !files.includes(f));
      if (missing.length || extra.length) gaps++;
      rows.push(`| ${row} | ${path.relative(dir, sw)} | ${v} | ${missing.length ? 'missing: ' + missing.join(', ') : 'ok'} | ${extra.length ? 'not in the build: ' + extra.join(', ') : ''} |`);
    }
  }
}
console.log(rows.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.join('\n') + '\n');
process.exit(strict && gaps ? 1 : 0);
