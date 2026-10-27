#!/usr/bin/env bash
# Picha full backup: database + config + customised texts + storage, encrypted, verified, rotated.
#
#   sudo picha-backup.sh                       # one backup now
#   sudo picha-backup.sh --install-cron        # daily at 03:30
#   sudo picha-backup.sh --install-cron hourly # every hour (on disk only the last 3 days; Telegram keeps all of them)
#   sudo picha-backup.sh --remove-cron
#   Options: --app DIR  --out DIR  --keep DAYS  --telegram  --telegram-chat ID  --remote user@host:/path  --no-encrypt
# Settings can also live in /etc/picha-backup.conf (APP_DIR OUT_DIR KEEP_DAYS TELEGRAM TG_CHAT REMOTE PASSFILE).
#   --telegram        also send the encrypted file to Telegram (the admin's chat, or TG_CHAT: a private channel id -100…)
set -uo pipefail

CONF="${PICHA_BACKUP_CONF:-/etc/picha-backup.conf}"
[ -f "$CONF" ] && . "$CONF"
APP_DIR="${APP_DIR:-/var/www/html/mirzaprobotconfig}"
OUT_DIR="${OUT_DIR:-/root/picha-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
TELEGRAM="${TELEGRAM:-0}"
TG_CHAT="${TG_CHAT:-}"
REMOTE="${REMOTE:-}"
PASSFILE="${PASSFILE:-/root/.picha-backup-pass}"
ENCRYPT=1
TG_API="${PICHA_TG_API:-https://api.telegram.org}"
LOG="${PICHA_BACKUP_LOG:-/var/log/picha-backup.log}"

while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP_DIR="$2"; shift 2;;
    --out) OUT_DIR="$2"; shift 2;;
    --keep) KEEP_DAYS="$2"; shift 2;;
    --telegram) TELEGRAM=1; shift;;
    --telegram-chat) TELEGRAM=1; TG_CHAT="$2"; shift 2;;
    --remote) REMOTE="$2"; shift 2;;
    --no-encrypt) ENCRYPT=0; shift;;
    --install-cron)
      f=/etc/cron.d/picha-backup
      if [ "${2:-}" = "hourly" ]; then
        printf '7 * * * * root %s --keep 3 >> %s 2>&1\n' "$(readlink -f "$0")" "$LOG" > "$f"; chmod 644 "$f"
        echo "hourly backup scheduled (minute 07, last 3 days kept on disk) in $f"
      else
        printf '30 3 * * * root %s >> %s 2>&1\n' "$(readlink -f "$0")" "$LOG" > "$f"; chmod 644 "$f"
        echo "daily backup scheduled (03:30) in $f"
      fi
      exit 0;;
    --remove-cron) rm -f /etc/cron.d/picha-backup; echo "scheduled backup removed"; exit 0;;
    -h|--help) sed -n '2,10p' "$0"; exit 0;;
    *) echo "unknown option $1" >&2; exit 64;;
  esac
done

ts() { date '+%Y-%m-%d %H:%M:%S'; }
say() { echo "$(ts) $*" | tee -a "$LOG" 2>/dev/null || echo "$(ts) $*"; }
die() { say "ERROR: $*"; notify "❌ Picha backup FAILED on $(hostname): $*"; exit 1; }

# read bot token + admin id for notifications (best effort)
php_get() { php -r "error_reporting(0); include '$APP_DIR/config.php'; echo \$$1;" 2>/dev/null; }
notify() {
  [ "$TELEGRAM" = "1" ] || return 0
  local tok adm; tok="$(php_get APIKEY)"; adm="${TG_CHAT:-$(php_get adminnumber)}"
  [ -n "$tok" ] && [ -n "$adm" ] && curl -s -m 20 "$TG_API/bot$tok/sendMessage" --data-urlencode "chat_id=$adm" --data-urlencode "text=$1" >/dev/null 2>&1 || true
}

[ -f "$APP_DIR/config.php" ] || die "config.php not found in $APP_DIR (use --app)"
command -v mysqldump >/dev/null || die "mysqldump not installed"
command -v php >/dev/null || die "php not installed"
DBH="$(php_get dbhost)"; DBN="$(php_get dbname)"; DBU="$(php_get usernamedb)"; DBP="$(php_get passworddb)"
[ -n "$DBN" ] && [ -n "$DBU" ] || die "could not read database settings from $APP_DIR/config.php"

umask 077
mkdir -p "$OUT_DIR" || die "cannot create $OUT_DIR"
if [ "$ENCRYPT" = "1" ]; then
  command -v openssl >/dev/null || die "openssl not installed"
  if [ ! -s "$PASSFILE" ]; then
    openssl rand -base64 33 > "$PASSFILE"; chmod 600 "$PASSFILE"
    say "NEW backup password created in $PASSFILE"
    echo "=================================================================="
    echo " BACKUP PASSWORD (save it OFF this server, e.g. a password manager):"
    echo "   $(cat "$PASSFILE")"
    echo " Without it the backups cannot be opened. It is shown only now."
    echo "=================================================================="
  fi
