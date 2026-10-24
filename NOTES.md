# Notes

- Composite actions live at the repo root (`setup-node/`, `setup-browser/`, `setup-emulators/`) so they are called as
  `flamingbeing/app-devkit/<name>@v1`. Reusable workflows must live in `.github/workflows/`.
- Reusable workflows cannot read the caller's `vars`, so `deploy-rules.yml` takes them as inputs.
- Reusable workflows cannot call a composite from their own repo by relative path (it resolves to the caller), so
  `deploy-worker.yml` is self-contained.
- The kit's CI calls blocks with `./<name>` so a PR is tested before it is tagged.
