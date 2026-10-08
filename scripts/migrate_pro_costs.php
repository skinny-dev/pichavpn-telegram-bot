<?php
/*
 * Statistics count expenses/capital that were stored as Mirza-Pro payment rows (Payment_Method 'cost' / 'capital_injection'),
 * but the panel list «حسابداری ← هزینه‌ها» and ورود سرمایه only show the `expenses` / `capital_entries` tables.
 * This moves those rows into the tables (so you can see, edit and categorise them) without changing any total.
 *
 *   php scripts/migrate_pro_costs.php            # dry run: lists every row and the category it would get
 *   php scripts/migrate_pro_costs.php --apply    # saves a SQL copy, copies the rows, marks the old ones as migrated (never deleted)
 * Safe to run twice. Undo: restore the SQL copy printed at the end.
 *
 * The label of an old expense lives in one of Payment_report's text columns. By default it is read from `dec_not_confirmed`
 * (falls back to the random id when that is empty). If you see random ids like «c7fa265f03» as names, find the column that holds
 * the real label with  php scripts/migrate_pro_costs.php --show  and pass it:
 *   php scripts/migrate_pro_costs.php --repair --desc-column=COLUMN          # dry run: fixes the names of rows already moved
 *   php scripts/migrate_pro_costs.php --repair --desc-column=COLUMN --apply
 *   php scripts/migrate_pro_costs.php --desc-column=COLUMN [--apply]         # (first-time move with the right column)
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'stats_report.php';
$apply = in_array('--apply', $argv, true);
$kinds = accExpenseKinds();
$descCol = 'dec_not_confirmed';
foreach ($argv as $a) {
    if (strpos($a, '--desc-column=') === 0) {
        $descCol = substr($a, 14);
    }
}
$cols = $pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Payment_report'")->fetchAll(PDO::FETCH_COLUMN);
if (!in_array($descCol, $cols, true) || $descCol === 'id') {
    fwrite(STDERR, "unknown column «{$descCol}». Columns of Payment_report: " . implode(', ', $cols) . "\n");
    exit(1);
}

if (in_array('--show', $argv, true)) {
    // every column of a few cost rows (migrated or not), to find where the label is stored
    $st = $pdo->query("SELECT * FROM Payment_report WHERE Payment_Method IN ('cost','cost_migrated') ORDER BY id DESC LIMIT 5");
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        echo "---- row #{$row['id']}\n";
        foreach ($row as $k => $v) {
            printf("  %-20s %s\n", $k, mb_substr((string) $v, 0, 80));
        }
    }
    exit(0);
}

if (in_array('--repair', $argv, true)) {
    // rows already moved got the random id as name: put the real label (from the old row) in its place
    $old = $pdo->query("SELECT id_order, `$descCol` d FROM Payment_report WHERE Payment_Method = 'cost_migrated'")->fetchAll(PDO::FETCH_KEY_PAIR);
    $todo = [];
    $find = $pdo->prepare("SELECT id, description FROM expenses WHERE admin_id = 'migrated' AND description = ?");
    foreach ($old as $orderId => $label) {
        $label = trim((string) $label);
        if ($label === '' || $label === 'none' || $label === $orderId) {
            continue;
        }
        $find->execute([$orderId]);
        foreach ($find->fetchAll(PDO::FETCH_ASSOC) as $e) {
            $todo[] = ['id' => $e['id'], 'from' => $e['description'], 'to' => $label, 'kind' => accGuessKind($label)];
        }
    }
    foreach ($todo as $t) {
        printf("  #%-5s %s → %s%s\n", $t['id'], $t['from'], mb_substr($t['to'], 0, 50), $t['kind'] ? '   [' . $kinds[$t['kind']] . ']' : '');
    }
    printf("\nnames to repair: %d (column «%s»)\n", count($todo), $descCol);
    if (!$todo || !$apply) {
        echo $todo ? "DRY RUN. Add --apply to save.\n" : "Nothing to repair: that column is empty for these rows. Try --show to find the right one.\n";
        exit(0);
    }
    $backup = '/root/pre-repair-names-' . time() . '.sql';
    exec(sprintf('MYSQL_PWD=%s mysqldump -h %s -u %s --single-transaction --no-tablespaces %s expenses > %s 2>/dev/null', escapeshellarg($passworddb), escapeshellarg($dbhost), escapeshellarg($usernamedb), escapeshellarg($dbname), escapeshellarg($backup)), $o, $code);
    if ($code !== 0 || !is_file($backup) || filesize($backup) < 100) {
        fwrite(STDERR, "could not save a safety copy; nothing was changed\n");
        exit(1);
    }
    echo "safety copy: $backup\n";
    $up = $pdo->prepare("UPDATE expenses SET description = ?, kind = IF(kind IN ('general',''), ?, kind) WHERE id = ?");
    $pdo->beginTransaction();
    foreach ($todo as $t) {
        $up->execute([$t['to'], $t['kind'] ?? 'general', $t['id']]);
    }
    $pdo->commit();
    echo 'DONE: ' . count($todo) . " names repaired (category guessed only for rows still in «سایر»).\n";
    exit(0);
}

$rows = $pdo->query("SELECT id, time, price, id_order, `$descCol` AS dec_not_confirmed, Payment_Method, payment_Status FROM Payment_report WHERE Payment_Method IN ('cost','capital_injection') ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
if (!$rows) {
    echo "No Mirza-Pro cost/capital rows in Payment_report: nothing to move.\n";
    exit(0);
}
$plan = [];
foreach ($rows as $r) {
    $desc = trim((string) ($r['dec_not_confirmed'] ?? ''));
    if ($desc === '' || $desc === 'none') {
        $desc = ''; // no label stored in this column: leave the name empty instead of showing a random id (see --show / --desc-column)
    }
    $ts = accParseDateTime((string) $r['time']) ?? time();
    $isCost = $r['Payment_Method'] === 'cost';
    $plan[] = [
        'id' => $r['id'], 'type' => $isCost ? 'expense' : 'capital', 'amount' => (int) $r['price'], 'desc' => $desc, 'ts' => $ts,
        'kind' => $isCost ? (accGuessKind($desc) ?? 'general') : null,
    ];
}
$exists = function ($table, $p) use ($pdo) {
    $st = $pdo->prepare("SELECT COUNT(*) FROM `$table` WHERE amount = ? AND created_at = ? AND COALESCE(description,'') = ?");
    $st->execute([$p['amount'], $p['ts'], $p['desc']]);
    return (int) $st->fetchColumn() > 0;
};
$sum = ['expense' => [0, 0], 'capital' => [0, 0]];
foreach ($plan as $p) {
    printf("  #%-5s %-8s %12s  %s  %-26s %s\n", $p['id'], $p['type'] === 'expense' ? 'expense' : 'capital', number_format($p['amount']), accFormatDateTime($p['ts']), $p['kind'] ? $kinds[$p['kind']] : '—', mb_substr($p['desc'], 0, 40));
    $sum[$p['type']][0]++;
    $sum[$p['type']][1] += $p['amount'];
}
printf("\nexpenses: %d rows, %s toman · capital: %d rows, %s toman\n", $sum['expense'][0], number_format($sum['expense'][1]), $sum['capital'][0], number_format($sum['capital'][1]));
if (!$apply) {
    echo "DRY RUN. The statistics totals do not change when you apply (the rows only move to the editable tables). Run with --apply to do it.\n";
    exit(0);
}
$backup = '/root/pre-migrate-costs-' . time() . '.sql';
$cmd = sprintf('MYSQL_PWD=%s mysqldump -h %s -u %s --single-transaction --no-tablespaces %s Payment_report expenses capital_entries > %s 2>/dev/null', escapeshellarg($passworddb), escapeshellarg($dbhost), escapeshellarg($usernamedb), escapeshellarg($dbname), escapeshellarg($backup));
exec($cmd, $o, $code);
if ($code !== 0 || !is_file($backup) || filesize($backup) < 100) {
    fwrite(STDERR, "could not save a safety copy ($backup); nothing was changed\n");
    exit(1);
}
echo "safety copy: $backup\n";
$insE = $pdo->prepare('INSERT INTO expenses (amount, description, created_at, admin_id, kind) VALUES (?,?,?,?,?)');
$insC = $pdo->prepare('INSERT INTO capital_entries (amount, description, created_at, admin_id) VALUES (?,?,?,?)');
$mark = $pdo->prepare("UPDATE Payment_report SET Payment_Method = ?, payment_Status = 'migrated' WHERE id = ?");
$pdo->beginTransaction();
$added = 0;
foreach ($plan as $p) {
    $table = $p['type'] === 'expense' ? 'expenses' : 'capital_entries';
    if (!$exists($table, $p)) {
        if ($p['type'] === 'expense') {
            $insE->execute([$p['amount'], $p['desc'], $p['ts'], 'migrated', $p['kind']]);
        } else {
            $insC->execute([$p['amount'], $p['desc'], $p['ts'], 'migrated']);
        }
        $added++;
    }
    $mark->execute([$p['type'] === 'expense' ? 'cost_migrated' : 'capital_migrated', $p['id']]);
}
$pdo->commit();
echo "DONE: $added rows copied, " . count($plan) . " old rows marked as migrated (not deleted).\nNow check: panel → حسابداری → هزینه‌ها, and the bot's آمار (totals unchanged).\n";
