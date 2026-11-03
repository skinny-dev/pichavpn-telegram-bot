<?php
/*
 * Seeds the expenses paid from the business SwapWallet account (1405/07–08): Pars Safe invoices, the 8 TB traffic purchase and
 * two USDT transfers.
 *   php scripts/seed_swapwallet_expenses.php             # dry run
 *   php scripts/seed_swapwallet_expenses.php --apply     # insert (safe to re-run: the invoice number / transfer label is the identity)
 *   php scripts/seed_swapwallet_expenses.php --csv       # the same rows as a CSV
 * How the bot counts them (stats_report.php): expenses are NEVER taken out of revenue; revenue is customer money arriving.
 * They only lower net profit, in the day they are dated. SwapWallet is the one business account: money put into it is a
 * «capital entry» (not revenue), money leaving it for costs is an expense (this table) — they never mix.
 * Amounts are TOMAN. Crypto transfers use the toman value SwapWallet printed («ارزش تقریبی»). Only a shortened wallet address is stored.
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
date_default_timezone_set('Asia/Tehran');
$payer = 'SwapWallet (حساب کسب‌وکار)';
// kind, toman, title, payee, reference label, reference (identity), Gregorian date, time
$rows = [
    ['purchase', 4224000, 'خرید ۸ ترابایت ترافیک', 'پارس سیف', null, null, '2026-11-03', '10:45'],
    // the two Pars Safe invoices and the two USDT transfers were paid at the start of 1405/08 (23 Oct 2026);
    // the 29 Oct 20:18 stamp on the forwarded messages is only when they were forwarded
    ['purchase', 984500, 'پارس سیف — فاکتور ۹۸۰۷۷', 'پارس سیف', 'فاکتور', '98077', '2026-10-23', '12:00'],
    ['purchase', 4950000, 'پارس سیف — فاکتور ۹۸۰۷۹', 'پارس سیف', 'فاکتور', '98079', '2026-10-23', '12:00'],
    ['purchase', 13088975, 'خرید سرورهای Aeza — ۴۸٫۷۳ تتر (BSC)، ارزش تقریبی ۱۳٬۰۸۸٬۹۷۵ تومان', 'Aeza', 'تراکنش', 'USDT 48.73 → 0x53B8…5a14', '2026-10-23', '12:00'],
    ['purchase', 12624123, 'خرید سرورهای Doprax — ۴۶٫۹۳ تتر (BSC)، ارزش تقریبی ۱۲٬۶۲۴٬۱۲۳ تومان', 'Doprax', 'تراکنش', 'USDT 46.93 → 0xe79E…2C6F', '2026-10-23', '12:00'],
];

$records = [];
foreach ($rows as [$kind, $toman, $title, $payee, $refLabel, $ref, $date, $time]) {
    $records[] = ['payer' => $payer, 'kind' => $kind, 'amount' => $toman, 'desc' => $title . ' | ' . ($refLabel && $ref ? "$refLabel $ref" : 'SwapWallet'),
        'ref' => $ref, 'payee' => $payee, 'ts' => strtotime("$date $time:00"), 'when' => "$date $time"];
}

if (in_array('--csv', $argv, true)) {
    echo "\xEF\xBB\xBF";
    $out = fopen('php://output', 'w');
    fputcsv($out, ['created_at', 'kind', 'description', 'payer', 'payee', 'amount']);
    foreach ($records as $r) {
        fputcsv($out, [$r['when'], $r['kind'], $r['desc'], $r['payer'], $r['payee'], $r['amount']]);
    }
    exit;
}

require_once 'config.php';
$apply = in_array('--apply', $argv, true);
$hasPayer = (bool) $pdo->query("SHOW COLUMNS FROM expenses LIKE 'payer'")->fetchColumn() && (bool) $pdo->query("SHOW COLUMNS FROM expenses LIKE 'payee'")->fetchColumn();
if ($apply && !$hasPayer) {
    exit("ستون‌های «پرداخت‌کننده / مقصد» هنوز نیست: اول php table.php (یا دیپلوی کامل) را بزنید.\n");
}
$added = $skipped = 0;
$sum = 0;
foreach ($records as $r) {
    if ($r['ref']) {
        $q = $pdo->prepare("SELECT COUNT(*) FROM expenses WHERE description LIKE ?");
        $q->execute(['%' . $r['ref'] . '%']);
    } else {
        $q = $pdo->prepare("SELECT COUNT(*) FROM expenses WHERE description = ? AND amount = ? AND created_at = ?");
        $q->execute([$r['desc'], $r['amount'], $r['ts']]);
    }
    $dup = (int) $q->fetchColumn() > 0;
    if ($dup && $r['ref'] && $apply) { // rows this script wrote earlier are corrected in place (kind, date, payee, text)
        $fix = $pdo->prepare("UPDATE expenses SET kind = ?, created_at = ?, payee = ?, description = ?, amount = ? WHERE admin_id = 'swapwallet-seed' AND description LIKE ? AND (kind <> ? OR created_at <> ? OR COALESCE(payee,'') <> ? OR description <> ? OR amount <> ?)");
        $fix->execute([$r['kind'], $r['ts'], $r['payee'], $r['desc'], $r['amount'], '%' . $r['ref'] . '%', $r['kind'], $r['ts'], $r['payee'], $r['desc'], $r['amount']]);
        if ($fix->rowCount() > 0) {
            printf("%-16s %-9s %12s  %s  (updated)\n", $r['when'], $r['kind'], number_format($r['amount']), $r['desc']);
            $skipped++;
            continue;
        }
    }
    printf("%-16s %-9s %12s  %s → %s  %s\n", $r['when'], $r['kind'], number_format($r['amount']), $r['desc'], $r['payee'], $dup ? '(already there)' : ($apply ? 'ADD' : 'would add'));
    if ($dup) {
        $skipped++;
        continue;
    }
    $sum += $r['amount'];
    $added++;
    if ($apply) {
        $cols = $hasPayer ? '(amount, description, created_at, admin_id, kind, payer, payee)' : '(amount, description, created_at, admin_id, kind)';
        $vals = [$r['amount'], $r['desc'], $r['ts'], 'swapwallet-seed', $r['kind']];
        if ($hasPayer) {
            array_push($vals, $r['payer'], $r['payee']);
        }
        $pdo->prepare("INSERT INTO expenses $cols VALUES (" . implode(',', array_fill(0, count($vals), '?')) . ")")->execute($vals);
    }
}
printf("\n%s %d rows (%s toman), already there %d.%s\n", $apply ? 'added' : 'would add', $added, number_format($sum), $skipped, $apply ? '' : ' DRY RUN — re-run with --apply.');
if ($apply) {
    echo "Run: php scripts/fin_sync.php   (puts them in the finance ledger)\n";
}
