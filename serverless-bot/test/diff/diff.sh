#!/usr/bin/env bash
# bash test/diff/diff.sh scenarios/start.mjs [--show]   (PHP_ROOT and DIFF_DIR set; setup.sh done once)
set -e
cd "$(dirname "$0")"
: "${PHP_ROOT:?}" "${DIFF_DIR:?}"
mkdir -p "$DIFF_DIR"
export TGMOCK_LOG="$DIFF_DIR/calls.jsonl"
ss -ltn | grep -q ':8136 ' || { (TGMOCK_LOG="$TGMOCK_LOG" setsid php -S 127.0.0.1:8136 tgmock.php >/dev/null 2>&1 &); sleep 0.5; }
exec node --no-warnings --import ../register.mjs run.mjs "$@"
