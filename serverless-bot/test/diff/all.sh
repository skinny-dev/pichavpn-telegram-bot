#!/usr/bin/env bash
# run every scenario; exit 1 if any differs
cd "$(dirname "$0")"
fail=0
for f in scenarios/*.mjs; do
  [ "$(basename "$f")" = lib.mjs ] && continue
  bash diff.sh "$f" 2>&1 | tail -1
  [ "${PIPESTATUS[0]}" = 0 ] || fail=1
done
exit $fail
