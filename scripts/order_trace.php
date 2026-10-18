<?php
// Everything about one customer's recent orders and payments, to see where a purchase went wrong.
//
//   php scripts/order_trace.php 74391909            # Telegram user id
//   php scripts/order_trace.php 74391909 pichavpn_8d0e
//
// Shows: wallet, last payments (status, method, what they were for, whether that order exists), last orders,
// the bot's change log (storage/log.txt) lines for this user / these services, and PHP errors mentioning them.
// Reads only.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
require $root . '/config.php';

$uid = (string) ($argv[1] ?? '');
if (!ctype_digit($uid)) {
    fwrite(STDERR, "usage: php scripts/order_trace.php TELEGRAM_ID [SERVICE_NAME]\n");
    exit(1);
}
$extra = array_slice($argv, 2);
$t = fn($v) => ctype_digit((string) $v) && strlen((string) $v) >= 9 ? date('Y-m-d H:i:s', (int) $v) . ' (UTC)' : (string) $v;

$u = $pdo->prepare("SELECT id, username, Balance, step, Processing_value, Processing_value_one, Processing_value_tow, agent FROM user WHERE id = ?");
$u->execute([$uid]);
$user = $u->fetch(PDO::FETCH_ASSOC);
if (!$user) {
    echo "کاربر $uid پیدا نشد\n";
    exit(1);
}
echo "━━ کاربر $uid @{$user['username']} | موجودی: " . number_format((float) $user['Balance']) . " | step: {$user['step']} | P1: {$user['Processing_value_one']} | P2: {$user['Processing_value_tow']}\n";

echo "\n━━ پرداخت‌ها (۱۵ مورد آخر)\n";
$names = $extra;
$orders = [];
$q = $pdo->prepare("SELECT id_order, time, at_updated, price, payment_Status, Payment_Method, id_invoice FROM Payment_report WHERE id_user = ? ORDER BY id DESC LIMIT 15");
$q->execute([$uid]);
$inv = $pdo->prepare("SELECT Status FROM invoice WHERE username = ?");
foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $p) {
    $parts = explode('|', (string) $p['id_invoice']);
    $target = '';
    if (in_array($parts[0], ['getconfigafterpay', 'refunded'], true)) {
        $target = $parts[0] === 'refunded' ? explode('%', $parts[2] ?? '')[0] : explode('%', $parts[1] ?? '')[0];
    }
    $exists = '';
    if ($target !== '') {
        $names[] = $target;
        $inv->execute([$target]);
        $st = $inv->fetchColumn();
        $exists = $st === false ? ' ← ❌ این سفارش در جدول invoice نیست' : " ← سفارش موجود ($st)";
    }
    $orders[] = $p['id_order'];
    echo "  {$p['id_order']} | " . $t($p['time']) . " | " . number_format((float) $p['price']) . " | {$p['payment_Status']} | {$p['Payment_Method']} | {$p['id_invoice']}$exists\n";
}

echo "\n━━ سفارش‌ها (۱۵ مورد آخر)\n";
$q = $pdo->prepare("SELECT id_invoice, username, time_sell, Status, name_product, price_product, Service_location FROM invoice WHERE id_user = ? ORDER BY CAST(time_sell AS UNSIGNED) DESC LIMIT 15");
$q->execute([$uid]);
foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $i) {
    $names[] = $i['username'];
    echo "  {$i['id_invoice']} | {$i['username']} | " . $t($i['time_sell']) . " | {$i['Status']} | {$i['name_product']} | " . number_format((float) $i['price_product']) . " | {$i['Service_location']}\n";
}
$names = array_values(array_unique(array_filter($names)));

$needles = array_merge([$uid], $names, $orders);
$grep = function (string $file, int $max) use ($needles) {
    if (!is_file($file)) {
        return null;
    }
    $size = filesize($file);
    $fh = fopen($file, 'r');
    fseek($fh, max(0, $size - 8 * 1024 * 1024)); // last 8 MB
    $hits = [];
    while (($line = fgets($fh)) !== false) {
        foreach ($needles as $n) {
            if ($n !== '' && strpos($line, (string) $n) !== false) {
                $hits[] = rtrim(mb_substr($line, 0, 300));
                break;
            }
        }
    }
    fclose($fh);
    return array_slice($hits, -$max);
};

echo "\n━━ لاگ تغییرات ربات (storage/log.txt) — ۶۰ خط آخر مربوط\n";
$h = $grep($root . '/storage/log.txt', 60);
echo $h === null ? "  (فایل نیست)\n" : ($h ? '  ' . implode("\n  ", $h) . "\n" : "  (چیزی نبود)\n");

foreach ([$root . '/error_log', $root . '/cronbot/error_log', '/var/log/apache2/error.log'] as $f) {
    $h = $grep($f, 20);
    if ($h) {
        echo "\n━━ خطاها: $f\n  " . implode("\n  ", $h) . "\n";
    }
}
