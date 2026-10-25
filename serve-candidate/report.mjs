// serve-candidate report: node report.mjs <log> --row <name> --expect <version>
// Reads the preload's log. The row passes only if some page really ran the engine and every page that did got the
// expected VERSION (a stale cache or a fallback to the live engine shows up as another version). Prints one markdown
// table row (and adds it to $GITHUB_STEP_SUMMARY); exit 1 when the row fails.
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i < 0 ? '' : args[i + 1]; };
const log = args[0];
const row = opt('row') || 'app';
const expect = opt('expect') || process.env.SERVE_CANDIDATE_VERSION || '';
const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const checked = lines.flatMap(l => l.checked);
const wrong = [...new Set(checked.filter(c => c.version !== expect).map(c => c.version))];
const pinned = [...new Set(lines.flatMap(l => l.pinned))];
const missing = [...new Set(lines.flatMap(l => l.notFound))];
const served = lines.reduce((n, l) => n + l.served.sync, 0);
let result = 'pass', note = `${checked.length} page checks, ${served} engine files served`;
if (!expect) { result = 'fail'; note = 'no --expect version'; }
else if (wrong.length) { result = 'fail'; note = `loaded ${wrong.join(', ')}`; }
else if (!checked.length) { result = 'fail'; note = served ? 'engine served but never loaded in a page that was checked' : 'engine never loaded'; }
if (missing.length) note += `; not in the candidate: ${missing.slice(0, 5).join(', ')}`;
const out = `| ${row} | ${result} | ${expect} | ${pinned.join(', ') || '-'} | ${note} |`;
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
process.exit(result === 'pass' ? 0 : 1);
