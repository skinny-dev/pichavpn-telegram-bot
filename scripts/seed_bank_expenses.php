<?php
/*
 * Seeds the bank-paid expenses of 1405/07 (paid by علیرضا خدابخش).
 *   php scripts/seed_bank_expenses.php             # dry run
 *   php scripts/seed_bank_expenses.php --apply     # insert (safe to re-run: the bank reference number is the identity)
 *   php scripts/seed_bank_expenses.php --csv       # print the same rows as a CSV for «داده‌های حسابداری ← هزینه‌ها ← درون‌ریزی»
 * Amounts are stored in TOMAN like every other expense in the bot (the bank slips are in rial: toman = rial / 10).
 * Full card / IBAN numbers of the payees are deliberately NOT stored; only the name, bank and bank reference.
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
date_default_timezone_set('Asia/Tehran');
$payer = 'علیرضا خدابخش';
// kind, rial, title, payee, method text, bank, reference label, reference, Gregorian date, time (null = unknown)
$rows = [
    ['advertising', 20000000, 'تبلیغات', 'حسین حیدری', 'بلو به بلو', 'بلو', 'شماره سند', '14055408860705', '2026-09-25', '20:13'],
    ['advertising', 30000000, 'تبلیغات', 'حسین حیدری', 'بلو به بلو', 'بلو', 'شماره سند', '14055524165086', '2026-09-29', '01:08'],
    ['advertising', 20000000, 'تبلیغات', 'حسین حیدری', 'بلو به بلو', 'بلو', 'شماره سند', '14055524344215', '2026-09-29', '01:34'],
    ['advertising', 50000000, 'تبلیغات', 'امیرحسین ندرلو', 'کارت به کارت', 'تجارت', 'شماره پیگیری', '068581343691', '2026-09-29', '16:13'],
    ['advertising', 5000000, 'تبلیغات', 'ترنم میرزایی', 'کارت به کارت', 'ملی', 'شماره پیگیری', '095157952257', '2026-10-02', '18:02'],
    ['server', 29249780, 'سرور — پروژه hoozhan (YottaSrc)', 'YottaSrc', null, null, null, null, null, null],
];

$records = [];
foreach ($rows as [$kind, $rial, $title, $payee, $method, $bank, $refLabel, $ref, $date, $time]) {
    $parts = [$title . ($payee !== 'YottaSrc' ? ' — ' . $payee : '')];
    if ($method) {
        $parts[] = $method . ($bank ? " (بانک $bank)" : '');
    }
    if ($ref) {
        $parts[] = "$refLabel $ref";
    }
    $records[] = ['kind' => $kind, 'amount' => (int) round($rial / 10), 'desc' => implode(' | ', $parts), 'ref' => $ref,
        'ts' => $date ? strtotime("$date $time:00") : null, 'when' => $date ? "$date $time" : ''];
}

if (in_array('--csv', $argv, true)) {
    echo "\xEF\xBB\xBF";
    $out = fopen('php://output', 'w');
    fputcsv($out, ['created_at', 'kind', 'description', 'payer', 'amount']);
    foreach ($records as $r) {
        fputcsv($out, [$r['when'], $r['kind'], $r['desc'], $payer, $r['amount']]);
    }
    exit;
}

require_once 'config.php';
$apply = in_array('--apply', $argv, true);
$hasPayer = (bool) $pdo->query("SHOW COLUMNS FROM expenses LIKE 'payer'")->fetchColumn();
if ($apply && !$hasPayer) {
    exit("ستون «پرداخت‌کننده» هنوز نیست: اول php table.php (یا دیپلوی کامل) را بزنید.\n");
}
$added = $skipped = 0;
$sum = 0;
foreach ($records as $r) {
    $dup = false;
    if ($r['ref']) {
        $q = $pdo->prepare("SELECT COUNT(*) FROM expenses WHERE description LIKE ?");
        $q->execute(['%' . $r['ref'] . '%']);
        $dup = (int) $q->fetchColumn() > 0;
    } else {
        $q = $pdo->prepare("SELECT COUNT(*) FROM expenses WHERE description = ? AND amount = ?");
        $q->execute([$r['desc'], $r['amount']]);
        $dup = (int) $q->fetchColumn() > 0;
    }
    printf("%-16s %-11s %12s  %s  %s\n", $r['when'] ?: '(تاریخ نامعلوم: الان)', $r['kind'], number_format($r['amount']), $r['desc'], $dup ? '(already there)' : ($apply ? 'ADD' : 'would add'));
    if ($dup) {
        $skipped++;
        continue;
    }
    $sum += $r['amount'];
    $added++;
    if ($apply) {
        $cols = $hasPayer ? '(amount, description, created_at, admin_id, kind, payer)' : '(amount, description, created_at, admin_id, kind)';
        $vals = [$r['amount'], $r['desc'], $r['ts'] ?? time(), $payer, $r['kind']];
        if ($hasPayer) {
            $vals[] = $payer;
        }
        $pdo->prepare("INSERT INTO expenses $cols VALUES (" . implode(',', array_fill(0, count($vals), '?')) . ")")->execute($vals);
    }
}
printf("\n%s %d rows (%s toman), already there %d.%s\n", $apply ? 'added' : 'would add', $added, number_format($sum), $skipped, $apply ? '' : ' DRY RUN — re-run with --apply.');
if ($apply) {
    echo "Run: php scripts/fin_sync.php   (puts them in the finance ledger)\n";
}
