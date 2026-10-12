<?php
/*
 * One-off import of the hand-kept expense / income lines (Oct 2026), with Persian titles and categories.
 *   php scripts/import_ledger.php           # dry run: shows what would be added / renamed / skipped
 *   php scripts/import_ledger.php --apply   # writes it (safe to re-run)
 * Expenses -> bot «هزینه‌ها» table (kind set; the finance ledger picks them up through the legacy bridge).
 * Income   -> finance module cash sales (no customer needed).
 * Lines imported by the first version of this script (English titles) are renamed to Persian, not duplicated.
 * Income lines that name a service (ref) are skipped when the bot already recorded that order/renewal itself.
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
// date, E expense / I income, kind, amount (toman), Persian title, [old English title], [service ref]
$rows = [
    ['2026-10-03', 'E', 'server', 1000000, 'سرور — Manageit (شارژ کلود)'],
    ['2026-10-03', 'E', 'advertising', 3000000, 'تبلیغات اینستاگرام — Flora'],
    ['2026-10-03', 'E', 'advertising', 500000, 'تبلیغات اینستاگرام — rfiq tanin she'],
    ['2026-10-03', 'E', 'advertising', 660000, 'تبلیغات اینستاگرام — parza_.am'],
    ['2026-10-03', 'E', 'advertising', 700000, 'تبلیغات اینستاگرام — navidhabibi3'],
    ['2026-10-04', 'E', 'server', 1000000, 'سرور — Manageit'],
    ['2026-10-05', 'E', 'server', 2000000, 'سرور — Manageit'],
    ['2026-10-05', 'I', 'sale', 125000, 'تمدید دستی سرویس none_100_6328305', null, 'none_100_6328305'],
    ['2026-10-05', 'I', 'sale', 125000, 'خرید سرویس جدید ۲۵ گیگ — pichavpn_va3HR3c3', null, 'pichavpn_va3HR3c3'],
    ['2026-10-05', 'I', 'sale', 60000, 'خرید سرویس جدید (دستی) ۱۰ گیگ — j7KZCxWv', null, 'j7KZCxWv'],
    ['2026-10-06', 'E', 'tools', 1500000, 'اشتراک ابزار — Variza', 'Variza — Subscription'],
    ['2026-10-06', 'E', 'advertising', 500000, 'تبلیغات اینستاگرام — Mehshad', 'Mehshad — Instagram Advertisement'],
    ['2026-10-07', 'E', 'server', 4000000, 'سرور — Nexnode', 'Nexnode — Server'],
    ['2026-10-07', 'E', 'server', 1000000, 'سرور — Manageit', 'Manageit — Server'],
    ['2026-10-08', 'E', 'advertising', 3000000, 'تبلیغات اینستاگرام — Walker', 'Walker — Instagram Advertising'],
    ['2026-10-08', 'I', 'sale', 250000, 'فروش کانفیگ رندوم', 'Sell Random Config'],
    ['2026-10-09', 'E', 'server', 5000000, 'سرور — Doprax (خرید)', 'Doprax — Server'],
    ['2026-10-09', 'E', 'server', 2000000, 'سرور — Manageit (خرید)', 'Manageit — Server'],
    ['2026-10-09', 'I', 'sale', 250000, 'فروش کانفیگ رندوم', 'Sell Random Config'],
    ['2026-10-09', 'I', 'sale', 210000, 'فروش کانفیگ رندوم', 'Sell Random Config'],
    ['2026-10-10', 'E', 'general', 764500, 'هزینهٔ بدون توضیح (نیاز به بررسی)'],
    ['2026-10-10', 'E', 'server', 1000000, 'سرور — Manageit'],
    ['2026-10-11', 'E', 'server', 1000000, 'سرور — Manageit'],
    ['2026-10-12', 'E', 'server', 1100000, 'ترافیک سرور — Parssafe'],
];

$hasKind = (bool) $pdo->query("SHOW COLUMNS FROM expenses LIKE 'kind'")->fetchColumn();
$added = $renamed = $skipped = 0;
foreach ($rows as $n => $r) {
    [$date, $type, $kind, $amount, $desc] = $r;
    $old = $r[5] ?? null;
    $ref = $r[6] ?? null;
    $ts = strtotime("$date 12:00:00");
    $lo = strtotime("$date 00:00:00");
    $hi = strtotime("$date 23:59:59");
    $label = sprintf("%s %-12s %11s  %s", $date, $type === 'E' ? "هزینه/$kind" : 'درآمد', number_format($amount), $desc);
    if ($type === 'E') {
        $q = $pdo->prepare("SELECT id, description FROM expenses WHERE description IN (?, ?) AND amount = ? AND created_at BETWEEN ? AND ? LIMIT 1");
        $q->execute([$desc, $old ?? $desc, $amount, $lo, $hi]);
        $hit = $q->fetch(PDO::FETCH_ASSOC);
        if ($hit && $hit['description'] === $desc) {
            echo "$label   (already there)\n";
            $skipped++;
        } elseif ($hit) {
            echo "$label   " . ($apply ? 'RENAMED' : 'would rename') . " (was: {$hit['description']})\n";
            if ($apply) {
                $pdo->prepare("UPDATE expenses SET description = ? WHERE id = ?")->execute([$desc, $hit['id']]);
            }
            $renamed++;
        } else {
            echo "$label   " . ($apply ? 'ADD' : 'would add') . "\n";
            if ($apply) {
                $cols = $hasKind ? '(amount, description, created_at, admin_id, kind)' : '(amount, description, created_at, admin_id)';
                $vals = $hasKind ? [$amount, $desc, $ts, 'import', $kind] : [$amount, $desc, $ts, 'import'];
                $pdo->prepare("INSERT INTO expenses $cols VALUES (" . implode(',', array_fill(0, count($vals), '?')) . ")")->execute($vals);
            }
            $added++;
        }
        continue;
    }
    // income: tag keeps the first-version identity (old English title) so earlier imports are recognised
    $tagDesc = $old ?? $desc;
    $same = count(array_filter(array_slice($rows, 0, $n), fn($x) => $x[0] === $date && $x[1] === 'I' && $x[3] === $amount && ($x[5] ?? $x[4]) === $tagDesc));
    $tag = 'import:' . md5("$date|I|$amount|$tagDesc") . ':' . $same;
    $q = $pdo->prepare("SELECT COUNT(*) FROM fin_txn WHERE memo = ?");
    $q->execute([$tag]);
    if ((int) $q->fetchColumn() > 0) {
        echo "$label   (already there)\n";
        $skipped++;
        continue;
    }
    if ($ref !== null) {
        $isRenewal = strpos($desc, 'تمدید') === 0;
        $bot = $pdo->prepare($isRenewal
            ? "SELECT COUNT(*) FROM service_other WHERE username = ? AND CAST(price AS SIGNED) = ? AND type LIKE 'extend%' AND LOWER(status) NOT IN ('unpaid','expire','unsuccessful','reject')"
            : "SELECT COUNT(*) FROM invoice WHERE username = ? AND CAST(price_product AS SIGNED) = ? AND LOWER(Status) NOT IN ('unpaid','expire','unsuccessful','reject')");
        $bot->execute([$ref, $amount]);
        if ((int) $bot->fetchColumn() > 0) {
            echo "$label   (SKIPPED: the bot already recorded this " . ($isRenewal ? 'renewal' : 'order') . " itself, importing would count it twice)\n";
            $skipped++;
            continue;
        }
    }
    echo "$label   " . ($apply ? 'ADD' : 'would add') . "\n";
    if ($apply) {
        finCreateSale($pdo, ['date' => date('Y-m-d', $ts), 'items' => [['name' => $desc, 'qty' => 1, 'price' => $amount]], 'paid_now' => $amount, 'money_account' => 'cash', 'memo' => $tag, 'channel' => 'import'], 'import');
    }
    $added++;
}
if ($apply) {
    // titles of income lines imported by the first version
    foreach ($rows as $r) {
        if ($r[1] === 'I' && !empty($r[5])) {
            $pdo->prepare("UPDATE fin_txn SET meta = REPLACE(meta, ?, ?) WHERE memo LIKE 'import:%'")->execute([json_encode($r[5], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), json_encode($r[4], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        }
    }
    $s = finSyncLegacy($pdo, 100000);
    printf("\nadded %d, renamed %d, unchanged/skipped %d; ledger sync: expenses %d, issues %d\n", $added, $renamed, $skipped, $s['legacy_expense'], count($s['issues']));
} else {
    printf("\nDRY RUN — would add %d, rename %d, leave %d. Nothing written. Re-run with --apply.\n", $added, $renamed, $skipped);
}
