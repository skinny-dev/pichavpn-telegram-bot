#!/usr/bin/env bash
# Guided go-live for a FRESH server that already has the base Mirza bot installed by its installer.
#
#   sudo bash golive.sh --domain fa-bot.example.com --tarball /root/picha.tgz \
#        [--db-backup /root/picha-backup.tar.gz.enc] [--passfile /root/.picha-backup-pass] \
#        [--set-token] [--harden] [--start-cron] [--yes] [--dry-run]
#
#   --tarball     the code (git archive of this branch). CRLF line endings from Windows are fixed automatically.
#   --db-backup   restore ONLY the database from a picha-backup (never overwrites this server's config.php).
#   --set-token   ask for the live bot token (hidden) and write it into config.php (+ username from Telegram).
#   --harden      ufw: allow 22/80/443 and enable. (SSH keys / password login are only reported, never changed.)
#   --start-cron  start the scheduled jobs, but only if the health check has NO failures.
#   --dry-run     print what would be done and change nothing.
# Safe to re-run. Every destructive step asks you to type a word unless --yes.
set -uo pipefail

APP="${APP_DIR:-/var/www/html/mirzaprobotconfig}"
DOMAIN=""; TARBALL=""; DBBACKUP=""; PASSFILE="${PASSFILE:-/root/.picha-backup-pass}"
SETTOKEN=0; HARDEN=0; STARTCRON=0; YES=0; DRY=0; SKIPNET=${GOLIVE_SKIP_NET:-0}
while [ $# -gt 0 ]; do case "$1" in
  --domain) DOMAIN="$2"; shift 2;; --tarball) TARBALL="$2"; shift 2;; --db-backup) DBBACKUP="$2"; shift 2;;
  --passfile) PASSFILE="$2"; shift 2;; --set-token) SETTOKEN=1; shift;; --harden) HARDEN=1; shift;;
  --start-cron) STARTCRON=1; shift;; --yes) YES=1; shift;; --dry-run) DRY=1; shift;; --app) APP="$2"; shift 2;;
  -h|--help) sed -n '2,15p' "$0"; exit 0;; *) echo "unknown option $1"; exit 64;; esac; done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mSTOPPED:\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then echo "    [dry-run] $*"; else "$@"; fi; }
confirm() { # confirm WORD "question"
  [ "$YES" = 1 ] && return 0
  [ "$DRY" = 1 ] && { echo "    [dry-run] would ask: $2 (type $1)"; return 0; }
  printf '    %s -- type %s and press Enter to continue: ' "$2" "$1" >&2
  read -r a </dev/tty || die "no terminal for confirmation (use --yes)"
  [ "$a" = "$1" ] || die "cancelled"
}
here="$(cd "$(dirname "$0")" && pwd)"
[ "$DRY" = 1 ] || [ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -n "$DOMAIN" ] || die "--domain is required"
[ -f "$APP/config.php" ] || die "no bot in $APP: install the base Mirza bot first (its installer), then run this"
for t in php mysql openssl curl tar sed; do command -v "$t" >/dev/null || die "missing tool: $t"; done
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
cfg() { php -r "error_reporting(0); ob_start(); include '$APP/config.php'; ob_end_clean(); echo \$$1;"; }

