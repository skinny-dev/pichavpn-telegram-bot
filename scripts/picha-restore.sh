#!/usr/bin/env bash
# Restore or verify a Picha backup made by picha-backup.sh.
#
#   picha-restore.sh FILE --verify            # SAFE: decrypt + load into a temporary DB, compare counts, drop it
#   picha-restore.sh FILE --apply             # REAL restore into the configured DB + files (asks you to type RESTORE)
#   picha-restore.sh FILE --extract-sql       # writes /root/mirza_backup_<date>.sql so you can use Mirza's own menu: mirza -> [7] Import Database
#   Options: --app DIR  --passfile FILE  --db-admin-args "-uroot"
set -uo pipefail
FILE="${1:-}"; shift || true
APP_DIR="${APP_DIR:-/var/www/html/mirzabotapp}"; PASSFILE="${PASSFILE:-/root/.picha-backup-pass}"; MODE=""; ADMIN_ARGS="${DB_ADMIN_ARGS:--uroot}"
while [ $# -gt 0 ]; do case "$1" in
  --verify) MODE=verify; shift;; --apply) MODE=apply; shift;; --extract-sql) MODE=extract; shift;;
  --app) APP_DIR="$2"; shift 2;; --passfile) PASSFILE="$2"; shift 2;; --db-admin-args) ADMIN_ARGS="$2"; shift 2;;
  *) echo "unknown option $1"; exit 64;; esac; done
[ -f "$FILE" ] && [ -n "$MODE" ] || { sed -n '2,7p' "$0"; exit 64; }

die() { echo "ERROR: $*" >&2; exit 1; }
W="$(mktemp -d)"; trap 'rm -rf "$W"; [ -n "${TMPDB:-}" ] && mysql $ADMIN_ARGS -e "DROP DATABASE IF EXISTS \`$TMPDB\`" 2>/dev/null' EXIT

[ -f "$FILE.sha256" ] && { ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null 2>&1 ) && echo "checksum OK" || die "checksum mismatch: the file is damaged"; }
case "$FILE" in
  *.enc) [ -s "$PASSFILE" ] || die "password file $PASSFILE missing (use --passfile)"
         openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -pass "file:$PASSFILE" 2>/dev/null | tar -xzf - -C "$W" 2>/dev/null || die "cannot decrypt (wrong password or damaged file)";;
  *) tar -xzf "$FILE" -C "$W" || die "cannot read archive";;
esac
[ -f "$W/db.sql" ] && [ -f "$W/MANIFEST" ] || die "archive is missing db.sql or MANIFEST"
echo "--- manifest ---"; cat "$W/MANIFEST"; echo "----------------"
[ "$(sha256sum "$W/db.sql" | cut -d' ' -f1)" = "$(grep '^db_sha256=' "$W/MANIFEST" | cut -d= -f2)" ] || die "db.sql does not match the manifest checksum"
echo "archive intact"

if [ "$MODE" = "extract" ]; then
  OUT="/root/mirza_backup_$(grep '^created=' "$W/MANIFEST" | cut -d= -f2).sql"
  [ -n "${EXTRACT_TO:-}" ] && OUT="$EXTRACT_TO"
  cp "$W/db.sql" "$OUT" && echo "wrote $OUT" && echo "Now run:  mirza   ->  [7] Import Database  -> pick that file."
  echo "Note: Mirza's import restores the DATABASE only. Your bot token/config, edited texts and storage are in this archive under files/ (config.php, lang/override, storage)."
  exit 0
fi
if [ "$MODE" = "verify" ]; then
  TMPDB="picha_verify_$$"
  mysql $ADMIN_ARGS -e "CREATE DATABASE \`$TMPDB\` CHARACTER SET utf8mb4" || die "cannot create temporary database (db admin access needed; try --db-admin-args)"
  mysql $ADMIN_ARGS --default-character-set=utf8mb4 "$TMPDB" < "$W/db.sql" || die "database dump failed to load"
  bad=0
  for t in user invoice Payment_report product; do
    exp="$(grep "^rows_$t=" "$W/MANIFEST" | cut -d= -f2)"; got="$(mysql $ADMIN_ARGS -N -B "$TMPDB" -e "SELECT COUNT(*) FROM \`$t\`" 2>/dev/null)"
    [ "$exp" = "$got" ] && echo "  [ OK ] $t: $got rows" || { echo "  [FAIL] $t: expected $exp, restored $got"; bad=1; }
  done
  [ $bad -eq 0 ] && echo "RESULT: backup is restorable (temporary database removed, nothing changed)" || die "restore verification failed"
  exit 0
fi

# --- real restore
DBN="$(php -r "error_reporting(0); include '$APP_DIR/config.php'; echo \$dbname;")"
[ -n "$DBN" ] || die "cannot read database name from $APP_DIR/config.php"
echo "This will REPLACE database '$DBN' and the files config.php, lang/override, storage in $APP_DIR."
read -rp "Type RESTORE to continue: " ans; [ "$ans" = "RESTORE" ] || die "cancelled"
SAFE="/root/pre-restore-$(date +%s).sql"
mysqldump $ADMIN_ARGS --single-transaction "$DBN" > "$SAFE" 2>/dev/null && echo "safety copy of the current database: $SAFE"
mysql $ADMIN_ARGS -e "DROP DATABASE IF EXISTS \`$DBN\`; CREATE DATABASE \`$DBN\` CHARACTER SET utf8mb4" || die "cannot recreate database"
mysql $ADMIN_ARGS --default-character-set=utf8mb4 "$DBN" < "$W/db.sql" || die "restore failed (your previous data is in $SAFE)"
for p in config.php lang/override storage version; do [ -e "$W/files/$p" ] && { mkdir -p "$APP_DIR/$(dirname "$p")"; cp -a "$W/files/$p" "$APP_DIR/$(dirname "$p")/"; }; done
echo "RESTORED. If the bot domain changed, re-run: php $APP_DIR/table.php  (sets the webhook again)"
