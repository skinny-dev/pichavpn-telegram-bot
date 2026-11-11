<?php
// Period statistics + accounting report (Farsi). Used by the admin stats menu and the web panel API.
//
// Accounting model (the bot is wallet-based: customers pay into the wallet, then buy from the balance):
//   revenue      = cash received = paid customer payments (every gateway) + sales registered by an admin.
//                  Admin balance gifts, internal "wallet" payments, expenses and capital are NOT revenue.
//   expenses     = Payment_report rows with Payment_Method 'cost' (Mirza Pro) + rows in table `expenses`.
//   capital      = Payment_report rows 'capital_injection' (Mirza Pro) + rows in table `capital_entries`.
//   withdrawals  = table wallet_withdraw (Mirza Pro, status paid) or 'low balance by admin' payments.
//   P&L (as an accountant reads it):  sales (cash received) - refunds = net sales
//                  - purchases (cost of goods: kind «purchase»)            = gross profit
//                  - operating expenses (salary, ads, server, tools, fees, tax, other) = net profit
//                  - dividends / partner withdrawals (kind «dividend», NOT an expense) = retained profit
//   capital      = money the owners put in. Reported on its own, never part of sales or profit.
//   sales        = invoices with price > 0 that are not unpaid / expired-unpaid / unsuccessful / rejected.

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
            return ['title' => 'آمار کلی ربات', 'start' => 0, 'end' => $now];
    }
}

function statsHas(PDO $pdo, $table, $column = null)
{
    static $cache = [];
    $k = $table . '.' . $column;
    if (!isset($cache[$k])) {
        try {
            $q = $column === null ? "SHOW TABLES LIKE " . $pdo->quote($table) : "SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column);
            $cache[$k] = (bool) $pdo->query($q)->fetch();
        } catch (Throwable $e) {
            $cache[$k] = false;
        }
    }
    return $cache[$k];
}

// SQL: a column holding either unix seconds or 'YYYY/MM/DD HH:MM:SS' (Tehran time) -> unix seconds.
function statsTs($col)
{
    return "(CASE WHEN $col REGEXP '^[0-9]+$' THEN CAST($col AS UNSIGNED) ELSE UNIX_TIMESTAMP(STR_TO_DATE($col, '%Y/%m/%d %H:%i:%s')) END)";
}

const STATS_NON_CASH = "'add balance by admin','low balance by admin','wallet','cost','capital_injection','cost_migrated','capital_migrated'";
const STATS_ADMIN_SALE = "'manual invoice','add order by admin','extend by admin'";
const STATS_BAD_INVOICE = "('unpaid','expire','unsuccessful','reject')";

// Raw numbers for [$start, $end] (unix timestamps).

/** Accounting categories of the `expenses` table (kind column). Order = order in menus and reports. */
function accExpenseKinds()
{
    return [
        'purchase' => 'خرید (بهای تمام‌شده)',
        'salary' => 'حقوق و دستمزد',
        'advertising' => 'تبلیغات',
        'server' => 'سرور و زیرساخت',
        'tools' => 'نرم‌افزار و ابزار',
        'fee' => 'کارمزد درگاه و بانک',
        'tax' => 'مالیات و عوارض',
        'general' => 'سایر هزینه‌ها',
        'dividend' => 'سود سهام / برداشت شرکا',
    ];
}

// first match wins; most specific first
const ACC_KIND_RULES = [
    'dividend' => ['سهام', 'سهم شریک', 'سهم ', 'سود شریک', 'برداشت شریک', 'برداشت شخصی', 'تقسیم سود', 'dividend'],
    'salary' => ['حقوق', 'دستمزد', 'پشتیبان', 'کارمند', 'اپراتور', 'پاداش', 'salary'],
    'advertising' => ['تبلیغ', 'کمپین', 'اینستا', 'تلگرام ادز', 'ادز', 'بنر', 'اینفلوئنسر', 'اسپانسر', 'کلیک', 'ads', 'campaign'],
    'tax' => ['مالیات', 'عوارض', 'tax'],
    'fee' => ['کارمزد', 'درگاه', 'بانک', 'کارت', 'fee'],
    'server' => ['سرور', 'دامنه', 'هاست', 'vps', 'ssl', 'کلودفلر', 'cloudflare', 'آی‌پی', 'ایپی', 'ip ', 'دیتاسنتر', 'server', 'domain'],
    'tools' => ['ابزار', 'نرم‌افزار', 'نرم افزار', 'اشتراک ابزار', 'لایسنس', 'اپلیکیشن', 'اپ ', 'پریمیوم', 'premium', 'chatgpt', 'github', 'tool'],
    'purchase' => ['خرید', 'ترافیک', 'پنل', 'ساب', 'لایسنس vpn', 'تامین', 'تأمین', 'کانفیگ', 'حجم', 'گیگ', 'اکانت', 'purchase'],
];

