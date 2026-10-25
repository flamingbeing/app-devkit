// Drift report for an app made from a starter template: which of the template's files the app has changed, which it
// lacks, and how far its recorded template version is behind. It only reports; it never changes a file.
//
//   node .devkit/tools/starter-drift.mjs --template <checkout of the template> [--app <dir>] [--json] [--strict]
//
// The app's .starter.json records the template version and commit it started from (or adopted), and its own values
// (name, host, kit, project, title). The template's tools/fill.mjs supplies the replacements (swapsFor), so a template
// file is compared with what filling it for this app would give (and its fixup, when it has one). --strict exits 1 when anything differs (for CI);
// otherwise it always exits 0.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SKIP = new Set(['.starter.json', 'app/config.js']);   // always the app's own

export async function drift({ template, app = '.' }) {
  const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!fs.existsSync(path.join(app, '.starter.json'))) throw new Error(`${app}: no .starter.json (not made from a starter template)`);
  const mine = read(app, '.starter.json'), theirs = read(template, '.starter.json');
  const fill = await import(pathToFileURL(path.resolve(template, 'tools/fill.mjs')).href);
  const swaps = fill.swapsFor(theirs.app, mine.app);
  const keep = new Set(fill.KEEP_FILES || []);
  const out = { template: { version: theirs.version, commit: theirs.commit || '' }, app: { version: mine.version, commit: mine.commit || '' },
    behind: mine.version !== theirs.version, same: [], changed: [], missing: [] };
  for (const f of fill.files(template).sort()) {
    if (SKIP.has(f)) continue;
    let want = fs.readFileSync(path.join(template, f), 'utf8');
    if (!keep.has(f)) { for (const [re, to] of swaps) want = want.replace(re, to); if (fill.fixup) want = fill.fixup(f, want, mine.app); }
    const p = path.join(app, f);
    if (!fs.existsSync(p)) out.missing.push(f);
    else (fs.readFileSync(p, 'utf8') === want ? out.same : out.changed).push(f);
  }
  return out;
}

export function report(d) {
  const lines = [`template ${d.template.version}${d.template.commit ? ` (${d.template.commit.slice(0, 8)})` : ''}; ` +
    `this app ${d.behind ? 'is on' : 'matches'} ${d.app.version}${d.app.commit ? ` (${d.app.commit.slice(0, 8)})` : ''}`,
    `${d.same.length} same, ${d.changed.length} changed here, ${d.missing.length} not here`];
  if (d.changed.length) lines.push('changed here (compare before taking the template\'s version):', ...d.changed.map(f => `  ${f}`));
  if (d.missing.length) lines.push('not here:', ...d.missing.map(f => `  ${f}`));
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), arg = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  try {
    const template = arg('--template');
    if (!template) throw new Error('--template <checkout of the template> is required');
    const d = await drift({ template, app: arg('--app') || '.' });
    console.log(a.includes('--json') ? JSON.stringify(d, null, 2) : report(d));
    if (a.includes('--strict') && (d.behind || d.changed.length || d.missing.length)) process.exit(1);
  } catch (e) { console.error(`starter-drift: ${e.message}`); process.exit(2); }
}
