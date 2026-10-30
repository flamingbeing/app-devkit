#!/usr/bin/env node
// How much a page loads before it can draw: the JS and CSS its HTML starts (module and classic scripts, modulepreload,
// stylesheets) and every static import those files make, gzipped. A dynamic import() is not followed: that is how a
// screen or a heavy extra (Excel, an editor, PDF) stays off startup. Files on other origins (core, CDNs) are counted
// as requests only; their size is the core's own budget.
//   node startup-size.mjs <page.html> [--max <KiB gz>] [--max-files <n>] [--json]
// Exits 1 when the gzipped JS goes over --max or the request count over --max-files, naming the biggest files.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const max = opt('--max'), maxFiles = opt('--max-files');
const json = args.includes('--json');
const page = args.find(a => !a.startsWith('--'));
if (!page) { console.error('usage: startup-size.mjs <page.html> [--max <KiB gz>] [--max-files <n>] [--json]'); process.exit(2); }

export function startupSize(pagePath) {
  const html = fs.readFileSync(pagePath, 'utf8');
  const dir = path.dirname(path.resolve(pagePath));
  const local = new Map(), external = new Set(), missing = new Set();
  const map = {};
  for (const m of html.matchAll(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { Object.assign(map, JSON.parse(m[1]).imports || {}); } catch { /* a broken map is the page's own test */ }
  }
  // a page in <dir> may keep its files in <dir>/public/ (the Vite-lite layout); the Worker serves them at the same URL
  const onDisk = p => [p, path.join(dir, 'public', path.relative(dir, p))].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
  const resolve = (spec, from) => {
    if (!/^(\.{0,2}\/|https?:)/.test(spec)) {
      const key = Object.keys(map).filter(k => k === spec || (k.endsWith('/') && spec.startsWith(k))).sort((a, b) => b.length - a.length)[0];
      if (!key) return null;
      spec = map[key] + spec.slice(key.length);
      from = dir;
    }
    if (/^https?:|^\/\//.test(spec)) return { url: spec };
    const clean = spec.replace(/[?#].*$/, '');
    // a root path ("/home/js/home.js") is served from the site root: the folder it is run from, or the page's own
    return { file: clean.startsWith('/') ? [process.cwd(), dir].map(d => path.join(d, clean)).find(f => fs.existsSync(f)) || path.join(dir, clean) : path.resolve(from, clean) };
  };
  // an HTML src/href is a URL, so a plain "js/app.js" is relative to the page, not a bare import name
  const fromHtml = (spec, kind) => add(/^([a-z]+:|\.{0,2}\/)/i.test(spec) ? spec : `./${spec}`, dir, kind);
  const add = (spec, from, kind) => {
    const r = resolve(spec, from);
    if (!r) return;
    if (r.url) { external.add(r.url); return; }
    const f = onDisk(r.file);
    if (!f) { missing.add(path.relative(dir, r.file)); return; }
    if (local.has(f)) return;
    const src = fs.readFileSync(f);
    local.set(f, { kind, bytes: src.length, gz: zlib.gzipSync(src, { level: 9 }).length });
    if (kind !== 'js') return;
    const text = src.toString('utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) add(m[1] || m[2], path.dirname(f), 'js');
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\bsrc=["']([^"']+)["']/.exec(m[1]);
    if (/type=["']importmap["']/.test(m[1])) continue;
    if (src) fromHtml(src[1], 'js');
    else if (/type=["']module["']/.test(m[1])) for (const i of m[2].matchAll(/^\s*import\b[^'"]*?['"]([^'"]+)['"]/gm)) add(i[1], dir, 'js');
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = /\bhref=["']([^"']+)["']/.exec(m[0]);
    if (!href) continue;
    if (/rel=["']modulepreload["']/.test(m[0])) fromHtml(href[1], 'js');
    else if (/rel=["']stylesheet["']/.test(m[0])) fromHtml(href[1], 'css');
  }
  const files = [...local].map(([f, v]) => ({ file: path.relative(dir, f), ...v })).sort((a, b) => b.gz - a.gz);
  const sum = (kind, k) => files.filter(f => f.kind === kind).reduce((n, f) => n + f[k], 0);
  return {
    page: pagePath, files, external: [...external], missing: [...missing],
    js: { bytes: sum('js', 'bytes'), gz: sum('js', 'gz') }, css: { bytes: sum('css', 'bytes'), gz: sum('css', 'gz') },
    requests: files.length + external.size,
  };
}

const r = startupSize(page);
const kib = n => (n / 1024).toFixed(1);
const problems = [];
if (max && r.js.gz > Number(max) * 1024) problems.push(`startup JS is ${kib(r.js.gz)} KiB gzipped, over the ${max} KiB budget`);
if (maxFiles && r.requests > Number(maxFiles)) problems.push(`startup makes ${r.requests} requests, over the ${maxFiles} budget`);
if (json) console.log(JSON.stringify({ ...r, problems }, null, 2));
else {
  console.log(`startup-size ${page}: JS ${kib(r.js.gz)} KiB gz (${kib(r.js.bytes)} raw), CSS ${kib(r.css.gz)} KiB gz, ` +
    `${r.files.length} local files + ${r.external.length} from other origins = ${r.requests} requests`);
  if (r.missing.length) console.log(`  not found (not counted): ${r.missing.join(', ')}`);
  if (problems.length) {
    console.log('  biggest at startup (gz KiB):');
    for (const f of r.files.filter(f => f.kind === 'js').slice(0, 10)) console.log(`    ${kib(f.gz).padStart(6)}  ${f.file}`);
    console.log('  Load screens and heavy extras on first use (import()) instead of at startup, then prefetch them when idle.');
  }
}
if (problems.length) { console.error(`startup-size: ${problems.join('; ')}`); process.exit(1); }
