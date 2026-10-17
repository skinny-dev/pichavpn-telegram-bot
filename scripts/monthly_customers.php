<?php
// Per-month customer averages (Jalali months, Tehran time), the last N months side by side.
//   php scripts/monthly_customers.php        # last 6 months
//   php scripts/monthly_customers.php 12
// Revenue = cash received (same rules as the stats page). «مشتری پرداخت‌کننده» = distinct customers with a paid payment
// that month; «خریدار» = distinct customers with an order (purchase / renewal / extra) that month.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
require $root . '/config.php';
require_once $root . '/jdf.php';
require_once $root . '/stats_report.php';

$months = max(1, min(36, (int) ($argv[1] ?? 6)));
$now = time();
[$jy, $jm] = array_map('intval', explode('/', jdate('Y/n', $now, '', 'Asia/Tehran', 'en')));
$start = function ($y, $m) {
    [$gy, $gm, $gd] = jalali_to_gregorian($y, $m, 1);
    return (new DateTime(sprintf('%04d-%02d-%02d 00:00:00', $gy, $gm, $gd), new DateTimeZone('Asia/Tehran')))->getTimestamp();
};
$names = [1 => 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
$rows = [];
for ($i = $months - 1; $i >= 0; $i--) {
    $y = $jy;
    $m = $jm - $i;
    while ($m < 1) {
        $m += 12;
        $y--;
    }
    [$ny, $nm] = $m == 12 ? [$y + 1, 1] : [$y, $m + 1];
    $s = $start($y, $m);
    $e = min($now, $start($ny, $nm) - 1);
    $d = statsCollect($pdo, $s, $e);
    $rows[] = [$names[$m] . " $y" . ($i === 0 ? ' (تا امروز)' : ''), $d];
}
$f = fn($v) => number_format((float) $v);
echo "ماه                  | درآمد          | پرداخت‌کننده | میانگین هر مشتری | خریدار | سفارش | میانگین سفارش | سفارش/مشتری\n";
echo str_repeat('─', 118) . "\n";
foreach ($rows as [$label, $d]) {
    printf("%-20s | %14s | %12s | %16s | %6s | %5s | %13s | %s\n", $label, $f($d['revenue']), $f($d['payers']),
        $f($d['payers'] ? $d['revenue'] / $d['payers'] : 0), $f($d['buyers']), $f($d['orders']),
        $f($d['orders'] ? $d['orders_sum'] / $d['orders'] : 0), $d['buyers'] ? round($d['orders'] / $d['buyers'], 2) : 0);
}
echo "\nمبلغ‌ها به تومان. میانگین هر مشتری = درآمد ماه ÷ تعداد مشتری‌هایی که آن ماه پول دادند.\n";
