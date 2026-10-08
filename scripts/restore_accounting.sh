#!/usr/bin/env bash
# Copy ONLY the accounting rows (expenses, capital entries, Mirza-Pro cost/investment payments) from a backup
# into the live database. Nothing else is touched; rows that already exist are skipped (safe to run twice).
# Uses the bot's own database login from config.php (no MySQL root password needed): the three backup tables are loaded
# next to the live ones under the temporary names zz_bk_* and dropped again at the end.
#
#   restore_accounting.sh BACKUP.tgz.enc --inspect  # read-only: shows what accounting data the backup holds
#   restore_accounting.sh BACKUP.tgz.enc            # dry run: shows how many rows would be added
#   restore_accounting.sh BACKUP.tgz.enc --apply    # saves a copy of the live accounting tables, then adds the missing rows
#   Options: --app DIR  --passfile FILE  --sql db.sql (use a plain dump instead of a backup file)
set -uo pipefail
FILE="${1:-}"; shift || true
APP_DIR="${APP_DIR:-/var/www/html/mirzaprobotconfig}"; PASSFILE="${PASSFILE:-/root/.picha-backup-pass}"; APPLY=0; SQLFILE=""; INSPECT=0
while [ $# -gt 0 ]; do case "$1" in
  --apply) APPLY=1; shift;; --inspect) INSPECT=1; shift;; --app) APP_DIR="$2"; shift 2;; --passfile) PASSFILE="$2"; shift 2;;
  --sql) SQLFILE="$2"; shift 2;; *) echo "unknown option $1"; exit 64;; esac; done
[ -n "$FILE" ] || { sed -n '2,11p' "$0"; exit 64; }
die() { echo "ERROR: $*" >&2; exit 1; }

php_get() { php -r "error_reporting(0); include '$APP_DIR/config.php'; echo \$$1;"; }
DBH="$(php_get dbhost)"; DBN="$(php_get dbname)"; DBU="$(php_get usernamedb)"; DBP="$(php_get passworddb)"
[ -n "$DBN" ] && [ -n "$DBU" ] || die "cannot read the database login from $APP_DIR/config.php"
M()  { MYSQL_PWD="$DBP" mysql -h "${DBH:-localhost}" -u "$DBU" --default-character-set=utf8mb4 "$DBN" "$@"; }
MN() { M -N -B "$@"; }
M -e "SELECT 1" >/dev/null 2>&1 || die "cannot connect to the database with the login from config.php"

W="$(mktemp -d)"
cleanup() { rm -rf "$W"; for t in expenses capital_entries Payment_report; do M -e "DROP TABLE IF EXISTS \`zz_bk_$t\`" 2>/dev/null; done; }
trap cleanup EXIT

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

# pull the three tables out of the dump and load them under temporary names
FOUND=""
for t in expenses capital_entries Payment_report; do
  sed -n "/^-- Table structure for table \`$t\`/,/^-- Table structure for table /p" "$W/db.sql" | sed '$d' > "$W/$t.part"
  if grep -q "CREATE TABLE" "$W/$t.part"; then
    sed -E "s/^(DROP TABLE IF EXISTS |CREATE TABLE |LOCK TABLES |INSERT INTO |INSERT IGNORE INTO |\/\*!40000 ALTER TABLE )\`$t\`/\1\`zz_bk_$t\`/; s/^(ALTER TABLE )\`$t\`/\1\`zz_bk_$t\`/" "$W/$t.part" > "$W/$t.sql"
    # these tables hold no foreign keys; a stray «CONSTRAINT» line would break the temporary copy
    M < "$W/$t.sql" || die "could not load $t from the backup"
    FOUND="$FOUND $t"
  fi
done
[ -n "$FOUND" ] || die "the backup contains none of the accounting tables"

