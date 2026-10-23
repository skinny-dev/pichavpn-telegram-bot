<?php
// Orders that failed while the panel was unreachable: what happened to each, and fixing them.
//
//   php scripts/failed_orders.php --hours=6                        # report (changes nothing)
//   php scripts/failed_orders.php --hours=6 --users=111,222        # also wallet purchases of these Telegram ids
//   php scripts/failed_orders.php --hours=6 --fix                  # services that DO exist on the panel: activate them in
//                                                                  #   the bot and take the refund back from the wallet
//   php scripts/failed_orders.php --hours=6 --notify               # customers still without a service: «your money is in
//                                                                  #   your wallet, buy again» (once per customer)
//
// Every approved payment for a new service in the window is checked: was the service made (bot + panel), or was the
// money put back in the wallet? Wallet purchases that failed are read from storage/order_failures.jsonl (written by the
// bot from now on) and, for earlier ones, from the unpaid orders of the Telegram ids given with --users.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/botapi.php';
require_once $root . '/jdf.php';
require_once $root . '/function.php';
require_once $root . '/panels.php';

$o = [];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/s', $a, $m)) {
        $o[$m[1]] = $m[2] ?? true;
    }
}
$since = time() - (int) round((float) ($o['hours'] ?? 24) * 3600);
$onlyUsers = isset($o['users']) ? array_filter(array_map('trim', explode(',', (string) $o['users']))) : [];
$ts = function ($v) {
    if (ctype_digit((string) $v)) {
        return (int) $v;
    }
    $t = DateTime::createFromFormat('Y/m/d H:i:s', (string) $v, new DateTimeZone('Asia/Tehran'));
    return $t ? $t->getTimestamp() : (strtotime((string) $v) ?: 0);
};
$fmtT = fn($t) => $t ? jdate('m/d H:i', $t, '', 'Asia/Tehran') : '?';

// ---- candidates: service username => info
$c = [];
$pays = $pdo->query("SELECT id_order, id_user, time, price, payment_Status, Payment_Method, id_invoice FROM Payment_report WHERE payment_Status = 'paid' AND id_invoice LIKE '%getconfigafterpay|%' ORDER BY id DESC LIMIT 3000")->fetchAll(PDO::FETCH_ASSOC);
foreach ($pays as $p) {
    $t = $ts($p['time']);
    if ($t < $since) {
        continue;
    }
    $parts = explode('|', (string) $p['id_invoice']);
    $refunded = $parts[0] === 'refunded';
    $svc = explode('%', (string) ($refunded ? ($parts[2] ?? '') : ($parts[1] ?? '')))[0];
    if ($svc === '') {
        continue;
    }
    $c[$svc] = ['service' => $svc, 'user' => (string) $p['id_user'], 'price' => (int) $p['price'], 'kind' => 'پرداخت (' . $p['Payment_Method'] . ')',
        'payment' => $p['id_order'], 'at' => $t, 'refunded' => $refunded];
}
$logFile = $root . '/storage/order_failures.jsonl';
foreach (is_file($logFile) ? file($logFile, FILE_IGNORE_NEW_LINES) : [] as $line) {
    $f = json_decode($line, true);
    if (!is_array($f) || (int) $f['at'] < $since || ($f['service'] ?? '') === '') {
        continue;
    }
    $c[$f['service']] = ($c[$f['service']] ?? []) + ['service' => $f['service'], 'user' => $f['user'], 'price' => (int) $f['price'],
        'kind' => $f['kind'] === 'wallet' ? 'کیف پول' : 'پرداخت', 'payment' => $f['payment'], 'at' => (int) $f['at'], 'refunded' => true];
}
if ($onlyUsers) { // earlier wallet purchases of these customers: their unpaid orders in the window
    $q = $pdo->prepare("SELECT username, id_user, price_product, time_sell FROM invoice WHERE id_user = ? AND LOWER(Status) IN ('unpaid','unsuccessful') AND CAST(price_product AS SIGNED) > 0");
    foreach ($onlyUsers as $u) {
        $q->execute([$u]);
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $i) {
            if ($ts($i['time_sell']) >= $since && !isset($c[$i['username']])) {
                $c[$i['username']] = ['service' => $i['username'], 'user' => (string) $i['id_user'], 'price' => (int) $i['price_product'], 'kind' => 'کیف پول؟',
                    'payment' => '', 'at' => $ts($i['time_sell']), 'refunded' => true];
            }
        }
    }
}
if ($onlyUsers) {
    $c = array_filter($c, fn($x) => in_array($x['user'], $onlyUsers, true));
}
if (!$c) {
    echo "سفارش ناموفقی در این بازه پیدا نشد\n";
    exit;
}

