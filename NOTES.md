# Notes

- Composite actions live at the repo root (`setup-node/`, `setup-browser/`, `setup-emulators/`) so they are called as
  `flamingbeing/app-devkit/<name>@v1`. Reusable workflows must live in `.github/workflows/`.
- Reusable workflows cannot read the caller's `vars`, so `deploy-rules.yml` takes them as inputs.
- Reusable workflows cannot call a composite from their own repo by relative path (it resolves to the caller), so
  `deploy-worker.yml` is self-contained.
- The kit's CI calls blocks with `./<name>` so a PR is tested before it is tagged.
- Rules kit: claims in the emulator work both through `@firebase/rules-unit-testing` (`authenticatedContext(uid,
  claims)`) and as an unsigned Bearer token over REST; `rules/suite.mjs` uses REST so it needs no dependencies.
- The emulator evaluates each `get`/`exists` twice per request (a first pass yields `undefined`), so lookups are counted
  as distinct document paths in the coverage report, not as evaluations.
- Rules function arguments are evaluated eagerly: a `get()` passed to `roleOrDoc` is always read (tested). Inline the
  ternary to skip it.
- Each helper was written test-first: `rules/test/helpers.test.mjs` failed 10/10 against stubs before the real helpers.
- Claims Worker modules (emulator, 25 Oct 2026): developer claims from a custom token stay after an ID token refresh;
  claims written with `accounts:update` reach the next refresh; when both exist, the custom token's claims win key by
  key, so link users and account users each get one source. The Auth emulator does not enforce `validSince`, so
  revocation is tested through `revoked/{uid}` and the rules. Mutation check: removing `clearRevoked`, `markRevoked`,
  the signature check or the custom-sign-in refusal each fails a test.
