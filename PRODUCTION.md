# Going live on a fresh server (fa-bot.theownlypwcha.top)

Everything below is tested except the steps that need your real Telegram bot, VPN panel and bank
(those are covered by the health check, which tells you PASS / WARN / FAIL before customers arrive).

## 0. What you need before you start
- A fresh Ubuntu 22.04/24.04 server (root access), ≥ 2 GB RAM, ports 22/80/443 reachable.
- DNS **A record** `fa-bot.theownlypwcha.top` → the new server IP. On Cloudflare use **DNS only** (grey cloud) until the certificate exists.
- The **live bot token** from @BotFather (`/revoke` for the live bot → new token). Never paste it in chat or tickets.
- The code tarball and a backup of the data (see steps 2 and 3). The repo is private: no tokens are needed on the server.

## 1. Base install (once, on the new server)
Run the same Mirza installer you used for the dev server. Answer: domain `fa-bot.theownlypwcha.top`, the **live** bot token,
your admin Telegram id. It installs Apache, PHP, MySQL, the SSL certificate and the bot.

## 2. Package the code (on your PC, Git Bash)
```bash
cd /c/Users/skinny/Documents/github/pichavpn-telegram-bot
git config core.autocrlf false
git pull origin claude/picha-bot-farsi-restore-uwlwar
git archive --prefix=p/ -o /tmp/picha.tgz --format=tar.gz HEAD
scp /tmp/picha.tgz root@NEW_SERVER_IP:/root/picha.tgz
```

## 3. Package the data (on the dev server)
```bash
bash /var/www/html/mirzaprobotconfig/scripts/picha-backup.sh        # -> /root/picha-backups/*.enc (+ .sha256)
```
Copy the newest `.enc`, its `.sha256` and `/root/.picha-backup-pass` to the new server's `/root/` (`scp` from the dev server). Delete the password file from dev afterwards.
Optional: clean your own test payments first (dry run lists everything, changes nothing):
```bash
php scripts/clean_test_data.php --users=YOUR_ID,TESTER_ID --since=2026-10-05
php scripts/clean_test_data.php --users=YOUR_ID,TESTER_ID --since=2026-10-05 --apply   # saves a SQL copy first
```
Then delete the printed panel users by hand in PasarGuard and reset test wallets.

## 4. One command on the new server
```bash
# copy scripts/golive.sh out of the tarball once (it is not on the server yet)
tar xzf /root/picha.tgz -O --wildcards '*/scripts/golive.sh' > /root/golive.sh
sudo bash /root/golive.sh --domain fa-bot.theownlypwcha.top --tarball /root/picha.tgz \
     --db-backup /root/picha_backup_XXXX.tgz.enc --passfile /root/.picha-backup-pass --set-token --harden
```
Add `--dry-run` first to see the plan. The script, in order:
1. normalises Windows line endings and deploys the code (never overwrites `config.php`, never ships the installer);
2. verifies the backup in a temporary database, asks you to type `IMPORT`, then restores **only the database** (this server's `config.php` is kept and checked unchanged);
3. asks for the live token (hidden), checks it with Telegram, writes `APIKEY` + `usernamebot`;
4. forces the blind auto-approve timer OFF, runs `php table.php` (schema + webhook), fixes permissions;
5. creates the backup password file (**copy it off the server**) and schedules the daily encrypted backup;
6. `--harden`: opens only 22/80/443 in ufw (SSH settings are never changed automatically);
7. runs the health check (`scripts/golive_check.php`).
It starts the scheduled jobs only with `--start-cron` and only if the health check has **no FAIL**.

You can run the health check any time: `php scripts/golive_check.php --domain=fa-bot.theownlypwcha.top`.

## 5. Smoke test with real money (10 minutes) — then start the jobs
1. `/start` the live bot from your own account: menu appears.
2. Card-to-card top-up (receipt photo) → admins get ✅/❌ → approve → wallet credited.
3. Buy the cheapest plan → config arrives → connect with a client → check the user in PasarGuard.
4. Press «پرداخت کردم» on a Variza invoice if Variza is on (the receipt button waits 5 minutes; see PICHA.md).
5. Everything good: `sudo systemctl enable --now cron` (expiry/renewal reminders to real customers start now).
   **Keep cron stopped on the dev server forever**: it holds a copy of the customer list.

## 6. Rollback (no data is deleted by any step)
- Put the maintenance notice back: `picha-maint start`.
- Or restore the previous config: `cp /root/config.php.before-golive.* /var/www/html/mirzaprobotconfig/config.php && php table.php`.
- `systemctl stop cron` if the jobs misbehave. The database copy from before the restore is in `/root/pre-golive-*.sql`.

## 7. First week
- Check `php scripts/golive_check.php` daily; read the report group's errors topic.
- Test one restore: `bash scripts/picha-restore.sh /root/picha-backups/LATEST.enc --verify`.
- Rotate every secret that was ever pasted in chat/tickets: PasarGuard admin password, bot tokens (dev and live), web-panel passwords, GitHub tokens, SMS forwarder token. Use SSH keys and turn off root password login.
- Agents (`agent` n / n2) have no products by default; give them products or set them to `f`.
- SMS auto-approval is **off** by default (later: `php scripts/sms_setup.php token` then `on`).
