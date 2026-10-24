#!/usr/bin/env bash
# Tests the secret-cleaning function that deploy-worker.yml uses (the lines between the clean-begin/clean-end markers).
set -euo pipefail
wf="$(dirname "$0")/../.github/workflows/deploy-worker.yml"
eval "$(sed -n '/# clean-begin/,/# clean-end/p' "$wf")"
fail=0
check() { # name, input, expected
  local got; got="$(clean "$2")"
  if [ "$got" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$got'"; fail=1; fi
}
check "plain"           "abc123"                      "abc123"
check "trailing LF"     $'abc123\n'                   "abc123"
check "trailing CRLF"   $'abc123\r\n'                 "abc123"
check "leading BOM"     $'\xEF\xBB\xBFabc123'         "abc123"
check "BOM and CRLF"    $'\xEF\xBB\xBFabc123\r\n'     "abc123"
check "inner kept"      "a-b_c.d"                     "a-b_c.d"
check "empty"           ""                            ""
exit $fail
