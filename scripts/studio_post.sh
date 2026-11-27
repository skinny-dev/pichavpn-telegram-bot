#!/usr/bin/env bash
# Put a ready post file (growth/content/*.json) into the Studio, and send it, from the project folder (where `npx tgcloud` is logged in).
#   bash studio_post.sh <file.json> [--bot] [--send <post-id>] [--live]
#     (no flags)   imports the posts as DRAFTS and shows the Studio state: nothing is sent
#     --bot        also tick «bot users» on the imported posts (default: the file decides; the outage file is channel only)
#     --send <id>  «send now» for that post (the same as the Mini App button). Needs the mode to be live to reach the channel.
#     --live       switch the Studio mode to live first (otherwise sim: only a preview to the administrators)
# The posts must pass the Studio rules (tone, buttons); a post that does not is refused with the reason.
set -euo pipefail
FILE="${1:?usage: studio_post.sh <file.json> [--bot] [--send <post-id>] [--live]}"; shift || true
SEND=""; BOT=""; LIVE=""
while [ $# -gt 0 ]; do case "$1" in --send) SEND="$2"; shift 2;; --bot) BOT=1; shift;; --live) LIVE=1; shift;; *) echo "unknown option $1"; exit 1;; esac; done
INPUT=$(node -e '
const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const o = { tool: "studio", import: f.posts };
if (process.argv[2]) o.toBot = true;
if (process.argv[3]) o.mode = "live";
if (process.argv[4]) o.send_now = [process.argv[4]];
process.stdout.write(JSON.stringify(o));
' "$FILE" "$BOT" "$LIVE" "$SEND")
npx tgcloud run endpoints/admin_report "$INPUT"
