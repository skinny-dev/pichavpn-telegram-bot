<?php
// php tests/pay_menu_order_test.php — the payment menu: online payment, automatic card-to-card, Telegram Stars first; the rest below; close last.
chdir(__DIR__ . '/..');
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }
$src = file_get_contents('keyboard.php');
$a = strpos($src, '$PaySettingcard = getPaySettingValue("Cartstatus");');
$b = strpos($src, '$step_payment = json_encode($step_payment);');
$code = substr($src, $a, $b - $a) . '$step_payment = json_encode($step_payment);';
$code = str_replace("require_once __DIR__ . '/gateway_pause.php';", '', $code); // the test loads it itself
$S = [];
function getPaySettingValue($k, $d = null) { global $S; return $S[$k] ?? $d; }
require 'gateway_pause.php';
function menu(array $settings): array {
    global $code;
    global $S; $S = $settings;
    $from_id = 1; $users = ['cardpayment' => 1];
    $pdo = new PDO('sqlite::memory:'); $pdo->exec("CREATE TABLE Payment_report (id_user TEXT, payment_Status TEXT)"); $pdo->exec("INSERT INTO Payment_report VALUES ('1','paid'),('1','paid')");
    $textbotlang = ['textbot' => ['cartToCart' => 'CARD', 'variza' => 'AUTO', 'tetraminator' => 'ONLINE', 'starTelegram' => 'STARS', 'zarinPal' => 'ZARIN', 'paymentNotVerify' => 'NV', 'nowPayment' => 'NOW', 'cryptoPayment' => 'CRY', 'nowPaymentTron' => 'TRON', 'iranPay1' => 'I1', 'iranPay2' => 'I2', 'iranPay3' => 'I3', 'iranPay4' => 'I4', 'aqayePardakht' => 'AQ'], 'keyboard' => ['closeList' => 'CLOSE']];
    eval($code);
    return array_map(fn($r) => $r[0]['text'], json_decode($step_payment, true)['inline_keyboard']);
}
$all = ['Cartstatus' => 'oncard', 'Cartstatuspv' => 'offcardpv', 'variza_status' => 'onvariza', 'variza_api_token' => 'x', 'variza_webhook_secret' => 'y',
    'tetraminator_status' => 'ontetraminator', 'tetraminator_api_key' => 'k', 'statusstar' => '1', 'zarinpalstatus' => 'onzarinpal'];
ok(menu($all) === ['ONLINE', 'AUTO', 'STARS', 'CARD', 'ZARIN', 'CLOSE'], 'everything on: online, automatic card-to-card, Stars, then the rest, close last');
$one = $all; unset($one['tetraminator_status']);
ok(menu($one) === ['AUTO', 'STARS', 'CARD', 'ZARIN', 'CLOSE'], 'online payment off: the others keep their order');
$two = $all; $two['Cartstatus'] = 'offcard'; unset($two['variza_status'], $two['zarinpalstatus']);
ok(menu($two) === ['ONLINE', 'STARS', 'CLOSE'], 'online + Stars only');
ok(menu(['Cartstatus' => 'offcard']) === ['CLOSE'], 'nothing on: only the close button');
$nokey = $all; $nokey['tetraminator_api_key'] = '0';
ok(!in_array('ONLINE', menu($nokey), true), 'online payment without a key is never shown');
$nostar = $all; $nostar['statusstar'] = '0';
ok(!in_array('STARS', menu($nostar), true), 'Stars off: not shown');
// Variza's own limit: hidden while paused, back afterwards
$paused = $all; $paused['variza_pause_until'] = (string) (time() + 600);
ok(!in_array('AUTO', menu($paused), true) && in_array('ONLINE', menu($paused), true), 'Variza paused: its button is hidden, the others stay');
$over = $all; $over['variza_pause_until'] = (string) (time() - 5);
ok(in_array('AUTO', menu($over), true), 'pause over: Variza is back');
// the refusal that starts the pause
$msg = 'به دلیل محدودیت اشتراک فعلی، امکان ساخت لینک پرداخت جدید وجود ندارد.';
$res = ['error' => 'http 422', 'raw' => json_encode(['message' => $msg]), 'decoded' => ['message' => $msg], 'http_code' => 422];
ok(varizaLimitReached($res), 'Variza 422 «محدودیت اشتراک» is recognised (decoded answer)');
unset($res['decoded']);
ok(varizaLimitReached($res), 'recognised from the raw JSON text too (\\u escapes)');
// the real text from the alert, exactly as Variza sent it (\u escapes, the last word completed)
$real = ['error' => 'http 422', 'http_code' => 422, 'raw' => '{"message":"\u0628\u0647 \u062f\u0644\u06cc\u0644 \u0645\u062d\u062f\u0648\u062f\u06cc\u062a \u0627\u0634\u062a\u0631\u0627\u06a9 \u0641\u0639\u0644\u06cc\u060c \u0627\u0645\u06a9\u0627\u0646 \u0633\u0627\u062e\u062a \u0644\u06cc\u0646\u06a9"}'];
ok(varizaLimitReached($real), 'the real Variza answer from the production alert is recognised');
ok(!varizaLimitReached(['http_code' => 422, 'decoded' => ['message' => 'amount too low']]), 'another 422 (amount) does not pause the gateway');
ok(!varizaLimitReached(['http_code' => 500, 'decoded' => ['message' => $msg]]) && !varizaLimitReached(['error' => 'curl: timeout']) && !varizaLimitReached(null), '500 / network errors never pause it');
echo $fail ? "\n$fail FAILED\n" : "\nall passed\n";
exit($fail ? 1 : 0);
