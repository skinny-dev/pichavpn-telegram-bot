
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

## Premium (custom) emoji
Applied at send time to every HTML message, caption and button label; nothing in `lang/*.php` or the database is rewritten.
    php scripts/premium_emoji.php import https://t.me/addemoji/PACKNAME   # repeat for more packs
    php scripts/premium_emoji.php coverage                               # which emoji the bot uses and which have no premium version yet
    php scripts/premium_emoji.php test YOUR_CHAT_ID                      # real test: does Telegram accept them for this bot?
    php scripts/premium_emoji.php off                                    # back to plain emoji instantly
Admins can also type a premium emoji into product/category/panel names (the "no HTML" check accepts that exact tag only).
If Telegram refuses custom emoji for the bot, the existing fallback in `botapi.php` sends normal emoji, so nothing breaks.
Tests: `php tests/premium_emoji_test.php`.

### Premium emoji: aliases and catalog
- **Aliases** let an emoji the pack lacks borrow a close premium one (✅→✔, 💰→💵, 🛒→🛍, 💀→🚨 ...). `php scripts/premium_emoji.php alias list`.
- **Catalog emoji** (`catalog on`): product and category *buttons* get a fitting emoji (⚡ ≤25 GB, ⭐ ≤100, 💎 ≤250, 👑 above, 🔥 unlimited, 🚨 emergency, 🗓 monthly categories).
  Display only: names in the database are never changed, because renewals look products up by name. `catalog preview` shows the result for your real catalog.

## Card-to-card auto-approval (Mirza SMS Forwarder + Blu)

How it works: when SMS auto-approval is on, each card-to-card top-up gets a unique amount
(your price + 1..999 toman, never shared by two open orders). The forwarder app sends the
bank's «واریز پول» SMS to `payment/sms_webhook.php`; the bot converts rial→toman, finds the
single open order with that exact amount (created within `sms_match_window` minutes, default
180) and approves it atomically. Withdrawals are ignored; replayed SMS are ignored
(fingerprint); no match / two matches go to the payment-report topic for manual review.

Setup (on the server, in the bot folder):
```
php table.php                       # creates sms_inbox + settings
php scripts/sms_setup.php token     # prints the token + webhook URL (shown once)
php scripts/sms_setup.php on        # enable (off = nothing changes for customers)
php scripts/sms_setup.php status    # state + last 15 SMS
```
In the app → Webhook tab: Webhook URL = the printed URL, Admin token = the printed token,
Bank code `blu`, "must contain" `بلو`. Use "Test webhook reachability".
Log of every request (token never logged): `storage/sms_webhook.log`.
Rotate the token any time with `scripts/sms_setup.php token` (update the app after).
The old built-in blind timer `autoconfirmcart` must stay OFF.
Tests: `php tests/sms_pay_test.php`.

Catch-up (no need to pay again): every deposit SMS is kept in `sms_inbox`. If a deposit arrived
before its order existed, the customer pressing «پرداخت کردم» makes the bot approve the order from
the stored deposit (exact amount, one unclaimed deposit, received ≤15 min before the order, <24h old).
A message the server missed can be stored by hand: put the Blu texts in a file and run
`php scripts/sms_setup.php import file.txt`, then the customer presses «پرداخت کردم».

## Variza: manual receipt fallback
Every Variza invoice has a «📎 پرداخت کردم، ارسال رسید» button. It is refused until `variza_receipt_delay` minutes (default 5) have
passed since the invoice was created (the customer gets an alert with the remaining minutes). After that the customer sends a receipt
photo and the admins get the same ✅/❌ buttons as card-to-card (plus a note that this is a Variza receipt to verify in the Variza
dashboard or the bank). Safe by construction: approval is one atomic claim (`paid` can be set once), so a later Variza webhook, an SMS
or a second admin click can never credit the order twice; a receipt cannot reopen an order that is already paid/rejected/expired;
only the order's owner can attach a receipt; one receipt per order, and re-submits are rate limited.
Change the delay: `UPDATE PaySetting SET ValuePay='10' WHERE NamePay='variza_receipt_delay';` (minutes).

## Sale status for categories and products
- **Categories**: bot admin → 🏬 تنظیمات فروشگاه → 🗂 مدیریت دسته بندی → **🚦 وضعیت فروش دسته بندی**; tap a category to switch 🟢 موجود ↔ 🔴 ناموجود.
  A sold-out category stays in the buy list with the label «ناموجود», cannot be opened, and none of its products can be bought. Renewals of existing services are unaffected.
- **Products**: ✏️ ویرایش محصول → choose panel, customer type, product → **🚦 وضعیت فروش** (bottom keyboard).
- **Web panel**: both have a «وضعیت فروش» column (dropdown) in the Products / Categories tables.
Tests: `php tests/category_status_test.php`, `python3 tests/api_test.py URL admin PASS`.

### Premium emoji on the bottom menu (reply keyboard) — opt-in
    php scripts/premium_emoji.php replytest YOUR_ID   # sends a bottom keyboard with 2 premium icons: do you SEE them?
    php scripts/premium_emoji.php reply on            # yes -> the whole bottom menu gets premium icons
    php scripts/premium_emoji.php reply off           # instant way back
With `reply on`: every bottom-menu label that starts with a mapped emoji gets that emoji as its premium icon, and a label you edit in
the bot (button text editor) with a premium emoji applies as well. Taps come back as the text without the emoji; the bot remembers every
converted label (`storage/premium_reply_labels.json`) and the edited labels (existing label map) and matches them back, so every handler still works.
Whether the icon is actually drawn depends on Telegram (bot allowance and app version): that is why `replytest` exists. Inline buttons use `buttons on|off`.
Tests: `php tests/premium_emoji_test.php`.


## Welcome message with guide buttons
`/start` sends the welcome text with **🚀 شروع سریع | 📥 نصب و اتصال | 🔄 تمدید | 🛠 رفع مشکل** under it (each opens the matching آموزش category),
then a short line with the normal bottom menu. A guide button only appears when its category has articles.
    php scripts/start_menu.php seed      # creates the 4 categories with starter articles (edit them in the bot: آموزش management)
    php scripts/start_menu.php status | on | off | set "TEXT" "CATEGORY" | url "TEXT" https://... | remove "TEXT"
The welcome text is editable in the bot's text editor (`users.text_start`); premium emoji typed there are kept (see below).
Tests: `php tests/start_menu_test.php`.
