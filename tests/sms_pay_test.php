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
exit($fail ? 1 : 0);
