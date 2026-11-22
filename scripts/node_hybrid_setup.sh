#!/usr/bin/env bash
# Run as root on a NEW foreign server (Finland, Germany, Netherlands, Poland, USA ...):
#   PANEL_IP=<panel public ip> bash node_hybrid_setup.sh
# Installs: PasarGuard node named "node-hybrid" (service port 62070, API port 62071), BackPack, firewall.
# The tunnel itself is linked afterwards by hand (Setup Link from the Iran side).
# No secrets live in this file; the node prints its own certificate and API key at the end.
#   PANEL_IP        (required) the panel server; only it may reach the node ports
#   NODE_NAME       default node-hybrid
#   SERVICE_PORT    default 62070      API_PORT  default 62071
#   TCP_PORT        default 51140 (direct inbound, public)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
NODE_NAME=${NODE_NAME:-node-hybrid}; SERVICE_PORT=${SERVICE_PORT:-62070}; API_PORT=${API_PORT:-62071}; TCP_PORT=${TCP_PORT:-51140}
if [ -z "${PANEL_IP:-}" ]; then read -r -p "Panel server IP: " PANEL_IP; fi
[ -n "$PANEL_IP" ] || { echo "PANEL_IP is required"; exit 1; }

echo "== 1/4 PasarGuard node ($NODE_NAME)"
apt-get update -y >/dev/null; apt-get install -y curl ca-certificates ufw >/dev/null
if ! systemctl list-unit-files | grep -q "^${NODE_NAME}-service"; then
  bash -c "$(curl -sL https://github.com/PasarGuard/scripts/raw/main/pg-node.sh)" @ install --name "$NODE_NAME"
fi
ENVF=$(find /opt /etc /var/lib -maxdepth 3 -name .env -path "*${NODE_NAME}*" 2>/dev/null | head -1 || true)
if [ -n "$ENVF" ]; then
  echo "env file: $ENVF"
  grep -qE '^\s*#?\s*SERVICE_PORT' "$ENVF" && sed -i -E "s/^\s*#?\s*SERVICE_PORT\s*=.*/SERVICE_PORT = $SERVICE_PORT/" "$ENVF" || echo "SERVICE_PORT = $SERVICE_PORT" >> "$ENVF"
  if grep -qE '^\s*#?\s*API_PORT' "$ENVF"; then sed -i -E "s/^\s*#?\s*API_PORT\s*=.*/API_PORT = $API_PORT/" "$ENVF"; fi
  systemctl restart "${NODE_NAME}-service" 2>/dev/null || "$NODE_NAME" restart || true
else
  echo "!! could not find the node .env: set the ports with:  $NODE_NAME edit-env"
fi

echo "== 2/4 BackPack"
if ! command -v backpack >/dev/null; then
  bash <(curl -fsSL https://raw.githubusercontent.com/AminMGMT/BackPack/main/install.sh) </dev/null || true
fi
command -v backpack >/dev/null || echo "!! BackPack did not install; run its README install line by hand"

echo "== 3/4 firewall"
ufw allow 22/tcp >/dev/null
ufw allow from "$PANEL_IP" to any port "$SERVICE_PORT" proto tcp >/dev/null
ufw allow from "$PANEL_IP" to any port "$API_PORT" proto tcp >/dev/null
ufw allow "$TCP_PORT"/tcp >/dev/null      # direct TCP: public. Tunnel ports stay closed (reached through the tunnel).
ufw --force enable >/dev/null

echo "== 4/4 node details for the panel (Nodes > Add)"
echo "address: $(curl -s4 ifconfig.me || echo '<this server ip>')   port: $SERVICE_PORT   api port: $API_PORT"
CD=$(find /var/lib -maxdepth 2 -type d -name certs -path "*${NODE_NAME}*" 2>/dev/null | head -1 || true)
[ -n "$CD" ] && { echo "--- certificate ($CD)"; cat "$CD"/ssl_cert.pem 2>/dev/null || ls "$CD"; }
[ -n "$ENVF" ] && { echo "--- API key"; grep -E '^\s*API_KEY' "$ENVF" || true; }
cat <<MSG

Next:
 1. Panel > Nodes > Add (use the details above; core config = the one of the server this replaces).
 2. Tunnel: on the Iran server  sudo backpack > Setup Iran > Reverse > TCP > forwarded port (see table);
    then here  sudo backpack > Setup Kharej > Reverse > same transport > paste the Setup Link.
 3. DNS: point the host's name(s) at this server. Check: ss -ltnp | grep -E ':($TCP_PORT|<tunnel port>)'
MSG
