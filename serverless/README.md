# ربات تست پیچا روی Serverless تلگرام

یک ربات **جدا** که روی Serverless تلگرام اجرا می‌شود و اطلاعات را از سرور فعلی پیچا (`serverless_api.php`) می‌خواند.
فعلاً فقط نمایش است: تعرفه‌ها، سرویس‌های من (حجم و زمان زنده از پنل)، کیف پول، پشتیبانی، و برای ادمین‌ها دکمه «پنل مدیریت».
خرید و تمدید هنوز در ربات اصلی است.

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
4. در ربات تست، خط `/setup ...` مرحله ۲ را بفرستید. اولین کسی که setup می‌کند صاحب ربات می‌شود (`/stats`، `/mainbot`).

خاموش کردن: `php scripts/serverless_setup.php off`
