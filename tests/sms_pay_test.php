<?php
// php tests/sms_pay_test.php  (needs the local test DB: config.php -> $pdo)
chdir(__DIR__ . '/..');
require 'config.php';
require 'sms_pay.php';
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }

$dep = "بلو\nواریز پول\nعلیرضا عزیز، 2,005,420ریال به حساب شما نشست.\nموجودی: 14,418,073 ریال\n۷:۳۲\n۱۴۰۵.۰۷.۱۳";
$dep2 = "بلو\nواریز پول\nعلیرضا عزیز،609,860 ریال به حساب شما نشست.\nموجودی: 12,412,653 ریال\n۶:۴۴\n۱۴۰۵.۰۷.۱۳";
$wd = "بلو\nبرداشت پول\nعلیرضا عزیز، 38,550,000ریال از حساب شما پرید.\nموجودی: 11,963,793 ریال\n۵:۵۳\n۱۴۰۵.۰۷.۱۳";
$p = smsParse($dep);
ok($p && $p['kind'] === 'deposit' && $p['amount_rial'] === 2005420 && $p['balance_rial'] === 14418073, 'parse deposit amount/balance');
ok($p['sms_time'] === '1405/07/13 07:32', 'parse time ' . $p['sms_time']);
ok(smsParse($dep2)['amount_rial'] === 609860, 'parse no-space comma form');
$w = smsParse($wd);
ok($w && $w['kind'] === 'withdraw' && $w['amount_rial'] === 38550000, 'parse withdrawal');
ok(smsParse('کد ورود 12345') === null, 'unrelated sms ignored');
ok(smsParse("واریز پول از حساب شما پرید 1000 ریال") === null, 'contradictory refused');

$pdo->exec("DELETE FROM sms_inbox"); $pdo->exec("DELETE FROM Payment_report WHERE id_order LIKE 'smst%'");
$pdo->exec("INSERT IGNORE INTO PaySetting (NamePay,ValuePay) VALUES ('sms_match_window','180')");
$now = time();
$mk = fn($id, $price, $age, $st = 'Unpaid') => $pdo->prepare("INSERT INTO Payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES ('1001',?,?,?,?, 'cart to cart','x|y')")->execute([$id, date('Y/m/d H:i:s', $now - $age), $price, $st]);
$mk('smst1', 200542, 60); $mk('smst_old', 60986, 99999); $mk('smst_a', 5000, 30); $mk('smst_b', 5000, 20);
$approved = [];
$ap = function ($o) use (&$approved) { $approved[] = $o['id_order']; };

$r = smsProcess($pdo, $dep, 'blu', $ap, $now);
ok($r['status'] === 'matched' && $approved === ['smst1'], 'deposit matches open order (rial/10)');
$r = smsProcess($pdo, $dep, 'blu', $ap, $now);
ok($r['status'] === 'duplicate' && count($approved) === 1, 'replayed SMS not re-approved');
ok($pdo->query("SELECT payment_Status FROM Payment_report WHERE id_order='smst1'")->fetchColumn() === 'paid', 'order marked paid once');
$r = smsProcess($pdo, $dep2, 'blu', $ap, $now);
ok($r['status'] === 'unmatched', 'expired order (outside window) not matched');
$r = smsProcess($pdo, $wd, 'blu', $ap, $now);
ok($r['status'] === 'ignored', 'withdrawal ignored');
$r = smsProcess($pdo, "واریز پول\nعزیز، 50,000 ریال به حساب شما نشست. موجودی: 1 ریال", 'blu', $ap, $now);
ok($r['status'] === 'ambiguous' && count($approved) === 1, 'two orders same amount -> ambiguous, nobody approved');

// unique amounts never collide
$taken = [];
for ($i = 0; $i < 40; $i++) { $a = smsUniqueAmount($pdo, 100000); ok($a > 100000 && $a <= 100999 && !isset($taken[$a]), "unique $a") || 0; $taken[$a] = 1; $mk("smstu$i", $a, 5); }
$pdo->exec("DELETE FROM Payment_report WHERE id_order LIKE 'smst%'");

$e = smsExtractPayload('{"text":"hello","bank":"BLU","token":"T"}', [], [], []);
ok($e['text'] === 'hello' && $e['bank'] === 'blu' && $e['token'] === 'T', 'payload: json token in body');
$e = smsExtractPayload('{"message":"m"}', [], [], ['authorization' => 'Bearer ZZ']);
ok($e['token'] === 'ZZ' && $e['text'] === 'm', 'payload: bearer header');
$e = smsExtractPayload('plain sms body', [], ['token' => 'Q'], []);
ok($e['text'] === 'plain sms body' && $e['token'] === 'Q', 'payload: raw body + query token');
// catch-up: deposit arrived first (unclaimed), order opened after, customer presses "I paid"
$pdo->exec("DELETE FROM sms_inbox"); $pdo->exec("DELETE FROM Payment_report WHERE id_order LIKE 'smst%'");
$ap2 = []; $apf = function ($o) use (&$ap2) { $ap2[] = $o['id_order']; };
$r = smsProcess($pdo, $dep2, 'blu', $apf, $now - 120);          // 60,986 toman, no order yet -> unmatched
ok($r['status'] === 'unmatched', 'deposit with no order yet is kept unclaimed');
$mk('smstc', 60986, 60);                                         // order created 60s ago (after SMS 120s ago)
$o = $pdo->query("SELECT * FROM Payment_report WHERE id_order='smstc'")->fetch(PDO::FETCH_ASSOC);
ok(smsReconcileOrder($pdo, $o, $apf, $now) === true && $ap2 === ['smstc'], 'catch-up approves order from earlier deposit');
ok(smsReconcileOrder($pdo, $o, $apf, $now) === false, 'catch-up does not approve twice');
$mk('smstd', 60986, 30);
$o2 = $pdo->query("SELECT * FROM Payment_report WHERE id_order='smstd'")->fetch(PDO::FETCH_ASSOC);
ok(smsReconcileOrder($pdo, $o2, $apf, $now) === false, 'consumed deposit cannot pay a second order');
$pdo->exec("DELETE FROM sms_inbox");
smsProcess($pdo, $dep2, 'blu', $apf, $now - 7200);               // deposit 2h before order
$mk('smste', 60986, 60);
$o3 = $pdo->query("SELECT * FROM Payment_report WHERE id_order='smste'")->fetch(PDO::FETCH_ASSOC);
ok(smsReconcileOrder($pdo, $o3, $apf, $now) === false, 'deposit far older than the order is not accepted');
ok(smsStoreUnclaimed($pdo, $dep) !== null && smsStoreUnclaimed($pdo, $dep) === null, 'import stores once, then dedupes');
$pdo->exec("DELETE FROM Payment_report WHERE id_order LIKE 'smst%'");

$e = smsExtractPayload('{"c6f69d2a0d1dd1030df100b86e34e536_blu":"بلو\nواریز پول"}', [], [], []);
ok($e['token'] === 'c6f69d2a0d1dd1030df100b86e34e536' && $e['bank'] === 'blu' && str_contains($e['text'], 'واریز'), 'payload: forwarder {token_bank: text}');
ok(!str_contains(implode(',', $e['keys']), 'c6f69d2a'), 'token never appears in logged keys');
$e = smsExtractPayload('', ['c6f69d2a0d1dd1030df100b86e34e536_blu' => 'x'], [], []);
ok($e['text'] === 'x' && $e['bank'] === 'blu', 'payload: same shape as form field');
exit($fail ? 1 : 0);
