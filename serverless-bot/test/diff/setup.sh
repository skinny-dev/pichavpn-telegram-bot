#!/usr/bin/env bash
# One-time setup of the PHP side for the diff tests (a copy of the bot in $PHP_ROOT, pointed at the fake Telegram).
set -e
: "${PHP_ROOT:?set PHP_ROOT to a copy of the bot with a test config.php}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
rsync -a --exclude .git --exclude config.php --exclude storage "$REPO/" "$PHP_ROOT/"
sed -i 's#https://api.telegram.org/#http://127.0.0.1:8136/#g' "$PHP_ROOT/botapi.php"
sed -i "s/^\$APIKEY = .*/\$APIKEY = 'MAINTOKEN:x';/" "$PHP_ROOT/config.php"
(cd "$PHP_ROOT" && php scripts/serverless_setup.php main on >/dev/null)
ss -ltn | grep -q ':8136 ' || (setsid php -S 127.0.0.1:8136 "$(dirname "$0")/tgmock.php" >/dev/null 2>&1 &)
echo "PHP side ready in $PHP_ROOT"
