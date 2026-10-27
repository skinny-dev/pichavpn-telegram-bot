<?php
// Deterministic-ish rich data for the panel differential test (php seed.php <bot-root>): users, orders, payments, renewals, expenses, capital, finance rows.
$root = $argv[1] ?? '.';
chdir($root);
require $root . '/config.php';
date_default_timezone_set('Asia/Tehran');
mt_srand(7);
$pdo->exec('SET FOREIGN_KEY_CHECKS=0');
foreach (['invoice', 'Payment_report', 'service_other', 'expenses', 'capital_entries', 'user', 'fin_txn'] as $t) {
    $pdo->exec("DELETE FROM `$t`");
}
$now = time();
$agents = ['f', 'f', 'f', 'n', 'n2'];
$ins = fn($t, $r) => $pdo->prepare("INSERT INTO `$t` (`" . implode('`,`', array_keys($r)) . "`) VALUES (" . implode(',', array_fill(0, count($r), '?')) . ")")->execute(array_values($r));
$userCols = $pdo->query('SHOW COLUMNS FROM user')->fetchAll(PDO::FETCH_ASSOC);
for ($i = 1; $i <= 30; $i++) {
    $row = [];
    foreach ($userCols as $c) {
        $row[$c['Field']] = $c['Default'] ?? (stripos($c['Type'], 'int') !== false || stripos($c['Type'], 'decimal') !== false ? 0 : '');
        if ($c['Null'] === 'YES' && $c['Default'] === null) {
            $row[$c['Field']] = null;
        }
    }
    $row['id'] = (string) (7000 + $i);
    $row['username'] = $i % 7 === 0 ? 'none' : "user$i";
    $row['namecustom'] = $i % 3 === 0 ? "نام $i" : '';
    $row['number'] = $i % 4 === 0 ? '0912000' . $i : '';
    $row['Balance'] = (string) ($i * 1500);
    $row['agent'] = $agents[$i % 5];
    $row['User_Status'] = $i % 11 === 0 ? 'block' : 'Active';
    $row['register'] = (string) ($now - $i * 86400 * 3 - 500);
    $row['step'] = 'home';
    $ins('user', $row);
}
$prods = [['۳۰ گیگ', 100000, 30, 30], ['۵۰ گیگ', 160000, 50, 30], ['سرویس تست', 0, 1, 1], ['اضطراری ۱۰ گیگ', 50000, 10, 30], ['هدیه', 0, 5, 30]];
$statuses = ['active', 'active', 'active', 'end_of_time', 'end_of_volume', 'disabled', 'removebyuser', 'Unpaid', 'send_on_hold', 'sendedwarn', 'unsuccessful', 'expire', 'reject'];
for ($i = 1; $i <= 90; $i++) {
    $p = $prods[$i % 5];
    $t = $now - mt_rand(0, 60 * 86400);
    if ($i % 9 === 0) {
        $t = $now - mt_rand(0, 3600 * 5);
    }
    $ins('invoice', ['id_invoice' => "inv$i", 'id_user' => (string) (7000 + 1 + ($i % 30)), 'username' => "svc$i", 'Service_location' => $i % 3 ? 'Picha-1' : 'Picha-2', 'time_sell' => (string) $t, 'name_product' => $p[0],
        'price_product' => (string) $p[1], 'Volume' => (string) $p[2], 'Service_time' => (string) $p[3], 'uuid' => '', 'note' => '', 'user_info' => '', 'bottype' => '', 'refral' => '0', 'time_cron' => '0', 'notifctions' => '{}', 'Status' => $statuses[$i % count($statuses)]]);
}
$methods = ['cart to cart', 'cart to cart', 'variza', 'Star Telegram', 'zarinpal', 'wallet', 'add balance by admin', 'low balance by admin', 'manual invoice', 'add order by admin', 'extend by admin', 'cost', 'capital_injection', 'plisio'];
for ($i = 1; $i <= 120; $i++) {
    $t = $now - mt_rand(0, 60 * 86400);
    $time = $i % 2 ? date('Y/m/d H:i:s', $t) : (string) $t;
    $ins('Payment_report', ['id_user' => (string) (7000 + 1 + ($i % 30)), 'id_order' => "ord$i", 'time' => $time, 'price' => (string) (mt_rand(1, 40) * 10000), 'payment_Status' => $i % 6 ? 'paid' : 'Unpaid',
        'Payment_Method' => $methods[$i % count($methods)], 'id_invoice' => 'none']);
}
for ($i = 1; $i <= 25; $i++) {
    $t = $now - mt_rand(0, 40 * 86400);
    $ins('service_other', ['id_user' => (string) (7000 + 1 + ($i % 30)), 'username' => "svc$i", 'value' => (string) mt_rand(5, 40), 'time' => $i % 2 ? date('Y/m/d H:i:s', $t) : (string) $t, 'price' => (string) (mt_rand(1, 20) * 10000),
        'type' => ['extend_user', 'extra_user', 'extend_user_by_admin', 'extra_time_user'][$i % 4], 'status' => $i % 5 ? 'paid' : 'unpaid', 'output' => '']);
}
$kinds = array_keys(['purchase' => 1, 'salary' => 1, 'advertising' => 1, 'server' => 1, 'tools' => 1, 'fee' => 1, 'tax' => 1, 'general' => 1, 'dividend' => 1]);
for ($i = 1; $i <= 20; $i++) {
    $ins('expenses', ['amount' => mt_rand(1, 50) * 10000, 'description' => "هزینه $i", 'created_at' => $now - mt_rand(0, 50 * 86400), 'admin_id' => '1', 'kind' => $i % 10 === 0 ? '' : $kinds[$i % 9], 'payer' => 'ali', 'payee' => 'x']);
}
for ($i = 1; $i <= 4; $i++) {
    $ins('capital_entries', ['amount' => $i * 1000000, 'description' => "سرمایه $i", 'created_at' => $now - $i * 9 * 86400, 'admin_id' => '1']);
}
$acc = $pdo->query("SELECT id, system_key FROM fin_accounts WHERE system_key IN ('cogs','exp_salary','exp_server','dividends')")->fetchAll(PDO::FETCH_KEY_PAIR);
$types = [['expense', 'exp_salary'], ['expense', 'exp_server'], ['capital_out', 'dividends'], ['distribution', 'dividends'], ['capital_in', null], ['purchase', 'cogs']];
foreach ($types as $n => [$type, $key]) {
    $cat = $key ? (int) array_search($key, $acc) : null;
    $ins('fin_txn', ['ref' => "T$n", 'type' => $type, 'txn_date' => $now - $n * 86400 * 4, 'category_account_id' => $cat ?: null, 'subtotal' => 100000 * ($n + 1), 'total' => 100000 * ($n + 1), 'status' => 'posted', 'created_at' => $now,
        'meta' => $type === 'purchase' ? '{"expense":true}' : null]);
}
echo "seeded\n";
