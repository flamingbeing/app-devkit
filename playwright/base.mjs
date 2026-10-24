// Shared Playwright Test settings. Plain objects only (no @playwright/test import), so it loads from any folder.
//
//   import { baseConfig } from './.devkit/playwright/base.mjs';   // .devkit/ is put there by setup-browser
//   export default { ...baseConfig({ testDir: 'e2e', projects: ['phone'] }) };
//
// `projects` picks from: phone (390 x 844, touch) and desktop (1280 x 800). Everything else passed in wins.

export const phone = {
  name: 'phone',
  use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
export const desktop = {
  name: 'desktop',
  use: { viewport: { width: 1280, height: 800 } },
};
const PROJECTS = { phone, desktop };

export function baseConfig({ projects = ['phone', 'desktop'], use = {}, ...rest } = {}) {
  const CI = !!process.env.CI;
  return {
    fullyParallel: true,
    forbidOnly: CI,
    retries: CI ? 1 : 0,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: CI ? [['github'], ['list']] : 'list',
    use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', ...use },
    projects: projects.map(p => {
      if (!PROJECTS[p]) throw new Error(`unknown project '${p}' (phone, desktop)`);
      return PROJECTS[p];
    }),
    ...rest,
  };
}