// ---- check each one
$mp = new ManagePanel();
$invQ = $pdo->prepare("SELECT * FROM invoice WHERE username = ? LIMIT 1");
$laterQ = $pdo->prepare("SELECT COUNT(*) FROM invoice WHERE id_user = ? AND LOWER(Status) IN ('active','sendedwarn','send_on_hold','end_of_time','end_of_volume') AND CAST(time_sell AS UNSIGNED) > ?");
$userQ = $pdo->prepare("SELECT Balance, username FROM user WHERE id = ?");
$rows = [];
foreach ($c as $x) {
    $invQ->execute([$x['service']]);
    $inv = $invQ->fetch(PDO::FETCH_ASSOC) ?: null;
    $panel = $inv['Service_location'] ?? null;
    $onPanel = null;
    $sub = '';
    if ($panel) {
        $d = $mp->DataUser($panel, $x['service']);
        $onPanel = ($d['status'] ?? 'Unsuccessful') !== 'Unsuccessful' && !empty($d['username']);
        $sub = (string) ($d['subscription_url'] ?? '');
    }
    $botActive = $inv && in_array(strtolower((string) $inv['Status']), ['active', 'sendedwarn', 'send_on_hold', 'end_of_time', 'end_of_volume'], true);
    $laterQ->execute([$x['user'], $x['at']]);
    $rebought = (int) $laterQ->fetchColumn() > 0;
    $userQ->execute([$x['user']]);
    $u = $userQ->fetch(PDO::FETCH_ASSOC) ?: ['Balance' => 0, 'username' => ''];
    if ($botActive && $onPanel) {
        $state = 'ok';
        $label = '✅ تحویل شد';
    } elseif ($onPanel && !$botActive) {
        $state = 'created';
        $label = '⚠️ روی پنل ساخته شده ولی در ربات ثبت نشده' . ($x['refunded'] ? ' + پولش هم به کیف پول برگشته' : '');
    } elseif ($rebought) {
        $state = 'rebought';
        $label = '✅ ساخته نشد، ولی مشتری بعداً دوباره خرید کرد';
    } elseif ($x['refunded']) {
        $state = 'refunded';
        $label = '💰 ساخته نشد؛ مبلغ در کیف پولش است (باید دوباره بخرد)';
    } elseif ($onPanel === null) {
        $state = 'unknown';
        $label = '❓ سفارش در ربات پیدا نشد';
    } else {
        $state = 'missing';
        $label = '❌ پرداخت تأیید شده ولی نه سرویس ساخته شده نه پول برگشته';
    }
    $rows[] = $x + ['state' => $state, 'label' => $label, 'inv' => $inv, 'panel' => $panel, 'sub' => $sub, 'balance' => (int) $u['Balance'], 'tg' => $u['username']];
}
usort($rows, fn($a, $b) => $a['at'] <=> $b['at']);

$counts = array_count_values(array_column($rows, 'state'));
echo "━━ " . count($rows) . " سفارش از " . $fmtT($since) . " تا الان\n\n";
foreach ($rows as $r) {
    echo $fmtT($r['at']) . " | 👤 {$r['user']}" . ($r['tg'] && $r['tg'] !== 'none' ? " @{$r['tg']}" : '') . " | 🔐 {$r['service']}"
        . ($r['inv'] ? " (کد سرویس {$r['inv']['id_invoice']})" : '') . ($r['payment'] !== '' ? " | 🧾 کد پرداخت {$r['payment']}" : '')
        . " | " . number_format($r['price']) . " | {$r['kind']}\n      {$r['label']}   (کیف پول الان: " . number_format($r['balance']) . ")\n";
}
echo "\nخلاصه: ✅ سالم " . (($counts['ok'] ?? 0) + ($counts['rebought'] ?? 0)) . " | ⚠️ ساخته‌شده‌ی ثبت‌نشده " . ($counts['created'] ?? 0)
    . " | 💰 منتظر خرید دوباره " . ($counts['refunded'] ?? 0) . " | ❌ مشکل‌دار " . (($counts['missing'] ?? 0) + ($counts['unknown'] ?? 0)) . "\n";

