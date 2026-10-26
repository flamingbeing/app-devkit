# Changelog

Versions are tags: `v1.x.y` never moves once released; `v1` always points at the newest `v1.x.y`. A breaking change
becomes `v2`.

## 1.10.3

- `live-smoke.yml` uses `setup-browser@v1.10.2` (and `setup-node@v1.10.2`): `setup-browser` copies `playwright/` from its
  own tag, so 1.10.2's workflow still ran 1.10.0's `signInViaApi` (no Referer) in the spec. Use `live-smoke.yml@v1.10.3`
  or `@v1`. When `playwright/live.mjs` changes, the next release must bump these pins.

## 1.10.2

- `live-smoke.yml`'s API sign-in check and `signInViaApi` send the site as `Referer` (`<origin>/` of `site-url` / the
  open page; `signInViaApi` takes `referer` to override). A Firebase web key restricted to the site's HTTP referrers
  refused both with "Requests from referer <empty> are blocked", so the smoke test failed on every run for such apps.
  New export `siteReferer(url)`. Use `live-smoke.yml@v1.10.2` or `@v1`.

## 1.10.1

- `live-smoke.yml` uses `setup-browser@v1.10.0` (and `setup-node@v1.10.0`): 1.10.0 pinned `v1.9.2`, whose browser block
  does not copy `playwright/live.config.mjs`, so the test step could not find its config. Use `live-smoke.yml@v1.10.1`
  or `@v1`; `v1.10.0` of this workflow does not work.

## 1.10.0

- New reusable workflow `live-smoke.yml` plus `playwright/live.mjs` (`liveUser`, `watchConsole`, `signInViaApi`) and
  `playwright/live.config.mjs`: signs an app's test user in on the deployed site and runs the app's own spec for the
  signed-in, no-data state. Inputs `site-url`, `spec-path`, optional `firebase-api-key` / `firebase-config-file` (an
  Identity Toolkit sign-in check first); secrets `test-email`, `test-password`. Skips with a notice when a secret is
  missing; credentials only travel in the environment and are never printed. CI: helpers on a local page and the skip
  path.

## 1.9.2

- `tools/check-links.mjs` and `tools/proofread.mjs`: a link or `src` in a page that is missing next to the page is also
  looked up in `<page folder>/public/<rest>` (the Vite-lite layout, where `app.css`, `manifest.webmanifest` and icons
  live in `app/public/`), the same fallback the Worker and `stamp-versions` use. The old layout is unchanged and a file
  missing from both places is still reported. No new input or option. CI: `fixtures/tools/public` (passes; the same
  folder without `app.css` must fail).

## 1.9.1

- `serve-candidate`: a page that loads the engine's `app.js` entry (a modules-only app, no `index.js`) is checked
  too: the preload imports that `app.js` before the page closes and logs its `VERSION` (app-sync 0.9.3 and later
  export it there). Before, such a page never counted as having loaded the engine and its row failed. CI fixture:
  `run.mjs app`.

## 1.9.0

- New block `serve-candidate`: an app's own browser tests run on a candidate engine build with no app change. A Node
  preload (the `node-options` output, set as `NODE_OPTIONS` on the test step) patches every Playwright copy the process
  loads, so each browser context serves `<origin>/sync/<any>/` and `/update/<any>/` from local folders, a service worker's install fetches included
  (Playwright 1.56 skips routes for those unless `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS` is on, which the
  preload sets). Each page's real engine `VERSION` is logged before it closes; `report.mjs` fails a row that never ran
  the candidate, ran another version, left a page unchecked or asked for a file the candidate lacks; `shell.mjs`
  reports each `sw.js` list against the build's `files.json`. The engine's origin is an input (nothing app-specific).
  CI: `fixtures/serve-candidate/` (plain script, service worker, stale copy, missing file, never loaded, SHELL gaps).

## 1.8.0

- New tool `tools/starter-drift.mjs`: drift report for an app made from a starter template (`.starter.json`): which
  template files the app changed or lacks, and whether its recorded template version is behind. Uses the template's own
  `tools/fill.mjs` (`swapsFor`, `files`, `KEEP_FILES`, optional `fixup`) so filling and comparing never disagree.
  Reports only. CI: tested on `fixtures/starter/`.

## 1.7.0

- `setup-emulators`: falls back to a normal install when the firebase-tools cache is restored but unusable (partial copy
  or wrong version), and fills npx's store with `--prefer-offline` so a cold npx store fetches instead of failing with
  `cache mode is 'only-if-cached'`. Same inputs and outputs; `firebase-tools-cache-hit` still reports the cache restore.

## 1.6.0

- New block `setup-tools`: copies the kit's `tools/`, `playwright/`, `rules/` and `worker/` into `.devkit/` with no Node or
  browser step, for jobs that only run a tool.