/** Guess the expense category from its description (Farsi/English keywords); null = no idea. */
function accGuessKind($desc)
{
    $d = mb_strtolower(trim((string) $desc));
    foreach (ACC_KIND_RULES as $kind => $words) {
        foreach ($words as $w) {
            if ($w !== '' && mb_strpos($d, mb_strtolower($w)) !== false) {
                return $kind;
            }
        }
    }
    return null;
}

/** cogs = cost of goods sold (purchases); equity = paid out to owners (not an expense); everything else = operating expense */
function accKindGroup($kind)
{
    return $kind === 'purchase' ? 'cogs' : ($kind === 'dividend' ? 'equity' : 'opex');
}

function accKindIcon($kind)
{
    static $i = ['purchase' => '🛒', 'salary' => '👥', 'advertising' => '📣', 'server' => '🖥', 'tools' => '🧰', 'fee' => '🏦', 'tax' => '🏛', 'general' => '🧾', 'dividend' => '🤝'];
    return $i[$kind] ?? '🧾';
}

/**
 * Date/time typed by a person -> unix time. '' = now. Accepts Jalali (1405/07/14 15:30) or Gregorian (2026-10-06 15:30),
 * Persian or Latin digits, / - . separators; a date without a time means 12:00 (Tehran). null = not understood.
 */
