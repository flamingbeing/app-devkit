# app-devkit

Small, reusable GitHub Actions pieces for web apps: five **building blocks** (composite actions) for CI, and two
**reusable workflows** for deploys. Each app keeps its own test commands; this repo only holds the repeated setup.

## Versions and pinning

- `@v1` moves to the newest `v1.x.y`. Fine for apps where a surprise is cheap.
- `@v1.x.y` is exact and never moves. **Use it for apps that real people depend on**, and bump it on purpose after the
  app's own checks pass.
- A breaking change becomes `v2`; `v1` keeps working.

## Building blocks

All five run on `ubuntu-24.04` (pin your jobs there too: `ubuntu-latest` can move to a release your pinned Playwright
cannot install on). Call them after `actions/checkout`.

### `setup-node`

```yaml
- uses: flamingbeing/app-devkit/setup-node@v1
  with:
    node-version: '22'        # default
    working-directory: '.'    # folder with package.json / package-lock.json
    install: 'true'           # npm ci when a lockfile exists
```

### `changed-files`

Says whether a pull request changes any app file, so a browser job can skip its steps in seconds on a docs-only PR. The
job still runs and succeeds (a required check never hangs); pushes and unclear cases report `app=true`. Use it inside the
job after checkout, never as a trigger-level `paths` filter.

```yaml
- uses: actions/checkout@...
- id: changes
  uses: flamingbeing/app-devkit/changed-files@v1
- if: steps.changes.outputs.app == 'true'
  uses: flamingbeing/app-devkit/setup-node@v1
# ...every later step carries the same `if:`
```

`ignore` (default `*.md`, `docs/*`, `LICENSE`) and `keep` (default `app/*`, `e2e/*`, `fixtures/*`, checked first) are
newline-separated shell patterns (whitespace is trimmed). Markdown outside `keep` counts as docs: list any folder whose
Markdown the app serves or the tests read.

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
    firebase-tools-version: '15.33.0'   # default; also the cache key
    emulators: firestore                # comma list; only emulators with a jar to download are fetched
    java-version: '21'
```

`setup-browser` copies the kit's `playwright/`, `rules/`, `tools/` and `worker/` into `.devkit/` (input `devkit-dir`, empty =
skip), at the same ref the action runs from; `setup-emulators` does the same when you pass `devkit-dir: .devkit` (off by
default), for a rules-only job. Add `.devkit/` to `.gitignore`.

### `setup-tools`

Only copies the kit's folders into `.devkit/` (no Node, browser or emulators), for jobs that run a tool and nothing else.

```yaml
- uses: flamingbeing/app-devkit/setup-tools@v1
- run: node .devkit/tools/check.mjs
```

### `serve-candidate`

For the engine's own CI: run an app's browser tests on a candidate engine build, with no change to the app. Every
Playwright browser context in a step that sets `NODE_OPTIONS` to the block's `node-options` output (`@playwright/test` or a plain script; any Playwright copy
the process loads) serves `<origin>/sync/<any version>/` from `sync-dir` and `/update/<any version>/`
from `update-dir`, a service worker's own fetches included. Files the candidate lacks answer 404 (logged), never the
live copy.

Proof, not trust: before each page or context closes, the page imports every engine `index.js` it asked for and the
`VERSION` it really ran is logged. `report.mjs` passes a row only when at least one page was checked, every checked
page ran the candidate (a stale cache or a live fallback shows as another version), no page that asked for the engine
closed unchecked, and no engine file asked for was missing from the candidate. Contexts are new browser
profiles, so no service worker from an earlier run is in the way.

```yaml
- uses: flamingbeing/app-devkit/serve-candidate@v1.9.0
  id: candidate
  with:
    origin: https://core.example.com   # the engine's origin, as the app pins it
    sync-dir: candidate            # the engine checkout
    update-dir: candidate/update   # empty = the live update module
- run: npx playwright test
  env:
    NODE_OPTIONS: ${{ steps.candidate.outputs.node-options }}   # GitHub refuses NODE_OPTIONS through GITHUB_ENV
