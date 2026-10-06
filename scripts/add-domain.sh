#!/usr/bin/env bash
# Add a hostname to the existing bot: Apache sites (80 + 443), Let's Encrypt certificate (webroot), auto-renew.
#   sudo bash add-domain.sh fa-bot.example.com [--dry-run] [--force-dns]
# Needs: the DNS A record already points to this server (Cloudflare: "DNS only"), Apache + certbot installed.
# Safe to re-run. Existing sites are left alone; phpMyAdmin is NOT exposed on the new hostname.
set -uo pipefail
DOM="${1:-}"; shift || true
DRY=0; FORCE=0; APP="${APP_DIR:-/var/www/html/mirzaprobotconfig}"
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --force-dns) FORCE=1;; esac; done
die() { echo "STOPPED: $*" >&2; exit 1; }
say() { printf '==> %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then echo "    [dry-run] $*"; else "$@"; fi; }
[[ "$DOM" =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || die "usage: add-domain.sh your.domain.com"
[ "$DRY" = 1 ] || [ "$(id -u)" -eq 0 ] || die "run as root"
[ -d "$APP" ] || die "bot folder $APP not found"
command -v apache2ctl >/dev/null || command -v apachectl >/dev/null || die "Apache is not installed"
command -v certbot >/dev/null || die "certbot is not installed (apt install certbot)"
AC="$(command -v apache2ctl || command -v apachectl)"

say "DNS"
MYIP="$(curl -s --max-time 8 https://api.ipify.org)"; DNSIP="$(getent hosts "$DOM" | awk '{print $1}' | head -1)"
echo "    this server: ${MYIP:-unknown}   $DOM -> ${DNSIP:-no record}"
if [ -z "$DNSIP" ]; then die "$DOM does not resolve yet"; fi
if [ -n "$MYIP" ] && [ "$DNSIP" != "$MYIP" ] && [ "$FORCE" != 1 ]; then die "$DOM points to $DNSIP, not to this server ($MYIP). Cloudflare: set the record to DNS only (grey cloud). Use --force-dns to override."; fi

AV=/etc/apache2/sites-available; HTTPCONF="$AV/$DOM.conf"; SSLCONF="$AV/$DOM-ssl.conf"
vhost80() { cat <<V
<VirtualHost *:80>
    ServerName $DOM
    DocumentRoot $APP
    <Directory $APP>
        Options FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    ErrorLog \${APACHE_LOG_DIR}/$DOM-error.log
    CustomLog \${APACHE_LOG_DIR}/$DOM-access.log combined
</VirtualHost>
V
}
vhost443() { cat <<V
<VirtualHost *:443>
    ServerName $DOM
    DocumentRoot $APP
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/$DOM/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$DOM/privkey.pem
    <Directory $APP>
        Options FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    ErrorLog \${APACHE_LOG_DIR}/$DOM-ssl-error.log
    CustomLog \${APACHE_LOG_DIR}/$DOM-ssl-access.log combined
</VirtualHost>
V
}
reload() { run "$AC" configtest 2>&1 | tail -1; if [ "$DRY" != 1 ]; then "$AC" configtest >/dev/null 2>&1 || die "Apache config test failed (nothing was reloaded)"; fi; run systemctl reload apache2; }

say "HTTP site"
if [ "$DRY" = 1 ]; then echo "    [dry-run] write $HTTPCONF, a2ensite"; else vhost80 > "$HTTPCONF"; a2ensite "$DOM.conf" >/dev/null; fi
a2enmod ssl rewrite >/dev/null 2>&1; reload

say "Certificate"
if [ -f "/etc/letsencrypt/live/$DOM/fullchain.pem" ] && openssl x509 -checkend 1209600 -noout -in "/etc/letsencrypt/live/$DOM/fullchain.pem" >/dev/null 2>&1; then
  echo "    a valid certificate already exists, keeping it"
else
  run certbot certonly --webroot -w "$APP" -d "$DOM" --non-interactive --agree-tos || die "certbot failed (DNS not reaching this server? port 80 blocked? see /var/log/letsencrypt/letsencrypt.log)"
fi

say "HTTPS site"
if [ "$DRY" = 1 ]; then echo "    [dry-run] write $SSLCONF, a2ensite"; else vhost443 > "$SSLCONF"; a2ensite "$DOM-ssl.conf" >/dev/null; fi
reload

say "Auto-renew"
if systemctl list-timers --all 2>/dev/null | grep -qi certbot || [ -f /etc/cron.d/certbot ] || [ -f /etc/cron.d/certbot-renew ]; then
  echo "    renewal is already scheduled"
else
  if [ "$DRY" = 1 ]; then echo "    [dry-run] install /etc/cron.d/certbot-renew"; else
    echo '17 3 * * * root certbot renew -q --deploy-hook "systemctl reload apache2"' > /etc/cron.d/certbot-renew; echo "    installed a daily renewal job"; fi
fi

say "Check"
if [ "$DRY" != 1 ]; then
  curl -sI --max-time 15 "https://$DOM" | head -1
  echo | openssl s_client -servername "$DOM" -connect "$DOM:443" 2>/dev/null | openssl x509 -noout -subject -enddate
fi
echo "Done: https://$DOM is served by the bot folder $APP"