if [ "$INSPECT" -eq 1 ]; then
  Q() { M -t -e "$1" 2>&1; }
  Has() { [ "$(MN -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DBN' AND TABLE_NAME='zz_bk_$1'")" = "1" ]; }
  if Has expenses; then
    echo "=== backup: expenses table ==="
    Q "SHOW COLUMNS FROM zz_bk_expenses"
    Q "SELECT COUNT(*) rows_, COALESCE(SUM(amount),0) total FROM zz_bk_expenses"
    Q "SELECT * FROM zz_bk_expenses ORDER BY created_at DESC LIMIT 60"
  else echo "=== backup has no expenses table ==="; fi
  if Has capital_entries; then
    echo "=== backup: capital_entries ==="
    Q "SELECT COUNT(*) rows_, COALESCE(SUM(amount),0) total FROM zz_bk_capital_entries"
    Q "SELECT * FROM zz_bk_capital_entries ORDER BY created_at DESC LIMIT 30"
  else echo "=== backup has no capital_entries table ==="; fi
  if Has Payment_report; then
    echo "=== backup: Payment_report cost / capital rows (Mirza Pro style) ==="
    Q "SELECT Payment_Method, payment_Status, COUNT(*) n, SUM(CAST(price AS SIGNED)) total FROM zz_bk_Payment_report WHERE Payment_Method IN ('cost','capital_injection') GROUP BY 1,2"
    Q "SELECT id, time, price, Payment_Method, payment_Status, id_order, LEFT(COALESCE(dec_not_confirmed,''),60) note FROM zz_bk_Payment_report WHERE Payment_Method IN ('cost','capital_injection') ORDER BY id DESC LIMIT 60"
  fi
  echo "=== live database now ==="
  Q "SELECT (SELECT COUNT(*) FROM expenses) expenses_rows, (SELECT COUNT(*) FROM capital_entries) capital_rows"
  exit 0
fi

# table | extra row filter (applied to both sides)
SPECS=("expenses|1=1" "capital_entries|1=1" "Payment_report|Payment_Method IN ('cost','capital_injection')")
SAFE="/root/pre-accounting-$(date +%s).sql"; MAXTOTAL=0; PLAN=""
for spec in "${SPECS[@]}"; do
  t="${spec%%|*}"; flt="${spec#*|}"
  case " $FOUND " in *" $t "*) ;; *) echo "  $t: not in this backup (skipped)"; continue;; esac
  cols="$(MN -e "SET SESSION group_concat_max_len=1000000; SELECT GROUP_CONCAT(CONCAT('\`',b.COLUMN_NAME,'\`') ORDER BY b.ORDINAL_POSITION) FROM information_schema.COLUMNS b JOIN information_schema.COLUMNS l ON l.COLUMN_NAME=b.COLUMN_NAME AND l.TABLE_SCHEMA='$DBN' AND l.TABLE_NAME='$t' WHERE b.TABLE_SCHEMA='$DBN' AND b.TABLE_NAME='zz_bk_$t' AND b.COLUMN_NAME<>'id'")"
  [ -n "$cols" ] && [ "$cols" != "NULL" ] || { echo "  $t: no common columns (skipped)"; continue; }
  same="$(MN -e "SET SESSION group_concat_max_len=1000000; SELECT GROUP_CONCAT(CONCAT('CONVERT(l.',b.COLUMN_NAME,' USING utf8mb4) COLLATE utf8mb4_unicode_ci <=> CONVERT(b.',b.COLUMN_NAME,' USING utf8mb4) COLLATE utf8mb4_unicode_ci') SEPARATOR ' AND ') FROM information_schema.COLUMNS b JOIN information_schema.COLUMNS l ON l.COLUMN_NAME=b.COLUMN_NAME AND l.TABLE_SCHEMA='$DBN' AND l.TABLE_NAME='$t' WHERE b.TABLE_SCHEMA='$DBN' AND b.TABLE_NAME='zz_bk_$t' AND b.COLUMN_NAME<>'id'")"
  missing="SELECT $(echo "$cols" | sed 's/`\([^`]*\)`/b.`\1`/g') FROM \`zz_bk_$t\` b WHERE $flt AND NOT EXISTS (SELECT 1 FROM \`$t\` l WHERE $same)"
  in_bk="$(MN -e "SELECT COUNT(*) FROM \`zz_bk_$t\` b WHERE $flt")"
  in_live="$(MN -e "SELECT COUNT(*) FROM \`$t\` WHERE $flt")"
  to_add="$(MN -e "SELECT COUNT(*) FROM ($missing) m")" || die "comparison failed for $t"
  printf '  %-16s backup: %-5s live now: %-5s missing in live (will add): %s\n' "$t" "$in_bk" "$in_live" "$to_add"
  PLAN="$PLAN$t|$cols|$missing|$to_add"$'\n'
  MAXTOTAL=$((MAXTOTAL + to_add))
done
if [ "$MAXTOTAL" -eq 0 ]; then echo "Nothing to add: the live database already has every accounting row of this backup."; exit 0; fi
if [ "$APPLY" -ne 1 ]; then echo "DRY RUN: $MAXTOTAL rows would be added. Run again with --apply to add them."; exit 0; fi

MYSQL_PWD="$DBP" mysqldump -h "${DBH:-localhost}" -u "$DBU" --single-transaction --no-tablespaces "$DBN" expenses capital_entries Payment_report > "$SAFE" 2>/dev/null \
  && [ "$(stat -c %s "$SAFE")" -gt 100 ] && echo "safety copy of the live accounting tables: $SAFE" || die "could not save the safety copy; nothing was changed"
while IFS='|' read -r t cols missing to_add; do
  [ -n "$t" ] && [ "$to_add" != "0" ] || continue
  M -e "INSERT INTO \`$t\` ($cols) $missing" || die "insert into $t failed (safety copy: $SAFE)"
  echo "  added $to_add rows to $t"
done <<< "$PLAN"
echo "DONE. Check: the web panel → حسابداری, or the bot's آمار."
