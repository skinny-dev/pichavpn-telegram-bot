#!/usr/bin/env bash
# Clone a PasarGuard panel onto ANOTHER server for testing.
#   on the SOURCE (production):  bash pasarguard_clone.sh backup
#         → /root/pasarguard-clone-<time>.tar.gz   (READ-ONLY: nothing is stopped or changed; a sqlite database is copied with sqlite3's online backup)
#   on the TARGET (a test server): bash pasarguard_clone.sh restore /root/pasarguard-clone-<time>.tar.gz [--dry] [--start]
#         → puts the files in place, BLOCKS the production nodes first (see below), and only starts the panel when you add --start.
#
# WHY THE NODES ARE BLOCKED: the clone knows the production nodes. A second panel talking to them would read their traffic counters (they reset when read, so
# production accounting loses data) and could push its own config to them. The restore refuses to continue unless it can block outgoing traffic to every node address.
# The clone is for testing inbounds / hosts / configs on its OWN xray: add a local node or use the built-in core of the clone.
#
# Settings (environment): PG_APP (default /opt/pasarguard) · PG_DATA (default /var/lib/pasarguard) · PG_OUT (default /root) · PG_IPTABLES (default iptables)
# The archive contains your customers' data and keys: keep it private and delete it when the test is over.
set -euo pipefail

APP="${PG_APP:-/opt/pasarguard}"; DATA="${PG_DATA:-/var/lib/pasarguard}"; OUT="${PG_OUT:-/root}"; IPT="${PG_IPTABLES:-iptables}"
say() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
mode="${1:-}"

dburl() { grep -E '^\s*SQLALCHEMY_DATABASE_URL' "$1/.env" 2>/dev/null | head -1 | sed -E 's/^[^=]*=//; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^["'"'"']//; s/["'"'"']$//' || true; }
sqlite_path() { local u="$1"; case "$u" in sqlite*) echo "${u#sqlite*:///}"; ;; *) echo ""; ;; esac; }

if [ "$mode" = backup ]; then
  [ -f "$APP/.env" ] || die "no PasarGuard here ($APP/.env missing). Set PG_APP=..."
  [ -d "$DATA" ] || die "no data folder ($DATA). Set PG_DATA=..."
  STAMP="$(date +%Y%m%d-%H%M%S)"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  mkdir -p "$TMP/app" "$TMP/data"
  cp -a "$APP/." "$TMP/app/"
  URL="$(dburl "$APP")"; DB="$(sqlite_path "$URL")"
  say "database: ${URL:-not set in .env (default sqlite)}"
  EXCL=(--exclude='*.log' --exclude='*.log.*')
  if [ -n "$DB" ] && [ -f "$DB" ]; then
    if command -v sqlite3 >/dev/null; then sqlite3 "$DB" ".backup '$TMP/db.sqlite3'"; say "sqlite database copied with the online backup (safe while the panel runs)"
    else cp "$DB" "$TMP/db.sqlite3"; say "WARNING: sqlite3 is not installed; the database was copied as a plain file while the panel runs (usually fine, install sqlite3 for a clean copy)"; fi
    EXCL+=(--exclude="${DB#$DATA/}")
    # the node addresses: the restore blocks them
    if command -v sqlite3 >/dev/null; then sqlite3 "$TMP/db.sqlite3" "SELECT address FROM nodes;" 2>/dev/null | sort -u > "$TMP/nodes.txt" || true; fi
    echo "$DB" > "$TMP/dbpath.txt"
  else
    echo "NOTE: the database is not sqlite ($URL). Dump it yourself and put the dump next to this archive, e.g. for MySQL/MariaDB in docker:" >&2
    echo "      docker compose -f $APP/docker-compose.yml exec -T <db service> mysqldump --single-transaction -u root -p<password> <database> > $OUT/pasarguard-db.sql" >&2
    echo "      and list the node addresses (SELECT address FROM nodes;) into a file nodes.txt next to it: the restore needs them to block the production nodes." >&2
  fi
  (cd "$DATA" && tar "${EXCL[@]}" -cf - .) | tar -xf - -C "$TMP/data"
  [ -f "$TMP/nodes.txt" ] || : > "$TMP/nodes.txt"
  FILE="$OUT/pasarguard-clone-$STAMP.tar.gz"
  tar -C "$TMP" -czf "$FILE" .
  chmod 600 "$FILE"
  say "done: $FILE ($(du -h "$FILE" | cut -f1)); nodes found: $(wc -l < "$TMP/nodes.txt" | tr -d ' ')"
  say "copy it to the TEST server (scp) and run:  bash pasarguard_clone.sh restore $FILE --dry"
  exit 0