function accParseDateTime($input, $now = null)
{
    $now = $now ?? time();
    $s = trim((string) $input);
    if ($s === '') {
        return $now;
    }
    $s = strtr($s, ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9', '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9', '٫' => ':', '،' => ' ']);
    if (ctype_digit($s) && strlen($s) >= 9) {
        return (int) $s; // already a unix time
    }
    if (!preg_match('#^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$#', $s, $m)) {
        return null;
    }
    [$y, $mo, $d] = [(int) $m[1], (int) $m[2], (int) $m[3]];
    if ($y >= 1300 && $y < 1700) {
        if ($mo < 1 || $mo > 12 || $d < 1 || $d > ($mo <= 6 ? 31 : 30)) {
            return null;
        }
        require_once __DIR__ . '/jdf.php';
        [$y, $mo, $d] = jalali_to_gregorian($y, $mo, $d);
    }
    $h = isset($m[4]) && $m[4] !== '' ? (int) $m[4] : 12;
    $i = isset($m[5]) && $m[5] !== '' ? (int) $m[5] : 0;
    if (!checkdate($mo, $d, $y) || $h > 23 || $i > 59) {
        return null;
    }
    $dt = new DateTime(sprintf('%04d-%02d-%02d %02d:%02d:00', $y, $mo, $d, $h, $i), new DateTimeZone('Asia/Tehran'));
    return $dt->getTimestamp();
}

/** unix time -> «1405/07/14 15:30» (Jalali, Tehran, Latin digits) */
function accFormatDateTime($ts)
{
    require_once __DIR__ . '/jdf.php';
    return jdate('Y/m/d H:i', (int) $ts, '', 'Asia/Tehran', 'en');
}

/**
 * Money received in [start,end] by source (paid payments, same cash rules as revenue). Card-to-card is split into the ones
 * the bank SMS confirmed by itself and the ones an admin approved from a receipt. [['m' => method key, 'c' => count, 's' => toman], ...] by amount.
 */
function statsByMethod(PDO $pdo, $start, $end)
{
    $m = statsHas($pdo, 'sms_inbox', 'id_order')
        ? "CASE WHEN Payment_Method = 'cart to cart' AND EXISTS (SELECT 1 FROM sms_inbox x WHERE x.id_order = Payment_report.id_order AND x.status = 'matched') THEN 'cart to cart sms' ELSE Payment_Method END"
        : 'Payment_Method';
    $st = $pdo->prepare("SELECT $m m, COUNT(*) c, SUM(CAST(price AS SIGNED)) s FROM Payment_report WHERE payment_Status = 'paid' AND " . statsTs('time') . " BETWEEN :s AND :e
        AND Payment_Method NOT IN (" . STATS_NON_CASH . ") GROUP BY m ORDER BY s DESC");
    $st->execute([':s' => $start, ':e' => $end]);
    return array_map(fn($x) => ['m' => (string) $x['m'], 'c' => (int) $x['c'], 's' => (float) $x['s']], $st->fetchAll(PDO::FETCH_ASSOC));
}

function statsCollect(PDO $pdo, $start, $end)
{
    $pdo->exec("SET time_zone = '+03:30'"); // bot times are Tehran local; Iran has no DST
    $one = function ($sql, $params = []) use ($pdo) {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return $st->fetch(PDO::FETCH_ASSOC) ?: [];
    };
    $n = function ($v) {
        return (float) ($v ?? 0);
    };
    $r = [];
    $tsInv = statsHas($pdo, 'invoice', 'time_sell_unix') ? 'IF(i.time_sell_unix > 0, i.time_sell_unix, CAST(i.time_sell AS UNSIGNED))' : 'CAST(i.time_sell AS UNSIGNED)';
    $isTest = "i.name_product LIKE '%تست%'";
    $sale = "CAST(i.price_product AS SIGNED) > 0 AND LOWER(i.Status) NOT IN " . STATS_BAD_INVOICE . " AND NOT ($isTest)";
    $inv = "FROM invoice i LEFT JOIN user u ON u.id = i.id_user WHERE $tsInv BETWEEN :s AND :e AND $sale";
    $p = [':s' => $start, ':e' => $end];

    // sales (orders)
    $row = $one("SELECT COUNT(*) c, SUM(CAST(i.price_product AS SIGNED)) p, SUM(CAST(i.Volume AS DECIMAL(12,2))) v $inv", $p);
    $r['orders'] = (int) $n($row['c']);
    $r['orders_sum'] = $n($row['p']);
    $r['vol_service'] = $n($row['v']);
    $row = $one("SELECT SUM(CAST(i.Volume AS DECIMAL(12,2))) v $inv AND i.name_product LIKE '%اضطراری%'", $p);
    $r['vol_emergency'] = $n($row['v']);
    foreach (['n' => 'agent_n', 'n2' => 'agent_n2'] as $type => $key) {
        $row = $one("SELECT COUNT(*) c, SUM(CAST(i.price_product AS SIGNED)) p $inv AND u.agent = '$type'", $p);
        $r[$key] = (int) $n($row['c']);
        $r[$key . '_sum'] = $n($row['p']);
    }
    // first purchases: the buyer's earliest sale
    $row = $one("SELECT COUNT(*) c, SUM(CAST(i.price_product AS SIGNED)) p,
                   AVG(CASE WHEN u.register REGEXP '^[0-9]+$' AND $tsInv >= CAST(u.register AS UNSIGNED) THEN $tsInv - CAST(u.register AS UNSIGNED) END) a,
                   SUM(CASE WHEN u.register REGEXP '^[0-9]+$' AND $tsInv >= CAST(u.register AS UNSIGNED) THEN 1 ELSE 0 END) ac
                 $inv AND NOT EXISTS (SELECT 1 FROM invoice j WHERE j.id_user = i.id_user AND CAST(j.price_product AS SIGNED) > 0
                      AND LOWER(j.Status) NOT IN " . STATS_BAD_INVOICE . " AND j.name_product NOT LIKE '%تست%'
                      AND CAST(j.time_sell AS UNSIGNED) < CAST(i.time_sell AS UNSIGNED))", $p);
    $r['first'] = (int) $n($row['c']);
    $r['first_sum'] = $n($row['p']);
    $r['first_avg_sec'] = $n($row['a']);
    $r['first_avg_n'] = (int) $n($row['ac']);

    // renewals / extras
    $tsSo = statsTs('time');
    foreach ([['extend_user', 'extend_user_by_admin', 'renew'], ['extra_user', null, 'extra']] as [$t1, $t2, $key]) {
        $types = $t2 ? "'$t1','$t2'" : "'$t1'";
        $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS SIGNED)) p FROM service_other WHERE type IN ($types) AND LOWER(status) = 'paid' AND $tsSo BETWEEN :s AND :e", $p);
        $r[$key] = (int) $n($row['c']);
        $r[$key . '_sum'] = $n($row['p']);
    }
    $row = $one("SELECT SUM(CAST(value AS DECIMAL(12,2))) v FROM service_other WHERE type = 'extra_user' AND LOWER(status) = 'paid' AND $tsSo BETWEEN :s AND :e", $p);
    $r['vol_extra'] = $n($row['v']);

    // cash received
    $tsPay = statsTs('time');
    $pay = "FROM Payment_report WHERE payment_Status = 'paid' AND $tsPay BETWEEN :s AND :e";
    $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS SIGNED)) p $pay AND Payment_Method NOT IN (" . STATS_NON_CASH . ',' . STATS_ADMIN_SALE . ')', $p);
    $r['wallet_in'] = (int) $n($row['c']);
    $r['wallet_in_sum'] = $n($row['p']);
    $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS SIGNED)) p $pay AND Payment_Method IN (" . STATS_ADMIN_SALE . ')', $p);
    $r['admin_in'] = (int) $n($row['c']);
    $r['admin_in_sum'] = $n($row['p']);
    $r['by_method'] = statsByMethod($pdo, $start, $end);
    // customers who paid in the period (cash in, same rules as revenue) and customers who bought (orders)
    $row = $one("SELECT COUNT(DISTINCT id_user) c $pay AND Payment_Method NOT IN (" . STATS_NON_CASH . ") AND id_user IS NOT NULL AND id_user != ''", $p);
    $r['payers'] = (int) $n($row['c']);
    $row = $one("SELECT COUNT(DISTINCT i.id_user) c $inv", $p);
    $r['buyers'] = (int) $n($row['c']);

    // withdrawals
    if (statsHas($pdo, 'wallet_withdraw')) {
        $row = $one("SELECT COUNT(*) c, SUM(amount) p FROM wallet_withdraw WHERE LOWER(status) = 'paid' AND created_at BETWEEN :s AND :e", $p);
    } else {
        $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS SIGNED)) p $pay AND Payment_Method = 'low balance by admin'", $p);
    }
    $r['wallet_out'] = (int) $n($row['c']);
    $r['wallet_out_sum'] = $n($row['p']);

    // capital: Pro rows in Payment_report + our own table (reported on its own, never part of sales or profit)
    $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS SIGNED)) p FROM Payment_report WHERE Payment_Method = 'capital_injection' AND $tsPay BETWEEN :s AND :e", $p);
    $r['cap'] = (int) $n($row['c']);
    $r['cap_sum'] = $n($row['p']);
    if (statsHas($pdo, 'capital_entries')) {
        $row = $one("SELECT COUNT(*) c, SUM(amount) p FROM `capital_entries` WHERE created_at BETWEEN :s AND :e", $p);
        $r['cap'] += (int) $n($row['c']);
        $r['cap_sum'] += $n($row['p']);
    }

    // expenses by category. Pro "cost" rows have no category = «سایر هزینه‌ها»
    $by = [];
    foreach (array_keys(accExpenseKinds()) as $k) {
        $by[$k] = ['c' => 0, 's' => 0.0];
    }
    $row = $one("SELECT COUNT(*) c, SUM(CAST(price AS SIGNED)) p FROM Payment_report WHERE Payment_Method = 'cost' AND $tsPay BETWEEN :s AND :e", $p);
    $by['general']['c'] += (int) $n($row['c']);
    $by['general']['s'] += $n($row['p']);
    if (statsHas($pdo, 'expenses')) {
        $kindExpr = statsHas($pdo, 'expenses', 'kind') ? "COALESCE(NULLIF(kind,''),'general')" : "'general'";
        $st = $pdo->prepare("SELECT $kindExpr k, COUNT(*) c, SUM(amount) p FROM `expenses` WHERE created_at BETWEEN :s AND :e GROUP BY k");
        $st->execute($p);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $x) {
            $k = isset($by[$x['k']]) ? $x['k'] : 'general';
            $by[$k]['c'] += (int) $x['c'];
            $by[$k]['s'] += (float) $x['p'];
        }
    }
    // expenses / owner withdrawals recorded in the finance section (finance/engine.php), by their category account.
    // (Rows synced from the `expenses` table are journal entries without a fin_txn row, so nothing is counted twice.)
    if (statsHas($pdo, 'fin_txn')) {
        $inv = ['cogs' => 'purchase', 'exp_salary' => 'salary', 'exp_advertising' => 'advertising', 'exp_server' => 'server', 'exp_tools' => 'tools', 'exp_fee' => 'fee',
            'exp_tax' => 'tax', 'dividends' => 'dividend', 'drawings' => 'dividend'];
        $st = $pdo->prepare("SELECT t.type, a.system_key sk, COUNT(*) c, SUM(t.total) p FROM fin_txn t LEFT JOIN fin_accounts a ON a.id = t.category_account_id
            WHERE t.status = 'posted' AND t.txn_date BETWEEN :s AND :e AND (t.type IN ('expense', 'capital_out', 'distribution') OR (t.type = 'purchase' AND t.meta LIKE '%\"expense\":true%'))
            GROUP BY t.type, a.system_key");
        $st->execute($p);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $x) {
            $k = in_array($x['type'], ['capital_out', 'distribution'], true) ? 'dividend' : ($inv[(string) $x['sk']] ?? 'general');
            $by[$k]['c'] += (int) $x['c'];
            $by[$k]['s'] += (float) $x['p'];
        }
        $row = $one("SELECT COUNT(*) c, SUM(total) p FROM fin_txn WHERE status = 'posted' AND type = 'capital_in' AND txn_date BETWEEN :s AND :e", $p);
        $r['cap'] += (int) $n($row['c']);
        $r['cap_sum'] += $n($row['p']);
    }
    $r['by_kind'] = $by;
    foreach (['cogs', 'opex', 'equity'] as $g) {
        $r[$g] = 0;
        $r[$g . '_sum'] = 0.0;
    }
    foreach ($by as $k => $v) {
        $g = accKindGroup($k);
        $r[$g] += $v['c'];
        $r[$g . '_sum'] += $v['s'];
    }
    $r['div'] = $r['equity'];
    $r['div_sum'] = $r['equity_sum'];
    // total expenses = purchases + operating costs (dividends are a distribution of profit, not an expense)
    $r['exp'] = $r['cogs'] + $r['opex'];
    $r['exp_sum'] = $r['cogs_sum'] + $r['opex_sum'];
    $r['exp_ads'] = $by['advertising']['c'];
    $r['exp_ads_sum'] = $by['advertising']['s'];

    // users / tests
    $row = $one("SELECT COUNT(*) c FROM invoice i WHERE $tsInv BETWEEN :s AND :e AND $isTest", $p);
    $r['tests'] = (int) $n($row['c']);
    $row = $one("SELECT COUNT(*) c FROM user WHERE register REGEXP '^[0-9]+$' AND CAST(register AS UNSIGNED) BETWEEN :s AND :e", $p);
    $r['new_users'] = (int) $n($row['c']);

    $r['revenue'] = $r['wallet_in_sum'] + $r['admin_in_sum'];
    $r['net_sales'] = $r['revenue'] - $r['wallet_out_sum'];
    $r['gross'] = $r['net_sales'] - $r['cogs_sum'];
    $r['net'] = $r['gross'] - $r['opex_sum'];
    $r['retained'] = $r['net'] - $r['div_sum'];
    $r['count_all'] = $r['wallet_in'] + $r['admin_in'];
    return $r;
}

