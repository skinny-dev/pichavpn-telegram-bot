#!/usr/bin/env bash
# Picha maintenance bot installer. Ubuntu/Debian with systemd. No domain, SSL or web server needed.
#
#   sudo bash install.sh                      # asks for the bot token
#   sudo bash install.sh --token 123:ABC --yes
#   curl -fsSL https://raw.githubusercontent.com/skinny-dev/pichavpn-telegram-bot/claude/picha-bot-farsi-restore-uwlwar/maintenance/install.sh | sudo bash -s -- --token 123:ABC --yes
set -euo pipefail

RAW_BASE="${PICHA_RAW_BASE:-https://raw.githubusercontent.com/skinny-dev/pichavpn-telegram-bot/claude/picha-bot-farsi-restore-uwlwar/maintenance}"
ROOT="${PICHA_ROOT:-}"                       # only used by tests
APP="$ROOT/opt/picha-maintenance"
ENVF="$ROOT/etc/picha-maintenance.env"
LOGD="$ROOT/var/log/picha-maintenance"
STATED="$ROOT/var/lib/picha-maintenance"
UNIT="$ROOT/etc/systemd/system/picha-maintenance.service"
BIN="$ROOT/usr/local/bin/picha-maint"
SVC_USER="picha-maint"
TOKEN="${PICHA_BOT_TOKEN:-}"
YES=0

C0=$'\e[0m'; CG=$'\e[32m'; CR=$'\e[31m'; CY=$'\e[33m'; CB=$'\e[1m'
step() { echo; echo "${CB}==> $*${C0}"; }
ok()   { echo "  ${CG}✔${C0} $*"; }
warn() { echo "  ${CY}!${C0} $*"; }
die()  { echo "  ${CR}✘ $*${C0}" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$ROOT" ] || [ "$(id -u)" -eq 0 ] || die "run as root:  sudo bash install.sh"

step "1/7 Checking the system"
if [ -z "$ROOT" ]; then
  command -v systemctl >/dev/null || die "systemd not found (this installer needs systemd)"
  ok "systemd present"
fi
if ! command -v python3 >/dev/null; then
  warn "python3 missing, installing it"
  apt-get update -qq && apt-get install -y -qq python3 >/dev/null || die "could not install python3"
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,8) else 1)' || die "Python 3.8+ required (found $(python3 -V 2>&1))"
ok "$(python3 -V 2>&1)"
command -v curl >/dev/null || [ -f "$(dirname "$0")/bot.py" ] || { apt-get install -y -qq curl >/dev/null || die "curl is required"; }

step "2/7 Bot token"
if [ -z "$TOKEN" ]; then
  if { : </dev/tty; } 2>/dev/null; then
    printf "  Paste the bot token from @BotFather (input hidden): " >/dev/tty
    read -rs TOKEN </dev/tty; echo >/dev/tty
  else
    die "no token given. Use:  --token 123456:ABC..."
  fi
fi
[[ "$TOKEN" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{20,}$ ]] || die "that does not look like a bot token (expected 123456789:AA...)"
ok "token format looks right"

step "3/7 Downloading files"
SRC_DIR=""
# Only trust local files when running from a real script file (not `curl | bash`).
if [ -f "${BASH_SOURCE[0]:-}" ]; then SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
mkdir -p "$APP" "$LOGD" "$STATED" "$(dirname "$ENVF")" "$(dirname "$UNIT")" "$(dirname "$BIN")"
fetch() {  # fetch NAME DEST
  if [ -n "$SRC_DIR" ] && [ -f "$SRC_DIR/$1" ]; then cp "$SRC_DIR/$1" "$2"
  else curl -fsSL --retry 4 --retry-delay 2 --max-time 60 "$RAW_BASE/$1" -o "$2" || die "download failed: $RAW_BASE/$1"; fi
}
fetch bot.py "$APP/bot.py"
grep -q "picha-maintenance" "$APP/bot.py" || die "bot.py looks wrong (is the repo private? download an archive and run install.sh from it)"
fetch picha-maint "$BIN"
[ -f "$APP/message.txt" ] || fetch message.txt "$APP/message.txt"
chmod 755 "$APP/bot.py" "$BIN"
python3 -m py_compile "$APP/bot.py" && ok "bot.py installed ($(python3 "$APP/bot.py" version))"
ok "helper command installed: picha-maint"

