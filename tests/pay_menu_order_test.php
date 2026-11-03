<?php
// php tests/pay_menu_order_test.php — the payment menu: online payment, automatic card-to-card, Telegram Stars first; the rest below; close last.
chdir(__DIR__ . '/..');
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }
$src = file_get_contents('keyboard.php');
$a = strpos($src, '$PaySettingcard = getPaySettingValue("Cartstatus");');
$b = strpos($src, '$step_payment = json_encode($step_payment);');
$code = substr($src, $a, $b - $a) . '$step_payment = json_encode($step_payment);';
$S = [];
function getPaySettingValue($k, $d = null) { global $S; return $S[$k] ?? $d; }
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
echo $fail ? "\n$fail FAILED\n" : "\nall passed\n";
exit($fail ? 1 : 0);
