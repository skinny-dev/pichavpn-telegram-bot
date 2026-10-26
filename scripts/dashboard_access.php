<?php
// Where the admin panel can be opened.
//
//   php scripts/dashboard_access.php status
//   php scripts/dashboard_access.php web off     # password login on the website off: only the Telegram Mini App
//   php scripts/dashboard_access.php web on      # website login back on (the Mini App keeps working)
//   php scripts/dashboard_access.php menu        # «پنل» menu button (opens the Mini App) for every panel admin in Telegram
//
// The Mini App is the same panel (dashboard/), opened from the bot; admins are recognised by their Telegram account.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/botapi.php';

$file = $root . '/storage/dashboard_access.json';
$cfg = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
$url = 'https://' . $domainhosts . '/dashboard/';
$cmd = $argv[1] ?? 'status';

switch ($cmd) {
    case 'web':
        $on = ($argv[2] ?? '') === 'on';
        if (!in_array($argv[2] ?? '', ['on', 'off'], true)) {
            fwrite(STDERR, "php scripts/dashboard_access.php web on|off\n");
            exit(1);
        }
        $cfg['web_login'] = $on;
        @mkdir(dirname($file), 0775, true);
        file_put_contents($file, json_encode($cfg, JSON_PRETTY_PRINT), LOCK_EX);
        echo $on ? "✅ ورود با رمز در سایت روشن شد ($url)\n" : "✅ ورود با رمز در سایت خاموش شد؛ پنل فقط از مینی‌اپ تلگرام باز می‌شود (نشست‌های باز سایت هم بسته شدند)\n";
        break;

    case 'menu':
        $ids = $pdo->query("SELECT id_admin FROM admin WHERE rule IN ('administrator','support')")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($ids as $id) {
            if (!ctype_digit((string) $id)) {
                continue;
            }
            $r = telegram('setChatMenuButton', ['chat_id' => $id, 'menu_button' => json_encode(['type' => 'web_app', 'text' => 'پنل', 'web_app' => ['url' => $url]])]);
            echo (!empty($r['ok']) ? '✅' : '❌ ' . ($r['description'] ?? '')) . " $id\n";
        }
        break;

    default:
        $web = !array_key_exists('web_login', $cfg) || $cfg['web_login'] !== false;
        echo "مینی‌اپ تلگرام: ✅ همیشه روشن (دکمه «🖥 پنل مدیریت (مینی‌اپ)» یا /webpanel در ربات)\n";
        echo "ورود با رمز در سایت: " . ($web ? '✅ روشن' : '⛔ خاموش') . "  ($url)\n";
}