fi

if [ "$mode" = restore ]; then
  FILE="${2:-}"; [ -f "$FILE" ] || die "usage: bash pasarguard_clone.sh restore <archive.tar.gz> [--dry] [--start]"
  DRY=0; START=0; for a in "${@:3}"; do [ "$a" = --dry ] && DRY=1; [ "$a" = --start ] && START=1; done
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  tar -C "$TMP" -xzf "$FILE"
  [ -f "$TMP/app/.env" ] || die "this archive has no app/.env — not a clone made by this script"
  say "archive: app $(find "$TMP/app" -type f | wc -l) files · data $(find "$TMP/data" -type f | wc -l) files · nodes listed: $(wc -l < "$TMP/nodes.txt" | tr -d ' ')"
  [ ! -e "$APP/.env" ] || die "$APP already has a PasarGuard install: this is for an EMPTY test server (remove it first if you are sure)"
  # 1) block the production nodes FIRST (before anything can start)
  BLOCKED="$OUT/pasarguard-clone-blocked-nodes.txt"; : > "$TMP/blocked.txt"
  if [ -s "$TMP/nodes.txt" ]; then
    command -v "$IPT" >/dev/null || die "$IPT is needed to block the production nodes (apt install iptables). Refusing to continue without it."
    while read -r host; do
      [ -n "$host" ] || continue
      ips="$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u || true)"; [ -n "$ips" ] || ips="$host"
      for ip in $ips; do say "block outgoing traffic to production node $host ($ip)"; [ "$DRY" = 1 ] || { "$IPT" -C OUTPUT -d "$ip" -j DROP 2>/dev/null || "$IPT" -I OUTPUT -d "$ip" -j DROP; echo "$ip" >> "$TMP/blocked.txt"; }; done
    done < "$TMP/nodes.txt"
    [ "$DRY" = 1 ] || cp "$TMP/blocked.txt" "$BLOCKED"
  else
    echo "WARNING: no node addresses in the archive. If the source panel has nodes, block them yourself BEFORE starting (iptables -I OUTPUT -d <ip> -j DROP)." >&2
  fi
  # 2) put the files in place
  say "installing the app to $APP and the data to $DATA"
  if [ "$DRY" = 1 ]; then say "dry run: nothing was written. Re-run without --dry."; exit 0; fi
  mkdir -p "$APP" "$DATA"
  cp -a "$TMP/app/." "$APP/"
  cp -a "$TMP/data/." "$DATA/"
  if [ -f "$TMP/db.sqlite3" ]; then
    DBP="$(cat "$TMP/dbpath.txt" 2>/dev/null || echo "$DATA/db.sqlite3")"; mkdir -p "$(dirname "$DBP")"; cp "$TMP/db.sqlite3" "$DBP"; say "database restored to $DBP"
  fi
  say "files are in place. BEFORE the first start check $APP/.env : the port, the domain / certificates, SUBSCRIPTION_URL_PREFIX — this is a TEST copy and must not use production's domain."
  if [ "$START" = 1 ]; then command -v docker >/dev/null || die "docker is not installed"; (cd "$APP" && docker compose up -d); say "started"; else say "not started. Start with:  cd $APP && docker compose up -d   (or re-run with --start)"; fi
  exit 0
fi
echo "usage: bash pasarguard_clone.sh backup | restore <archive.tar.gz> [--dry] [--start]"; exit 1
