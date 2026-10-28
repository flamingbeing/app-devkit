// Slow-phone profile for the nightly soak, loaded into every Playwright process with
//   NODE_OPTIONS="--import ./.devkit/playwright/soak-slow.mjs"
// Every page gets CPU 4x slower and fast-3G-like network (Chromium DevTools protocol), so timing assumptions that only
// hold on a fast runner fail here. SOAK_BLIPS=1 adds short offline blips (1.5 s every 20 s); off by default because a
// spec that goes offline on purpose would fight them. Nothing happens unless SOAK_SLOW=1.
import { chromium } from 'playwright-core';

const CPU_RATE = Number(process.env.SOAK_CPU_RATE || 4);
// DevTools "Fast 3G": 1.6 Mbit/s down (200 kB/s), 750 kbit/s up, 150 ms round trip. "Slow 3G" (50 kB/s) was tried first:
// the app shell alone took longer than the specs' 10 s waits, so every test failed on every run and showed nothing.
// SOAK_DOWN_KBPS / SOAK_UP_KBPS / SOAK_LATENCY_MS override it.
const NETWORK = {
  offline: false,
  latency: Number(process.env.SOAK_LATENCY_MS || 150),
  downloadThroughput: Number(process.env.SOAK_DOWN_KBPS || 200) * 1024,
  uploadThroughput: Number(process.env.SOAK_UP_KBPS || 94) * 1024,
};

async function slow(context) {
  context.on('page', async page => {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', NETWORK);
    } catch { /* page closed while attaching */ }
  });
  if (process.env.SOAK_BLIPS === '1') {
    const timer = setInterval(async () => {
      try { await context.setOffline(true); await new Promise(r => setTimeout(r, 1500)); await context.setOffline(false); }
      catch { clearInterval(timer); }
    }, 20_000);
    timer.unref();
    context.on('close', () => clearInterval(timer));
  }
}

if (process.env.SOAK_SLOW === '1' && !chromium.__soakSlow) {
  chromium.__soakSlow = true;
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...a) => { const ctx = await newContext(...a); await slow(ctx); return ctx; };
    return browser;
  };
}
