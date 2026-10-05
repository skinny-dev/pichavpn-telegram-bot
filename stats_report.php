<?php
// Period statistics + accounting report (Farsi). Used by the admin stats menu.
// Revenue model: orders + renewals + extra volume + wallet charges.
// Net revenue: revenue - expenses - wallet withdrawals. Capital inflow is shown separately.

if (!function_exists('jdate')) {
    require_once __DIR__ . '/jdf.php';
}

function statsFa($n)
{
    return number_format((float) $n, 0, '.', ',');
}

function statsPeriod($key, $now = null)
{
    $now = $now ?: time();
    $tz = new DateTimeZone('Asia/Tehran');
    $today0 = (new DateTime('@' . $now))->setTimezone($tz)->setTime(0, 0, 0)->getTimestamp();
    [$jy, $jm] = array_map('intval', explode('/', jdate('Y/n', $now, '', 'Asia/Tehran', 'en')));
    $monthStart = function ($y, $m) {
        [$gy, $gm, $gd] = jalali_to_gregorian($y, $m, 1);
        return (new DateTime(sprintf('%04d-%02d-%02d 00:00:00', $gy, $gm, $gd), new DateTimeZone('Asia/Tehran')))->getTimestamp();
    };
    $curStart = $monthStart($jy, $jm);
    [$py, $pm] = $jm == 1 ? [$jy - 1, 12] : [$jy, $jm - 1];
    switch ($key) {
        case 'hour':
            return ['title' => 'آمار ۱ ساعت گذشته', 'start' => $now - 3600, 'end' => $now];
        case 'today':
            return ['title' => 'آمار روز فعلی', 'start' => $today0, 'end' => $now];
        case 'yesterday':
            return ['title' => 'آمار روز گذشته', 'start' => $today0 - 86400, 'end' => $today0 - 1];
        case 'month':
            return ['title' => 'آمار ماه فعلی', 'start' => $curStart, 'end' => $now];
        case 'lastmonth':
            return ['title' => 'آمار ماه گذشته', 'start' => $monthStart($py, $pm), 'end' => $curStart - 1];
        default:
            return ['title' => 'آمار کل', 'start' => 0, 'end' => $now];
    }
}

