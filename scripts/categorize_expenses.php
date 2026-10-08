<?php
/*
 * Put old expenses into the professional categories by reading their description.
 *   php scripts/categorize_expenses.php            # dry run: shows what would change (only rows still in «سایر»)
 *   php scripts/categorize_expenses.php --apply    # saves a SQL copy of the table, then updates `kind`
 *   php scripts/categorize_expenses.php --all      # also re-check rows that already have a category
 * Rows with no matching keyword stay as they are; fix those by hand in the panel (حسابداری ← هزینه‌ها).
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'stats_report.php';
$apply = in_array('--apply', $argv, true);
$all = in_array('--all', $argv, true);

$kinds = accExpenseKinds();
$rows = $pdo->query("SELECT id, amount, description, COALESCE(NULLIF(kind,''),'general') kind FROM expenses ORDER BY created_at")->fetchAll(PDO::FETCH_ASSOC);
$change = [];
$unknown = [];
foreach ($rows as $r) {
    if (!$all && $r['kind'] !== 'general') {
        continue;
    }
    $g = accGuessKind($r['description']);
    if ($g === null) {
        if ($r['kind'] === 'general') {
            $unknown[] = $r;
        }
        continue;
    }
    if ($g !== $r['kind']) {
        $change[] = $r + ['to' => $g];
    }
}
printf("expenses in the table: %d · to change: %d · no keyword match (stay as is): %d\n\n", count($rows), count($change), count($unknown));
$sum = [];
foreach ($change as $c) {
    printf("  #%-5s %12s  %-34s %s → %s\n", $c['id'], number_format((int) $c['amount']), mb_substr((string) $c['description'], 0, 34), $kinds[$c['kind']] ?? $c['kind'], $kinds[$c['to']]);
    $sum[$c['to']] = ($sum[$c['to']] ?? 0) + 1;
}
if ($sum) {
    echo "\nsummary:\n";
    foreach ($sum as $k => $n) {
        printf("  %-28s %d rows\n", $kinds[$k], $n);
    }
}
if ($unknown) {
    echo "\nno match (set by hand in the panel):\n";
    foreach (array_slice($unknown, 0, 40) as $u) {
        printf("  #%-5s %12s  %s\n", $u['id'], number_format((int) $u['amount']), mb_substr((string) $u['description'], 0, 60));
    }
    if (count($unknown) > 40) {
        echo '  … and ' . (count($unknown) - 40) . " more\n";
    }
}
if (!$change) {
    exit(0);
}
if (!$apply) {
    echo "\nDRY RUN. Run again with --apply to save these.\n";
    exit(0);
}
$backup = '/root/pre-categorize-' . time() . '.sql';
$cmd = sprintf('MYSQL_PWD=%s mysqldump -h %s -u %s --single-transaction --no-tablespaces %s expenses > %s 2>/dev/null', escapeshellarg($passworddb), escapeshellarg($dbhost), escapeshellarg($usernamedb), escapeshellarg($dbname), escapeshellarg($backup));
exec($cmd, $o, $code);
if ($code !== 0 || !is_file($backup) || filesize($backup) < 100) {
    fwrite(STDERR, "could not save a safety copy ($backup); nothing was changed\n");
    exit(1);
}
echo "\nsafety copy of the expenses table: $backup\n";
$up = $pdo->prepare('UPDATE expenses SET kind = ? WHERE id = ?');
$pdo->beginTransaction();
foreach ($change as $c) {
    $up->execute([$c['to'], $c['id']]);
}
$pdo->commit();
echo 'updated ' . count($change) . " rows.\n";
