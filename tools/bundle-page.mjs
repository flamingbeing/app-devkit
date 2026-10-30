#!/usr/bin/env node
// Joins a page's startup files into a few, at deploy time (and in the CI run that tests the deployed shape), so a phone
// opens it with a handful of requests instead of dozens. The source stays build-free: local runs and the usual tests
// use it as it is, and the bundle is never committed.
// - Each local <script type="module" src> is an entry; each literal import() (a screen, a heavy extra) becomes its own
//   file, loaded on first use as before.
// - The core at an exact pin (core.anawj.com/ui/<x.y.z>/, /sync/<x.y.z>/, also through the import map's @core/*) is
//   fetched and joined in, only what the page imports: a released version never changes.
// - Everything else stays as it is: other origins (Firebase's CDN, the update core, which the service worker also
//   loads) and the import map's other bare names (vendored Firebase), so a test's import('firebase/auth') still gets
//   the page's one copy.
// - Output sits next to the source (<entry>.b.js, chunk-<hash>.js beside the first entry) so relative URLs keep
//   working; a .js.map beside each, so an error names the source file and line.
// - The page then starts the bundle and preloads only what it imports; with --sw, that sw.js's SHELL lists the bundle
//   instead of the files inside it.
// A non-literal import(path) of a file inside the bundle loads a second copy of that module, with its own state:
// keep every import() literal (`import('./x.js')`, the full core address). Run the deploy's stamp after this.
//   node bundle-page.mjs <page.html> [--sw <sw.js>] [--check]   (--check builds into a temp folder, prints sizes only)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ESBUILD = 'esbuild@0.24.2';
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const swArg = opt('--sw');
const check = args.includes('--check');
const page = args.find(a => !a.startsWith('--'));
if (!page) { console.error('usage: bundle-page.mjs <page.html> [--sw <sw.js>] [--check]'); process.exit(2); }

