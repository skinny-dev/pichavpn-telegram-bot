# Maintenance bot
Replies to every message with the "bot is updating, contact @pichanet_support" text.

1. Copy this folder to the server web root, e.g. /var/www/html/maintenance/ (HTTPS required by Telegram).
2. `echo 'YOUR_BOT_TOKEN' > maintenance/token.txt`
3. Point Telegram at it (replaces the current webhook):
   curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR_DOMAIN/maintenance/index.php"
4. To go back to the real bot, set the webhook back to the mirzabot `index.php` URL.
