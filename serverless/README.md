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


## ربات اصلی (@pichanet_bot) روی Serverless
همه‌ی کار همچنان روی سرور انجام می‌شود (همان کد، همان دیتابیس، همان پنل مینی‌اپ)؛ Serverless فقط پیام‌ها را تحویل می‌دهد.
1. روی سرور: `php scripts/serverless_setup.php main on` و بعد `php scripts/serverless_setup.php project --main`
   (کلید و آدرس سرور داخل کد گذاشته می‌شود؛ ربات عمومی هیچ‌وقت /setup قبول نمی‌کند). از این به بعد deploy وب‌هوک را عوض نمی‌کند.
2. BotFather → @pichanet_bot → Serverless → روشن → CLI Access → توکن CLI.
3. `cd /root/picha-serverless-main && npm install && npx tgcloud login && npx tgcloud push && npx tgcloud migrate && npx tgcloud webhook sync`
4. `php scripts/serverless_setup.php check` باید «☁️ Serverless تلگرام» نشان دهد.

**برگشت فوری:** `php scripts/serverless_setup.php rollback` (وب‌هوک مستقیم روی سرور) و بعد Serverless را در BotFather خاموش کنید.
