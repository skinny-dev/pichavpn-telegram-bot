<?php
/*
 * Remove test payments / orders so statistics and accounting start clean.
 *   php scripts/clean_test_data.php --users=1001,1002 --since=2026-10-05            # DRY RUN: shows what would go
 *   php scripts/clean_test_data.php --users=1001,1002 --since=2026-10-05 --apply    # deletes (after saving a SQL copy)
 * Only rows of the listed Telegram user ids, created on/after --since (Tehran date), are touched.
 * Deleted rows are saved as /root/clean_test_data_<time>.sql (re-importable). Wallet balances and the services on the
 * VPN panel are NOT changed: the script prints the panel usernames to delete by hand and the balances to reset.
 */
chdir(__DIR__ . '/..');
require_once 'config.php';
$o = getopt('', ['users:', 'since:', 'apply']);
$users = array_values(array_filter(array_map('trim', explode(',', $o['users'] ?? ''))));
$since = $o['since'] ?? '';
if (!$users || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $since)) {
    exit("Usage: php scripts/clean_test_data.php --users=ID1,ID2 --since=YYYY-MM-DD [--apply]\n");
}
foreach ($users as $u) {
    if (!ctype_digit($u)) {
        exit("Bad user id: $u\n");
    }
}
date_default_timezone_set('Asia/Tehran');
$sinceTs = strtotime($since . ' 00:00:00');
$in = implode(',', array_fill(0, count($users), '?'));

// Payment_report.time is either unix seconds or 'Y/m/d H:i:s'; invoice.time_sell is unix seconds.
$pay = $pdo->prepare("SELECT * FROM Payment_report WHERE id_user IN ($in)");
$pay->execute($users);
$payRows = array_values(array_filter($pay->fetchAll(PDO::FETCH_ASSOC), function ($r) use ($sinceTs) {
    $t = ctype_digit((string) $r['time']) ? (int) $r['time'] : (int) strtotime((string) $r['time']);
    return $t >= $sinceTs;
}));
$inv = $pdo->prepare("SELECT * FROM invoice WHERE id_user IN ($in) AND CAST(time_sell AS UNSIGNED) >= ?");
$inv->execute(array_merge($users, [$sinceTs]));
$invRows = $inv->fetchAll(PDO::FETCH_ASSOC);
$sms = $pdo->query("SELECT COUNT(*) FROM sms_inbox")->fetchColumn();

echo "Accounts: " . implode(', ', $users) . "   since $since\n";
$sum = array_sum(array_map(fn($r) => $r['payment_Status'] === 'paid' ? (int) $r['price'] : 0, $payRows));
echo "Payment reports: " . count($payRows) . " (paid total " . number_format($sum) . " toman)\n";
echo "Invoices (services): " . count($invRows) . "\n";
echo "Stored bank SMS rows (also removed, they are test deposits): $sms\n";
foreach ($invRows as $r) {
    echo "  panel user to delete by hand: {$r['username']}  [{$r['Service_location']}]  status={$r['Status']}\n";
}
foreach ($users as $u) {
    $b = $pdo->prepare('SELECT Balance FROM user WHERE id = ?');
    $b->execute([$u]);
    echo "  wallet of $u is " . number_format((int) $b->fetchColumn()) . " toman (reset it by hand if needed)\n";
}
if (!isset($o['apply'])) {
    exit("\nDRY RUN: nothing was changed. Add --apply to delete.\n");
}
$file = '/root/clean_test_data_' . date('Ymd_His') . '.sql';
$fh = @fopen($file, 'w');
if (!$fh) {
    $file = sys_get_temp_dir() . '/' . basename($file);
    $fh = fopen($file, 'w');
}
$dump = function (string $table, array $rows) use ($pdo, $fh): void {
    foreach ($rows as $r) {
        $cols = implode(',', array_map(fn($c) => "`$c`", array_keys($r)));
        $vals = implode(',', array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote((string) $v), array_values($r)));
        fwrite($fh, "INSERT INTO `$table` ($cols) VALUES ($vals);\n");
    }
};
$dump('Payment_report', $payRows);
$dump('invoice', $invRows);
fclose($fh);
$pdo->beginTransaction();
try {
    foreach ($payRows as $r) {
        $pdo->prepare('DELETE FROM Payment_report WHERE id = ?')->execute([$r['id']]);
    }
    foreach ($invRows as $r) {
        $pdo->prepare('DELETE FROM invoice WHERE id_invoice = ?')->execute([$r['id_invoice']]);
    }
    $pdo->exec('DELETE FROM sms_inbox');
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    exit("FAILED, nothing deleted: " . $e->getMessage() . "\n");
}
echo "\nDeleted. A copy of the removed rows is in $file\n";
