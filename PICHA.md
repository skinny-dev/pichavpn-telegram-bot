
## Statistics & accounting (stats_report.php)
Admin stats menu now shows: کل / یک ساعت اخیر / امروز / دیروز / ماه فعلی / ماه قبل (Jalali months, Asia/Tehran).
- Revenue = orders + renewals + extra volume + wallet charges. Net = revenue - expenses - wallet withdrawals.
- Record costs / capital (admins only), in the bot chat:
  `/expense 150000 توضیحات`   `/capital 5000000 توضیحات`
- Emergency internet volume = products whose name contains «اضطراری».
- Statistics follow a cash-basis, wallet-aware model (see the header of `stats_report.php`); they also read Mirza Pro data (`cost`, `capital_injection`, `wallet_withdraw`, `auto_renew`) when present.

## Picha Panel (dashboard/)
Mobile-first, RTL admin panel (React + Tailwind + shadcn/ui components). Open `https://YOUR_DOMAIN/dashboard/`.
Log in with the bot's `admin` table credentials (role `administrator`).

- **Overview / Statistics** (all, last hour, today, yesterday, this month, last month) — same numbers as the bot's stats report.
- **Users, Orders, Products, Categories, Payments, Expenses, Capital**: spreadsheet-style grids. Double-click or Enter edits a cell;
  arrows/Tab move; Paste from Excel/Sheets works; on phones, tap a cell to edit in a sheet.
  Changing a user's balance writes an `add/low balance by admin` payment row so the accounting stays correct.
- **Products tree**: drag categories and products (also between categories); order is saved to `sort_order`.
- **Import / export** on every grid: CSV, Excel, JSON. Import checks the file first (dry run) and applies all-or-nothing.
- Code: `dashboard/api.php` (JSON API), `dashboard-src/` (frontend source). The built files in `dashboard/` are committed, so the server needs no Node.
  Rebuild: `cd dashboard-src && npm ci && npm run build`.
- Tests: `python3 tests/api_test.py URL admin PASS` (needs `tests/seed_test_db.sql` loaded), `cd dashboard-src && npm test`,
  `node tests/panel_e2e.mjs` (Playwright, needs `npm i playwright-core`).
- The old server-rendered `panel/` is untouched and still works.

## Deploying this branch to a bot server (use the script, not a raw tar extract)
    curl -fsSL -o /root/deploy.sh https://raw.githubusercontent.com/skinny-dev/pichavpn-telegram-bot/claude/picha-bot-farsi-restore-uwlwar/scripts/deploy.sh
    sudo bash /root/deploy.sh
It backs up `config.php`, copies the code, **never** copies the web installer (`install/`: while it exists the bot's `.htaccess` answers
403 to every request, including Telegram), config, backups, tests or dev sources, fixes ownership, runs `php table.php`, reloads Apache and
self-tests the webhook URL. Bot folder: `/var/www/html/mirzaprobotconfig`.
