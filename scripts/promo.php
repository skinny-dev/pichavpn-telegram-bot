<?php
/*
 * Product promotion from the terminal (the panel page «تخفیف‌ها» does the same).
 *   php scripts/promo.php plan  --min-gb=40 --percent=20 [--round=5000] [--round-mode=down] [--hours=72] [--agents=f]
 *   php scripts/promo.php start --min-gb=40 --percent=20 ...        (or --bonus-gb=10 instead of --percent)
 *   php scripts/promo.php status
 *   php scripts/promo.php end                                         # restore now (also automatic at the end time)
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'promo_lib.php';
date_default_timezone_set('Asia/Tehran');

$cmd = $argv[1] ?? 'status';
$o = ['min-gb' => 0, 'percent' => 0, 'bonus-gb' => 0, 'round' => 1000, 'round-mode' => 'down', 'hours' => 72, 'agents' => 'f', 'title' => 'تخفیف ویژه'];
foreach (array_slice($argv, 2) as $a) {
    if (!preg_match('/^--([a-z-]+)=(.+)$/su', $a, $m) || !array_key_exists($m[1], $o)) {
        fwrite(STDERR, "unknown option: $a\n");
        exit(64);
    }
    $o[$m[1]] = $m[2];
}
$fmt = fn($n) => number_format((int) $n);
$show = function (array $items) use ($fmt) {
    foreach ($items as $it) {
        printf("%-42s %6s→%-6s GB  %10s → %10s  [%s]\n", $it['name'], promoNum($it['old_gb']), promoNum($it['new_gb']), $fmt($it['old_price']), $fmt($it['new_price']), $it['agent']);
    }
};
if ($cmd === 'status') {
    $s = promoState();
    if (!$s) {
        exit("no promotion running\n");
    }
    printf("%s — ends %s, %d products\n", $s['title'], date('Y-m-d H:i', $s['ends_at']), count($s['items']));
    $show($s['items']);
    exit;
}
if ($cmd === 'end') {
    [$n, $skipped] = promoEnd($pdo);
    exit("restored $n product(s)" . ($skipped ? '; left alone (changed during the promotion): ' . implode(', ', $skipped) : '') . "\n");
}
$type = (float) $o['percent'] > 0 ? 'percent' : 'bonus_gb';
$value = $type === 'percent' ? (float) $o['percent'] : (float) $o['bonus-gb'];
$agents = array_filter(explode(',', (string) $o['agents']));
$st = $pdo->prepare("SELECT id FROM product WHERE CAST(Volume_constraint AS DECIMAL(12,2)) >= ? AND CAST(Volume_constraint AS DECIMAL(12,2)) > 0 AND COALESCE(NULLIF(agent,''),'f') IN (" . implode(',', array_fill(0, count($agents), '?')) . ")");
$st->execute(array_merge([(float) $o['min-gb']], $agents));
$items = promoBuild($pdo, $st->fetchAll(PDO::FETCH_COLUMN), $type, $value, (int) $o['round'], (string) $o['round-mode']);
if ($cmd === 'start') {
    promoStart($pdo, $items, $type, $value, time() + max(1, (int) $o['hours']) * 3600, (string) $o['title']);
}
$show($items);
printf("\n%d product(s). %s\n", count($items), $cmd === 'start' ? 'STARTED — ends ' . date('Y-m-d H:i', time() + (int) $o['hours'] * 3600) : 'PREVIEW only (use «start»)');
