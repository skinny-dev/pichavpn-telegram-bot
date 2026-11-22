#!/usr/bin/env bash
# Run on the NEW Finland server as root:   bash finland_node_setup.sh
# Installs: Docker, PasarGuard node, Backhaul client (reverse tunnel to the Iran server), firewall.
# Nothing secret is stored in this file. Values come from environment variables or hidden prompts.
#   PANEL_IP        public IP of the PasarGuard panel server (only it may reach the node API)
#   IRAN_IP         public IP of the Iran server (Backhaul server side)
#   IRAN_TUNNEL_PORT port of the Backhaul server on the Iran side (default 3080)
#   NODE_PORT / NODE_API_PORT   node ports (defaults 62070 / 62071, same as the other hybrid nodes)
#   TCP_PORT        direct TCP inbound port (default 51140)
#   TUN_PORT        tunnel inbound port on this server (default 8087)
#   BH_TOKEN        Backhaul token (generated if empty; shown once for the Iran side)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
ask() { local n="$1" p="$2" d="${3:-}"; if [ -z "${!n:-}" ]; then read -r -p "$p${d:+ [$d]}: " v; printf -v "$n" '%s' "${v:-$d}"; fi; }
ask PANEL_IP "Panel server IP"
ask IRAN_IP "Iran server IP"
ask IRAN_TUNNEL_PORT "Iran Backhaul port" 3080
ask NODE_PORT "Node service port" 62070
ask NODE_API_PORT "Node API port" 62071
ask TCP_PORT "Direct TCP inbound port" 51140
ask TUN_PORT "Tunnel inbound port" 8087
BH_TOKEN="${BH_TOKEN:-$(head -c 24 /dev/urandom | base64 | tr -d '=+/' | head -c 24)}"

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

echo "== 3/5 Backhaul client"
if [ ! -x /usr/local/bin/backhaul ]; then
  T=$(mktemp -d)
  curl -fsSL -o "$T/b.tgz" https://github.com/Musixal/Backhaul/releases/latest/download/backhaul_linux_amd64.tar.gz
  tar -xzf "$T/b.tgz" -C "$T"; install -m 755 "$T/backhaul" /usr/local/bin/backhaul; rm -rf "$T"
fi
mkdir -p /etc/backhaul
cat > /etc/backhaul/client.toml <<TOML
[client]
remote_addr = "$IRAN_IP:$IRAN_TUNNEL_PORT"
transport = "tcp"
token = "$BH_TOKEN"
connection_pool = 8
aggressive_pool = false
keepalive_period = 75
dial_timeout = 10
retry_interval = 3
nodelay = true
log_level = "info"
TOML
chmod 600 /etc/backhaul/client.toml
cat > /etc/systemd/system/backhaul-client.service <<UNIT
[Unit]
Description=Backhaul client (tunnel to Iran)
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/usr/local/bin/backhaul -c /etc/backhaul/client.toml
Restart=always
RestartSec=3
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now backhaul-client

echo "== 4/5 firewall"
ufw allow 22/tcp >/dev/null
ufw allow from "$PANEL_IP" to any port "$NODE_PORT" proto tcp >/dev/null
ufw allow from "$PANEL_IP" to any port "$NODE_API_PORT" proto tcp >/dev/null
ufw allow "$TCP_PORT"/tcp >/dev/null            # direct TCP: public
# the tunnel port is reached only through Backhaul (loopback), so it stays closed to the world
ufw --force enable >/dev/null

echo "== 5/5 done"
cat <<MSG

Finland side is ready. Remaining steps:
 1. Panel > Nodes > Add: this server's IP, port $NODE_PORT, API port $NODE_API_PORT, same core config as the old Finland node.
 2. On the IRAN server create the Backhaul SERVER (save as /etc/backhaul/server.toml and run it the same way):

[server]
bind_addr = "0.0.0.0:$IRAN_TUNNEL_PORT"
transport = "tcp"
token = "$BH_TOKEN"
keepalive_period = 75
nodelay = true
channel_size = 2048
log_level = "info"
ports = ["$TUN_PORT"]

    (Iran listens on $TUN_PORT and Backhaul delivers it to 127.0.0.1:$TUN_PORT here, where the tunnel inbound must listen.)
 3. Check:  systemctl status backhaul-client   ·   ss -ltnp | grep -E ':($TCP_PORT|$TUN_PORT)'
Keep the token above private. It is not saved anywhere except /etc/backhaul/client.toml.
MSG
