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

`setup-browser` copies the kit's `playwright/`, `rules/`, `tools/` and `worker/` into `.devkit/` (input `devkit-dir`, empty =
skip), at the same ref the action runs from; `setup-emulators` does the same when you pass `devkit-dir: .devkit` (off by
default), for a rules-only job. Add `.devkit/` to `.gitignore`.

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

## Speed recipe the blocks follow

No `--with-deps`; `ubuntu-24.04`; caches for the browser and emulator downloads; `concurrency` and `timeout-minutes`
on every job. Run independent checks as parallel jobs.

## Releasing

Bump `version` in `package.json`, add a CHANGELOG entry, merge with CI green. `release.yml` then tags `vX.Y.Z` (an
existing tag is never moved) and points `vX` at the newest release of that major.
