
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


## Welcome message (one message, two buttons)
`/start` sends ONE message: the welcome text («🐈‍⬛ درود، خوش اومدی به پیچا! …») with two buttons side by side under it:
**🛍 خرید اشتراک** (opens the buy flow) and **📚 آموزش** (the tutorials; while there are none it answers «📚 این آموزش به‌زودی منتشر می‌شود!»).
Telegram allows only one keyboard per message, so the bottom menu is sent with the welcome only to users who never received it
(new users, first /start; `user.menu_sent`); everybody who exists today already has it, and gets the single message.
    php scripts/start_menu.php reset     # back to the default two buttons
    php scripts/start_menu.php status | on | off | set "TEXT" "HELP CATEGORY" | url "TEXT" https://... | remove "TEXT"
`off` returns to the old single message with the bottom menu attached. The welcome text is editable in the bot (📝 ویرایش متن‌های ربات, `users.text_start`).
Tests: `php tests/start_menu_test.php`.

## Product and category order
Customers' product lists are sorted by the bot (they used to follow creation order). Admin: 🏬 تنظیمات فروشگاه → 🛍 مدیریت محصولات → **🔃 ترتیب نمایش محصولات**:
`حجم کم←زیاد` (default), `حجم زیاد←کم`, `قیمت ارزان←گران`, `قیمت گران←ارزان`, or `دستی` (the order numbers from the web panel's tree/table, then volume).
Unlimited / zero-volume products always come last. Categories follow the web panel's order numbers.
`php scripts/sort_products.php --by=volume --dir=asc [--apply]` writes clean order numbers (1..n per category) to start a manual order from.
Tests: `php tests/product_order_test.php`.

## Accounting: expense kinds, advertising, date/time
Expenses now have a **kind** (📣 تبلیغات · 🖥 سرور و زیرساخت · سایر هزینه‌ها), a name, an amount and an editable **date/time** (empty = now).
Every expense counts in the expenses of ITS OWN day; advertising also has its own line («↳ 📣 تبلیغات») in the bot's statistics and the web panel's stats.
- **Web panel → Accounting/Expenses → Add**: نوع هزینه = تبلیغات, نام, مبلغ, تاریخ و ساعت (`1405/07/14 15:30`, Gregorian `2026-10-06 15:30` also works; date alone = 12:00; empty = now). Dates are editable afterwards.
- **Bot** (administrator): `/ad 500000 کمپین اینستاگرام` (now) · `/ad 500000 کمپین اینستاگرام @1405/07/14 15:30` (that moment) · `/expense 120000 سرور` · `/capital 5000000 سرمایه` (all accept the `@date` suffix).
Tests: `php tests/accounting_dt_test.php`, `python3 tests/api_test.py URL admin PASS`.

## Admin notification test
- In the bot (administrator): **`/admintest`** sends a test message to every admin and replies with who received it («✅ پیام رسید» / «❌ او هنوز /start را نزده است» / «ربات را بلاک کرده»).
- From the server: `php scripts/admin_test.php` (same result, exit code 1 if someone did not receive it).
- Every admin in the admin table gets payment receipts (with ✅/❌ buttons), support messages and alerts — the table is read live, so a newly added admin starts receiving them at once, if they pressed Start on the bot. «support» admins do not get payment receipts.
- Adding an admin in the bot now tells you at once if the new admin never pressed Start (the message could not be delivered).
Tests: `php tests/admin_test_test.php`.

## Admin management in the web panel
Sidebar → «ادمین‌ها» (`/dashboard/#/admins`). Only an `administrator` can open the panel.
- **Add**: Telegram numeric id + role. Roles: `administrator` (everything + web panel), `Seller` (limited bot menu), `support` (limited, no payment receipts). The new admin must press /start in the bot once.
- **Web login**: for `administrator` (everything) and `support` (live-chat page only); set a username and a password (≥ 8 chars). Leave the password empty on edit = unchanged. Seller (or an admin without a login name) is bot-only.
- **Edit/delete**: change role, rename login, reset password, remove. Guards: you cannot delete or demote yourself, and the last administrator can never be removed/demoted. A demoted admin loses panel access immediately (role is checked on every request).
- API: `admins`, `admin_save`, `admin_delete` in `dashboard/api.php`; covered by `tests/api_test.py`.

## Live support chat (panel ⇄ Telegram)
Sidebar → «پشتیبانی» (badge = customers waiting). It reads the bot's own ticket table (`support_message`), so both sides are always in sync:
- A customer's messages from the bot's «پشتیبانی» appear in the panel within ~5 s (unread badge until you open the chat).
- A reply typed in the panel is sent straight to the customer in Telegram (same text + «پاسخ به پیام» button as a reply from the bot). If Telegram refuses (customer blocked the bot) the panel shows the error and stores nothing.
- A reply given inside Telegram by support staff shows in the panel too (with time and author; stored in `result_time` / `result_by`). Whoever answers first closes the "answer" button for the others, as before.
- «بستن گفتگو» closes the thread; a new customer message reopens it. Filters: باز / بسته / همه + search by name or id.
- Accounts with role `support` can log in (create them in «ادمین‌ها» with a username/password) and see only this page; every other API route answers 403 for them.
- Not synced: photos/videos customers send (still arrive in Telegram for the department admin; only text is shown in the panel).
Tests: `python3 tests/api_test.py URL admin PASS` (successful Telegram delivery needs the real API and was not exercised offline).

## Bring accounting rows back from a backup
`scripts/restore_accounting.sh BACKUP.tgz.enc [--apply]` copies ONLY expenses, capital entries and the Mirza-Pro cost/investment payment rows from a backup into the live DB. Dry run by default (shows counts), `--apply` saves a copy of the live accounting tables to `/root/pre-accounting-*.sql` first, skips rows that already exist (safe to repeat) and never touches users, orders, products or settings.

## Professional accounting (P&L)
Stats (bot «آمار» and panel «آمار») now read like an accountant's statement:
```
فروش (پول دریافتی)  − بازپرداخت به مشتریان  − خرید (بهای تمام‌شده)  = سود ناخالص
− هزینه‌های عملیاتی (حقوق، تبلیغات، سرور، ابزار، کارمزد، مالیات، سایر)  = سود خالص
− سود سهام / برداشت شرکا (هزینه نیست)                                   = سود باقی‌مانده
ورود سرمایه: بلوک جدا (هیچ‌وقت جزو فروش یا سود نیست) + «سرمایه + سود باقی‌مانده»
```
Categories (`expenses.kind`): `purchase` خرید · `salary` حقوق · `advertising` تبلیغات · `server` سرور · `tools` ابزار · `fee` کارمزد · `tax` مالیات · `general` سایر · `dividend` سود سهام.
- Bot (administrator): `/finance` shows all commands: `/buy /salary /ad /server /tools /fee /tax /expense /dividend /capital AMOUNT description [@1405/07/14 15:30]`.
- Panel: حسابداری → هزینه‌ها: the «نوع هزینه» column is a dropdown, so old rows (all «سایر») can be re-categorised in place, e.g. server purchases → «خرید».
- Old rows keep working: Mirza-Pro «cost» payments count as «سایر هزینه‌ها»; `net` is unchanged for old data except that dividends no longer reduce expenses (they reduce retained profit).

### Cleaning old expenses
- `bash scripts/restore_accounting.sh BACKUP.tgz.enc --inspect` — read-only: shows which accounting data (expenses, capital, Pro cost rows) a backup holds.
- `php scripts/categorize_expenses.php` — dry run: guesses the category of every «سایر» expense from its description (Farsi keywords); `--apply` saves a copy of the table and updates `kind`; `--all` also re-checks already categorised rows. Unmatched rows are listed to be set by hand in the panel.

### «In statistics I see expenses but not in the list»
Mirza-Pro stored expenses/capital as `Payment_report` rows (`cost` / `capital_injection`). Statistics count them, but the panel list and `/finance` commands use the tables `expenses` / `capital_entries`. `php scripts/migrate_pro_costs.php [--apply]` moves those rows into the tables (category guessed from the description, totals unchanged, old rows kept and marked `cost_migrated`, SQL copy saved first).
