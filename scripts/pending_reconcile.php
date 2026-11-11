<?php
// Which pending/expired orders were really paid at the gateway but not delivered?
//
//   php scripts/pending_reconcile.php --hours=168            # report only (asks Tetraminator about each open order; changes nothing)
//   php scripts/pending_reconcile.php --hours=168 --deliver  # also deliver the ones Tetraminator confirms (once each) and notify the customer
//
// Variza orders cannot be asked here (no inquiry): they are listed so you can check them in the Variza panel.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/botapi.php';
require_once $root . '/jdf.php';
require_once $root . '/function.php';
require_once $root . '/panels.php';
require_once $root . '/pending_watch.php';
$textbotlang = languagechange();
$o = [];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/s', $a, $m)) {
        $o[$m[1]] = $m[2] ?? true;
    }
}
$res = pendingWatchRun($pdo, ['hours' => (float) ($o['hours'] ?? 168), 'deliver' => !empty($o['deliver']), 'alert' => false, 'wait' => 0, 'limit' => 400]);
$kinds = [];
foreach ($res as $f) {
    $kinds[$f['kind']][] = $f;
}
$title = ['paid_undelivered' => '🚨 پول رسیده، تحویل نشده', 'delivered' => '✅ تحویل شد', 'delivery_failed' => '🚨 تحویل خطا داد', 'amount_mismatch' => '⚠️ مبلغ نامطابق',
    'receipt_waiting' => '🧾 رسید منتظر تأیید (واریزا)', 'waiting_long' => '⏳ باز و بدون پرداخت', 'inquiry_error' => '❓ استعلام نشد'];
foreach ($title as $k => $t) {
    if (empty($kinds[$k])) {
        continue;
    }
    echo "\n$t (" . count($kinds[$k]) . ")\n";
    if (in_array($k, ['waiting_long'], true) && count($kinds[$k]) > 12) {
        echo "  (" . count($kinds[$k]) . " مورد؛ فقط شمارش)\n";
        continue;
    }
    foreach ($kinds[$k] as $f) {
        echo sprintf("  %s  %s  %s تومان  کاربر %s  %d دقیقه  %s\n", $f['order'], $f['method'], number_format($f['amount']), $f['user'], $f['age_min'], $f['note']);
    }
}
if (!$res) {
    echo "چیزی برای گزارش نیست.\n";
}
