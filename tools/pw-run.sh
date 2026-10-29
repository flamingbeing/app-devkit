#!/usr/bin/env bash
# One call: run a repo's Playwright specs in Chromium, Firefox and WebKit (pw-box: Playwright's image + a fresh Firestore
# emulator) and print a short summary (per browser pass/fail counts and the failing tests, at most ~20 lines). The full
# output goes to a log file whose path is printed last. Exit 0 only if every test passed.
#
#   bash tools/pw-run.sh <owner/repo> [ref] [-- <playwright test args, e.g. e2e/sync.spec.mjs --repeat-each 5>]
#   curl -fsSL https://raw.githubusercontent.com/<owner>/app-devkit/main/tools/pw-run.sh | bash -s -- <owner/repo> [ref] [-- ...]
#
#   ref: a branch, tag, sha or pull/<n>/head (default: the default branch).
#   env: BROWSERS (chromium,firefox,webkit), WORKERS (2; WebKit on a busy laptop fails at the default), PW_RUN_DIR (work
#        dir root, default ~/.cache/pw-run; the last 3 runs are kept), KIT_REF (app-devkit ref when run from a pipe: main).
# Engine: podman when present, else docker (Docker Desktop on Windows is started if it is stopped; run from Git Bash).
set -uo pipefail

[ $# -ge 1 ] && [ "$1" != -- ] || { sed -n 2,13p "$0" 2>/dev/null; echo "pw-run: need <owner/repo>" >&2; exit 2; }
REPO=$1; shift
REF=; if [ $# -gt 0 ] && [ "$1" != -- ]; then REF=$1; shift; fi
[ "${1:-}" = -- ] && shift
BROWSERS=${BROWSERS:-chromium,firefox,webkit}
ROOT=${PW_RUN_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/pw-run}
mkdir -p "$ROOT"
RUN="$ROOT/$(date +%Y%m%d-%H%M%S)-$$"; mkdir -p "$RUN"
LOG="$RUN/run.log"
ls -1dt "$ROOT"/*/ 2>/dev/null | tail -n +4 | while read -r d; do rm -rf "$d" 2>/dev/null || true; done

ENGINE=(); if command -v podman >/dev/null; then :; elif command -v docker >/dev/null; then ENGINE=(--docker)
  docker info >/dev/null 2>&1 || { docker desktop start --timeout 300 >/dev/null 2>&1 || true; }
  docker info >/dev/null 2>&1 || { echo "pw-run: docker is installed but not running" >&2; exit 3; }
else echo "pw-run: needs podman or docker" >&2; exit 3; fi

# the kit: this checkout when pw-box.sh sits beside the script, else a fresh clone (the script came through a pipe)
HERE=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)
if [ -f "$HERE/pw-box.sh" ]; then KIT=$(cd "$HERE/.." && pwd)
else KIT="$RUN/kit"; git clone -q --depth 1 -b "${KIT_REF:-main}" "https://github.com/${KIT_REPO:-flamingbeing/app-devkit}" "$KIT" >>"$LOG" 2>&1 \
  || { echo "pw-run: could not clone app-devkit (log $LOG)" >&2; exit 3; }; fi

APP="$RUN/app"
{ git init -q "$APP" && git -C "$APP" remote add origin "https://github.com/$REPO" \
  && git -C "$APP" fetch -q --depth 1 origin "${REF:-HEAD}" && git -C "$APP" checkout -q FETCH_HEAD; } >>"$LOG" 2>&1 \
  || { echo "pw-run: could not fetch $REPO ${REF:-(default branch)} (log $LOG)" >&2; exit 3; }
SHA=$(git -C "$APP" rev-parse --short HEAD)

START=$(date +%s)
( cd "$APP" && PW_BOX_JSON=.pw-results.json bash "$KIT/tools/pw-box.sh" ${ENGINE[@]+"${ENGINE[@]}"} -b "$BROWSERS" -- \
    --reporter=line,json --workers "${WORKERS:-2}" "$@" ) >>"$LOG" 2>&1
CODE=$?
echo "pw-run: $REPO@$SHA ${REF:-} [$BROWSERS] $(( $(date +%s) - START )) s, exit $CODE"
if [ -s "$APP/.pw-results.json" ]; then node "$KIT/tools/pw-summary.mjs" "$APP/.pw-results.json"; S=$?; [ $CODE -eq 0 ] && CODE=$S
else echo "no results written; last lines of the log:"; tail -n 12 "$LOG"; [ $CODE -eq 0 ] && CODE=1; fi
echo "log: $LOG"
exit $CODE
