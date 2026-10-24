# Changelog

Versions are tags: `v1.x.y` never moves once released; `v1` always points at the newest `v1.x.y`. A breaking change
becomes `v2`.

## 1.0.0

First release.

- Composite actions: `setup-node`, `setup-browser`, `setup-emulators`.
- Reusable workflows: `deploy-worker.yml` (strips a byte-order mark and trailing CR/LF from the Cloudflare secrets;
  skips cleanly without them; optional beta environment) and `deploy-rules.yml` (keyless sign-in; skips cleanly until
  configured).
- CI runs every block against a small fixture; `release.yml` tags the version and moves `v1`.
