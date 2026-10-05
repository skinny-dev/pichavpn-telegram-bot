# Maintenance bot

Replies to every private message (and button press) with the "bot is updating" notice from `message.txt`.

**It uses long polling**: the server only makes outbound HTTPS calls to Telegram. No domain, SSL certificate,
nginx/Apache or open port is needed, and it can run next to anything (including your xray node).

## Install (one command, as root)
    curl -fsSL https://raw.githubusercontent.com/skinny-dev/pichavpn-telegram-bot/claude/picha-bot-farsi-restore-uwlwar/maintenance/install.sh | sudo bash -s -- --token YOUR_BOT_TOKEN --yes

Without `--token` it asks for it (input hidden). Re-running is safe. It installs a systemd service
(`picha-maintenance`, unprivileged user, restarts itself, starts on boot) and the `picha-maint` command.

> Starting it **removes the bot's webhook** (Telegram allows either a webhook or polling). To bring the real bot back:
> `picha-maint stop`, then re-run the real bot's `php table.php` (it sets its own webhook).

## Day to day
| command | what it does |
|---|---|
| `picha-maint status` | running? restarts, chats served, last log lines |
| `picha-maint follow` | live log |
| `picha-maint logs 200` / `errors` / `journal` | last lines / warnings+errors only / systemd journal |
| `picha-maint messages` | last handled messages (JSON lines) |
| `picha-maint check` | diagnostics: DNS, IPv4/IPv6 reachability, token, webhook, disk |
| `picha-maint test <chat_id>` | send the notice to your own Telegram id |
| `picha-maint edit` | change the text (picked up within a minute, no restart) |
| `picha-maint set-token` / `stop` / `start` / `uninstall` | |

## What is logged
`/var/log/picha-maintenance/bot.log` (rotated, 5×5 MB): startup config, authentication, webhook removal, every update
(`update=… chat=… user=@name(id) text="first 60 chars" -> replied message_id=… in 120ms`), cooldown skips, ignored
groups, blocked users (403), rate limits (429), network errors with back-off, 409 conflicts, a heartbeat every 5 minutes.
`messages.jsonl` has one JSON object per update for analysis. The bot token is masked everywhere.
Set `PICHA_LOG_TEXT=0` in `/etc/picha-maintenance.env` to stop logging message text.

## Behaviour
- Replies once per chat per 10 s (`PICHA_COOLDOWN`), also across restarts, so backlogs never spam anyone.
- Private chats only; groups are ignored.
- Network down: keeps retrying (1 s → 60 s). Token revoked (401): stops and says so (no restart loop).

## Tests
`python3 tests/maintenance_test.py` (fake Telegram: duplicates, groups, 429, 403, 502, 409, restart, bad token) and
`python3 tests/maintenance_install_test.py` (installer + helper in a sandbox root).

## Legacy
`index.php` is the old webhook version (needs HTTPS + web server + PHP). Kept only for reference; use the polling bot.
