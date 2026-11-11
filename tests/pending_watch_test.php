<?php
// php tests/pending_watch_test.php   (self-contained: SQLite in memory + the Tetraminator mock)
chdir(__DIR__ . '/..');
define('TETRAMINATOR_NO_SLEEP', 1);
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }
$port = 8141;
$state = sys_get_temp_dir() . '/tetra_mock_pw_' . getmypid() . '.json';
@unlink($state);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/tetraminator_mock.php'], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, ["TETRA_MOCK_STATE" => $state] + $_ENV + ["PATH" => getenv("PATH")]);
register_shutdown_function(function () use ($proc, $state) { proc_terminate($proc); @unlink($state); });
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) { usleep(100000); }
$mock = fn(string $p) => json_decode((string) @file_get_contents("http://127.0.0.1:$port$p"), true);

$SETTINGS = ["tetraminator_api_key" => "testkey", 'tetraminator_base_url' => "http://127.0.0.1:$port/v1"];
function getPaySettingValue($name, $default = null) { global $SETTINGS; return $SETTINGS[$name] ?? $default; }
$sent = []; $delivered = [];
function select($t, $c = '*', $f = null, $v = null, $m = 'select') {
    if ($t === 'setting') return ['Channel_Report' => '-100999'];
    if ($t === 'topicid') return ['idreport' => 7];
    if ($t === 'user') return ['username' => 'u', 'Balance' => 0];
    return [];
}
function update(...$a) {}
function sendmessage(...$a) {}
function telegram($m, $p = []) { global $sent; $sent[] = $p; return ['ok' => true]; }
function languagechange() { return ['paymentGateway' => [], 'users' => ['Balance' => []]]; }
function DirectPayment($id) { global $delivered; $delivered[] = $id; }
$domainhosts = 'bot.example.com';
require 'pending_watch.php';
@unlink(PW_STATE);

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec("CREATE TABLE Payment_report (id_user TEXT, id_order TEXT, time TEXT, price TEXT, payment_Status TEXT, Payment_Method TEXT, id_invoice TEXT, dec_not_confirmed TEXT)");
$now = fn(int $minAgo) => date('Y/m/d H:i:s', time() - $minAgo * 60 + 0);
date_default_timezone_set('Asia/Tehran');
$mk = function ($id, $price, $payId, $status, $method, $ageMin) use ($pdo) {
    $pdo->prepare("INSERT INTO Payment_report VALUES ('1001', ?, ?, ?, ?, ?, 'x|y', ?)")->execute([$id, date('Y/m/d H:i:s', time() - $ageMin * 60), $price, $status, $method, $payId]);
};
$st = fn($id) => $pdo->query("SELECT payment_Status FROM Payment_report WHERE id_order = " . $pdo->quote($id))->fetchColumn();

$mock('/__set?pay_id=pP&status=paid&amount=60000');      $mk('oExpiredPaid', 60000, 'pP', 'expire', 'tetraminator', 300);
$mock('/__set?pay_id=pQ&status=pending&amount=60000');   $mk('oWaiting', 60000, 'pQ', 'Unpaid', 'tetraminator', 40);
$mock('/__set?pay_id=pR&status=pending&amount=60000');   $mk('oFresh', 60000, 'pR', 'Unpaid', 'tetraminator', 2);
$mock('/__set?pay_id=pS&status=paid&amount=10000');      $mk('oShort', 144000, 'pS', 'Unpaid', 'tetraminator', 30);
$mk('vReceipt', 60000, 'v1', 'waiting', 'variza', 20);
$mk('vOpen', 60000, 'v2', 'Unpaid', 'variza', 30);
$mk('vFresh', 60000, 'v3', 'Unpaid', 'variza', 3);
$mk('oOld', 60000, 'pP', 'Unpaid', 'tetraminator', 60 * 24 * 9);

// report only: nothing changes
$r = pendingWatchRun($pdo, ['hours' => 24 * 7, 'deliver' => false, 'alert' => false, 'wait' => 15]);
$kinds = array_column($r, 'kind', 'order');
ok(($kinds['oExpiredPaid'] ?? '') === 'paid_undelivered' && $st('oExpiredPaid') === 'expire' && $delivered === [], 'report: an EXPIRED order the gateway says is paid is found, and nothing is changed');
ok(($kinds['oShort'] ?? '') === 'amount_mismatch', 'report: paid amount below the bill -> flagged, not delivered');
ok(!isset($kinds['oOld']), 'report: orders outside the window are ignored');
ok(($kinds['vReceipt'] ?? '') === 'receipt_waiting' && ($kinds['vOpen'] ?? '') === 'waiting_long' && !isset($kinds['vFresh']), 'report: Variza receipts and long-open orders are listed, fresh ones are not');

// deliver + alert
$r = pendingWatchRun($pdo, ['hours' => 24 * 7, 'deliver' => true, 'alert' => true, 'wait' => 15]);
$kinds = array_column($r, 'kind', 'order');
ok(($kinds['oExpiredPaid'] ?? '') === 'delivered' && $st('oExpiredPaid') === 'paid' && $delivered === ['oExpiredPaid'], 'deliver: the paid-but-expired order is delivered once and marked paid');
ok($st('oShort') === 'Unpaid' && $st('oWaiting') === 'Unpaid' && $st('vOpen') === 'Unpaid', 'deliver: unpaid / short / Variza orders are left alone');
ok(($kinds['oWaiting'] ?? '') === 'waiting_long' && !isset($kinds['oFresh']), 'waiting: a customer waiting 40 min is flagged; one waiting 2 min is not');
$text = implode("\n", array_column($sent, 'text'));
ok($sent && $sent[0]['chat_id'] === '-100999' && $sent[0]['message_thread_id'] === 7, 'alert: posted to the report group payment topic');
ok(str_contains($text, 'oWaiting') && str_contains($text, 'oShort') && str_contains($text, 'vReceipt'), 'alert: lists the orders a person must look at');
$n = count($sent);
pendingWatchRun($pdo, ['hours' => 24 * 7, 'deliver' => true, 'alert' => true, 'wait' => 15]);
ok(count($sent) === $n && $delivered === ['oExpiredPaid'], 'second run: no repeated alerts, no second delivery');

echo $fail ? "\n$fail FAILED\n" : "\nall passed\n";
exit($fail ? 1 : 0);
