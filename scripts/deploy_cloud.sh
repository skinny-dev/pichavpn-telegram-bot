#!/usr/bin/env bash
# Deploy the bot to Telegram Serverless from ANY machine that has Node.js + curl — no PHP server, no MySQL.
#   bash scripts/deploy_cloud.sh            # download the branch, update the project folder, npm install, tgcloud push
#   bash scripts/deploy_cloud.sh --dry      # same, but stop before npm / push (shows what would be deployed)
# Settings (environment): BRANCH (default: the working branch) · DEPLOY_DIR (default ~/picha-serverless-main)
#
# FIRST TIME on a new machine (what the old server kept for us):
#   1. mkdir -p ~/picha-serverless-main && cd ~/picha-serverless-main
#   2. copy the saved `.tgcloud` folder here (the login and the link to the app)  — or run:  npx tgcloud login
#   3. (optional) copy the saved tgcloud/lib/config.js; without it the bot runs by itself (native), which is what we want.
# Never put secrets in this script. The repository is public, so no token is needed.
set -euo pipefail

REPO="skinny-dev/pichavpn-telegram-bot"
BRANCH="${BRANCH:-claude/picha-bot-farsi-restore-uwlwar}"
DST="${DEPLOY_DIR:-$HOME/picha-serverless-main}"
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1

say() { echo "==> $*"; }
command -v node >/dev/null || { echo "ERROR: Node.js is needed (https://nodejs.org)"; exit 1; }
command -v curl >/dev/null || { echo "ERROR: curl is needed"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
say "downloading $BRANCH"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$TMP" --strip-components=1
SRC="$TMP/serverless-bot"
[ -f "$SRC/tgcloud/lib/config.js" ] || { echo "ERROR: the download has no serverless-bot/ (wrong BRANCH?)"; exit 1; }

mkdir -p "$DST"
KEEP="$TMP/keep-config.js"
[ -f "$DST/tgcloud/lib/config.js" ] && cp "$DST/tgcloud/lib/config.js" "$KEEP"
say "updating $DST (the login .tgcloud and node_modules stay)"
# files of older versions must not stay behind; the login (.tgcloud) and node_modules do
rm -rf "$DST/tgcloud" "$DST/dist" "$DST/tools"
(cd "$SRC" && tar --exclude=./test --exclude=./node_modules --exclude=./.tgcloud -cf - .) | tar -xf - -C "$DST"
if [ -f "$KEEP" ]; then cp "$KEEP" "$DST/tgcloud/lib/config.js"; say "kept your existing tgcloud/lib/config.js"; fi
[ -f "$DST/tgcloud/lib/config.js" ] && chmod 600 "$DST/tgcloud/lib/config.js" || true
N=$(find "$DST/tgcloud" -name '*.js' | wc -l | tr -d ' ')
say "modules in the app: $N (the platform allows 100)"
[ "$N" -le 100 ] || { echo "ERROR: more than 100 modules"; exit 1; }

if [ "$DRY" = 1 ]; then say "dry run: stopping before npm / push. Project folder: $DST"; exit 0; fi
cd "$DST"
[ -d .tgcloud ] || { echo "ERROR: no .tgcloud here — run:  cd $DST && npx tgcloud login   (or copy the saved .tgcloud folder)"; exit 1; }
say "npm install"
npm install --no-audit --no-fund >/dev/null
say "tgcloud push (answer y if it asks about modules that no longer exist)"
npx tgcloud push
say "done — check:  npx tgcloud run endpoints/admin_report '{\"tool\":\"diag\"}'"
