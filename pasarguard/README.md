# PasarGuard server: subscription page and old links

## 1) Persian subscription page (dmc.theownlypwcha.top/sub/…)
On the PasarGuard server:
```
mkdir -p /var/lib/pasarguard/templates/subscription
curl -fsSL -o /var/lib/pasarguard/templates/subscription/index.html \
  https://fa-bot.theownlypwcha.top/pasarguard/templates/subscription/index.html
grep -q '^CUSTOM_TEMPLATES_DIRECTORY' /opt/pasarguard/.env || echo 'CUSTOM_TEMPLATES_DIRECTORY="/var/lib/pasarguard/templates/"' >> /opt/pasarguard/.env
grep -q '^SUBSCRIPTION_PAGE_TEMPLATE' /opt/pasarguard/.env || echo 'SUBSCRIPTION_PAGE_TEMPLATE="subscription/index.html"' >> /opt/pasarguard/.env
cd /opt/pasarguard && docker compose up -d
```
Apps still receive their configs; the page is only what a browser sees.

## 2) New links straight from the panel
On the bot server: `php scripts/sub_mode.php native`

## 3) Old links (fa-bot…/sub/<order>) when the bot server goes away
1. bot server: `php scripts/sub_links_map.php` → copy /root/picha-sub-map.txt to the PasarGuard server as /etc/apache2/picha-sub-map.txt
2. PasarGuard server: certificate for fa-bot.theownlypwcha.top, then `cp apache-sub-redirect.conf /etc/apache2/sites-available/picha-sub.conf && a2enmod rewrite ssl && a2ensite picha-sub && apache2ctl configtest && systemctl reload apache2`
3. point fa-bot.theownlypwcha.top to the PasarGuard server's IP.