// Extra all-time figures (funnel, retention, payment methods). Returns raw numbers.
function statsOverall(PDO $pdo)
{
    $pdo->exec("SET time_zone = '+03:30'");
    $v = function ($sql) use ($pdo) {
        return $pdo->query($sql)->fetchColumn();
    };
    $sale = "CAST(price_product AS SIGNED) > 0 AND LOWER(Status) NOT IN " . STATS_BAD_INVOICE . " AND name_product NOT LIKE '%تست%'";
    $o = [];
    $o['users'] = (int) $v('SELECT COUNT(*) FROM user');
    $o['balance'] = (int) $v('SELECT COALESCE(SUM(Balance),0) FROM user');
    $o['with_service'] = (int) $v('SELECT COUNT(DISTINCT id_user) FROM invoice');
    $o['buyers'] = (int) $v("SELECT COUNT(DISTINCT id_user) FROM invoice WHERE $sale");
    $o['test_users'] = (int) $v("SELECT COUNT(DISTINCT id_user) FROM invoice WHERE name_product LIKE '%تست%'");
    $o['test_then_buy'] = (int) $v("SELECT COUNT(DISTINCT t.id_user) FROM invoice t JOIN invoice p ON p.id_user = t.id_user AND p.price_product + 0 > 0 AND LOWER(p.Status) NOT IN " . STATS_BAD_INVOICE . " AND p.name_product NOT LIKE '%تست%' WHERE t.name_product LIKE '%تست%'");
    $o['test_only'] = $o['test_users'] - $o['test_then_buy'];
    $o['agents_n'] = (int) $v("SELECT COUNT(*) FROM user WHERE agent = 'n'");
    $o['agents_n2'] = (int) $v("SELECT COUNT(*) FROM user WHERE agent = 'n2'");
    $o['panels'] = (int) $v('SELECT COUNT(*) FROM marzban_panel');
    $o['active_services'] = (int) $v("SELECT COUNT(*) FROM invoice WHERE CAST(price_product AS SIGNED) > 0 AND LOWER(Status) IN ('active','send_on_hold','sendedwarn')");
    $o['active_sum'] = (int) $v("SELECT COALESCE(SUM(CAST(price_product AS SIGNED)),0) FROM invoice WHERE CAST(price_product AS SIGNED) > 0 AND LOWER(Status) IN ('active','send_on_hold','sendedwarn')");
    if (statsHas($pdo, 'invoice', 'auto_renew')) {
        $o['auto_users'] = (int) $v("SELECT COUNT(DISTINCT id_user) FROM invoice WHERE auto_renew IN ('1','on','yes') ");
        $o['auto_services'] = (int) $v("SELECT COUNT(*) FROM invoice WHERE auto_renew IN ('1','on','yes')");
    } else {
        $o['auto_users'] = $o['auto_services'] = null;
    }
    // loyalty: buyers with 2+ paid events (sales + renewals)
    $o['repeat_buyers'] = (int) $v("SELECT COUNT(*) FROM (SELECT id_user FROM (
            SELECT id_user FROM invoice WHERE $sale
            UNION ALL SELECT id_user FROM service_other WHERE type IN ('extend_user','extend_user_by_admin') AND LOWER(status) = 'paid') x
            GROUP BY id_user HAVING COUNT(*) >= 2) y");
    // payments by method (paid)
    $o['methods'] = $pdo->query("SELECT Payment_Method m, COUNT(*) c, SUM(CAST(price AS SIGNED)) s FROM Payment_report WHERE payment_Status = 'paid'
            AND Payment_Method NOT IN ('cost','capital_injection','cost_migrated','capital_migrated') GROUP BY Payment_Method ORDER BY s DESC")->fetchAll(PDO::FETCH_ASSOC);
    // last 30 days revenue = monthly run rate
    $d = statsCollect($pdo, time() - 30 * 86400, time());
    $o['revenue_30d'] = $d['revenue'];
    $o['volume_30d'] = $d['vol_service'] + $d['vol_extra'];
    return $o;
}

