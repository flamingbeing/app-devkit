#!/usr/bin/env bash
# Reads changed file paths on stdin; prints `app=true` unless every path matches $IGNORE and none matches $KEEP.
# An empty list counts as true (an unreadable diff must never skip the tests). Pattern lines are trimmed.
set -u
matches() { # matches <path> <newline-separated patterns>
  local f=$1 p
  while IFS= read -r p; do
    p=${p%$'\r'}; p=${p#"${p%%[![:space:]]*}"}; p=${p%"${p##*[![:space:]]}"}
    [ -n "$p" ] || continue
    # shellcheck disable=SC2254
    case "$f" in $p) return 0;; esac
  done <<<"$2"
  return 1
}
seen=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  seen=1
  matches "$f" "${KEEP:-}" && { echo "app=true"; exit 0; }
  matches "$f" "${IGNORE:-}" || { echo "app=true"; exit 0; }
done
[ "$seen" = 1 ] && echo "app=false" || echo "app=true"
