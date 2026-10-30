# Changelog

Versions are tags: `v1.x.y` never moves once released; `v1` always points at the newest `v1.x.y`. A breaking change
becomes `v2`.

## 1.15.0

- New tool `startup-size.mjs <page.html> [--max <KiB gz>] [--max-files <n>] [--json]`: the JS and CSS a page loads
  before it can draw (its scripts, modulepreloads, stylesheets and their static imports; `import()` is not followed;
  other origins count as requests only), gzipped. Fails over the budget and names the biggest files, so an app's
  Checks catch a feature that slows its first screen.

## 1.14.3

- `soak.yml`: the normal browser step may run 60 minutes (was 40) and the job 150 (was 100). The notes suite needs about 22 minutes
  per batch of 5, so 10 runs hit the limit, the step was killed and its web server held the port for the next step.
- `soak-report.mjs`: skips folders in the results folder. 1.14.2 put `test-results/` there, and the report read it as a
  file (EISDIR), so the step "Update the Nightly soak issue" failed on every night with a failing batch.
- `soak-batches.sh`: before each batch waits up to 30 s for the app and emulator ports (`SOAK_PORTS`, default
  `4173 8080 9099`) to be free, and names the holder if they stay taken (a step once died on "port 4173 is already used").

## 1.14.2

- `soak.yml`: `kit-ref` now defaults to this release's own tag (it was stuck on v1.13.7, so apps that did not set it ran
  the old helpers: `db.list` read only 300 docs and caused a tasks flake). A test in `fixtures/tools` fails CI when the
  default and `package.json` differ, so it cannot lag again; bump both on each release.
- `soak-batches.sh`: each batch writes Playwright's output to `soak-results/test-results/<prefix>.b<N>` (Playwright
  empties its output folder on every invocation, so earlier batches' traces, screenshots and error-context were lost).
  Only failing batches are kept, empty test folders removed, total capped at 150 MB (`SOAK_RESULTS_MAX_MB`). They ship in
  the `soak-results` artifact.

## 1.14.1

- `soak-report.mjs`: the Nightly soak issue links the run by the repo's current name from the API, not
  `GITHUB_REPOSITORY` as is. After a repo rename that variable keeps the old name (tasks was sandbox-app), so the issue linked
  `sandbox-app/actions/runs/<id>`. Apps pinned to a soak.yml tag pick this up by bumping to v1.14.1.

## 1.14.0

- New reusable `e2e.yml`: the browser tests split over `shards` parallel runners (Playwright `--shard`, even by test
  with the base config's `fullyParallel`), then one gate job named after `name` that passes only when every shard did.
  Inputs for the quick/full split: `args` (projects or spec files), `browsers`, `webkit-deps`, `emulators`,
  `build-command` + `app-dir` (a Vite run), `ref` (a PR number, branch, tag or SHA, for a dispatched full run),
  `working-directory`. Docs-only pull requests skip the steps (changed-files) and still pass.

## 1.13.9

- `soak.yml`: `browsers` input (default `chromium`), passed to setup-browser, so a soak can run other browsers' projects
  too (e.g. `chromium firefox` with `--project=phone --project=firefox`). The slow-phone profile still throttles
  Chromium only.

## 1.13.8

- `tools/pw-run.sh <owner/repo> [ref] [-- <playwright args>]`: one call fetches the repo at a ref, runs its Playwright
  specs in Chromium, Firefox and WebKit through `pw-box.sh` (podman, or docker / Docker Desktop) and prints a short
  summary from the JSON report (`tools/pw-summary.mjs`: per browser counts and the failing tests, at most ~20 lines);
  the full output stays in a log file. Works through `curl ... | bash -s --` on a host without a kit checkout.
- `pw-box.sh`: `PW_BOX_JSON` passes the JSON report path into the box; runs from Git Bash with Docker Desktop on
  Windows; the box fetches `github:` dependencies over https.

## 1.13.7

- `soak.yml`: a night that runs only unit, chaos or model steps and passes is clean again. Those steps now write a
  `<step>.ok.txt` line when they pass, and the report counts it (the clean line lists them); before, nothing they
  wrote was read, so the report said "no results were written" and showed the run red. `kit-ref` defaults to v1.13.7.

## 1.13.6

- `fsAdmin(...).list` follows `nextPageToken`: a collection over one page (300) came back without its newest documents, so
  long `--repeat-each` soaks on a shared list failed `serverHas`-style checks late in the run. `soak.yml`'s `kit-ref` defaults to v1.13.6.

## 1.13.5

- `soak.yml`: a failing `model-command` now lists the failing seeds (and their replay lines) in the issue, not only that it
  failed; the step has a 50 min limit. `kit-ref` defaults to v1.13.5.

## 1.13.4

- `playwright/soak-slow.mjs`: the slow-phone network is now "Fast 3G" (200 kB/s, 150 ms) instead of "Slow 3G" (50 kB/s).
  On Slow 3G the app shell took longer than the specs' 10 s waits, so every test failed on every run (trial: 31 tests,
  5 of 5 runs each) and the issue showed no real signal. `SOAK_DOWN_KBPS`, `SOAK_UP_KBPS` and `SOAK_LATENCY_MS` override it.