function statsMethodLabel($m)
{
    static $map = [
        'cart to cart sms' => '💳 کارت به کارت (خودکار، با پیامک)', 'cart to cart' => '💳 کارت به کارت (رسید، تأیید ادمین)', 'variza' => '🏦 واریزا', 'Currency Rial 1' => '🏦 درگاه ریالی ۱', 'Currency Rial 2' => '🏦 درگاه ریالی ۲', 'Currency Rial 3' => '🏦 درگاه ریالی ۳', 'AbanGateway' => '🏦 درگاه آبان', 'Star Telegram' => '⭐ استار تلگرام', 'tetraminator' => '🏦 تترامینیتور',
        'after pay' => '🧾 پرداخت بعد از دریافت', 'manual invoice' => '✍️ فاکتور دستی', 'add order by admin' => '🛠 سفارش ثبت‌شده توسط ادمین',
        'extend by admin' => '🛠 تمدید توسط ادمین', 'wallet' => '👛 پرداخت از کیف پول (داخلی)', 'add balance by admin' => '🎁 شارژ توسط ادمین (هدیه)',
        'low balance by admin' => '➖ کسر موجودی توسط ادمین', 'zarinpal' => 'زرین‌پال', 'aqayepardakht' => 'آقای پرداخت', 'plisio' => 'Plisio',
        'nowpayment' => 'NowPayments', 'arze digital offline' => 'ارز دیجیتال (دستی)',
    ];
    return $map[$m] ?? $m;
}