fi

STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/b/files"
say "backup started: db=$DBN app=$APP_DIR"

# 1) database (consistent snapshot, no table locks)
MYSQL_PWD="$DBP" mysqldump -h "${DBH:-localhost}" -u "$DBU" --single-transaction --quick --routines --triggers --no-tablespaces --default-character-set=utf8mb4 "$DBN" > "$WORK/b/db.sql" 2>"$WORK/dump.err" \
  || die "mysqldump failed: $(head -c 300 "$WORK/dump.err")"
grep -q "Dump completed" "$WORK/b/db.sql" || die "database dump looks incomplete"
TABLES="$(grep -c '^CREATE TABLE' "$WORK/b/db.sql")"

# 2) files that are NOT in git: config (token, db password), edited texts, storage, uploads
for p in config.php lang/override storage version vpnbot; do # vpnbot/: the agents' own bots (their config and texts)
  [ -e "$APP_DIR/$p" ] && { mkdir -p "$WORK/b/files/$(dirname "$p")"; cp -a "$APP_DIR/$p" "$WORK/b/files/$p"; }
done
rm -rf "$WORK/b/files/storage/cache" 2>/dev/null

# 3) manifest
{
  echo "created=$STAMP"; echo "host=$(hostname)"; echo "app_dir=$APP_DIR"; echo "db=$DBN"; echo "tables=$TABLES"
  echo "version=$(cat "$APP_DIR/version" 2>/dev/null)"
  echo "db_sha256=$(sha256sum "$WORK/b/db.sql" | cut -d' ' -f1)"
  for t in user invoice Payment_report product; do
    n="$(MYSQL_PWD="$DBP" mysql -h "${DBH:-localhost}" -u "$DBU" -N -B "$DBN" -e "SELECT COUNT(*) FROM \`$t\`" 2>/dev/null)"; echo "rows_$t=${n:-?}"
  done
} > "$WORK/b/MANIFEST"

# 4) archive (+ encrypt)
tar -C "$WORK/b" -czf "$WORK/backup.tgz" . || die "tar failed"
BASE="$OUT_DIR/picha_backup_$STAMP"
if [ "$ENCRYPT" = "1" ]; then
  FINAL="$BASE.tgz.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$WORK/backup.tgz" -out "$FINAL" -pass "file:$PASSFILE" || die "encryption failed"
else
  FINAL="$BASE.tgz"; cp "$WORK/backup.tgz" "$FINAL"
fi
( cd "$OUT_DIR" && sha256sum "$(basename "$FINAL")" > "$(basename "$FINAL").sha256" )

# 5) verify what we just wrote can really be opened (a backup you cannot restore is not a backup)
if [ "$ENCRYPT" = "1" ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FINAL" -pass "file:$PASSFILE" 2>/dev/null | tar -tzf - >/dev/null 2>&1 || die "verification failed: cannot decrypt/read $FINAL"
else
  tar -tzf "$FINAL" >/dev/null 2>&1 || die "verification failed: cannot read $FINAL"
fi
SIZE="$(du -h "$FINAL" | cut -f1)"
say "backup OK: $FINAL ($SIZE, $TABLES tables, verified)"

# 6) rotate
find "$OUT_DIR" -maxdepth 1 -name 'picha_backup_*' -mtime +"$KEEP_DAYS" -delete 2>/dev/null
say "kept the last $KEEP_DAYS days ($(ls "$OUT_DIR"/picha_backup_*.enc "$OUT_DIR"/picha_backup_*.tgz 2>/dev/null | wc -l) backups on disk)"

# 7) copy off the server
if [ -n "$REMOTE" ]; then
  if scp -q -o BatchMode=yes -o ConnectTimeout=15 "$FINAL" "$FINAL.sha256" "$REMOTE/" 2>>"$LOG"; then say "copied to $REMOTE"; else say "WARNING: copy to $REMOTE failed (SSH key set up?)"; notify "⚠️ Picha backup made but remote copy FAILED"; fi
fi
if [ "$TELEGRAM" = "1" ]; then
  tok="$(php_get APIKEY)"; adm="${TG_CHAT:-$(php_get adminnumber)}"
  if [ "$(stat -c %s "$FINAL")" -gt 49000000 ]; then say "WARNING: file larger than Telegram's 50MB limit, not sent"; notify "⚠️ Picha backup $STAMP is too big for Telegram ($SIZE)"
  elif curl -s -m 120 "$TG_API/bot$tok/sendDocument" -F "chat_id=$adm" -F "document=@$FINAL" -F "caption=📦 Picha backup $STAMP ($SIZE, $TABLES tables, encrypted · rows: $(grep -E '^rows_(user|invoice)=' "$WORK/b/MANIFEST" | tr '\n' ' '))" | grep -q '"ok":true'; then say "sent to Telegram ($adm)"
  else say "WARNING: Telegram upload failed"; fi
fi
echo "$FINAL"
