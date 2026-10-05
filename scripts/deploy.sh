#!/usr/bin/env bash
# Safely deploy this branch over an installed Mirza bot (run as root on the bot server).
#   sudo ./deploy.sh                      # uses /var/www/html/mirzaprobotconfig
#   APP_DIR=/path BRANCH=name sudo ./deploy.sh
# The repo is private: create a read-only token (GitHub > Settings > Developer settings > Fine-grained tokens >
# only this repo > Repository permissions > Contents: Read-only) and run:  PICHA_GH_TOKEN=github_pat_... sudo -E ./deploy.sh
# (or just run it and paste the token when asked; it is not stored).
# Never ships: installer (install/), config.php, backups, tests, dev sources. Never overwrites config.php.
set -euo pipefail

APP="${APP_DIR:-/var/www/html/mirzaprobotconfig}"
BRANCH="${BRANCH:-claude/picha-bot-farsi-restore-uwlwar}"
REPO="skinny-dev/pichavpn-telegram-bot"
TARBALL_URL="${PICHA_TARBALL_URL:-https://api.github.com/repos/$REPO/tarball/$BRANCH}"
TEST="${PICHA_DEPLOY_TEST:-}"
# top-level names that must never be copied to a live bot
SKIP=(config.php install tests maintenance dashboard-src .github .git .gitignore PICHA.md README.md LICENSE composer.lock)

say() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$APP/config.php" ] || die "no bot found in $APP (config.php missing). Use APP_DIR=..."
[ -n "$TEST" ] || [ "$(id -u)" -eq 0 ] || die "run as root"

say "backing up config.php"
BK="${PICHA_BACKUP_DIR:-/root}/config.php.$(date +%Y%m%d-%H%M%S).bak"
cp -a "$APP/config.php" "$BK" && echo "    saved to $BK"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
say "downloading $BRANCH"
if [ -n "${PICHA_TARBALL:-}" ]; then tar xzf "$PICHA_TARBALL" -C "$TMP" --strip-components=1
else
  TOKEN="${PICHA_GH_TOKEN:-}"
  if [ -z "$TOKEN" ] && { : </dev/tty; } 2>/dev/null; then
    printf "    GitHub read-only token (input hidden, not stored; Enter to try without): " >/dev/tty
    read -rs TOKEN </dev/tty; echo >/dev/tty
  fi
  HDR="$TMP/.hdr"
  umask 077; { echo "Accept: application/vnd.github+json"; [ -n "$TOKEN" ] && echo "Authorization: Bearer $TOKEN"; } > "$HDR"; umask 022
  CODE="$(curl -sSL --retry 2 -o "$TMP/src.tgz" -w '%{http_code}' -H "@$HDR" "$TARBALL_URL" || true)"
  rm -f "$HDR"
  if [ "$CODE" != "200" ]; then
    case "$CODE" in
      404|401|403) die "download refused (HTTP $CODE). The repo is private: create a read-only token (see the top of this script) and run again." ;;
      *) die "download failed (HTTP ${CODE:-none}); check the server's internet access" ;;
    esac
  fi
  tar xzf "$TMP/src.tgz" -C "$TMP" --strip-components=1 && rm -f "$TMP/src.tgz"
fi
[ -f "$TMP/index.php" ] || die "download looks wrong (no index.php)"

say "copying files (skipping installer, config, backups, tests, dev sources)"
shopt -s dotglob nullglob
n=0
for f in "$TMP"/*; do
  b="$(basename "$f")"
  case "$b" in backup*|*.sql|*.zip|*.tgz|*.enc) continue;; esac
  skip=0; for s in "${SKIP[@]}"; do [ "$b" = "$s" ] && skip=1; done
  [ $skip -eq 1 ] && continue
  cp -a "$f" "$APP/"; n=$((n+1))
done
echo "    copied $n items"

say "removing anything that must not be on a live bot"
rm -rf "$APP/install" "$APP/tests" "$APP/maintenance" "$APP/dashboard-src" "$APP/.github"
rm -f "$APP"/backup_*.zip "$APP"/backup_*.sql "$APP"/*.tgz "$APP"/*.enc 2>/dev/null || true
[ -e "$APP/install/index.php" ] && die "installer still present, bot would answer 403"

say "fixing ownership and permissions"
if [ -z "$TEST" ]; then
  chown -R www-data:www-data "$APP"
  find "$APP" -type d -exec chmod 755 {} \;
  chmod 640 "$APP/config.php"
fi

if [ -z "$TEST" ]; then
  say "updating the database (adds new tables/columns, sets the webhook)"
  ( cd "$APP" && php table.php )
  say "reloading Apache"
  systemctl reload apache2
  DOMAIN="$(php -r "error_reporting(0); include '$APP/config.php'; echo \$domainhosts;" 2>/dev/null | cut -d/ -f1)"
  if [ -n "$DOMAIN" ]; then
    CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST "https://$DOMAIN/index.php" -d '{}' || true)"
    echo "    self-test POST https://$DOMAIN/index.php -> HTTP $CODE (403 means something is still blocking Telegram)"
    [ "$CODE" = "403" ] && die "still 403. Check: ls $APP/install ; tail /var/log/apache2/error.log"
  fi
fi
say "done"
