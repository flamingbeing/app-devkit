#!/usr/bin/env node
// Checks relative links and #anchors in Markdown and HTML files. External (http) links are not fetched.
//   node check-links.mjs [folder]      exit 1 and a list when a link points at a missing file or heading
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const SKIP = new Set(['node_modules', '.git', '.devkit', 'test-results']);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(md|html?)$/i.test(e.name)) files.push(p);
  }
})(root);

const slug = t => t.toLowerCase().replace(/<[^>]+>|[`*_]/g, '').trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const anchors = new Map();
const anchorsOf = f => {
  if (!anchors.has(f)) {
    const s = fs.readFileSync(f, 'utf8'), set = new Set();
    for (const m of s.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) set.add(slug(m[1]));
    for (const m of s.matchAll(/\bid=["']([^"']+)["']/g)) set.add(m[1]);
    anchors.set(f, set);
  }
  return anchors.get(f);
};

// a page in <dir> may keep its files in <dir>/public/ (the Vite-lite layout); the Worker serves them from the same URL
const resolveLink = (from, rel) => {
  const target = path.resolve(path.dirname(from), rel);
  if (fs.existsSync(target)) return target;
  const dir = path.dirname(from), inside = path.relative(dir, target);
  if (inside && !inside.startsWith('..') && !path.isAbsolute(inside) && !inside.split(path.sep)[0].startsWith('public')) {
    const alt = path.join(dir, 'public', inside);
    if (fs.existsSync(alt)) return alt;
  }
  return target;
};

const bad = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8').replace(/```[\s\S]*?```/g, '');
  const links = /\.html?$/i.test(f)
    ? [...s.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(m => m[1])
    : [...s.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1]);
  for (const l of links) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(l)) continue;
    const [file, hash] = l.split('#');
    const target = file ? resolveLink(f, decodeURIComponent(file)) : f;
    if (!fs.existsSync(target)) { bad.push(`${path.relative(root, f)}: ${l} (no such file)`); continue; }
    if (hash && fs.statSync(target).isFile() && /\.(md|html?)$/i.test(target) && !anchorsOf(target).has(decodeURIComponent(hash))) bad.push(`${path.relative(root, f)}: ${l} (no such heading)`);
  }
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log(`${files.length} files, links ok`);
