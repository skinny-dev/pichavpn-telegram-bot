<?php
// php tests/admin_test_test.php  (needs the local test DB; telegram() is stubbed, nothing is sent)
chdir(__DIR__ . '/..');
require 'config.php';
$GLOBALS['sent'] = [];
function telegram($method, $d = [], $t = null, $f = true) {
    $GLOBALS['sent'][] = $d;
    $id = (string) $d['chat_id'];
    if ($id === '222') return ['ok' => false, 'error_code' => 400, 'description' => 'Bad Request: chat not found'];
    if ($id === '333') return ['ok' => false, 'error_code' => 403, 'description' => 'Forbidden: bot was blocked by the user'];
    return ['ok' => true];
}
$src = file_get_contents('function.php');
foreach (['adminTestNotify', 'adminTestLine'] as $fn) {
    preg_match('/\nfunction ' . $fn . '\(.*?\n}\n/s', $src, $m);
    eval($m[0]);
}
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }
$pdo->exec("DELETE FROM admin WHERE id_admin IN ('111','222','333','444')");
$ins = $pdo->prepare("INSERT INTO admin (id_admin, username, password, rule) VALUES (?, ?, 'x', ?)");
foreach ([['111', 'administrator'], ['222', 'Seller'], ['333', 'Seller'], ['444', 'support']] as [$id, $rule]) $ins->execute([$id, $id, $rule]);
$res = adminTestNotify('note');
$by = array_column($res, null, 'id');
ok($by['111']['ok'] === true && $by['444']['ok'] === true, 'admins who started the bot receive the test');
ok($by['222']['ok'] === false && strpos(adminTestLine($by['222']), 'نزده') !== false, '«chat not found» is explained as «has not pressed /start»');
ok($by['333']['ok'] === false && strpos(adminTestLine($by['333']), 'بلاک') !== false, 'a blocked bot is explained');
ok(strpos(adminTestLine($by['111']), '✅') === 0, 'delivered row has a check mark');
$texts = []; foreach ($GLOBALS['sent'] as $s) { $texts[(string) $s['chat_id']] = $s['text']; }
ok(strpos($texts['444'], 'رسید پرداخت برای شما ارسال نمی‌شود') !== false, '«support» is told it does not get payment receipts');
ok(strpos($texts['111'], 'رسید پرداخت‌ها') !== false, 'other roles are told they get receipts');
$pdo->exec("DELETE FROM admin WHERE id_admin IN ('111','222','333','444')");
exit($fail ? 1 : 0);
