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
