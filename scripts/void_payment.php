<?php
/*
 * Takes a customer payment OUT of the accounts (revenue, the finance ledger) without touching the customer's wallet.
 * For a receipt that turned out to be fake after it was approved: the admin has already taken the money back from the wallet by hand,
 * but the payment still counts as «پول دریافتی» in the stats. The order becomes «reject» (the status the bot itself uses for a refused receipt).
 *   php scripts/void_payment.php --find[=AMOUNT]       # recent paid wallet top-ups of at least AMOUNT toman (default 1,000,000; last 3 days)
 *   php scripts/void_payment.php ORDER_ID              # dry run: what would change
 *   php scripts/void_payment.php ORDER_ID --apply --reason="رسید جعلی"
 * Only a paid WALLET TOP-UP can be voided (a payment that delivered a service / renewal cannot: the product is already out). The wallet is never changed here.
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'finance/engine.php';
require_once 'finance/reports.php';
require_once 'finance/legacy.php';
date_default_timezone_set('Asia/Tehran');

const VP_NON_CASH = ['add balance by admin', 'low balance by admin', 'wallet', 'cost', 'capital_injection', 'cost_migrated', 'capital_migrated'];
const VP_SERVICE_KINDS = ['getconfigafterpay', 'getextenduser', 'getextravolumeuser', 'getextratimeuser'];

$args = array_slice($argv, 1);
$apply = in_array('--apply', $args, true);
$reason = '';
$find = null;
$order = null;
foreach ($args as $a) {
    if (str_starts_with($a, '--reason=')) {
        $reason = trim(substr($a, 9));
    } elseif ($a === '--find' || str_starts_with($a, '--find=')) {
        $find = $a === '--find' ? 1000000 : (int) preg_replace('/\D/', '', substr($a, 7));
    } elseif ($a[0] !== '-') {
        $order = $a;
    }
}

if ($find !== null) {
    $since = date('Y/m/d H:i:s', time() - 3 * 86400);
    $in = implode(',', array_fill(0, count(VP_NON_CASH), '?'));
    $st = $pdo->prepare("SELECT id_order, id_user, price, Payment_Method, time FROM Payment_report WHERE payment_Status = 'paid' AND time >= ? AND CAST(price AS UNSIGNED) >= ?
        AND Payment_Method NOT IN ($in) AND SUBSTRING_INDEX(id_invoice, '|', 1) NOT IN ('getconfigafterpay','getextenduser','getextravolumeuser','getextratimeuser') ORDER BY time DESC LIMIT 30");
    $st->execute(array_merge([$since, $find], VP_NON_CASH));
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $r) {
        printf("%s | سفارش %s | کاربر %s | %s تومان | %s\n", $r['time'], $r['id_order'], $r['id_user'], number_format((int) $r['price']), $r['Payment_Method']);
    }
    echo $rows ? "\nبعدی: php scripts/void_payment.php ORDER_ID   (پیش‌نمایش)\n" : "هیچ شارژ کیف پولی با این مبلغ در ۳ روز اخیر نیست.\n";
    exit;
}
if ($order === null) {
    exit("Usage: php scripts/void_payment.php --find | ORDER_ID [--apply --reason=\"…\"]\n");
}

$st = $pdo->prepare("SELECT * FROM Payment_report WHERE id_order = ?");
$st->execute([$order]);
$p = $st->fetch(PDO::FETCH_ASSOC);
if (!$p) {
    exit("❌ سفارش {$order} پیدا نشد.\n");
}
$kind = explode('|', (string) $p['id_invoice'])[0];
if ($p['payment_Status'] !== 'paid') {
    exit("❌ وضعیت این سفارش «{$p['payment_Status']}» است، نه paid؛ چیزی برای ابطال نیست.\n");
}
if (in_array($p['Payment_Method'], VP_NON_CASH, true)) {
    exit("❌ روش «{$p['Payment_Method']}» اصلاً جزو پول دریافتی حساب نمی‌شود؛ ابطال لازم نیست.\n");
}
if (in_array($kind, VP_SERVICE_KINDS, true)) {
    exit("❌ این پرداخت یک خرید/تمدید سرویس بوده (نوع {$kind}) و سرویس تحویل شده؛ ابطالش درست نیست. فقط شارژ کیف پول قابل ابطال است.\n");
}
$u = $pdo->prepare("SELECT Balance FROM user WHERE id = ?");
$u->execute([$p['id_user']]);
$bal = $u->fetchColumn();
$j = $pdo->prepare("SELECT id FROM fin_journal WHERE source_type = 'legacy_payment' AND source_id = ? AND status = 'posted' ORDER BY id DESC LIMIT 1");
$j->execute(['p' . $p['id']]);
$jid = $j->fetchColumn();
printf("سفارش %s | کاربر %s | %s تومان | %s | %s\n", $p['id_order'], $p['id_user'], number_format((int) $p['price']), $p['Payment_Method'], $p['time']);
printf("موجودی فعلی کیف پول کاربر: %s (این اسکریپت آن را تغییر نمی‌دهد)\n", $bal === false ? '—' : number_format((float) $bal));
echo "با --apply: وضعیت سفارش ← reject (از آمار «پول دریافتی» حذف می‌شود)" . ($jid ? "، و سند مالی #{$jid} برگشت می‌خورد." : '؛ سند مالی ثبت‌شده‌ای برایش نیست.') . "\n";
if (!$apply) {
    exit("\nپیش‌نمایش بود. برای اجرا: php scripts/void_payment.php {$order} --apply --reason=\"رسید جعلی\"\n");
}
if ($reason === '') {
    exit("❌ با --apply دلیل بدهید: --reason=\"رسید جعلی\"\n");
}
$upd = $pdo->prepare("UPDATE Payment_report SET payment_Status = 'reject' WHERE id_order = ? AND payment_Status = 'paid'");
$upd->execute([$order]);
if ($upd->rowCount() !== 1) {
    exit("❌ هم‌زمان وضعیت سفارش عوض شد؛ چیزی تغییر نکرد.\n");
}
if ($jid) {
    try {
        finReverseEntry($pdo, (int) $jid, 'ابطال پرداخت: ' . $reason, 'void_payment');
        echo "✅ سند مالی #{$jid} برگشت خورد.\n";
    } catch (Throwable $e) {
        echo "⚠️ سفارش reject شد ولی برگرداندن سند مالی خطا داد: " . $e->getMessage() . "\n";
    }
}
@mkdir(__DIR__ . '/../storage', 0775, true);
@file_put_contents(__DIR__ . '/../storage/void_payment.log', json_encode(['at' => date('Y/m/d H:i:s'), 'order' => $order, 'user' => $p['id_user'], 'price' => (int) $p['price'], 'reason' => $reason], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
echo "✅ سفارش {$order} از پول دریافتی حذف شد (وضعیت: reject). آمار «امروز» را دوباره ببینید.\n";
