#!/usr/bin/env bash
# bash test/panel/run.sh [cases/x.mjs ...]  — needs PHP_ROOT (a copy of the bot on :8099 with a test DB) and PANEL_EXPORT (scratch dir)
# Every cases file starts from freshly seeded data on both sides.
set -e
: "${PHP_ROOT:?}" "${PANEL_EXPORT:?}"
cd "$(dirname "$0")"
fail=0
for c in "${@:-cases/core.mjs}"; do
  php seed.php "$PHP_ROOT" >/dev/null
  (cd "$PHP_ROOT" && php scripts/serverless_export.php --out="$PANEL_EXPORT" >/dev/null 2>&1)
  echo "== $c"
  node --no-warnings --import ../register.mjs diff.mjs "$PANEL_EXPORT" "./$c" || fail=1
done
exit $fail
