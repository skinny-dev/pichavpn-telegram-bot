#!/usr/bin/env bash
# Picha payment relay on the PasarGuard server (Apache + PHP + a Let's Encrypt certificate).
#   bash install.sh pay.theownlypwcha.top [IRAN_IP]
# With IRAN_IP, Variza payment links are made through an SSH tunnel to the Iranian server (Variza may refuse
# foreign servers); it asks the Iranian server's root password once to install a key.
# The domain must point to this server in Cloudflare with the grey cloud (DNS only) while the certificate is made.
# At the end it prints the /setrelay command to send to the bot (from an admin account).
set -euo pipefail
DOMAIN="${1:?usage: bash install.sh pay.example.com [IRAN_IP]}"
IRAN="${2:-}"
SRC="$(cd "$(dirname "$0")" && pwd)"
WEB=/var/www/picha-relay
DATA=/var/lib/picha-relay
CONF=/etc/picha-relay.php

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq apache2 php libapache2-mod-php php-curl certbot python3-certbot-apache >/dev/null

echo "== files"
mkdir -p "$WEB" "$DATA"
install -m 0644 "$SRC/index.php" "$WEB/index.php"
chown -R www-data:www-data "$DATA"
chmod 0700 "$DATA"
if [ ! -s "$CONF" ]; then
  KEY="$(openssl rand -hex 24)"
  printf "<?php\nconst RELAY_KEY = '%s';\nconst RELAY_DIR = '%s';\nconst VARIZA_PROXY = '';\n" "$KEY" "$DATA" > "$CONF"
fi
if [ -n "$IRAN" ]; then
  echo "== tunnel to the Iranian server $IRAN (for Variza)"
  K=/root/.ssh/picha_iran_tunnel
  [ -f "$K" ] || ssh-keygen -q -t ed25519 -N "" -C picha-iran-tunnel -f "$K"
  echo "the Iranian server's root password is asked once to install the key:"
  ssh-copy-id -i "$K.pub" -o StrictHostKeyChecking=accept-new "root@$IRAN"
  cat > /etc/systemd/system/picha-iran-tunnel.service <<UNIT
[Unit]
Description=Picha SOCKS tunnel through the Iranian server (Variza)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/ssh -N -D 127.0.0.1:1080 -i $K -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new root@$IRAN
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload && systemctl enable --now picha-iran-tunnel && sleep 3
  systemctl is-active --quiet picha-iran-tunnel && echo "✅ tunnel up" || echo "⚠️ tunnel did not start: journalctl -u picha-iran-tunnel"
  sed -i "s#^const VARIZA_PROXY = .*#const VARIZA_PROXY = 'socks5h://127.0.0.1:1080';#" "$CONF"
  grep -q VARIZA_PROXY "$CONF" || echo "const VARIZA_PROXY = 'socks5h://127.0.0.1:1080';" >> "$CONF"
fi
chown root:www-data "$CONF"
chmod 0640 "$CONF"

echo "== apache site $DOMAIN"
cat > /etc/apache2/sites-available/picha-relay.conf <<CONFEOF
<VirtualHost *:80>
    ServerName $DOMAIN
    DocumentRoot $WEB
    <Directory $WEB>
        Require all granted
        AllowOverride None
        FallbackResource /index.php
    </Directory>
    ErrorLog \${APACHE_LOG_DIR}/picha-relay-error.log
    CustomLog \${APACHE_LOG_DIR}/picha-relay-access.log combined
</VirtualHost>
CONFEOF
a2enmod -q php* >/dev/null 2>&1 || true
a2ensite -q picha-relay >/dev/null
apache2ctl configtest
systemctl reload apache2

echo "== certificate"
certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect >/dev/null

echo "== check"
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/pull")
[ "$code" = "401" ] && echo "✅ relay is up (https://$DOMAIN)" || echo "⚠️ https://$DOMAIN/pull answered $code (expected 401)"

KEY="$(php -r "require '$CONF'; echo RELAY_KEY;")"
cat <<DONE

Done. Three steps left:
 1) send this to the bot from your admin account (the bot deletes the message right away):
      /setrelay https://$DOMAIN $KEY
 2) Variza panel → webhook address:   https://$DOMAIN/variza
 3) SMS forwarder app → address:      https://$DOMAIN/sms   (same token as before)
DONE
