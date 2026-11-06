#!/usr/bin/env bash
# Runs the browser suite REPEAT times in batches of BATCH, one Playwright invocation per batch, each writing
# $SOAK_DIR/$PREFIX.b<N>.json. A new invocation empties the emulators first (the apps' global setup); one long
# --repeat-each run piles up data until every sign-in times out (an app whose tests share one list piles up fastest:
# tasks went from 0 failures in its first run of a batch to 56 of 65 in its fifth). Exit 1 if any batch had a failing test.
# While runs are left, $SOAK_DIR/$PREFIX.unfinished.fail.txt says how many: the step's time limit kills this script
# before Playwright writes its report, and without the note the report read the lost runs as a clean night.
# Playwright empties its output folder at the start of each invocation, so each batch writes to its own folder
# ($SOAK_DIR/test-results/$PREFIX.b<N>: traces, screenshots, error-context) and the folder is deleted unless the batch
# failed. Only failing batches stay, and only while the kept total is under SOAK_RESULTS_MAX_MB (default 150), so the
# soak-results artifact stays bounded. Within a kept batch, folders of passing tests are removed.
set -u
max_kb=$(( ${SOAK_RESULTS_MAX_MB:-150} * 1024 ))
left=$REPEAT
i=0
bad=0
unfinished="$SOAK_DIR/$PREFIX.unfinished.fail.txt"
while [ "$left" -gt 0 ]; do
  echo "$PREFIX: $left of $REPEAT runs did not finish (the step's time limit stopped them; their results are lost)" > "$unfinished"
  i=$((i + 1))
  n=$(( left < BATCH ? left : BATCH ))
  left=$(( left - n ))
  echo "::group::$PREFIX batch $i ($n runs)"
  # The last invocation's servers (app 4173, emulators 8080/9099) can still be shutting down; Playwright refuses to
  # start on a taken port, which killed a whole step. Wait up to 30 s; then (CI only) stop whoever still holds it: the
  # Firestore emulator's java outlives its firebase-tools parent, and once it held 8080 every later batch died at start.
  for port in ${SOAK_PORTS:-4173 8080 9099}; do
    for _ in $(seq 1 30); do (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null || break; sleep 1; done
    if (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      holder=$(ss -ltnp 2>/dev/null | grep ":$port " | head -1)
      echo "::warning::port $port still taken before $PREFIX batch $i: $holder"
      if [ "${CI:-}" = true ]; then
        for pid in $(echo "$holder" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$pid" 2>/dev/null; done
        for _ in $(seq 1 10); do (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null || break; sleep 1; done
        for pid in $(echo "$holder" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill -9 "$pid" 2>/dev/null; done
      fi
    fi
  done
  # shellcheck disable=SC2086  # TEST_CMD and EXTRA_ARGS are words on purpose
  out="$SOAK_DIR/test-results/$PREFIX.b$i"
  failed=0
  PLAYWRIGHT_JSON_OUTPUT_NAME="$SOAK_DIR/$PREFIX.b$i.json" $TEST_CMD --repeat-each="$n" --retries=0 ${EXTRA_ARGS:-} --reporter=list,json --output="$out" || { bad=1; failed=1; }
  if [ "$failed" = 1 ] && [ -d "$out" ]; then
    # A failing test's folder holds its error-context.md or a trace; folders of passing tests hold neither.
    for d in "$out"/*/; do [ -d "$d" ] && [ -z "$(ls -A "$d" 2>/dev/null)" ] && rmdir "$d"; done
    used=$(du -sk "$SOAK_DIR/test-results" | cut -f1)
    if [ "$used" -gt "$max_kb" ]; then rm -rf "$out"; echo "::warning::$PREFIX batch $i: failure artifacts dropped, kept results over ${SOAK_RESULTS_MAX_MB:-150} MB"; fi
  else
    rm -rf "$out"
  fi
  echo "::endgroup::"
done
rm -f "$unfinished"
exit "$bad"