// Returns raw numbers for [$start, $end] (unix timestamps).
function statsCollect(PDO $pdo, $start, $end)
{
    $testName = 'سرویس تست';
    $s = date('Y/m/d H:i:s', $start);
    $e = date('Y/m/d H:i:s', $end);
    $one = function ($sql, $params) use ($pdo) {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return $st->fetch(PDO::FETCH_ASSOC) ?: [];
    };
    $num = function ($v) {
        return (float) ($v ?? 0);
    };
    $r = [];

    // --- orders (new purchases) ---
    $inv = "FROM invoice i LEFT JOIN user u ON u.id = i.id_user
            WHERE CAST(i.time_sell AS DECIMAL(20,0)) BETWEEN :s AND :e
              AND i.Status != 'Unpaid' AND i.name_product != :t";
    $row = $one("SELECT COUNT(*) c, SUM(CAST(i.price_product AS DECIMAL(20,0))) p, SUM(CAST(i.Volume AS DECIMAL(20,2))) v $inv", [':s' => $start, ':e' => $end, ':t' => $testName]);
    $r['orders'] = (int) $num($row['c']);
    $r['orders_sum'] = $num($row['p']);
    $r['vol_service'] = $num($row['v']);

    $row = $one("SELECT SUM(CAST(i.Volume AS DECIMAL(20,2))) v $inv AND i.name_product LIKE :em", [':s' => $start, ':e' => $end, ':t' => $testName, ':em' => '%اضطراری%']);
    $r['vol_emergency'] = $num($row['v']);

    foreach (['n' => 'agent_n', 'n2' => 'agent_n2'] as $type => $key) {
        $row = $one("SELECT COUNT(*) c, SUM(CAST(i.price_product AS DECIMAL(20,0))) p $inv AND u.agent = :a", [':s' => $start, ':e' => $end, ':t' => $testName, ':a' => $type]);
        $r[$key] = (int) $num($row['c']);
        $r[$key . '_sum'] = $num($row['p']);
    }

    // first purchases: invoices that are the buyer's earliest paid, non-test invoice
    $row = $one("SELECT COUNT(*) c, SUM(CAST(i.price_product AS DECIMAL(20,0))) p,
                    AVG(CASE WHEN u.register REGEXP '^[0-9]+$' AND CAST(i.time_sell AS DECIMAL(20,0)) >= CAST(u.register AS DECIMAL(20,0))
                             THEN CAST(i.time_sell AS DECIMAL(20,0)) - CAST(u.register AS DECIMAL(20,0)) END) a,
                    SUM(CASE WHEN u.register REGEXP '^[0-9]+$' AND CAST(i.time_sell AS DECIMAL(20,0)) >= CAST(u.register AS DECIMAL(20,0))
                             THEN 1 ELSE 0 END) ac
                 $inv AND NOT EXISTS (
                    SELECT 1 FROM invoice j WHERE j.id_user = i.id_user AND j.Status != 'Unpaid' AND j.name_product != :t2
                      AND CAST(j.time_sell AS DECIMAL(20,0)) < CAST(i.time_sell AS DECIMAL(20,0)))",
        [':s' => $start, ':e' => $end, ':t' => $testName, ':t2' => $testName]);
    $r['first'] = (int) $num($row['c']);
    $r['first_sum'] = $num($row['p']);
    $r['first_avg_sec'] = $num($row['a']);
    $r['first_avg_n'] = (int) $num($row['ac']);

    // --- service_other: renewals, extra volume ---
    foreach (['extend_user' => 'renew', 'extra_user' => 'extra'] as $type => $key) {
        $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS DECIMAL(20,0))) p FROM service_other
                     WHERE type = :ty AND status != 'unpaid' AND time BETWEEN :s AND :e", [':ty' => $type, ':s' => $s, ':e' => $e]);
        $r[$key] = (int) $num($row['c']);
        $r[$key . '_sum'] = $num($row['p']);
    }
    $row = $one("SELECT SUM(CAST(value AS DECIMAL(20,2))) v FROM service_other
                 WHERE type = 'extra_user' AND status != 'unpaid' AND time BETWEEN :s AND :e", [':s' => $s, ':e' => $e]);
    $r['vol_extra'] = $num($row['v']);

    // --- wallet ---
    $pay = "FROM Payment_report WHERE payment_Status = 'paid' AND time BETWEEN :s AND :e";
    $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS DECIMAL(20,0))) p $pay AND Payment_Method NOT IN ('low balance by admin') AND (id_invoice IS NULL OR id_invoice = 'none')", [':s' => $s, ':e' => $e]);
    $r['wallet_in'] = (int) $num($row['c']);
    $r['wallet_in_sum'] = $num($row['p']);
    $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS DECIMAL(20,0))) p $pay AND Payment_Method = 'low balance by admin'", [':s' => $s, ':e' => $e]);
    $r['wallet_out'] = (int) $num($row['c']);
    $r['wallet_out_sum'] = $num($row['p']);

    // --- expenses / capital ---
    foreach (['expenses' => 'exp', 'capital_entries' => 'cap'] as $table => $key) {
        $row = $one("SELECT COUNT(*) c, SUM(amount) p FROM $table WHERE created_at BETWEEN :s AND :e", [':s' => $start, ':e' => $end]);
        $r[$key] = (int) $num($row['c']);
        $r[$key . '_sum'] = $num($row['p']);
    }

    // --- users / tests ---
    $row = $one("SELECT COUNT(*) c FROM invoice WHERE CAST(time_sell AS DECIMAL(20,0)) BETWEEN :s AND :e AND name_product = :t", [':s' => $start, ':e' => $end, ':t' => $testName]);
    $r['tests'] = (int) $num($row['c']);
    $row = $one("SELECT COUNT(*) c FROM user WHERE register REGEXP '^[0-9]+\$' AND CAST(register AS DECIMAL(20,0)) BETWEEN :s AND :e", [':s' => $start, ':e' => $end]);
    $r['new_users'] = (int) $num($row['c']);

    $r['revenue'] = $r['orders_sum'] + $r['renew_sum'] + $r['extra_sum'] + $r['wallet_in_sum'];
    $r['net'] = $r['revenue'] - $r['exp_sum'] - $r['wallet_out_sum'];
    $r['count_all'] = $r['orders'] + $r['renew'] + $r['extra'] + $r['wallet_in'];
    return $r;
}

function statsDuration($sec)
{
    $sec = (int) round($sec);
    if ($sec < 60) return $sec . ' ثانیه';
    if ($sec < 3600) return intdiv($sec, 60) . ' دقیقه';
    if ($sec < 86400) return round($sec / 3600, 1) . ' ساعت';
    return round($sec / 86400, 1) . ' روز';
}