- Repo tools, moved here from the 8 app repos that carried byte-identical copies. Run from the repo root as
  `node .devkit/tools/<name>.mjs`. Same behaviour as the app copies, except: they read the repo from the working
  directory (the copies read the folder above the script), and `proofread` also skips `test-results/` and
  `playwright-report/` (kakihome's copy already did).
  - `check.mjs`: each app's `sw.js` VERSION and cache rules, SHELL files exist, `wrangler.jsonc` keeps preview links off,
    Worker tests pass.
  - `proofread.mjs`: lang, title, viewport, noindex, alt text, links to files; `--live` and `--md`.
  - `shots.mjs`: phone screenshots (`pages <base-ref>`, `shoot <url> …`).
- `stamp-versions.mjs` is not here: the app copies have diverged into two generations, tests import it, and Cloudflare
  builds run it from the repo, so it stays per app for now.
- CI: `setup-tools` job runs the tools on a good and a bad fixture (`fixtures/tools/`).

## 1.5.0

- `rules/common.rules`: `stampKept()` (`serverAt` unchanged from the stored document, for older clients' partial updates;
  trade-off: readers that fetch only changes after a `serverAt` see that edit at their next full read), `notFuture(field)`
  and `authorIs(field)`. Tested through probe rules in CI.
- `rules/suite.mjs`: list-rule cases, opt-in per collection with `list: { roles, filter? }` (an unfiltered list by a
  signed-in non-member is denied; a filter field must mirror the source of the role), `listOnly`, and a `query()` client
  call. Existing suite configs run exactly as before. Worked example in `rules/examples/multi-group/`.
- `deploy-rules.yml`: optional inputs `test-command`, `build-rules-check` (with `devkit-ref`, `node-version`) run before
  the sign-in and deploy, and `dry-run` (checks only). All off by default.
- `deploy-worker.yml`: wrangler is pinned to an exact version (new input `wrangler-version`, default `4.152.0`; it
  floated on `wrangler@4` before); optional `smoke-url` fetched with `curl -fsS` after the deploy (off by default).
- Removed the committed `firestore-debug.log` files; `*-debug.log` is ignored.

## 1.4.0

- Claims Worker modules: `worker/custom-token.js` (custom tokens with the claims shape, `claimsShape` check, `randomUid`)
  and `worker/claims.js` (`/api/claims` handler, ID token verification, admin calls `setClaims`, `revoke`, Firestore
  `getDoc`/`setDoc`/`deleteDoc`). No dependencies. Unit tests and emulator tests (claims kept across refresh, claims
  reach the rules, revocation) in CI.
- `setup-browser` and `setup-emulators` (with `devkit-dir`) also copy `worker/` into `.devkit/`.

## 1.3.0

- Rules kit: `rules/common.rules` (claims helpers `isSignedIn`, `role`, `inGroup`, `hasRole`, `live`, `notRevoked`,
  `can`, `roleOrDoc`, `stamped`, `stampOk`), `tools/build-rules.mjs` (pastes the helpers into an app's rules; `--check`
  for CI) and `rules/suite.mjs` (shared emulator cases, document-lookup counts). Worked single-group and multi-group
  examples, tested in CI.
- `setup-browser` also copies `rules/` into `.devkit/`; `setup-emulators` gains an optional `devkit-dir` (off by default).

## 1.2.0

- `setup-emulators` installs firebase-tools once into a cached prefix (keyed by version, OS and arch) and puts it on `PATH`,
  and caches npx's store, so a caller's `firebase ...` and `npx firebase-tools@<same version>` no longer download it each
  run. New output `firebase-tools-cache-hit`.

## 1.1.0

- `playwright/base.mjs`: `baseConfig()` with phone (390 px) and desktop projects, one retry in CI, trace on failure.
- `playwright/helpers.mjs`: `emulatorServer`, `waitForEmulators`, `waitFor`, `waitForState`, `createTestUser`, `fsAdmin`.
- `tools/step-timings.mjs` (per-step durations of a run) and `tools/check-links.mjs` (relative links and anchors).
- `setup-browser` copies `playwright/` and `tools/` into `.devkit/` (input `devkit-dir`), at the ref it runs from, so repos
  without a package.json can import them.

## 1.0.0

First release.

- Composite actions: `setup-node`, `setup-browser`, `setup-emulators`.
- Reusable workflows: `deploy-worker.yml` (strips a byte-order mark and trailing CR/LF from the Cloudflare secrets;
  skips cleanly without them; optional beta environment) and `deploy-rules.yml` (keyless sign-in; skips cleanly until
  configured).
- CI runs every block against a small fixture; `release.yml` tags the version and moves `v1`.