# 1 ---------------------------------------------------------------- code
if [ -n "$TARBALL" ]; then
  say "Deploying the code from $TARBALL"
  [ -f "$TARBALL" ] || die "tarball not found"
  run mkdir -p "$W/x"
  if [ "$DRY" != 1 ]; then
    tar xzf "$TARBALL" -C "$W/x" || die "cannot read the tarball"
    top="$(ls "$W/x" | head -1)"; [ -f "$W/x/$top/scripts/deploy.sh" ] || die "tarball does not look like this project"
    find "$W/x" -type f \( -name '*.php' -o -name '*.sh' -o -name '*.json' -o -name '*.sql' -o -name '*.md' -o -name '*.py' -o -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.txt' \) -exec sed -i 's/\r$//' {} +
    tar czf "$W/clean.tgz" -C "$W/x" "$top" && ok "line endings normalised"
    PICHA_TARBALL="$W/clean.tgz" APP_DIR="$APP" bash "$W/x/$top/scripts/deploy.sh" || die "deploy.sh failed (config.php was backed up in /root)"
  else echo "    [dry-run] normalise line endings, run deploy.sh"; fi
else
  warn "no --tarball: keeping the code that is already on the server"
fi
[ "$DRY" = 1 ] || [ -f "$APP/scripts/golive_check.php" ] || die "this code has no scripts/golive_check.php: deploy a newer tarball"

# 2 ---------------------------------------------------------------- data
if [ -n "$DBBACKUP" ]; then
  say "Restoring the DATABASE only from $DBBACKUP"
  [ -f "$DBBACKUP" ] || die "backup file not found"
  RS="$APP/scripts/picha-restore.sh"; [ -f "$RS" ] || RS="$here/picha-restore.sh"
  run bash "$RS" "$DBBACKUP" --verify --passfile "$PASSFILE" || die "backup verification failed: nothing was changed"
  confirm IMPORT "This REPLACES the current database on this server with the backup"
  if [ "$DRY" != 1 ]; then
    cp -a "$APP/config.php" "$W/config.keep"
    EXTRACT_TO="$W/db.sql" bash "$RS" "$DBBACKUP" --extract-sql --passfile "$PASSFILE" >/dev/null || die "cannot extract the database"
    DBN="$(cfg dbname)"; [ -n "$DBN" ] || die "cannot read dbname from config.php"
    mysqldump -uroot --single-transaction "$DBN" > "/root/pre-golive-$(date +%s).sql" 2>/dev/null && ok "safety copy of the current database saved in /root"
    mysql -uroot -e "DROP DATABASE IF EXISTS \`$DBN\`; CREATE DATABASE \`$DBN\` CHARACTER SET utf8mb4" || die "cannot recreate the database (root access? try: mysql -uroot -p)"
    mysql -uroot --default-character-set=utf8mb4 "$DBN" < "$W/db.sql" || die "import failed (safety copy is in /root)"
    cmp -s "$W/config.keep" "$APP/config.php" && ok "config.php untouched" || { cp -a "$W/config.keep" "$APP/config.php"; warn "config.php was changed by the import and was put back"; }
    ok "database restored"
  fi
fi

# 3 ---------------------------------------------------------------- token / domain
say "Bot token and domain"
CUR_DOMAIN="$(cfg domainhosts | sed 's#/.*##')"
if [ "$DRY" = 1 ] && [ "$CUR_DOMAIN" != "$DOMAIN" ]; then echo "    [dry-run] would set domain '$CUR_DOMAIN' -> '$DOMAIN'"
elif [ "$CUR_DOMAIN" != "$DOMAIN" ]; then
  warn "config.php domain is '$CUR_DOMAIN', expected '$DOMAIN'"
  confirm DOMAIN "Set the domain in config.php to $DOMAIN"
  APP="$APP" DOM="$DOMAIN" php -r '$f=getenv("APP")."/config.php"; $c=file_get_contents($f); $c=preg_replace("/^\\\$domainhosts = .*;$/m", "\\\$domainhosts = ".var_export(getenv("DOM"),true).";", $c, 1, $n); if($n!==1){fwrite(STDERR,"domainhosts line not found\n");exit(1);} file_put_contents($f,$c);' || die "could not set the domain"
  ok "domain set"
else ok "domain $DOMAIN"; fi
if [ "$SETTOKEN" = 1 ]; then
  if [ "$DRY" = 1 ]; then echo "    [dry-run] ask for the live bot token (hidden), validate with Telegram getMe, write APIKEY and usernamebot"
  else
    read -rsp "    Live bot token from @BotFather (hidden): " TOK </dev/tty; echo
    [[ "$TOK" =~ ^[0-9]{6,}:[A-Za-z0-9_-]{30,}$ ]] || die "that does not look like a bot token"
    if [ "$SKIPNET" != 1 ]; then
      ME="$(curl -s --max-time 15 "https://api.telegram.org/bot$TOK/getMe")"
      UN="$(printf '%s' "$ME" | php -r '$j=json_decode(stream_get_contents(STDIN),true); echo ($j["ok"]??false) ? $j["result"]["username"] : "";')"
      [ -n "$UN" ] || die "Telegram rejected this token"
      ok "Telegram accepted the token for @$UN"
    else UN="${GOLIVE_FAKE_USERNAME:-pichanet_bot}"; fi
    cp -a "$APP/config.php" "/root/config.php.before-golive.$(date +%s)"
    TOK="$TOK" UN="$UN" APP="$APP" php -r '$f=getenv("APP")."/config.php"; $c=file_get_contents($f);
      $c=preg_replace("/^\\\$APIKEY = .*;$/m","\\\$APIKEY = ".var_export(getenv("TOK"),true).";",$c,1,$a);
      $c=preg_replace("/^\\\$usernamebot = .*;$/m","\\\$usernamebot = ".var_export(getenv("UN"),true).";",$c,1,$b);
      if($a!==1||$b!==1){fwrite(STDERR,"APIKEY/usernamebot line not found\n");exit(1);} file_put_contents($f,$c);' || die "could not write the token"
    unset TOK; ok "token and username written to config.php"
  fi
fi

# 4 ---------------------------------------------------------------- safe defaults + schema + webhook
say "Safe defaults, schema and webhook"
if [ "$DRY" != 1 ]; then
  ( cd "$APP" && php -r 'require "config.php"; $pdo->exec("UPDATE PaySetting SET ValuePay=\"offauto\" WHERE NamePay=\"autoconfirmcart\""); echo "    ok blind auto-approve timer forced OFF\n";' ) || warn "could not set autoconfirmcart (tables missing yet?)"
  ( cd "$APP" && php table.php >"$W/table.log" 2>&1 ) && ok "php table.php (schema + webhook)" || { tail -5 "$W/table.log"; die "table.php failed"; }
  chown -R www-data:www-data "$APP/storage" 2>/dev/null; chmod 640 "$APP/config.php" 2>/dev/null; chown root:www-data "$APP/config.php" 2>/dev/null
else echo "    [dry-run] force autoconfirmcart=offauto, php table.php, fix permissions"; fi

# 5 ---------------------------------------------------------------- backups
say "Backups"
if [ "$DRY" != 1 ]; then
  if [ ! -s "$PASSFILE" ]; then
    umask 077; head -c 24 /dev/urandom | base64 | tr -d '=+/\n' > "$PASSFILE"; umask 022
    ok "created backup password file $PASSFILE"
    warn "COPY THIS FILE OFF THE SERVER NOW (password manager). A backup without it cannot be opened."
  else ok "backup password file exists ($PASSFILE)"; fi
  BS="$APP/scripts/picha-backup.sh"; [ -f "$BS" ] || BS="$here/picha-backup.sh"
  if [ -s /etc/cron.d/picha-backup ]; then ok "backup already scheduled (kept as is: $(cut -d' ' -f1-5 /etc/cron.d/picha-backup | head -1))" # never turn hourly back into daily
  else bash "$BS" --app "$APP" --install-cron >/dev/null 2>&1 && ok "daily backup scheduled (03:30)" || warn "could not schedule the backup: run: bash $BS --install-cron"; fi
else echo "    [dry-run] create backup password file, install the daily backup cron"; fi

# 6 ---------------------------------------------------------------- hardening
if [ "$HARDEN" = 1 ]; then
  say "Firewall"
  if command -v ufw >/dev/null; then
    confirm FIREWALL "Allow ports 22, 80, 443 and enable ufw (SSH stays open)"
    run ufw allow 22/tcp; run ufw allow 80/tcp; run ufw allow 443/tcp; run ufw --force enable
  else warn "ufw not installed (apt install ufw)"; fi
  warn "SSH: this script never changes SSH settings. Add your key, test a second login, then set PasswordAuthentication no."
fi

# 7 ---------------------------------------------------------------- health check
say "Health check"
CHK=(php "$APP/scripts/golive_check.php" --domain="$DOMAIN"); [ "$SKIPNET" = 1 ] && CHK+=(--offline)
if [ "$DRY" = 1 ]; then echo "    [dry-run] ${CHK[*]}"; HEALTH=0; else ( cd "$APP" && "${CHK[@]}" ); HEALTH=$?; fi

# 8 ---------------------------------------------------------------- jobs
say "Scheduled jobs"
if [ "$STARTCRON" = 1 ]; then
  if [ "$HEALTH" -ne 0 ]; then warn "NOT starting cron: the health check has failures. Fix them, then run: systemctl enable --now cron"
  else confirm CRON "Start the scheduled jobs (expiry warnings, renewals) for the REAL customers"; run systemctl enable --now cron && ok "cron started"; fi
else
  echo "    cron NOT started. When the smoke test passes:  systemctl enable --now cron"
fi

echo
echo "Done. If anything looks wrong: restore the config backup in /root (config.php.before-golive.*), run php table.php,"
echo "and keep the maintenance notice ready (picha-maint). Rollback needs no data deletion."
exit "$HEALTH"
