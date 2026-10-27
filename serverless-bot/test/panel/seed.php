<?php
// Deterministic-ish rich data for the panel differential test (php seed.php <bot-root>): users, orders, payments, renewals, expenses, capital, finance rows.
$root = $argv[1] ?? '.';
chdir($root);
require $root . '/config.php';
date_default_timezone_set('Asia/Tehran');
mt_srand(7);
$pdo->exec('SET FOREIGN_KEY_CHECKS=0');
$pdo->exec("UPDATE product SET Location = 'Picha-1', agent = 'f' WHERE id IN (1,2)");
foreach (['referral_payouts', 'referral_signups', 'referral_links', 'support_message', 'invoice', 'Payment_report', 'service_other', 'expenses', 'capital_entries', 'user', 'fin_txn'] as $t) {
    $pdo->exec("DELETE FROM `$t`");
}
$now = time();
$pdo->exec("DELETE FROM admin WHERE id_admin = '{admin_number}'");
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
foreach ([['mg1', '7002', 'm101', 'active'], ['mg2', '7003', 'm108', 'disablebyadmin'], ['mg3', '7004', 'm109', 'send_on_hold'], ['mg4', '7002', 'm120', 'active'], ['mg5', '0', 'm121', 'active']] as [$iid, $iu, $un, $stt]) {
    $ins('invoice', ['id_invoice' => $iid, 'id_user' => $iu, 'username' => $un, 'Service_location' => 'Picha-1', 'time_sell' => (string) ($now - 86400), 'name_product' => '۳۰ گیگ', 'price_product' => '100000', 'Volume' => '30', 'Service_time' => '30',
        'uuid' => 'u', 'note' => '', 'user_info' => 'x', 'bottype' => '', 'refral' => '0', 'time_cron' => '0', 'notifctions' => '{}', 'Status' => $stt]);
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
$pp = [['pend1', 'waiting', 'variza', 'getconfigafterpay|newsvc1'], ['pend2', 'Unpaid', 'cart to cart', 'none'], ['pend3', 'expire', 'variza', 'getextenduser|svc2%30'], ['pend4', 'reject', 'cart to cart', 'getextenduser|svc3%30'],
    ['pend5', 'paid', 'variza', 'getconfigafterpay|svc7'], ['pend6', 'paid', 'variza', 'getconfigafterpay|ghost'], ['pend7', 'paid', 'cart to cart', 'getextenduser|svc4%30'], ['pend8', 'waiting', 'cart to cart', 'none'], ['pend9', 'paid', 'cart to cart', 'refunded|svc4%30']];
foreach ($pp as $i => [$oid, $stt, $m, $inv]) {
    $ins('Payment_report', ['id_user' => '7002', 'id_order' => $oid, 'time' => date('Y/m/d H:i:s', $now - 600 * ($i + 1)), 'price' => '120000', 'payment_Status' => $stt, 'Payment_Method' => $m, 'id_invoice' => $inv, 'dec_not_confirmed' => 'slug' . $i]);
}
$ins('service_other', ['id_user' => '7002', 'username' => 'svc4', 'value' => '30', 'time' => (string) $now, 'price' => '1', 'type' => 'extend_user', 'status' => 'paid', 'output' => '']);
@unlink($root . '/storage/promo.json');
$pdo->exec("UPDATE setting SET affiliatespercentage = '10'");
$ins('expenses', ['amount' => 300000, 'description' => 'تبلیغات: کمپین اینستا', 'created_at' => $now - 5 * 86400, 'admin_id' => 'x', 'kind' => 'advertising', 'payer' => '', 'payee' => '']);
$eid = (int) $pdo->lastInsertId();
$ins('referral_links', ['name' => 'کمپین اینستا', 'platform' => 'instagram', 'code' => 'ad_insta', 'tg_user_id' => null, 'contact' => '@x', 'price' => 300000, 'pays_commission' => 1, 'commission_percent' => null, 'active' => 1, 'notes' => '', 'expense_id' => $eid, 'created_at' => $now - 9 * 86400, 'ad_date' => $now - 8 * 86400]);
$ins('referral_links', ['name' => 'یوتیوبر', 'platform' => 'youtube', 'code' => 'yt_one', 'tg_user_id' => '123456', 'contact' => '', 'price' => 0, 'pays_commission' => 1, 'commission_percent' => 20, 'active' => 1, 'notes' => 'n', 'expense_id' => null, 'created_at' => $now - 3 * 86400, 'ad_date' => null]);
$ins('referral_links', ['name' => 'قدیمی', 'platform' => 'other', 'code' => 'old_one', 'tg_user_id' => null, 'contact' => '', 'price' => 50000, 'pays_commission' => 0, 'commission_percent' => null, 'active' => 0, 'notes' => '', 'expense_id' => null, 'created_at' => $now - 30 * 86400, 'ad_date' => null]);
$lids = $pdo->query('SELECT id FROM referral_links ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
foreach ([[0, 7001], [0, 7002], [0, 7003], [0, 7004], [1, 7005], [1, 7006]] as [$li, $uu]) {
    $ins('referral_signups', ['link_id' => $lids[$li], 'user_id' => (string) $uu, 'created_at' => $now - 86400]);
}
$ins('referral_payouts', ['link_id' => $lids[0], 'amount' => 10000, 'note' => 'a', 'created_at' => $now - 3600]);
$st = ['Unseen', 'Answered', 'Customerresponse', 'close', 'Pending', 'Answered'];
for ($i = 1; $i <= 14; $i++) {
    $u = 7000 + 1 + ($i % 6);
    $t = date('Y/m/d H:i:s', $now - $i * 3600);
    $ins('support_message', ['Tracking' => "trk$i", 'idsupport' => '5550001', 'iduser' => (string) $u, 'name_departman' => $i % 2 ? 'پشتیبانی' : 'فروش', 'text' => "سوال $i", 'result' => $i % 3 ? "پاسخ $i" : '',
        'time' => $t, 'status' => $st[$i % 6], 'result_time' => $i % 3 ? $t : '', 'result_by' => $i % 3 ? '5550001' : '', 'file_id' => $i % 5 === 0 ? 'FILEID' : '', 'file_type' => $i % 5 === 0 ? 'photo' : '', 'file_name' => '',
        'result_file_id' => $i % 7 === 0 ? 'RF' : '', 'result_file_type' => $i % 7 === 0 ? 'document' : '', 'result_file_name' => $i % 7 === 0 ? 'a.pdf' : '']);
}
echo "seeded\n";
