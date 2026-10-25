// A plain Playwright script, the way the apps' own e2e scripts launch Chromium (no @playwright/test).
// argv[2]: 'load' (imports the pinned engine), 'stale' (the script itself serves an older engine for the pinned URL,
// as a cached copy would), 'none' (never loads the engine), 'sw' (a service worker stores the engine at install and
// the page runs it from that cache after a reload).
const pw = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const { chromium } = pw.default || pw;
const mode = process.argv[2];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
const html = mode === 'none' ? '<p>no engine</p>' : `<script type="module">
  import { VERSION, part } from 'https://core.anawj.com/sync/0.6.3/index.js';
  import { label } from 'https://core.anawj.com/update/0.2.0/register.js';
  window.got = { VERSION, part, label };
</script>`;
const SW = `const U = 'https://core.anawj.com/sync/0.6.3/index.js';
self.addEventListener('install', e => e.waitUntil(caches.open('c').then(c => c.add(U)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => { if (e.request.url === U) e.respondWith(caches.match(U)); });`;
const swPage = `<script type="module">
  if (!navigator.serviceWorker.controller) {
    await navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  } else {
    const { VERSION, part } = await import('https://core.anawj.com/sync/0.6.3/index.js');
    window.got = { VERSION, part, label: 'sw' };
  }
</script>`;
await page.context().route('https://app.test/**', r => r.request().url().endsWith('/sw.js')
  ? r.fulfill({ contentType: 'text/javascript', body: SW })
  : r.fulfill({ contentType: 'text/html', body: mode === 'sw' ? swPage : html }));
if (mode === 'stale') await page.context().route(/core\.anawj\.com\/sync\/[^/]+\/index\.js$/, r => r.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: "export const VERSION = '0.0.1-old'; export const part = 'old';" }));
await page.goto('https://app.test/');
if (mode !== 'none') await page.waitForFunction(() => window.got, null, { timeout: 20_000 });
console.log(JSON.stringify(await page.evaluate(() => window.got || null)));
await browser.close();
