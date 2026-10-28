#!/usr/bin/env bash
# changed-files/decide.sh with the action's default patterns: docs-only lists skip, everything else (and an empty list) runs.
set -eu
cd "$(dirname "$0")/.."
IGNORE=$(printf '*.md \r\ndocs/*\nLICENSE\n'); KEEP=$(printf 'app/*\ne2e/*\nfixtures/*\n'); export IGNORE KEEP
check() { want=$1; shift; got=$(printf '%s\n' "$@" | bash changed-files/decide.sh); [ "$got" = "app=$want" ] || { echo "FAIL: [$*] gave $got, wanted app=$want"; exit 1; }; }
check false README.md
check false README.md docs/guide/a.png LICENSE nested/NOTES.md
check true README.md app/app.js
check true app/README.md
check true e2e/specs/a.spec.js
check true .github/workflows/checks.yml
check true package.json
check true README.md package-lock.json
got=$(printf '' | bash changed-files/decide.sh); [ "$got" = app=true ] || { echo "FAIL: empty list gave $got"; exit 1; }
echo "changed-files: ok"
