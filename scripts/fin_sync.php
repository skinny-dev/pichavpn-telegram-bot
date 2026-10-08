<?php
/*
 * Finance ledger maintenance (run on the server):
 *   php scripts/fin_sync.php            # import/refresh everything from the bot's legacy accounting data, then run depreciation
 *   php scripts/fin_sync.php --check    # sync + integrity check + reconciliation against the bot's «آمار» numbers
 * Safe to run any time (idempotent). The first run on a big database can take a while; the panel itself only syncs small batches.
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'finance/engine.php';
require_once 'finance/reports.php';
require_once 'finance/legacy.php';

$t0 = microtime(true);
$round = 0;
do {
    $s = finSyncLegacy($pdo, 100000);
    $round++;
    printf("sync #%d: expenses %d · capital %d · cost %d · payments %d · re-posted %d · reversed %d · issues %d\n", $round, $s['legacy_expense'], $s['legacy_capital'], $s['legacy_cost'], $s['legacy_payment'], $s['reposted'], $s['reversed'], count($s['issues']));
} while (($s['legacy_payment'] + $s['legacy_cost'] + $s['legacy_capital']) >= 100000 && $round < 20);
foreach (array_slice($s['issues'], 0, 30) as $i) {
    echo "  ! $i\n";
}
echo 'depreciation entries posted: ' . finDepreciate($pdo, null, 'sync') . "\n";
printf("done in %.1fs\n", microtime(true) - $t0);

if (in_array('--check', $argv, true)) {
    $bad = finIntegrity($pdo);
    echo $bad ? "INTEGRITY PROBLEMS:\n  - " . implode("\n  - ", $bad) . "\n" : "integrity: OK (every entry balances, trial balance and balance sheet balance)\n";
    require_once 'stats_report.php';
    $st = statsCollect($pdo, 0, time());
    $pl = finProfitLoss($pdo, 0, time());
    $fmt = fn($n) => str_pad(number_format((int) $n), 16, ' ', STR_PAD_LEFT);
    echo "\nreconciliation with the bot's statistics (all time, toman):\n";
    echo "                                   bot «آمار»          ledger\n";
    echo '  revenue (cash received)    ' . $fmt($st['revenue']) . $fmt($pl['totals']['sales'] + $pl['totals']['other_income'] + 0) . "\n";
    echo '  expenses (all categories)  ' . $fmt($st['exp_sum']) . $fmt($pl['totals']['cogs'] + $pl['totals']['opex'] + $pl['totals']['other_expense']) . "\n";
    echo '  capital injected           ' . $fmt($st['cap_sum']) . $fmt(finAccountBalance($pdo, 'capital')) . "\n";
    echo '  dividends / withdrawals    ' . $fmt($st['div_sum']) . $fmt(-finAccountBalance($pdo, 'dividends')) . "\n";
    echo "(panel-created transactions exist only in the ledger, so small differences appear once you start using the new Finance section.)\n";
}
