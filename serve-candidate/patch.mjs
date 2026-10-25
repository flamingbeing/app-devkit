// serve-candidate preload (node --import): every Playwright browser context this process opens serves
// <SERVE_CANDIDATE_ORIGIN>/sync/<any>/<file> from SERVE_CANDIDATE_SYNC and /update/<any>/<file> from
// SERVE_CANDIDATE_UPDATE, so an app's own browser tests run on a candidate engine with no change to the app.
// Before a page or context closes, the page imports each engine index.js it asked for and the VERSION it really
// got is written to SERVE_CANDIDATE_LOG (one JSON line per context); report.mjs turns that into the row's result.
// Works for @playwright/test and plain scripts, for any copy of Playwright the process loads (local or global).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DIRS = { sync: process.env.SERVE_CANDIDATE_SYNC, update: process.env.SERVE_CANDIDATE_UPDATE };
const LOG = process.env.SERVE_CANDIDATE_LOG;
const ORIGIN = (process.env.SERVE_CANDIDATE_ORIGIN || '').replace(/\/+$/, '');
const esc = ORIGIN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const CORE = new RegExp(`^${esc}/(sync|update)/([^/]+)/([^?#]*)`);
const INDEX = new RegExp(`^${esc}/sync/[^/]+/index\\.js(?:[?#]|$)`);
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
const DONE = Symbol.for('serve-candidate');
const open = new Set();
// A service worker's own fetches (its install list) skip context routes unless this is on (Chromium); without it the
// worker caches the live engine and the page runs that after the first reload.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';

function record(state) {
  if (state.written || !LOG) return;
  for (const page of state.pages) for (const url of page[DONE] || []) state.unchecked.push(url);
  state.written = true;
  const { written, pinned, pages, ...line } = state;
  fs.appendFileSync(LOG, JSON.stringify({ ...line, pinned: [...pinned] }) + '\n');
}

async function checkPage(state, page) {
  for (const url of page[DONE] || []) {
    if (page.isClosed()) return;
    const version = await Promise.race([
      page.evaluate(u => import(u).then(m => String(m.VERSION), e => 'error: ' + e.message), url),
      new Promise(r => setTimeout(r, 5000, 'error: timed out')),
    ]).catch(e => 'error: ' + String(e.message).split('\n')[0]);
    state.checked.push({ url, version });
  }
  page[DONE] = new Set();
}

async function attach(context) {
  if (!context || context[DONE] || !ORIGIN || !DIRS.sync) return context;
  const state = { pid: process.pid, served: { sync: 0, update: 0 }, pinned: new Set(), notFound: [], checked: [], unchecked: [], pages: new Set() };
  context[DONE] = state;
  open.add(state);
  await context.route(CORE, route => {
    const [, kind, pinned, rel] = route.request().url().match(CORE);
    const root = DIRS[kind];
    if (!root) return route.continue();
    const file = path.resolve(root, rel || 'index.js');
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      state.notFound.push(`${kind}/${rel}`);
      return route.fulfill({ status: 404, body: 'not in the candidate' });
    }
    state.served[kind]++;
    if (kind === 'sync') state.pinned.add(pinned);
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: fs.readFileSync(file) });
  });
  const watch = page => {
    if (page[DONE]) return;
    page[DONE] = new Set();
    state.pages.add(page);
    // the exact URL (a query string makes another module); a page closed some other way counts as unchecked
    page.on('request', req => { if (INDEX.test(req.url())) page[DONE].add(req.url().replace(/#.*$/, '')); });
    page.on('close', () => { for (const url of page[DONE]) state.unchecked.push(url); page[DONE].clear(); });
    const close = page.close.bind(page);
    page.close = async (...a) => { await checkPage(state, page); return close(...a); };
  };
  context.pages().forEach(watch);
  context.on('page', watch);
  const close = context.close.bind(context);
  context.close = async (...a) => {
    if (!state.written) for (const page of context.pages()) await checkPage(state, page);
    record(state);
    open.delete(state);
    return close(...a);
  };
  return context;
}

function wrapBrowser(browser) {
  if (!browser || browser[DONE]) return browser;
  browser[DONE] = true;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => attach(await newContext(...a));
  const close = browser.close.bind(browser);
  browser.close = async (...a) => { for (const c of browser.contexts()) if (c[DONE]) await c.close(); return close(...a); };
  return browser;
}

function patch(core) {
  const proto = core && core.chromium && Object.getPrototypeOf(core.chromium);
  if (!proto || proto[DONE]) return;
  proto[DONE] = true;
  for (const name of ['launch', 'connect', 'connectOverCDP']) {
    const orig = proto[name];
    if (orig) proto[name] = async function (...a) { return wrapBrowser(await orig.apply(this, a)); };
  }
  const persistent = proto.launchPersistentContext;
  if (persistent) proto.launchPersistentContext = async function (...a) { return attach(await persistent.apply(this, a)); };
}

// Every playwright-core this process can reach: the project's own (directly, or under playwright / @playwright/test),
// PLAYWRIGHT_PATH / PW_PATH, and the global one. Loading it here puts it in the require cache the tests then share.
const from = [path.join(process.cwd(), 'x.js')];
for (const p of [process.env.PLAYWRIGHT_PATH, process.env.PW_PATH]) {
  if (p) from.push(path.join(fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : path.dirname(p), 'x.js'));
}
from.push(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'x.js'));
for (const base of from) {
  for (const chain of [['playwright-core'], ['playwright', 'playwright-core'], ['@playwright/test', 'playwright', 'playwright-core']]) {
    try {
      let at = base;
      for (const name of chain) at = createRequire(at).resolve(name);
      patch(createRequire(at)(at));
    } catch { /* not installed there */ }
  }
}
process.on('exit', () => { for (const state of open) record(state); });
if (!ORIGIN || !DIRS.sync) console.warn('serve-candidate: SERVE_CANDIDATE_ORIGIN and SERVE_CANDIDATE_SYNC must be set; nothing is swapped');
