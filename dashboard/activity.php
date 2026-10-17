<?php
// Monthly activity heatmap data: one value per Jalali day for each metric (same definitions as the «آمار» report).

/** Unix time of 00:00 Tehran on Jalali y/m/d. */
function picha_jday_start(int $jy, int $jm, int $jd): int
{
    [$gy, $gm, $gd] = jalali_to_gregorian($jy, $jm, $jd);
    return (new DateTime(sprintf('%04d-%02d-%02d 00:00:00', $gy, $gm, $gd), new DateTimeZone('Asia/Tehran')))->getTimestamp();
}

/** [start, number of days] of a Jalali month. */
function picha_jmonth(int $jy, int $jm): array
{
    $start = picha_jday_start($jy, $jm, 1);
    $next = $jm === 12 ? picha_jday_start($jy + 1, 1, 1) : picha_jday_start($jy, $jm + 1, 1);
    return [$start, (int) round(($next - $start) / 86400)];
}

function picha_activity(PDO $pdo, int $jy, int $jm): array
{
    $pdo->exec("SET time_zone = '+03:30'");
    [$start, $days] = picha_jmonth($jy, $jm);
    $end = $start + $days * 86400 - 1;
    $p = [':s' => $start, ':e' => $end];
    // per-day bucket of a unix-time SQL expression
    $byDay = function (string $tsExpr, string $from, string $where, string $value = 'COUNT(*)') use ($pdo, $p, $start, $days): array {
        $st = $pdo->prepare("SELECT FLOOR(($tsExpr - $start) / 86400) d, $value v FROM $from WHERE $where AND $tsExpr BETWEEN :s AND :e GROUP BY d");
        $st->execute($p);
        $out = array_fill(0, $days, 0);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $i = (int) $r['d'];
            if ($i >= 0 && $i < $days) {
                $out[$i] = (float) $r['v'];
            }
        }
        return $out;
    };
    $tsInv = statsHas($pdo, 'invoice', 'time_sell_unix') ? 'IF(i.time_sell_unix > 0, i.time_sell_unix, CAST(i.time_sell AS UNSIGNED))' : 'CAST(i.time_sell AS UNSIGNED)';
    $sale = "CAST(i.price_product AS SIGNED) > 0 AND LOWER(i.Status) NOT IN " . STATS_BAD_INVOICE . " AND i.name_product NOT LIKE '%تست%'";
    $tsPay = statsTs('time');
    $tsSo = statsTs('time');

    $s = [];
    $s['revenue'] = $byDay($tsPay, 'Payment_report', "payment_Status = 'paid' AND Payment_Method NOT IN (" . STATS_NON_CASH . ")", 'SUM(CAST(price AS SIGNED))');
    $s['orders'] = $byDay($tsInv, 'invoice i', $sale);
    $s['orders_sum'] = $byDay($tsInv, 'invoice i', $sale, 'SUM(CAST(i.price_product AS SIGNED))');
    $s['renew'] = $byDay($tsSo, 'service_other', "type IN ('extend_user','extend_user_by_admin') AND LOWER(status) = 'paid'");
    $s['new_users'] = $byDay('CAST(register AS UNSIGNED)', 'user', "register REGEXP '^[0-9]+$'");
    $s['tests'] = $byDay($tsInv, 'invoice i', "i.name_product LIKE '%تست%'");
    // expenses = purchases + operating costs (dividends are not an expense), plus Mirza Pro «cost» rows
    $exp = $byDay($tsPay, 'Payment_report', "Payment_Method = 'cost'", 'SUM(CAST(price AS SIGNED))');
    if (statsHas($pdo, 'expenses')) {
        $kind = statsHas($pdo, 'expenses', 'kind') ? "COALESCE(NULLIF(kind,''),'general') <> 'dividend'" : '1=1';
        foreach ($byDay('created_at', 'expenses', $kind, 'SUM(amount)') as $i => $v) {
            $exp[$i] += $v;
        }
    }
    $s['expenses'] = $exp;
    $s['support'] = statsHas($pdo, 'support_message') ? $byDay(statsTs('time'), 'support_message', '1=1') : array_fill(0, $days, 0);
    $s['net'] = array_map(fn($r, $e) => $r - $e, $s['revenue'], $s['expenses']);

    $today = time();
    $list = [];
    for ($i = 0; $i < $days; $i++) {
        $ts = $start + $i * 86400 + 43200;
        $list[] = ['day' => $i + 1, 'weekday' => (int) jdate('w', $ts, '', 'Asia/Tehran', 'en'), 'future' => $start + $i * 86400 > $today];
    }
    return [
        'year' => $jy, 'month' => $jm, 'title' => jdate('F Y', $start + 43200, '', 'Asia/Tehran', 'fa'), 'days' => $list,
        'series' => array_map(fn($a) => array_map(fn($v) => round($v), $a), $s),
        'totals' => array_map('array_sum', $s),
    ];
}