const pagePath = path.resolve(page);
const dir = path.dirname(pagePath);
// a page in <dir> may keep its files in <dir>/public/ (the Vite-lite layout); the Worker serves them at the same URL
const onDisk = p => [p, path.join(dir, 'public', path.relative(dir, p))].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
const CORE = /^https:\/\/core\.anawj\.com\/(ui|sync)\/\d+\.\d+\.\d+[^/]*\//;
const local = href => !/^([a-z]+:|\/\/)/i.test(href);
const toFile = href => path.resolve(dir, href.replace(/[?#].*$/, ''));

let html = fs.readFileSync(pagePath, 'utf8');
const map = {};
for (const m of html.matchAll(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi)) Object.assign(map, JSON.parse(m[1]).imports || {});
const viaMap = spec => {
  const key = Object.keys(map).filter(k => k === spec || (k.endsWith('/') && spec.startsWith(k))).sort((a, b) => b.length - a.length)[0];
  return key ? map[key] + spec.slice(key.length) : null;
};
const scripts = [...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>|<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*type=["']module["'][^>]*><\/script>/gi)]
  .map(m => m[1] || m[2]).filter(local);
if (!scripts.length) throw new Error(`bundle: ${page} starts no local module script`);
const entries = scripts.map(s => { const f = onDisk(toFile(s)); if (!f) throw new Error(`bundle: ${s} not found`); return f; });
const chunkDir = path.relative(dir, path.dirname(entries[0])).split(path.sep).join('/');

// esbuild, installed once into the temp folder (an app needs no dependency for it)
const TOOL = path.join(os.tmpdir(), 'bundle-page-esbuild');
if (!fs.existsSync(path.join(TOOL, 'node_modules', 'esbuild'))) {
  fs.mkdirSync(TOOL, { recursive: true });
  execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', TOOL, ESBUILD], { stdio: 'inherit' });
}
const esbuild = createRequire(path.join(TOOL, 'x.js'))('esbuild');

const fetched = new Map();
const core = {
  name: 'core',
  setup(b) {
    b.onResolve({ filter: /.*/, namespace: 'core' }, a => {
      const spec = /^\.{0,2}\//.test(a.path) ? new URL(a.path, a.importer).href : a.path;
      if (CORE.test(spec)) return { path: spec, namespace: 'core' };
      const mapped = /^https?:/.test(spec) ? null : viaMap(spec);
      return mapped && CORE.test(mapped) ? { path: mapped, namespace: 'core' } : { path: spec, external: true };
    });
    b.onResolve({ filter: /^https?:\/\// }, a => (CORE.test(a.path) ? { path: a.path, namespace: 'core' } : { path: a.path, external: true }));
    // a bare name: the import map's core address is joined in; any other stays bare for the page's import map
    b.onResolve({ filter: /^[^./]/ }, a => {
      const mapped = viaMap(a.path);
      if (mapped && CORE.test(mapped)) return { path: mapped, namespace: 'core' };
      return { path: a.path, external: true };
    });
    b.onLoad({ filter: /.*/, namespace: 'core' }, async a => {
      if (!fetched.has(a.path)) {
        const r = await fetch(a.path);
        if (!r.ok) throw new Error(`bundle: ${a.path} answered ${r.status}`);
        fetched.set(a.path, await r.text());
      }
      return { contents: fetched.get(a.path), loader: 'js' };
    });
  },
};
const out = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-page-')) : dir;
const result = await esbuild.build({
  absWorkingDir: dir, entryPoints: entries, bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2022',
  outbase: dir, outdir: out, entryNames: '[dir]/[name].b', chunkNames: `${chunkDir ? chunkDir + '/' : ''}chunk-[hash]`,
  sourcemap: 'linked', legalComments: 'none', metafile: true, logLevel: 'warning', plugins: [core],
});
const { inputs, outputs } = result.metafile;
const rel = f => path.relative(out, path.resolve(dir, f)).split(path.sep).join('/');   // metafile paths are dir-relative
const files = Object.keys(outputs).filter(f => f.endsWith('.js'));
const entryOut = e => files.find(f => outputs[f].entryPoint && path.resolve(dir, outputs[f].entryPoint) === e);
const statics = new Set();
const walk = f => { if (statics.has(f)) return; statics.add(f); for (const i of outputs[f].imports) if (i.kind === 'import-statement' && !i.external) walk(i.path); };
for (const e of entries) walk(entryOut(e));
const gz = f => zlib.gzipSync(fs.readFileSync(path.resolve(dir, f)), { level: 9 }).length;
console.log(`bundle ${page}: ${files.length} files (${fetched.size} core files joined in); startup ${statics.size} files, ` +
  `${([...statics].reduce((n, f) => n + gz(f), 0) / 1024).toFixed(1)} KiB gz`);
if (check) { fs.rmSync(out, { recursive: true }); process.exit(0); }

// what is inside the bundle now: local files (as the page's URLs) and core addresses
const inside = new Set([...fetched.keys()]);
for (const f of Object.keys(inputs)) if (!f.startsWith('core:')) {
  const abs = path.resolve(dir, f);
  const pub = path.relative(path.join(dir, 'public'), abs);
  inside.add(path.relative(dir, abs).split(path.sep).join('/'));
  if (!pub.startsWith('..')) inside.add(pub.split(path.sep).join('/'));
}
const isInside = href => (local(href) ? inside.has(path.relative(dir, toFile(href)).split(path.sep).join('/')) : inside.has(href.replace(/[?#].*$/, '')));

// the page: start the bundle, preload its startup files, drop the preloads of what is inside
const pre = indent => [...statics].map(f => `${indent}<link rel="modulepreload" href="${rel(f)}">`).join('\n');
let placed = false;
html = html.replace(/^([ \t]*)<link\b[^>]*rel=["']modulepreload["'][^>]*>[ \t]*\n/gim, (line, indent) => {
  const href = /\bhref=["']([^"']+)["']/.exec(line)?.[1];
  if (!href || !isInside(href)) return line;
  return placed ? '' : ((placed = true), pre(indent) + '\n');
});
// each entry and each literal import() by its page URL, quoted anywhere in the page (a <script src>, an inline
// preload hint like pre('js/demo.js')), now names its bundle file
for (const f of files) {
  const ep = outputs[f].entryPoint;
  if (!ep || ep.startsWith('core:')) continue;
  const abs = path.resolve(dir, ep);
  const urls = [path.relative(dir, abs), path.relative(path.join(dir, 'public'), abs)].filter(u => !u.startsWith('..')).map(u => u.split(path.sep).join('/'));
  for (const u of urls) for (const q of ['"', "'"]) html = html.split(q + u + q).join(q + rel(f) + q).split(q + './' + u + q).join(q + rel(f) + q);
}
if (!placed) html = html.replace(/^([ \t]*)(<script\b[^>]*type=["']module["'][^>]*\bsrc=)/im, (m, indent, tag) => `${pre(indent)}\n${indent}${tag}`);
fs.writeFileSync(pagePath, html);

// the service worker: save the bundle instead of the files inside it
if (swArg) {
  const swPath = path.resolve(swArg);
  const sw = fs.readFileSync(swPath, 'utf8');
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!shell) throw new Error(`bundle: ${swArg} has no SHELL list`);
  const listed = [...shell[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const kept = listed.filter(u => u === './' || !isInside(u));
  const add = files.map(rel);
  const list = [...new Set([...kept, ...add])];
  fs.writeFileSync(swPath, sw.replace(shell[0], `const SHELL = [\n${list.map(u => `  '${u}',`).join('\n')}\n];`));
  console.log(`bundle: ${swArg} SHELL: ${listed.length - kept.length} files now inside the bundle, ${add.length} bundle files added`);
}
console.log(`bundle: ${page} starts ${scripts.map((s, i) => rel(entryOut(entries[i]))).join(', ')}`);
