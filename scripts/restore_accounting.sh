#!/usr/bin/env bash
# Copy ONLY the accounting rows (expenses, capital entries, Mirza-Pro cost/investment payments) from a backup
# into the live database. Nothing else is touched; rows that already exist are skipped (safe to run twice).
#
#   restore_accounting.sh BACKUP.tgz.enc            # dry run: shows how many rows would be added
#   restore_accounting.sh BACKUP.tgz.enc --apply    # saves a copy of the live accounting tables, then adds the missing rows
#   Options: --app DIR  --passfile FILE  --db-admin-args "-uroot"  --sql db.sql (use a plain dump instead of a backup file)
set -uo pipefail
FILE="${1:-}"; shift || true
APP_DIR="${APP_DIR:-/var/www/html/mirzaprobotconfig}"; PASSFILE="${PASSFILE:-/root/.picha-backup-pass}"; ADMIN_ARGS="${DB_ADMIN_ARGS:--uroot}"; APPLY=0; SQLFILE=""
while [ $# -gt 0 ]; do case "$1" in
  --apply) APPLY=1; shift;; --app) APP_DIR="$2"; shift 2;; --passfile) PASSFILE="$2"; shift 2;;
  --db-admin-args) ADMIN_ARGS="$2"; shift 2;; --sql) SQLFILE="$2"; shift 2;; *) echo "unknown option $1"; exit 64;; esac; done
[ -n "$FILE" ] || { sed -n '2,7p' "$0"; exit 64; }
die() { echo "ERROR: $*" >&2; exit 1; }
W="$(mktemp -d)"; TMPDB="picha_acc_$$"
trap 'rm -rf "$W"; mysql $ADMIN_ARGS -e "DROP DATABASE IF EXISTS \`$TMPDB\`" 2>/dev/null' EXIT

if [ -n "$SQLFILE" ]; then cp "$SQLFILE" "$W/db.sql" || die "cannot read $SQLFILE"
else
  [ -f "$FILE" ] || die "backup file not found: $FILE"
  case "$FILE" in
    *.enc) [ -s "$PASSFILE" ] || die "password file $PASSFILE missing (use --passfile)"
           openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -pass "file:$PASSFILE" 2>/dev/null | tar -xzf - -C "$W" 2>/dev/null || die "cannot decrypt (wrong password or damaged file)";;
    *) tar -xzf "$FILE" -C "$W" || die "cannot read archive";;
  esac
fi
[ -f "$W/db.sql" ] || die "archive has no db.sql"
DBN="$(php -r "error_reporting(0); include '$APP_DIR/config.php'; echo \$dbname;")"
[ -n "$DBN" ] || die "cannot read the database name from $APP_DIR/config.php"
mysql $ADMIN_ARGS -e "CREATE DATABASE \`$TMPDB\` CHARACTER SET utf8mb4" || die "cannot create temporary database"
mysql $ADMIN_ARGS --default-character-set=utf8mb4 "$TMPDB" < "$W/db.sql" || die "backup database failed to load"

# table | extra row filter (applied to both sides)
SPECS=("expenses|1=1" "capital_entries|1=1" "Payment_report|Payment_Method IN ('cost','capital_injection')")
SAFE="/root/pre-accounting-$(date +%s).sql"; MAXTOTAL=0; PLAN=""
for spec in "${SPECS[@]}"; do
  t="${spec%%|*}"; flt="${spec#*|}"
  have_bk="$(mysql $ADMIN_ARGS -N -B -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TMPDB' AND TABLE_NAME='$t'")"
  if [ "$have_bk" != "1" ]; then echo "  $t: not in this backup (skipped)"; continue; fi
  cols="$(mysql $ADMIN_ARGS -N -B -e "SELECT GROUP_CONCAT(CONCAT('\`',b.COLUMN_NAME,'\`') ORDER BY b.ORDINAL_POSITION) FROM information_schema.COLUMNS b JOIN information_schema.COLUMNS l ON l.COLUMN_NAME=b.COLUMN_NAME AND l.TABLE_SCHEMA='$DBN' AND l.TABLE_NAME='$t' WHERE b.TABLE_SCHEMA='$TMPDB' AND b.TABLE_NAME='$t' AND b.COLUMN_NAME<>'id'")"
  [ -n "$cols" ] && [ "$cols" != "NULL" ] || { echo "  $t: no common columns (skipped)"; continue; }
  same="$(mysql $ADMIN_ARGS -N -B -e "SELECT GROUP_CONCAT(CONCAT('CONVERT(l.',b.COLUMN_NAME,' USING utf8mb4) COLLATE utf8mb4_unicode_ci <=> CONVERT(b.',b.COLUMN_NAME,' USING utf8mb4) COLLATE utf8mb4_unicode_ci') SEPARATOR ' AND ') FROM information_schema.COLUMNS b JOIN information_schema.COLUMNS l ON l.COLUMN_NAME=b.COLUMN_NAME AND l.TABLE_SCHEMA='$DBN' AND l.TABLE_NAME='$t' WHERE b.TABLE_SCHEMA='$TMPDB' AND b.TABLE_NAME='$t' AND b.COLUMN_NAME<>'id'" | sed 's/`//g')"
  missing="SELECT $(echo "$cols" | sed 's/`\([^`]*\)`/b.`\1`/g') FROM \`$TMPDB\`.\`$t\` b WHERE $flt AND NOT EXISTS (SELECT 1 FROM \`$DBN\`.\`$t\` l WHERE $same)"
  in_bk="$(mysql $ADMIN_ARGS -N -B -e "SELECT COUNT(*) FROM \`$TMPDB\`.\`$t\` b WHERE $flt")"
  in_live="$(mysql $ADMIN_ARGS -N -B -e "SELECT COUNT(*) FROM \`$DBN\`.\`$t\` WHERE $flt")"
  to_add="$(mysql $ADMIN_ARGS -N -B -e "SELECT COUNT(*) FROM ($missing) m")" || die "comparison failed for $t"
  printf '  %-16s backup: %-5s live now: %-5s missing in live (will add): %s\n' "$t" "$in_bk" "$in_live" "$to_add"
  PLAN="$PLAN$t|$cols|$missing|$to_add"$'\n'
  MAXTOTAL=$((MAXTOTAL + to_add))
done
if [ "$MAXTOTAL" -eq 0 ]; then echo "Nothing to add: the live database already has every accounting row of this backup."; exit 0; fi
if [ "$APPLY" -ne 1 ]; then echo "DRY RUN: $MAXTOTAL rows would be added. Run again with --apply to add them."; exit 0; fi

mysqldump $ADMIN_ARGS --single-transaction "$DBN" expenses capital_entries Payment_report > "$SAFE" 2>/dev/null && echo "safety copy of the live accounting tables: $SAFE" || die "could not save the safety copy; nothing was changed"
while IFS='|' read -r t cols missing to_add; do
  [ -n "$t" ] && [ "$to_add" != "0" ] || continue
  mysql $ADMIN_ARGS --default-character-set=utf8mb4 "$DBN" -e "INSERT INTO \`$t\` ($cols) $missing" || die "insert into $t failed (safety copy: $SAFE)"
  echo "  added $to_add rows to $t"
done <<< "$PLAN"
echo "DONE. Check: the web panel → حسابداری, or the bot's آمار."
