#!/usr/bin/env bash
# Run on the PASARGUARD panel server. Gives the groups "picha" and "free" the two Finland inbounds.
#   bash pasarguard_finland_groups.sh            # dry run: shows what it would do
#   bash pasarguard_finland_groups.sh --apply
# Inbounds default to the tags used today; override with TAGS="a b".
set -euo pipefail
C=${PG_DB_CONTAINER:-pasarguard-postgresql-1}
TAGS=${TAGS:-"finland-direct-tcp-reality finland-hetzner-tun"}
GROUPS_=${GROUPS_LIST:-"picha free"}
q() { docker exec -i "$C" psql -U pasarguard -d pasarguard -At -F '|' -c "$1"; }
echo "-- tables with 'group' in the name:"; q "select tablename from pg_tables where tablename like '%group%'"
ASSOC=$(q "select tablename from pg_tables where tablename like '%inbound%group%' or tablename like '%group%inbound%' limit 1")
[ -n "$ASSOC" ] || { echo "association table not found, stop"; exit 1; }
echo "-- association table: $ASSOC"; q "select column_name from information_schema.columns where table_name='$ASSOC'"
for t in $TAGS; do n=$(q "select count(*) from inbounds where tag='$t'"); echo "inbound $t: $n row(s)"; [ "$n" = 1 ] || { echo "!! inbound '$t' not known to the panel yet (the node on that core config must be connected once); stop"; exit 1; }; done
for g in $GROUPS_; do n=$(q "select count(*) from \"groups\" where name='$g'"); echo "group $g: $n row(s)"; [ "$n" = 1 ] || { echo "!! group '$g' not found"; exit 1; }; done
for g in $GROUPS_; do for t in $TAGS; do
  SQL="insert into $ASSOC (group_id, inbound_id) select g.id, i.id from \"groups\" g, inbounds i where g.name='$g' and i.tag='$t' and not exists (select 1 from $ASSOC a where a.group_id=g.id and a.inbound_id=i.id)"
  if [ "${1:-}" = "--apply" ]; then q "$SQL"; echo "added $t -> $g"; else echo "would run: $SQL"; fi
done; done
[ "${1:-}" = "--apply" ] || echo "(dry run; add --apply to write)"