function statsDuration($sec)
{
    $sec = (int) round($sec);
    if ($sec < 60) return $sec . ' ثانیه';
    if ($sec < 3600) return intdiv($sec, 60) . ' دقیقه';
    if ($sec < 86400) return round($sec / 3600, 1) . ' ساعت';
    $d = intdiv($sec, 86400);
    $h = intdiv($sec % 86400, 3600);
    return $d . ' روز' . ($h ? ' و ' . $h . ' ساعت' : '');
}

function statsPct($a, $b)
{
    return $b > 0 ? round($a * 100 / $b, 1) : 0;
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
    $vol = function ($x) {
        return rtrim(rtrim(number_format((float) $x, 2, '.', ''), '0'), '.');
    };
    $L = ['🕐 <b>' . $p['title'] . '</b>', ''];
    if ($key !== 'all') {
        $L[] = '⏳ بازه تایم : ' . $fmt($p['start']) . ' تا ' . $fmt($p['end']);
        $L[] = '';
    }
    if ($key === 'all') {
        $o = statsOverall($pdo);
        $L[] = '👥 <b>کاربران</b>';
        $L[] = '• کل کاربران : ' . $n($o['users']) . ' نفر';
        $L[] = '• دارای سرویس : ' . $n($o['with_service']) . ' نفر';
        $L[] = '• مشتری (دارای خرید) : ' . $n($o['buyers']) . ' نفر — ' . statsPct($o['buyers'], $o['users']) . '٪ کاربران';
        $L[] = '• دریافت‌کننده تست : ' . $n($o['test_users']) . ' نفر — ' . statsPct($o['test_users'], $o['users']) . '٪ کاربران';
        $L[] = '• تست بدون خرید : ' . $n($o['test_only']) . ' نفر · تست و سپس خرید : ' . $n($o['test_then_buy']) . ' نفر';
        $L[] = '• موجودی کیف پول‌ها : ' . $n($o['balance']) . ' تومان';
        $L[] = '';
    }
    $L[] = '💰 <b>درآمد و فروش</b>';
    $L[] = '🛍 تعداد فروش : ' . $n($d['orders']) . ' عدد — ' . $n($d['orders_sum']) . ' تومان';
    $L[] = '🆕 خرید اول : ' . $n($d['first']) . ' عدد — ' . $n($d['first_sum']) . ' تومان' . ($d['orders'] ? ' (' . statsPct($d['first'], $d['orders']) . '٪ فروش)' : '');
    $L[] = '🧲 تمدید : ' . $n($d['renew']) . ' عدد — ' . $n($d['renew_sum']) . ' تومان';
    if (($d['buyers'] ?? 0) > 0 || ($d['payers'] ?? 0) > 0) {
        $L[] = '👤 مشتری‌های این بازه : ' . $n($d['buyers']) . ' نفر خرید کردند · ' . $n($d['payers']) . ' نفر پول دادند';
        $L[] = '💳 میانگین پرداخت هر مشتری : ' . $n($d['payers'] ? $d['revenue'] / $d['payers'] : 0) . ' تومان · میانگین هر سفارش : ' . $n($d['orders'] ? $d['orders_sum'] / $d['orders'] : 0) . ' تومان · سفارش به ازای هر مشتری : ' . ($d['buyers'] ? round($d['orders'] / $d['buyers'], 2) : 0);
    }
    $L[] = '📦 حجم اضافه : ' . $n($d['extra']) . ' عدد — ' . $n($d['extra_sum']) . ' تومان';
    $L[] = '🛒 خرید نمایندگان عادی : ' . $n($d['agent_n']) . ' عدد — ' . $n($d['agent_n_sum']) . ' تومان';
    $L[] = '🛒 خرید نمایندگان پیشرفته : ' . $n($d['agent_n2']) . ' عدد — ' . $n($d['agent_n2_sum']) . ' تومان';
    $L[] = '';
    $L[] = '💳 <b>پول دریافتی (مبنای درآمد)</b>';
    $L[] = '• پرداخت مشتریان (درگاه‌ها) : ' . $n($d['wallet_in']) . ' عدد — ' . $n($d['wallet_in_sum']) . ' تومان';
    $L[] = '• ثبت‌شده توسط ادمین : ' . $n($d['admin_in']) . ' عدد — ' . $n($d['admin_in_sum']) . ' تومان';
    if (!empty($d['by_method'])) {
        $L[] = '';
        $L[] = '🏦 <b>دریافتی به تفکیک منبع</b>';
        foreach ($d['by_method'] as $m) {
            $L[] = '• ' . statsMethodLabel($m['m']) . ' : ' . $n($m['c']) . ' عدد — ' . $n($m['s']) . ' تومان' . ($d['revenue'] > 0 ? ' (' . statsPct($m['s'], $d['revenue']) . '٪)' : '');
        }
    }
    $L[] = '';
    $L[] = '📒 <b>صورت سود و زیان</b>';
    $L[] = '• فروش (پول دریافتی) : ' . $n($d['revenue']) . ' تومان';
    if ($d['wallet_out_sum'] > 0) {
        $L[] = '• − بازپرداخت به مشتریان : ' . $n($d['wallet_out']) . ' عدد — ' . $n($d['wallet_out_sum']) . ' تومان';
    }
    $L[] = '• − خرید (بهای تمام‌شده) : ' . $n($d['cogs']) . ' عدد — ' . $n($d['cogs_sum']) . ' تومان';
    $L[] = '= <b>سود ناخالص : ' . $n($d['gross']) . ' تومان</b>' . ($d['net_sales'] > 0 ? ' (' . statsPct($d['gross'], $d['net_sales']) . '٪ فروش)' : '');
    $L[] = '• − هزینه‌های عملیاتی : ' . $n($d['opex']) . ' عدد — ' . $n($d['opex_sum']) . ' تومان';
    foreach ($d['by_kind'] as $k => $v) {
        if (accKindGroup($k) === 'opex' && $v['c'] > 0) {
            $L[] = '   ↳ ' . accKindIcon($k) . ' ' . accExpenseKinds()[$k] . ' : ' . $n($v['c']) . ' عدد — ' . $n($v['s']) . ' تومان';
        }
    }
    $L[] = '= <b>سود خالص : ' . $n($d['net']) . ' تومان</b>' . ($d['net_sales'] > 0 ? ' (' . statsPct($d['net'], $d['net_sales']) . '٪ فروش)' : '');
    $L[] = '• − ' . accKindIcon('dividend') . ' سود سهام / برداشت شرکا : ' . $n($d['div']) . ' عدد — ' . $n($d['div_sum']) . ' تومان';
    $L[] = '= <b>سود باقی‌مانده : ' . $n($d['retained']) . ' تومان</b>';
    $L[] = '';
    $L[] = '🏦 <b>سرمایه (جدا از سود و فروش)</b>';
    $L[] = '• ورود سرمایه در این بازه : ' . $n($d['cap']) . ' عدد — ' . $n($d['cap_sum']) . ' تومان';
    if ($key !== 'all') {
        $L[] = '• ورود سرمایه از ابتدا : ' . $n($all['cap_sum']) . ' تومان';
    }
    $L[] = '• سرمایه + سود باقی‌مانده (از ابتدا) : ' . $n($all['cap_sum'] + $all['retained']) . ' تومان';
    $L[] = '';
    $L[] = '🔋 <b>حجم فروخته‌شده : ' . $vol($d['vol_service'] + $d['vol_extra']) . ' گیگابایت</b>';
    $L[] = '• از خرید سرویس : ' . $vol($d['vol_service']) . ' · از حجم اضافه : ' . $vol($d['vol_extra']);
    $L[] = '• اینترنت معمولی : ' . $vol($d['vol_service'] - $d['vol_emergency']) . ' · اضطراری : ' . $vol($d['vol_emergency']);
    $L[] = '';
    $L[] = '🔑 اکانت تست : ' . $n($d['tests']) . ' عدد · 👤 کاربر جدید : ' . $n($d['new_users']) . ' نفر';
    $L[] = '⏱ میانگین زمان عضویت تا اولین خرید : ' . ($d['first_avg_n'] > 0 ? statsDuration($d['first_avg_sec']) . ' (' . $n($d['first_avg_n']) . ' کاربر)' : '—');
    $L[] = '';
    if ($key !== 'all') {
        $L[] = '💰 فروش (از ابتدا) : ' . $n($all['revenue']) . ' تومان';
        $L[] = '📈 سود ناخالص (از ابتدا) : ' . $n($all['gross']) . ' تومان';
        $L[] = '💵 سود خالص (از ابتدا) : ' . $n($all['net']) . ' تومان';
        $L[] = '🧮 سود باقی‌مانده (از ابتدا) : ' . $n($all['retained']) . ' تومان';
    }
    if ($key === 'all') {
        $L[] = '';
        $L[] = '📈 <b>شاخص‌ها</b>';
        $L[] = '• درآمد هر مشتری از ابتدا (کل درآمد ÷ همه مشتری‌ها) : ' . $n($o['buyers'] ? $d['revenue'] / $o['buyers'] : 0) . ' تومان';
        $L[] = '• سهم تمدید از درآمد : ' . statsPct($d['renew_sum'], $d['revenue']) . '٪';
        $L[] = '• وفاداری (مشتری با ۲ خرید/تمدید یا بیشتر) : ' . statsPct($o['repeat_buyers'], $o['buyers']) . '٪';
        $L[] = '• درآمد ۳۰ روز اخیر : ' . $n($o['revenue_30d']) . ' تومان · حجم : ' . $vol($o['volume_30d']) . ' گیگابایت';
        $L[] = '• سرویس‌های فعال : ' . $n($o['active_services']) . ' عدد — ' . $n($o['active_sum']) . ' تومان';
        if ($o['auto_users'] !== null) {
            $L[] = '• تمدید خودکار : ' . $n($o['auto_users']) . ' کاربر · ' . $n($o['auto_services']) . ' سرویس';
        }
        $L[] = '• نمایندگان : ' . $n($o['agents_n'] + $o['agents_n2']) . ' (عادی ' . $n($o['agents_n']) . ' · پیشرفته ' . $n($o['agents_n2']) . ') · پنل‌ها : ' . $n($o['panels']);
    }
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