function statsReport(PDO $pdo, $key)
{
    $p = statsPeriod($key);
    $d = statsCollect($pdo, $p['start'], $p['end']);
    $all = $key === 'all' ? $d : statsCollect($pdo, 0, time());
    $fmt = function ($ts) {
        return jdate('Y/m/d H:i:s', $ts, '', 'Asia/Tehran', 'en');
    };
    $n = 'statsFa';
    $vol = function ($v) {
        return rtrim(rtrim(number_format((float) $v, 2, '.', ''), '0'), '.');
    };
    $L = [];
    $L[] = '🕐 <b>' . $p['title'] . '</b>';
    $L[] = '';
    if ($key !== 'all') {
        $L[] = '⏳ بازه تایم : ' . $fmt($p['start']) . ' تا ' . $fmt($p['end']);
        $L[] = '';
    }
    $L[] = '🛍 تعداد سفارشات : ' . $n($d['orders']) . ' عدد';
    $L[] = '💸 جمع مبلغ سفارشات  : ' . $n($d['orders_sum']) . ' تومان';
    $L[] = '🆕 خرید اول : ' . $n($d['first']) . ' عدد — از سفارشات';
    $L[] = '💰 مبلغ خرید اول : ' . $n($d['first_sum']) . ' تومان — از مبلغ سفارشات';
    $L[] = '';
    $L[] = '🛒 خرید نمایندگان عادی : ' . $n($d['agent_n']) . ' عدد — ' . $n($d['agent_n_sum']) . ' تومان';
    $L[] = '🛒 خرید نمایندگان پیشرفته : ' . $n($d['agent_n2']) . ' عدد — ' . $n($d['agent_n2_sum']) . ' تومان';
    $L[] = '';
    $L[] = '🧲 تعداد تمدید  : ' . $n($d['renew']) . ' عدد';
    $L[] = '💰 جمع مبلغ تمدید: ' . $n($d['renew_sum']) . ' تومان';
    $L[] = '';
    $L[] = '📦 حجم‌های اضافه  : ' . $n($d['extra']) . ' عدد';
    $L[] = '💰 مبلغ حجم‌های اضافه : ' . $n($d['extra_sum']) . ' تومان';
    $L[] = '';
    $L[] = '💳 شارژ کیف پول : ' . $n($d['wallet_in']) . ' عدد';
    $L[] = '💰 مبلغ شارژ کیف پول : ' . $n($d['wallet_in_sum']) . ' تومان';
    $L[] = '';
    $L[] = '💸 تعداد برداشت از کیف پول : ' . $n($d['wallet_out']) . ' عدد';
    $L[] = '💰 مبلغ برداشت از کیف پول : ' . $n($d['wallet_out_sum']) . ' تومان';
    $L[] = '';
    $L[] = '🧾 تعداد هزینه‌ها : ' . $n($d['exp']) . ' عدد';
    $L[] = '💸 مجموع هزینه‌ها : ' . $n($d['exp_sum']) . ' تومان';
    $L[] = '';
    $L[] = '📊 تعداد کل : ' . $n($d['count_all']) . ' عدد';
    $L[] = '';
    $L[] = '🔋 حجم فروخته‌شده : ' . $vol($d['vol_service'] + $d['vol_extra']) . ' گیگابایت';
    $L[] = '• از خرید سرویس : ' . $vol($d['vol_service']) . ' گیگابایت';
    $L[] = '• از حجم اضافه : ' . $vol($d['vol_extra']) . ' گیگابایت';
    $L[] = '• اینترنت معمولی (شرایط عادی) : ' . $vol($d['vol_service'] - $d['vol_emergency']) . ' گیگابایت';
    $L[] = '• اینترنت اضطراری (شرایط جنگ) : ' . $vol($d['vol_emergency']) . ' گیگابایت';
    $L[] = '';
    $L[] = '🔑 اکانت‌های تست  : ' . $n($d['tests']) . ' عدد';
    $L[] = '👤 تعداد کاربران  : ' . $n($d['new_users']) . ' نفر';
    $L[] = '⏱ میانگین زمان عضویت تا اولین خرید : ' . ($d['first_avg_n'] > 0 ? statsDuration($d['first_avg_sec']) . ' (' . $d['first_avg_n'] . ' کاربر)' : '—');
    $L[] = '';
    $L[] = '💰 درآمد کل (این بازه) : ' . $n($d['revenue']) . ' تومان';
    $L[] = '💵 درآمد خالص (این بازه) : ' . $n($d['net']) . ' تومان';
    $L[] = '🏦 ورود سرمایه (این بازه) : ' . $n($d['cap_sum']) . ' تومان';
    $L[] = '💰 درآمد کل (از ابتدا) : ' . $n($all['revenue']) . ' تومان';
    $L[] = '💵 درآمد خالص (از ابتدا) : ' . $n($all['net']) . ' تومان';
    $L[] = '🏦 ورود سرمایه (از ابتدا) : ' . $n($all['cap_sum']) . ' تومان';
    return implode("\n", $L);
}

function statsKeyboard($current = '')
{
    $b = function ($t, $k) use ($current) {
        return ['text' => ($current === $k ? '✅ ' : '') . $t, 'callback_data' => 'pstat_' . $k];
    };
    return json_encode(['inline_keyboard' => [
        [$b('📊 آمار کل', 'all'), $b('🕐 یک ساعت اخیر', 'hour')],
        [$b('📅 امروز', 'today'), $b('📅 دیروز', 'yesterday')],
        [$b('🗓 ماه فعلی', 'month'), $b('🗓 ماه قبل', 'lastmonth')],
        [['text' => '🗓 آمار در تاریخ مشخص', 'callback_data' => 'view_stat_time']],
    ]]);
}