- `soak.yml`: `kit-ref` defaults to v1.13.4.

## 1.13.3

- `tools/soak-report.mjs`: a batch whose Playwright run died (top-level `errors`: global setup threw, a spec failed to
  load) counted as a clean night. Its errors are now listed and the night is not clean.
- `playwright/helpers.mjs` `fsAdmin`: a `Date` was seeded as an empty map and timestamps read back as `undefined`. Dates
  now go in as `timestampValue` and come back as `Date`; `undefined` fields seed as null.
- `tools/check-links.mjs`: heading anchors dropped underscores inside words (`claims_shape`), so a correct link failed
  and a wrong one passed. Only emphasis underscores are dropped now, as on GitHub.
- `scripts/check-pins.mjs`: a pin on `@main`, a branch or a SHA was not listed or counted; it now counts as stale.

## 1.13.2

- `worker/claims.js` 1.4.2: a member removed while their page was asking `/api/claims` could keep access for the hour
  their ID token had left. The ask read the role doc (still there), then cleared `revoked/{uid}` after the removal had
  written it, so the rules and the files route let the old token through. The ask now reads the role once more after
  clearing and, if the person is gone, revokes again (every interleaving ends revoked). Apps copy the new file.

## 1.13.1

- `soak.yml`: the browser repeats now run in batches (`batch`, default 5; `tools/soak-batches.sh`), one Playwright
  invocation each, because the apps' global setup empties the emulators only at the start of an invocation and one
  20-run invocation made the emulator slow until every sign-in timed out (first trial run: cancelled at the job limit,
  nothing reported). Defaults are now `repeat` 10 and `slow-repeat` 5 (about an hour per repo); each browser step has a
  40 min limit and the job 100 min. `soak-report.mjs` merges the per-batch results.

## 1.13.0

- New reusable workflow `soak.yml` (the nightly soak): the app's browser tests `repeat` times (default 20) plus `slow-repeat`
  (10) under a slow-phone profile (`playwright/soak-slow.mjs`: CPU 4x, slow 3G, longer timeout; offline blips with
  `blips: true`), no retries. Optional `unit-command` (x100), `chaos-command` and `model-command` run with tonight's
  `SOAK_SEED` / `SOAK_SEED_N`. `tools/soak-report.mjs` keeps ONE open issue titled "Nightly soak" per repo (opened or
  rewritten on failure with the failing tests, counts and run link; closed after 7 clean nights). Plain Actions, no model;
  not a required check. Callers need `permissions: issues: write`. Nothing existing changes.

## 1.12.0

- New block `changed-files`: `id: changes` then `if: steps.changes.outputs.app == 'true'` on a heavy job's steps. On a pull
  request that changes only Markdown, `docs/` or `LICENSE` the job still runs and succeeds in seconds, so a required check
  never hangs; pushes, other events and anything unclear (failed fetch, empty diff) report `app=true`. Inputs `ignore` and
  `keep` (default `keep`: `app/*`, `e2e/*`, `fixtures/*`) change what counts. Used by this repo's `playwright-kit` job.
  Nothing existing changes.

## 1.11.1

- `worker/claims.js` 1.4.1: `/api/claims` reads the role again after writing the claims and writes again if it changed
  (up to 3 times). Two asks for one account could overlap (a page asks before its role doc arrives and again when it
  does); the older one finishing its write last left the account without its role, and the page asks only once per
  version, so it stayed on "no access" (about 1 in 177 sign-ins in an app's browser tests). `claims.js` is copied into
  apps: copy the new one and bump the pins to `v1.11.1`.
- `tools/pw-box.sh --docker` (or `PW_BOX_ENGINE=docker`) runs the box with Docker instead of Podman, for a cloud session
  (start `dockerd` first). Behind an HTTPS proxy it uses the host network, passes the proxy and its CA to the box, and
  bakes the Firestore emulator jar into the image. Git dependencies are installed on the host.
- `pw-box.sh`: when a proxy CA is given, Firefox skips certificate errors (it ignores the system store), so the service-worker
  specs pass behind the proxy: Firefox 41/41 in Docker. Nothing changes without a CA.

## 1.11.0

- `emulatorServer` and `setup-emulators` default to firebase-tools 15.33.0 (was 13.29.1, which drops document changes
  during a Listen resume). Pass `firebaseTools` / `firebase-tools-version` to keep another version. New
  `scripts/check-pins.mjs` lists a repo's devkit pins against the latest tag.

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
