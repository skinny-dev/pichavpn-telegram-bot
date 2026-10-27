<?php
// Setup for the dev bot that runs on Telegram Serverless (the serverless/ folder). Run on the bot server.
//
//   php scripts/serverless_setup.php key        # makes the API key (printed once: send it to the dev bot with /setup)
//   php scripts/serverless_setup.php token      # the dev bot's token (hidden input) so the admin panel Mini App opens from it too
//   php scripts/serverless_setup.php project    # copies serverless/ to /root/picha-serverless (where `npx tgcloud` runs)
//   php scripts/serverless_setup.php relay on   # the dev bot runs the full bot (all commands, texts, purchases) through serverless_relay.php
//   php scripts/serverless_setup.php relay off  # back to the read-only view
//   php scripts/serverless_setup.php status
//   php scripts/serverless_setup.php off | on   # stop / allow serverless_api.php
//
// The main bot (@pichanet_bot) is not touched: Serverless must only ever be turned on for the new dev bot.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';

$file = $root . '/storage/serverless.json';
$cfg = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
$save = function () use (&$cfg, $file) {
    @mkdir(dirname($file), 0775, true);
    file_put_contents($file, json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    @chmod($file, 0640);
};
$api = 'https://' . $domainhosts . '/serverless_api.php';

switch ($argv[1] ?? 'status') {
    case 'key':
        if (!empty($cfg['key']) && !in_array('--new', $argv, true)) {
            echo "کلید از قبل ساخته شده. برای کلید تازه (کلید قبلی از کار می‌افتد):  php scripts/serverless_setup.php key --new\n";
            exit(1);
        }
        $cfg['key'] = bin2hex(random_bytes(24));
        $cfg['enabled'] = true;
        $save();
        echo "✅ کلید ساخته شد. این پیام را کامل کپی کنید و در ربات تست (نه ربات اصلی) بفرستید؛ ربات بعد از ذخیره پیام را پاک می‌کند:\n\n";
        echo "/setup $api {$cfg['key']}\n\n";
        echo "⚠️ این کلید را جای دیگری نفرستید.\n";
        break;

    case 'token':
        fwrite(STDOUT, "توکن ربات تست (از BotFather؛ موقع تایپ دیده نمی‌شود): ");
        system('stty -echo 2>/dev/null');
        $t = trim((string) fgets(STDIN));
        system('stty echo 2>/dev/null');
        echo "\n";
        if (!preg_match('/^\d{5,20}:[A-Za-z0-9_-]{30,}$/', $t)) {
            fwrite(STDERR, "❌ شکل توکن درست نیست\n");
            exit(1);
        }
        if ($t === $APIKEY) {
            fwrite(STDERR, "❌ این توکن ربات اصلی است. Serverless را روی ربات اصلی روشن نکنید؛ یک ربات جدید در BotFather بسازید.\n");
            exit(1);
        }
        $me = json_decode((string) @file_get_contents("https://api.telegram.org/bot$t/getMe"), true);
        $cfg['bot_token'] = $t;
        $cfg['bot_username'] = $me['result']['username'] ?? null;
        $save();
        echo "✅ ذخیره شد" . (!empty($cfg['bot_username']) ? " (@{$cfg['bot_username']})" : '') . ". پنل مدیریت از دکمه «پنل» ربات تست هم باز می‌شود.\n";
        break;

    case 'project':
        $dst = '/root/picha-serverless';
        @mkdir($dst, 0700, true);
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/serverless', FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
        foreach ($it as $f) {
            $rel = substr($f->getPathname(), strlen($root . '/serverless') + 1);
            if ($rel === '.htaccess') {
                continue;
            }
            $to = "$dst/$rel";
            $f->isDir() ? @mkdir($to, 0700, true) : copy($f->getPathname(), $to);
        }
        echo "✅ پروژه در $dst به‌روز شد (ورود قبلی tgcloud دست نخورد)\n";
        echo "   cd $dst && npm install && npx tgcloud login\n";
        break;

    case 'relay':
        $on = ($argv[2] ?? '') === 'on';
        if (!in_array($argv[2] ?? '', ['on', 'off'], true)) {
            fwrite(STDERR, "php scripts/serverless_setup.php relay on|off\n");
            exit(1);
        }
        if ($on && (empty($cfg['key']) || empty($cfg['bot_token']))) {
            fwrite(STDERR, "❌ اول key و token را بسازید (php scripts/serverless_setup.php key / token)\n");
            exit(1);
        }
        $cfg['relay'] = $on;
        $save();
        echo $on ? "✅ ربات تست حالا همان ربات کامل است (همه دستورها، متن‌ها، دکمه‌ها و خرید؛ دیتابیس و کاربران مشترک)\n"
            : "⛔ رله خاموش شد؛ ربات تست فقط نمایش می‌دهد\n";
        break;

    case 'off':
    case 'on':
        $cfg['enabled'] = $argv[1] === 'on';
        $save();
        echo $cfg['enabled'] ? "✅ serverless_api.php روشن شد\n" : "⛔ serverless_api.php خاموش شد (ربات تست دیگر اطلاعات نمی‌گیرد)\n";
        break;

    default:
        echo "API: $api\n";
        echo "کلید: " . (!empty($cfg['key']) ? '✅ ساخته شده' : '❌ نه (php scripts/serverless_setup.php key)') . "\n";
        echo "وضعیت: " . (($cfg['enabled'] ?? true) ? '✅ روشن' : '⛔ خاموش') . "\n";
        echo "ربات کامل (رله): " . (!empty($cfg['relay']) ? '✅ روشن' : '— خاموش (php scripts/serverless_setup.php relay on)') . "\n";
        echo "توکن ربات تست برای پنل: " . (!empty($cfg['bot_token']) ? '✅ ' . (!empty($cfg['bot_username']) ? '@' . $cfg['bot_username'] : '') : '— (اختیاری: php scripts/serverless_setup.php token)') . "\n";
}
