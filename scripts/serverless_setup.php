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
// The main bot (@pichanet_bot) on Serverless:
//   php scripts/serverless_setup.php main on        # its own key + relay on; the server stops touching the webhook
//   php scripts/serverless_setup.php project --main # /root/picha-serverless-main with the key built in (no /setup in a public bot)
//   php scripts/serverless_setup.php rollback       # back to the direct webhook (index.php) in one step
//   php scripts/serverless_setup.php check          # where the main bot's webhook points now

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

    case 'main':
        if (($argv[2] ?? '') === 'off') {
            goto rollback;
        }
        if (($argv[2] ?? '') !== 'on') {
            fwrite(STDERR, "php scripts/serverless_setup.php main on   (برگشت: rollback)\n");
            exit(1);
        }
        if (empty($cfg['main_key'])) {
            $cfg['main_key'] = bin2hex(random_bytes(24));
        }
        $cfg['main_relay'] = true;
        $cfg['enabled'] = true;
        $save();
        echo "✅ سرور آماده‌ی ربات اصلی روی Serverless است (از این به بعد deploy وب‌هوک را عوض نمی‌کند)\n";
        echo "   بعدی: php scripts/serverless_setup.php project --main\n";
        break;

    case 'rollback':
        rollback:
        $cfg['main_relay'] = false;
        $save();
        require_once $root . '/botapi.php';
        require_once $root . '/function.php';
        define('PICHA_WEBHOOK_TAKEBACK', true);
        $secret = ensureWebhookSecret()['secret'];
        $r = telegram('setWebhook', ['url' => "https://$domainhosts/index.php?secret=$secret"]);
        echo !empty($r['ok']) ? "✅ وب‌هوک ربات اصلی برگشت روی سرور (index.php). ربات همین الان مثل قبل کار می‌کند.\n" : '❌ ' . ($r['description'] ?? 'setWebhook نشد') . "\n";
        echo "   در BotFather هم Serverless ربات اصلی را خاموش کنید تا tgcloud دوباره وب‌هوک را نگیرد.\n";
        break;

    case 'check':
        require_once $root . '/botapi.php';
        $w = telegram('getWebhookInfo', [])['result'] ?? [];
        $url = (string) ($w['url'] ?? '');
        $where = str_contains($url, 'cloud.telegram.org') ? '☁️ Serverless تلگرام' : (str_contains($url, $domainhosts) ? '🖥 مستقیم روی سرور' : '❓ ' . preg_replace('/secret=\w+/', 'secret=…', $url));
        echo "وب‌هوک ربات اصلی: $where\n";
        echo "در صف: " . (int) ($w['pending_update_count'] ?? 0) . (empty($w['last_error_message']) ? '' : " | آخرین خطا: {$w['last_error_message']} (" . date('H:i', (int) ($w['last_error_date'] ?? 0)) . ')') . "\n";
        echo "رله ربات اصلی روی سرور: " . (!empty($cfg['main_relay']) ? '✅ روشن' : '— خاموش') . "\n";
        break;

    case 'project':
        $main = in_array('--main', $argv, true);
        if ($main && (empty($cfg['main_key']) || empty($cfg['main_relay']))) {
            fwrite(STDERR, "❌ اول: php scripts/serverless_setup.php main on\n");
            exit(1);
        }
        $dst = $main ? '/root/picha-serverless-main' : '/root/picha-serverless';
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
        if ($main) { // the main bot is public: its server address and key are built in, /setup is off
            file_put_contents("$dst/tgcloud/lib/config.js", "// written by scripts/serverless_setup.php project --main — keep private\nexport default " .
                json_encode(['api_url' => $api, 'api_key' => $cfg['main_key'], 'mode' => 'main'], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n");
            @chmod("$dst/tgcloud/lib/config.js", 0600);
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
        echo "ربات اصلی روی Serverless: " . (!empty($cfg['main_relay']) ? '✅ رله روشن' : '— خاموش') . "  (وضعیت وب‌هوک: php scripts/serverless_setup.php check)\n";
        echo "توکن ربات تست برای پنل: " . (!empty($cfg['bot_token']) ? '✅ ' . (!empty($cfg['bot_username']) ? '@' . $cfg['bot_username'] : '') : '— (اختیاری: php scripts/serverless_setup.php token)') . "\n";
}
