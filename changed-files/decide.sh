#!/usr/bin/env bash
# Reads changed file paths on stdin; prints `app=true` unless every path matches $IGNORE and none matches $KEEP.
# An empty list counts as true (an unreadable diff must never skip the tests).
set -u
seen=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  seen=1
  hit=0
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    # shellcheck disable=SC2254
    case "$f" in $p) hit=1; break;; esac
  done <<<"${KEEP:-}"
  if [ "$hit" = 0 ]; then
    ign=0
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      # shellcheck disable=SC2254
      case "$f" in $p) ign=1; break;; esac
    done <<<"${IGNORE:-}"
    [ "$ign" = 1 ] && continue
  fi
  echo "app=true"; exit 0
done
[ "$seen" = 1 ] && echo "app=false" || echo "app=true"
