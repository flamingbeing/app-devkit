# app-devkit

Small, reusable GitHub Actions pieces for web apps: three **building blocks** (composite actions) for CI, and two
**reusable workflows** for deploys. Each app keeps its own test commands; this repo only holds the repeated setup.

## Versions and pinning

- `@v1` moves to the newest `v1.x.y`. Fine for apps where a surprise is cheap.
- `@v1.x.y` is exact and never moves. **Use it for apps that real people depend on**, and bump it on purpose after the
  app's own checks pass.
- A breaking change becomes `v2`; `v1` keeps working.

## Building blocks

All three run on `ubuntu-24.04` (pin your jobs there too: `ubuntu-latest` can move to a release your pinned Playwright
cannot install on). Call them after `actions/checkout`.

### `setup-node`

```yaml
- uses: flamingbeing/app-devkit/setup-node@v1
  with:
    node-version: '22'        # default
    working-directory: '.'    # folder with package.json / package-lock.json
    install: 'true'           # npm ci when a lockfile exists
```

### `setup-browser`

Playwright Chromium only, **without** `--with-deps` (the apt step is the slow part; the runner image already has the
libraries), with the download cached.

```yaml
- uses: flamingbeing/app-devkit/setup-browser@v1
  with:
    playwright-version: '1.56.1'   # exact; empty = the project's own `npx playwright` (run setup-node first)
    browsers: chromium             # default
```

### `setup-emulators`

Java 21, a pinned firebase-tools, and the emulator jars cached and fetched up front.

```yaml
- uses: flamingbeing/app-devkit/setup-emulators@v1
  with:
    firebase-tools-version: '13.29.1'   # default; also the cache key
    emulators: firestore                # comma list; only emulators with a jar to download are fetched
    java-version: '21'
```

Also copies the kit's `playwright/` and `tools/` into `.devkit/` (input `devkit-dir`, empty = skip), at the same ref
the action runs from. Add `.devkit/` to `.gitignore`.

## Playwright base, helpers and tools

Plain ES modules with no dependencies, imported from `.devkit/` after `setup-browser` (so a repo with no `package.json`
works too). Locally, copy the folders once or point the import at a checkout of this repo.

```js
// playwright.config.mjs
import { baseConfig } from './.devkit/playwright/base.mjs';
import { emulatorServer } from './.devkit/playwright/helpers.mjs';
export default baseConfig({
  testDir: 'e2e',
  projects: ['phone'],                          // phone (390 x 844, touch), desktop (1280 x 800); default both
  webServer: emulatorServer({ project: 'demo-myapp', only: 'firestore,auth', cwd: 'app' }),
  globalSetup: './global-setup.mjs',            // export default () => waitForEmulators()
});
```

`baseConfig` sets parallel tests, 1 retry in CI (0 locally; override with `retries`), trace and screenshot on failure,
and lets anything you pass win. Helpers: `waitFor(fn)` and `waitForState(page, fn)` wait for a state instead of a sleep;
`fsAdmin(project)` seeds, reads and clears Firestore emulator documents (skips the rules); `createTestUser(project,
email)` makes or signs in an Auth emulator account; `emulatorServer` refuses a project that is not `demo-`.

Tools (run with `node .devkit/tools/<name>.mjs`):

- `step-timings.mjs <owner/repo> <run-id>`: job and step durations, to compare CI before and after a change.
- `check-links.mjs [folder]`: fails on a relative link or `#anchor` in `.md`/`.html` that points nowhere.

## Reusable workflows

### `deploy-worker.yml`

Deploys a Cloudflare Worker with `wrangler@4`. Without the two Cloudflare secrets the run says so and **skips**. A
byte-order mark or trailing CR/LF on either secret is stripped first (it otherwise makes wrangler fail).

```yaml
name: Deploy
on:
  push:
    branches: [main, beta]
  workflow_dispatch:
jobs:
  deploy:
    uses: flamingbeing/app-devkit/.github/workflows/deploy-worker.yml@v1
    with:
      install: true                          # npm ci first (default false)
      build-command: npm run build           # default: none
      stamp-command: node tools/stamp.mjs    # default: none; runs after the build
      beta-env: true                         # a push to `beta` deploys the Worker's `beta` environment
    secrets: inherit                         # CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
```

Other inputs: `node-version` (22), `working-directory` (`.`), `dry-run` (build and `wrangler deploy --dry-run`, no
secrets needed).

### `deploy-rules.yml`

Deploys Firestore rules (or any `firebase deploy --only` target) with keyless Workload Identity sign-in. The caller must
grant `id-token: write`. Until all three values are passed the run **skips**.

```yaml
name: Deploy Firestore rules
on:
  push:
    branches: [main]
    paths: ['myapp/firestore.rules']
permissions:
  contents: read
  id-token: write
jobs:
  deploy:
    uses: flamingbeing/app-devkit/.github/workflows/deploy-rules.yml@v1
    with:
      working-directory: myapp              # its firebase.json names the rules
      firebase-project: ${{ vars.FIREBASE_PROJECT }}
      wif-provider: ${{ vars.WIF_PROVIDER }}
      rules-deployer: ${{ vars.RULES_DEPLOYER }}
```

Other inputs: `only` (`firestore:rules`), `firebase-tools-version` (`13`).

## Speed recipe the blocks follow

No `--with-deps`; `ubuntu-24.04`; caches for the browser and emulator downloads; `concurrency` and `timeout-minutes`
on every job. Run independent checks as parallel jobs.

## Releasing

Bump `version` in `package.json`, add a CHANGELOG entry, merge with CI green. `release.yml` then tags `vX.Y.Z` (an
existing tag is never moved) and points `vX` at the newest release of that major.
