#!/usr/bin/env bash
# Runs the browser suite REPEAT times in batches of BATCH, one Playwright invocation per batch, each writing
# $SOAK_DIR/$PREFIX.b<N>.json. A new invocation empties the emulators first (the apps' global setup); one long
# --repeat-each run piles up data until every sign-in times out. Exit 1 if any batch had a failing test.
set -u
left=$REPEAT
i=0
bad=0
while [ "$left" -gt 0 ]; do
  i=$((i + 1))
  n=$(( left < BATCH ? left : BATCH ))
  left=$(( left - n ))
  echo "::group::$PREFIX batch $i ($n runs)"
  # shellcheck disable=SC2086  # TEST_CMD and EXTRA_ARGS are words on purpose
  PLAYWRIGHT_JSON_OUTPUT_NAME="$SOAK_DIR/$PREFIX.b$i.json" $TEST_CMD --repeat-each="$n" --retries=0 ${EXTRA_ARGS:-} --reporter=list,json || bad=1
  echo "::endgroup::"
done
exit "$bad"