step "4/7 Configuration"
umask 077
printf 'PICHA_BOT_TOKEN=%s\n' "$TOKEN" > "$ENVF"
chmod 600 "$ENVF"
ok "token saved to $ENVF (root only)"
if [ -z "$ROOT" ] && ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
  ok "created service user $SVC_USER"
fi
umask 022
if [ -z "$ROOT" ]; then chown -R "$SVC_USER":"$SVC_USER" "$LOGD" "$STATED"; fi
chmod 755 "$APP"; chmod 644 "$APP/message.txt"

step "5/7 Checking Telegram"
set +e
CHECK_OUT="$(PICHA_BOT_TOKEN="$TOKEN" PICHA_LOG_DIR="$LOGD" PICHA_STATE_DIR="$STATED" python3 "$APP/bot.py" check 2>&1)"
CHECK_RC=$?
set -e
echo "$CHECK_OUT" | sed 's/^/  /'
if echo "$CHECK_OUT" | grep -qi "unauthorized"; then rm -f "$ENVF"; die "Telegram rejected this token. Copy it again from @BotFather. (nothing was started)"; fi
if [ $CHECK_RC -ne 0 ]; then warn "some checks failed (see above). The service will keep retrying, but fix those first if the bot stays silent."; fi
if echo "$CHECK_OUT" | grep -q "webhook currently set" && [ "$YES" -ne 1 ]; then
  echo
  warn "This bot currently has a webhook. Starting maintenance mode REMOVES it (the real bot stops receiving messages until you set its webhook again)."
  if { : </dev/tty; } 2>/dev/null; then
    printf "  Continue? [y/N] " >/dev/tty; read -r ans </dev/tty
    [[ "$ans" =~ ^[Yy] ]] || die "cancelled. Nothing was started."
  else die "re-run with --yes to confirm"; fi
fi

step "6/7 Creating the service"
cat > "$UNIT" <<UNITEOF
[Unit]
Description=Picha maintenance bot (replies with the 'bot is updating' notice)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
EnvironmentFile=/etc/picha-maintenance.env
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/env python3 /opt/picha-maintenance/bot.py run
Restart=always
RestartSec=5
RestartPreventExitStatus=2
User=$SVC_USER
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/picha-maintenance /var/lib/picha-maintenance

[Install]
WantedBy=multi-user.target
UNITEOF
ok "systemd unit written"

step "7/7 Starting"
if [ -z "$ROOT" ]; then
  systemctl daemon-reload
  systemctl enable --now picha-maintenance >/dev/null 2>&1
  sleep 4
  if systemctl is-active --quiet picha-maintenance; then ok "service is running"; else
    echo "${CR}  service is NOT running. Last log lines:${C0}"; journalctl -u picha-maintenance -n 25 --no-pager | sed 's/^/    /'; die "see above"; fi
  tail -n 8 "$LOGD/bot.log" 2>/dev/null | sed 's/^/    /' || true
else
  ok "(test mode: service not started)"
fi

cat <<DONE

${CG}${CB}Maintenance bot is live.${C0}  Send a message to the bot to see the notice.

  picha-maint status      is it running, who was served, last log lines
  picha-maint follow      watch the log live (Ctrl+C to leave)
  picha-maint logs 100    last 100 log lines          picha-maint errors   warnings/errors only
  picha-maint messages    last handled messages       picha-maint stats    totals
  picha-maint check       full diagnostics            picha-maint test <chat_id>   send a test notice
  picha-maint edit        change the notice text (applies within a minute)
  picha-maint stop        stop maintenance mode (then restore the real bot's webhook)
  picha-maint uninstall

Logs: $LOGD/bot.log  (readable) and messages.jsonl (one JSON line per message)
DONE
