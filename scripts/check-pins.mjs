#!/usr/bin/env node
// Lists a repo's devkit pins (`uses: flamingbeing/app-devkit/...@ref`) against the latest release tag.
// Usage: node check-pins.mjs [repo-dir] [--latest vX.Y.Z]   Exit 1 when a pin is a full version behind the latest.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const li = args.indexOf('--latest');
let latest = li >= 0 ? args.splice(li, 2)[1] : '';
const root = args[0] || '.';

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'node_modules' || f === '.git') return [];
    return statSync(p).isDirectory() ? files(p) : /\.ya?ml$/.test(f) ? [p] : [];
  });
}

if (!latest) {
  const out = execFileSync('git', ['ls-remote', '--tags', '--refs', 'https://github.com/flamingbeing/app-devkit'], { encoding: 'utf8' });
  const vers = [...out.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gm)].map((m) => m[1]);
  const key = (v) => v.slice(1).split('.').map(Number);
  vers.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  latest = vers.at(-1);
}
if (!latest) { console.error('no latest tag found'); process.exit(2); }

let stale = 0;
for (const f of [...files(join(root, '.github'))]) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const m = line.match(/flamingbeing\/app-devkit(\/[\w./-]+?)?@([\w.-]+)/);
    if (!m) return;
    const ok = m[2] === latest || m[2] === latest.split('.')[0];
    const note = ok ? 'ok' : m[2].startsWith(latest.split('.')[0] + '.') ? `behind ${latest}` : `different major (latest ${latest})`;
    if (!ok) stale++;
    console.log(`${ok ? 'ok   ' : 'STALE'} ${f}:${i + 1} ${m[1] || ''}@${m[2]} (${note})`);
  });
}
console.log(stale ? `${stale} pin(s) not on ${latest} or its major tag` : `all pins on ${latest} (or its major tag)`);
process.exit(stale ? 1 : 0);