- run: node "${{ steps.candidate.outputs.kit }}/report.mjs" "${{ steps.candidate.outputs.log }}" --row my-app --expect "${{ steps.candidate.outputs.version }}"
- run: node "${{ steps.candidate.outputs.kit }}/shell.mjs" --files candidate/files.json --origin https://core.example.com --row my-app .
```

- `report.mjs <log> --row <name> --expect <version>`: one markdown row `| row | pass/fail | expected | pinned | note |`
  (also added to the job summary); exit 1 on fail.
- `shell.mjs --files <files.json> --origin <url> [--row <name>] [--strict] <dir>…`: for each `sw.js`, the engine files its list
  misses (not stored offline) or names that the build lacks (the install fails). Reports only; `--strict` exits 1.

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

- `check.mjs`: repo checks (service-worker `VERSION` and cache rules, SHELL files exist, `wrangler.jsonc` keeps preview links
  off, Worker tests). Run from the repo root.
- `proofread.mjs [--live] [--md]`: mistakes no app test looks for (lang, title, viewport, noindex, alt text, links to files; a file missing next to the page is also looked for in `<page folder>/public/`).
- `shots.mjs pages <base-ref> | shoot <url> <out-dir> <name> <path>…`: phone screenshots for a visual change.
- `step-timings.mjs <owner/repo> <run-id>`: job and step durations, to compare CI before and after a change.
- `check-links.mjs [folder]`: fails on a relative link or `#anchor` in `.md`/`.html` that points nowhere (a file missing next to the page is also looked for in `<page folder>/public/`).
- `starter-drift.mjs --template <checkout> [--app .] [--json] [--strict]`: for an app made from a starter template (its
  `.starter.json` records the template version, commit and the app's values), lists the template's files the app has
  changed or lacks, comparing each with the template file filled for this app (the template's `tools/fill.mjs`
  `swapsFor`). Reports only, never writes; `--strict` exits 1 on any drift.

## Rules kit

Shared Firestore rules helpers, a builder and an emulator test suite, for apps whose roles come from **custom claims**
(a cache of the app's role docs, which stay the source of truth):

```text
{ g: { <groupId>: <role> },   // one role per group; a single-group app uses the key '_'
  x: <unix seconds>,          // access ends (absent = no end)
  v: <int>,                   // claims version, bumped when the role docs change
  m: <string> }               // sign-in method, for the record only
```

### Helpers (`rules/common.rules`)

| Helper | True when | Document lookups |
| --- | --- | --- |
| `isSignedIn()` | there is a token | 0 |
| `role(gid)` | (returns) the role for `gid`, or `''` | 0 |
| `inGroup(gid)` | any role in `gid` | 0 |
| `hasRole(gid, roles)` | the role for `gid` is in `roles` (never `''`) | 0 |
| `live()` | signed in and `x` is absent or later than now; a malformed `x` fails closed | 0 |
| `notRevoked()` | signed in and there is no `revoked/{uid}` document | 1 |
| `can(gid, roles)` | `hasRole && live && notRevoked`; the lookup runs only when the role fits | 0-1 |
| `roleOrDoc(gid, docRole)` | (returns) the claim when present, else `docRole` | whatever `docRole` costs, always |
| `stamped()` | the write sets `serverAt` to `request.time` | 0 |
| `stampOk()` | `serverAt` is absent or `request.time` (while old clients write without it) | 0 |
| `stampKept()` | on update, `serverAt` is exactly what the stored document has (older clients' partial updates) | 0 |
| `notFuture(field)` | `field` is a timestamp not after `request.time` | 0 |
| `authorIs(field)` | signed in and `field` is the caller's uid | 0 |

`stampKept()` is a migration aid: an older client that sends no `serverAt` keeps the old one, so readers that fetch only
documents changed after a `serverAt` (server mode) see that edit at their next full read (weekly, for apps that run
one). Drop it once every client stamps. `notFuture` also refuses a client clock ahead of the server; write
`request.time` (server timestamp) where that matters.

No email is used in authorisation. Keep `revoked/` closed to clients (no `match` for it): the app's server writes
`revoked/{uid}` when a member is removed and deletes it after re-issuing claims.

Rules functions take their arguments already evaluated, so a `get()` passed to `roleOrDoc` is read even when the claim
decides. To skip that read, write the migration form inline:
`role(g) != '' ? role(g) : get(/databases/$(database)/documents/groups/$(g)/members/$(request.auth.uid)).data.role`
(as in `rules/examples/multi-group/`).

### Building (`tools/build-rules.mjs`)

Rules have no imports, so you keep your rules in `firestore.app.rules` with one line `// devkit:common` inside
`match /databases/{database}/documents { … }`, and the builder pastes the helpers there:

```bash
node .devkit/tools/build-rules.mjs firestore.app.rules           # writes firestore.rules
node .devkit/tools/build-rules.mjs firestore.app.rules --check   # in CI: fails if firestore.rules is stale
```

Commit the built `firestore.rules` (deploys and the emulator use exactly that). `--common <file>` points at another copy.

### Test suite (`rules/suite.mjs`)

No dependencies. `suite(config)` registers `node:test` cases per collection: signed out denied; each allowed role
allowed (so the denials mean something); other roles and no role denied; a role in another group only denied
(multi-group); `x` in the past denied and in the future allowed; a revoked uid denied; `serverAt` checks
(`strict`/`lenient`); document lookups per read and create within budget (default 1, at most 2); `revoked/` closed;
and, with `fallback`, a user with no claim but a role doc gets that role while a claim wins over the doc.

List rules are tested when a collection has `list: { roles, filter? }`: a signed-out user, a signed-in user with no
role and every role outside `roles` is denied an unfiltered list; `roles` may list. With `filter: { field }` (rules that
read `resource.data.<field>`) the listing roles must filter on their own group's value, and an unfiltered query, another
group's value, or a role in another group only is denied, so the filter field mirrors the source of the role.
`listOnly: true` runs just these cases (see `entries/e1` in `rules/examples/multi-group/rules.test.mjs`).

```js
// rules.test.mjs
import { readFileSync } from 'node:fs';
import { suite } from './.devkit/rules/suite.mjs';

const emu = suite({
  project: 'demo-myapp',                       // must start with demo-; one project per test file
  rules: readFileSync('firestore.rules', 'utf8'),
  roles: ['admin', 'member', 'guest'],
  collections: [
    { path: 'notes/n1', read: ['admin', 'member', 'guest'], write: ['admin', 'member'],
      data: { text: 'hello' }, stamp: 'strict' },                 // '{g}' in the path marks a group id
  ],
  // fallback: { role: 'member', seed: (uid, g) => [[`groups/${g}/members/${uid}`, { role: 'member' }]] },
});
// your own cases beside it: emu.seed(path, data), emu.as(uid, claims).get/list/create/update/set/delete(path, …),
// emu.anon(), emu.clear(), emu.lookups(() => oneRequest)
```

Run it inside the emulator:

```bash
firebase emulators:exec --only firestore --project demo-myapp "node --test rules.test.mjs"
```

`emu.lookups(fn)` counts the distinct documents the rules looked up while `fn` ran (from the emulator's coverage report),
as Firestore counts them per request. Worked examples: `rules/examples/single-group/` and `rules/examples/multi-group/`.

## Claims Worker modules

Two plain ES modules for a Cloudflare Worker (Web Crypto and `fetch`, no dependencies) that set the rules kit's claims.
Copy `worker/custom-token.js` and `worker/claims.js` into the app's Worker folder and keep their version line; to check a
copy is unchanged in CI, `diff` it against `.devkit/worker/`.

**Secrets** (Worker secrets, never in a repo): a service account's email and PEM private key, for one Firebase
project. For custom tokens alone it needs no roles (it only signs). For `/api/claims` and `revoke` it must manage
Firebase Auth users and write Firestore (`revoked/`, and whatever `loadClaims` reads).

### Link, passcode and anonymous sign-in (`worker/custom-token.js`)

The app's own route checks the link or code, then answers a custom token; the page calls `signInWithCustomToken`.

```js
import { customToken, randomUid } from './custom-token.js';
const sa = { email: env.SA_EMAIL, key: env.SA_KEY };
const token = await customToken(sa, randomUid('g'), { m: 'link', g: { _: 'guest' }, x: link.endsAt, v: 1 });
```

- `claimsShape(claims)` checks the shape (only `m`, `g`, `x`, `v`; at most 20 groups; group ids and roles
  `[A-Za-z0-9_-]`; `x` in seconds; 1000 bytes at most) and throws otherwise. `customToken` calls it.
- These claims stay on that sign-in across ID token refreshes (tested in the emulator). New claims need a new token and
  a new sign-in, and they **win over** claims written on the account, so do not mix the two for one user.

### Accounts (`worker/claims.js`)

For Google, email-link and password users. The page posts its ID token, the Worker writes the claims on the account,
and the page calls `getIdToken(true)` (at sign-in, and whenever the role doc's `v` is ahead of the token's).

```js
import { admin, handleClaims } from './claims.js';
const adm = env.SA_KEY ? admin({ project: env.FIREBASE_PROJECT, sa: { email: env.SA_EMAIL, key: env.SA_KEY } }) : null;
if (url.pathname === '/api/claims') return handleClaims(request, {
  admin: adm, origin: 'https://app.example.com', limit: env.CLAIMS_LIMIT,
  // the app's role docs are the source of truth; null = no longer a member (claims cleared)
  loadClaims: async ({ uid, admin }) => {
    const d = await admin.getDoc(`members/${uid}`);
    return d ? { g: { _: d.role }, v: d.v } : null;
  },
});
```

- If `loadClaims` finds the role by email (old email-keyed docs), require `token.email_verified`: anyone can create a
  password account with someone else's address.
- `verifyIdToken(idToken, { project })`: RS256 against Google's published keys (cached by `max-age`), audience,
  issuer, expiry. Unsigned emulator tokens only with `emulator: true` and a `demo-` project.
- `handleClaims` answers `{ claims }`, or `{ error }` with 405, 503 (not set up), 403 (other origin), 429, 401 (no or
  bad token), 409 (a custom-token sign-in: its claims come with the token) or 500. It deletes `revoked/{uid}` after
  re-issuing for a member.
- `admin(...)`: `setClaims(uid, claims)` (`{}` clears), `revoke(uid)` (writes `revoked/{uid}`, clears claims, ends
  refresh tokens), `revokeSessions`, `markRevoked`, `clearRevoked`, `getDoc`, `setDoc`, `deleteDoc`. With
  `emulator: { auth, firestore }` (a `demo-` project) it talks to the emulators instead and needs no service account.

**Revocation:** an ID token keeps its claims for up to an hour. `revoke(uid)` makes the rules' `notRevoked()` refuse at
once and stops the refresh tokens; the Auth emulator does not enforce the last part, so the tests prove the
`revoked/{uid}` path. Tests: `worker/test/` (unit, and `emulator.test.mjs` with the Auth and Firestore emulators and the
single-group example's rules).

## Reusable workflows

### `deploy-worker.yml`

Deploys a Cloudflare Worker with an exact wrangler version (input `wrangler-version`, default `4.152.0`). Without the two Cloudflare secrets the run says so and **skips**. A
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
secrets needed), `wrangler-version` (exact, default `4.152.0`), `smoke-url` (fetched with `curl -fsS` after the deploy;
empty = none).

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

Other inputs: `only` (`firestore:rules`), `firebase-tools-version` (`13`). Optional checks, all off by default, run
before the sign-in (a failure stops the run): `test-command` (in `working-directory`, e.g. the rules tests through
`firebase emulators:exec`), `build-rules-check` (path of the app rules source; fails if the built `firestore.rules` is
stale; it fetches the builder at `devkit-ref`, default `v1`, so set it to your pin), `node-version` (22) and `dry-run`
(checks only, no deploy).

### `live-smoke.yml`

Signs the app's test user in on the deployed site and runs the app's own Playwright spec for the signed-in, no-data
state (the test user is in no app data, so nothing is read or written). Without both secrets the run says so and **skips**;
the credentials only travel in the environment and are never printed. Call it by hand and after Deploy:

```yaml
name: Live smoke
on:
  workflow_dispatch:
  workflow_run: { workflows: [Deploy], types: [completed], branches: [main] }
permissions:
  contents: read
jobs:
  smoke:
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    uses: flamingbeing/app-devkit/.github/workflows/live-smoke.yml@v1
    with:
      site-url: https://myapp.example.com
      spec-path: e2e/live                       # a spec file or folder, relative to working-directory
      firebase-config-file: app/config.js       # optional: has apiKey; checks the sign-in through the API first
      checkout-ref: ${{ github.event.workflow_run.head_sha }}   # empty on a manual run
    secrets:
      test-email: ${{ secrets.MYAPP_TEST_EMAIL }}
      test-password: ${{ secrets.MYAPP_TEST_PASSWORD }}
```

Other inputs: `firebase-api-key` (instead of the config file), `playwright-version` (`1.56.1`, match the lockfile),
`node-version` (22), `working-directory` (`.`). The spec gets `baseURL` = `site-url` and the environment variables
`LIVE_URL`, `LIVE_TEST_EMAIL`, `LIVE_TEST_PASSWORD`. In the spec, `playwright/live.mjs` gives `liveUser()` and
`watchConsole(page, { ignore })` (collects page and console errors, ignoring Firestore refusing a no-data user) and, for an app with no email + password form, `signInViaApi(page, { apiKey, email, password })` (signs in through the REST API with the site as `Referer`, so a web key restricted to the site's referrers accepts it, and stores the user where the Firebase SDK looks for it; `page.goto('/')` first, `page.reload()` after):

```js
import { test, expect } from '@playwright/test';
import { liveUser, watchConsole } from '../.devkit/playwright/live.mjs';
const { email, password } = liveUser();
test.skip(!email || !password, 'no test user');
test('signs in', async ({ page }) => { const errors = watchConsole(page); /* sign in through the app's own UI */ expect(errors).toEqual([]); });
```

Run by hand: `LIVE_URL=https://… LIVE_SPEC=e2e/live LIVE_TEST_EMAIL=… LIVE_TEST_PASSWORD=… npx playwright test -c .devkit/playwright/live.config.mjs`.

### `soak.yml`

The nightly soak: the browser tests many times (default 20 normal runs plus 10 under a slow-phone profile: CPU 4x, slow
3G, 180 s test timeout; no retries), optionally `unit-command` x100 and `chaos-command` / `model-command` with tonight's
`SOAK_SEED` (date) and `SOAK_SEED_N` (a new range of 10 seeds per night). Failures go to ONE open issue titled
`Nightly soak` per repo, rewritten in place (failing test, count, run link) and closed after 7 clean nights. Plain
Actions, no model, never a required check. The caller needs `permissions: { contents: read, issues: write }`:

```yaml
name: Nightly soak
on:
  schedule: [{ cron: '30 18 * * *' }]   # 02:30 SGT
  workflow_dispatch:
permissions: { contents: read, issues: write }
jobs:
  soak:
    uses: flamingbeing/app-devkit/.github/workflows/soak.yml@v1.13.6
    with: { emulators: 'firestore,auth' }   # empty for an app with no emulators
```

Inputs: `emulators`, `test-command` (`npx playwright test`), `repeat` (10), `slow-repeat` (5), `batch` (5: runs per Playwright invocation, so the emulators are emptied between batches), `blips` (false: short
offline blips in the slow runs; a spec that goes offline on purpose can fight them), `unit-command`, `unit-repeat`
(100), `chaos-command`, `model-command`, `kit-ref` (the scripts' tag), `playwright-version`, `node-version`.

## Speed recipe the blocks follow

No `--with-deps`; `ubuntu-24.04`; caches for the browser and emulator downloads; `concurrency` and `timeout-minutes`
on every job. Run independent checks as parallel jobs.

## Releasing

Bump `version` in `package.json`, add a CHANGELOG entry, merge with CI green. `release.yml` then tags `vX.Y.Z` (an
existing tag is never moved) and points `vX` at the newest release of that major.

## Checking a repo's pins

`node scripts/check-pins.mjs [repo-dir] [--latest vX.Y.Z]` lists every `flamingbeing/app-devkit/...@ref` in the repo's
`.github/` against the latest release tag (read with `git ls-remote` unless `--latest` is given); exit 1 when one is
behind. `@v1` always counts as current.
