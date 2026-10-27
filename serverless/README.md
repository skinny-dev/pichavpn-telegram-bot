# ربات تست پیچا روی Serverless تلگرام

یک ربات **جدا** که روی Serverless تلگرام اجرا می‌شود.

**حالت کامل (رله)** — `php scripts/serverless_setup.php relay on`:
هر پیام و دکمه به `serverless_relay.php` روی سرور می‌رود و همان کد ربات اصلی اجرا می‌شود و با ربات تست جواب می‌دهد:
همه دستورها، متن‌ها، پک‌های پرمیوم، دکمه‌ها، خرید، تمدید، کیف پول، پنل ادمین. دیتابیس و کاربران همان ربات اصلی است.
- پیام به گروه/کانال (گزارش‌ها، چک عضویت کانال) اگر ربات تست آنجا نباشد با ربات اصلی فرستاده می‌شود.
- عکس/ویدیوهایی که ربات اصلی ذخیره کرده یک بار با ربات تست دوباره آپلود می‌شوند (storage/cache/relay_files.json).
- پیام‌های بیرون از ربات (تأیید درگاه پرداخت، کرون، هشدار انقضا) هنوز از ربات اصلی می‌آیند.

**حالت نمایشی** — `relay off`: تعرفه‌ها، سرویس‌های من، کیف پول، پشتیبانی (فقط خواندن، از `serverless_api.php`).

⚠️ Serverless را **هرگز** روی @pichanet_bot روشن نکنید (وب‌هوک ربات اصلی را می‌گیرد و ربات از کار می‌افتد).

## راه‌اندازی
1. BotFather → `/newbot` → یک ربات تازه. بعد در BotFather همان ربات تازه → **Serverless** → روشن، و **CLI Access** → توکن CLI.
2. روی سرور ربات (بعد از deploy):
   ```
   cd /var/www/html/mirzaprobotconfig
   php scripts/serverless_setup.php key        # خط /setup را می‌دهد
   php scripts/serverless_setup.php token      # توکن ربات تست (اختیاری، برای باز شدن پنل)
   php scripts/serverless_setup.php project    # پروژه را در /root/picha-serverless می‌گذارد
   ```
3. Node.js 20+ لازم است. بعد:
   ```
   cd /root/picha-serverless
   npm install
   npx tgcloud login        # توکن CLI را می‌خواهد
   npx tgcloud push
   npx tgcloud migrate
   npx tgcloud webhook sync
   ```
4. در ربات تست، خط `/setup ...` مرحله ۲ را بفرستید. اولین کسی که setup می‌کند صاحب ربات می‌شود (`/devstats`، `/devmainbot`).
5. حالت کامل: `php scripts/serverless_setup.php relay on`

خاموش کردن: `php scripts/serverless_setup.php off`
