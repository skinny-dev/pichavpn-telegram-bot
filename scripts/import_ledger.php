<?php
/*
 * One-off import of hand-kept expense / income lines (Oct 2026).
 *   php scripts/import_ledger.php           # dry run: shows what would be added
 *   php scripts/import_ledger.php --apply   # writes them (safe to re-run: duplicates are skipped)
 * Expenses -> bot «هزینه‌ها» table (kind set; the finance ledger picks them up through the legacy bridge).
 * Income   -> finance module cash sales (no customer needed).
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

$apply = in_array('--apply', $argv, true);
// [date, type (E expense / I income), kind, amount toman, description]
$rows = [
    ['2026-10-06', 'E', 'tools', 1500000, 'Variza — Subscription'],
    ['2026-10-06', 'E', 'advertising', 500000, 'Mehshad — Instagram Advertisement'],
    ['2026-10-07', 'E', 'server', 4000000, 'Nexnode — Server'],
    ['2026-10-07', 'E', 'server', 1000000, 'Manageit — Server'],
    ['2026-10-08', 'E', 'advertising', 3000000, 'Walker — Instagram Advertising'],
    ['2026-10-08', 'I', 'sale', 250000, 'Sell Random Config'],
    ['2026-10-09', 'E', 'server', 5000000, 'Doprax — Server'],
    ['2026-10-09', 'E', 'server', 2000000, 'Manageit — Server'],
    ['2026-10-09', 'I', 'sale', 250000, 'Sell Random Config'],
    ['2026-10-09', 'I', 'sale', 210000, 'Sell Random Config'],
];

$hasKind = (bool) $pdo->query("SHOW COLUMNS FROM expenses LIKE 'kind'")->fetchColumn();
$added = $skipped = 0;
foreach ($rows as $n => [$date, $type, $kind, $amount, $desc]) {
    $ts = strtotime("$date 12:00:00");
    // an identical line imported earlier (same date/amount/text, and the n-th repeat of it) is skipped
    $tag = 'import:' . md5("$date|$type|$amount|$desc") . ':' . count(array_filter(array_slice($rows, 0, $n), fn($r) => $r[0] === $date && $r[1] === $type && $r[3] === $amount && $r[4] === $desc));
    if ($type === 'E') {
        $q = $pdo->prepare("SELECT COUNT(*) FROM expenses WHERE description = ? AND amount = ? AND created_at BETWEEN ? AND ?");
        $q->execute([$desc, $amount, strtotime("$date 00:00:00"), strtotime("$date 23:59:59")]);
        $dup = (int) $q->fetchColumn() > 0;
    } else {
        $q = $pdo->prepare("SELECT COUNT(*) FROM fin_txn WHERE memo = ?");
        $q->execute([$tag]);
        $dup = (int) $q->fetchColumn() > 0;
    }
    printf("%s %-7s %12s  %-38s %s\n", $date, $type === 'E' ? "هزینه/$kind" : 'درآمد', number_format($amount), $desc, $dup ? '(already there, skipped)' : ($apply ? 'ADD' : 'would add'));
    if ($dup) {
        $skipped++;
        continue;
    }
    if (!$apply) {
        continue;
    }
    if ($type === 'E') {
        $cols = $hasKind ? '(amount, description, created_at, admin_id, kind)' : '(amount, description, created_at, admin_id)';
        $vals = $hasKind ? [$amount, $desc, $ts, 'import', $kind] : [$amount, $desc, $ts, 'import'];
        $pdo->prepare("INSERT INTO expenses $cols VALUES (" . implode(',', array_fill(0, count($vals), '?')) . ")")->execute($vals);
    } else {
        finCreateSale($pdo, ['date' => date('Y-m-d', $ts), 'items' => [['name' => $desc, 'qty' => 1, 'price' => $amount]], 'paid_now' => $amount, 'money_account' => 'cash', 'memo' => $tag, 'channel' => 'import'], 'import');
    }
    $added++;
}
if ($apply) {
    $s = finSyncLegacy($pdo, 100000);
    printf("\nadded %d, skipped %d; ledger sync: expenses %d, issues %d\n", $added, $skipped, $s['legacy_expense'], count($s['issues']));
} else {
    echo "\nDRY RUN — nothing written. Re-run with --apply.\n";
}
