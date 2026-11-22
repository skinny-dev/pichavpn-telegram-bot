#!/usr/bin/env bash
# Run on the NEW Finland server as root:   bash finland_node_setup.sh
# Installs: Docker, PasarGuard node, BackPack (https://github.com/AminMGMT/BackPack), firewall.
# Nothing secret is stored in this file. Values come from environment variables or hidden prompts.
#   PANEL_IP        public IP of the PasarGuard panel server (only it may reach the node API)
#   NODE_PORT / NODE_API_PORT   node ports (defaults 62070 / 62071, same as the other hybrid nodes)
#   TCP_PORT        direct TCP inbound port (default 51140)
#   TUN_PORT        tunnel inbound port on this server (default 8087)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
ask() { local n="$1" p="$2" d="${3:-}"; if [ -z "${!n:-}" ]; then read -r -p "$p${d:+ [$d]}: " v; printf -v "$n" '%s' "${v:-$d}"; fi; }
ask PANEL_IP "Panel server IP"
ask NODE_PORT "Node service port" 62070
ask NODE_API_PORT "Node API port" 62071
ask TCP_PORT "Direct TCP inbound port" 51140
ask TUN_PORT "Tunnel inbound port" 8087

echo "== 1/5 base packages"
apt-get update -y >/dev/null
apt-get install -y curl ca-certificates tar ufw >/dev/null

echo "== 2/5 PasarGuard node"
if [ ! -d /opt/pg-node ]; then
  bash -c "$(curl -sL https://github.com/PasarGuard/scripts/raw/main/pg-node.sh)" @ install
fi
ENVF=/opt/pg-node/.env
if [ -f "$ENVF" ]; then
  sed -i -E "s/^#?\s*SERVICE_PORT\s*=.*/SERVICE_PORT = $NODE_PORT/; s/^#?\s*API_PORT\s*=.*/API_PORT = $NODE_API_PORT/" "$ENVF"
else
  echo "!! $ENVF not found: set the node ports by hand"
fi
CERT=/var/lib/pg-node/certs/ssl_client_cert.pem
mkdir -p "$(dirname "$CERT")"
if [ ! -s "$CERT" ]; then
  echo "Paste the panel's node certificate (Panel > Nodes > Add > certificate), then press Ctrl-D:"
  cat > "$CERT"
fi
(cd /opt/pg-node && docker compose up -d)

echo "== 3/5 BackPack"
if ! command -v backpack >/dev/null; then
  bash <(curl -fsSL https://raw.githubusercontent.com/AminMGMT/BackPack/main/install.sh) </dev/null || true
fi
command -v backpack >/dev/null || echo "!! BackPack installer did not finish; run the install line from its README by hand"

echo "== 4/5 firewall"
ufw allow 22/tcp >/dev/null
ufw allow from "$PANEL_IP" to any port "$NODE_PORT" proto tcp >/dev/null
ufw allow from "$PANEL_IP" to any port "$NODE_API_PORT" proto tcp >/dev/null
ufw allow "$TCP_PORT"/tcp >/dev/null            # direct TCP: public
# the Finland side dials OUT to Iran; the tunnel inbound ($TUN_PORT) is reached through the tunnel only, so it stays closed
ufw --force enable >/dev/null

echo "== 5/5 done"
cat <<MSG

Finland side is ready. Remaining steps:
 1. Panel > Nodes > Add: this server's IP, port $NODE_PORT, API port $NODE_API_PORT, same core config as the old Finland node.
 2. On the IRAN server:  sudo backpack  >  1. Setup Iran  >  Reverse  >  TCP (simplest)  >  forwarded port: $TUN_PORT
    At the end it shows a one-line Setup Link (backpack://...). Treat it as a secret (it carries the token).
 3. On THIS server:      sudo backpack  >  2. Setup Kharej  >  Reverse  >  same transport  >  paste the Setup Link  >  Create This Tunnel
    (Iran then listens on $TUN_PORT and delivers it here to 127.0.0.1:$TUN_PORT, where the tunnel inbound must listen.)
 4. Check: sudo backpack > Manage > Status / Link Test   ·   ss -ltnp | grep -E ':($TCP_PORT|$TUN_PORT)'
MSG
