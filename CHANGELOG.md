# Changelog

Versions are tags: `v1.x.y` never moves once released; `v1` always points at the newest `v1.x.y`. A breaking change
becomes `v2`.

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