// ---- fixes
if (isset($o['fix'])) {
    echo "\n━━ درست کردن سرویس‌هایی که روی پنل ساخته شده‌اند\n";
    foreach ($rows as $r) {
        if ($r['state'] !== 'created') {
            continue;
        }
        if ($r['refunded'] && $r['price'] > 0 && !deductBalance(['id' => $r['user'], 'agent' => 'f', 'maxbuyagent' => 0], $r['price'])) {
            echo "  ⏭ {$r['service']}: کیف پول مشتری کمتر از " . number_format($r['price']) . " است (احتمالاً خرجش کرده) — دستی بررسی کنید\n";
            continue;
        }
        update("invoice", "Status", "active", "username", $r['service']);
        $msg = "✅ <b>سرویس شما فعال شد</b>\n\n🔐 نام سرویس: <code>{$r['service']}</code>\n"
            . ($r['sub'] !== '' ? "🔗 لینک اشتراک:\n<code>{$r['sub']}</code>\n" : '')
            . ($r['refunded'] && $r['price'] > 0 ? "\n💳 مبلغ " . number_format($r['price']) . " تومان که موقتاً به کیف پولتان برگشته بود، بابت همین سرویس برداشته شد.\n" : '')
            . "\nاز «سرویس‌های من» در ربات هم می‌توانید ببینید.";
        telegram('sendmessage', ['chat_id' => $r['user'], 'text' => $msg, 'parse_mode' => 'HTML']);
        echo "  ✅ {$r['service']} فعال شد" . ($r['refunded'] ? ' و ' . number_format($r['price']) . ' از کیف پول برداشته شد' : '') . "\n";
    }
}
if (isset($o['notify'])) {
    $ledgerFile = $root . '/storage/failed_orders_notified.json';
    $done = is_file($ledgerFile) ? (json_decode((string) file_get_contents($ledgerFile), true) ?: []) : [];
    echo "\n━━ پیام به مشتری‌هایی که هنوز سرویس ندارند\n";
    $byUser = []; // one message per customer, with the total put back in the wallet
    foreach ($rows as $r) {
        if ($r['state'] === 'refunded' && !isset($done[$r['service']])) {
            $byUser[$r['user']][] = $r;
        }
    }
    foreach ($byUser as $uid => $list) {
        $sum = array_sum(array_column($list, 'price'));
        $msg = "🙏 <b>عذرخواهی بابت اختلال</b>\n\n" . (count($list) > 1 ? count($list) . ' سفارش' : 'سفارش') . " شما به‌خاطر قطعی موقت سرور ساخته نشد و مبلغ <b>" . number_format($sum)
            . " تومان</b> به کیف پول شما برگشت 💰\n\nمشکل برطرف شده؛ لطفاً از «🛍 خرید اشتراک» دوباره خرید کنید و پرداخت را با <b>کیف پول</b> انجام دهید.\n\n💬 پشتیبانی: @pichavpn_support";
        $res = telegram('sendmessage', ['chat_id' => $uid, 'text' => $msg, 'parse_mode' => 'HTML']);
        if (!empty($res['ok'])) {
            foreach ($list as $r) {
                $done[$r['service']] = time();
            }
        }
        echo '  ' . (!empty($res['ok']) ? '✅' : '❌') . " $uid — " . count($list) . ' سفارش، ' . number_format($sum) . " تومان\n";
        usleep(80000);
    }
    file_put_contents($ledgerFile, json_encode($done, JSON_PRETTY_PRINT));
}
if (!isset($o['fix']) && !isset($o['notify']) && (($counts['created'] ?? 0) || ($counts['refunded'] ?? 0))) {
    echo "\nبرای درست کردن:  --fix  (سرویس‌های ساخته‌شده)   و   --notify  (پیام خرید دوباره به بقیه)\n";
}
