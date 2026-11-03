<?php
// php tests/tetraminator_test.php   (self-contained: SQLite in memory + a mock of api.tetraminator.com started with `php -S`)
chdir(__DIR__ . '/..');
define('TETRAMINATOR_NO_SLEEP', 1);
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }

$port = 8139;
$state = sys_get_temp_dir() . '/tetra_mock_' . getmypid() . '.json';
@unlink($state);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/tetraminator_mock.php'], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, ['TETRA_MOCK_STATE' => $state] + $_ENV + ['PATH' => getenv('PATH')]);
register_shutdown_function(function () use ($proc, $state) { proc_terminate($proc); @unlink($state); });
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) { usleep(100000); }
$mock = fn(string $p) => json_decode((string) @file_get_contents("http://127.0.0.1:$port$p"), true);

// the bot's helper, reduced to a settings array
$SETTINGS = ['tetraminator_api_key' => 'testkey', 'tetraminator_base_url' => "http://127.0.0.1:$port/v1"];
function getPaySettingValue($name, $default = null) { global $SETTINGS; return $SETTINGS[$name] ?? $default; }
$domainhosts = 'bot.example.com';
require 'tetraminator.php';

// ---- create invoice
$r = createPayTetraminator(144000, 'ord1abc123');
ok(($r['pay_id'] ?? '') === 'pay1abc' && str_contains($r['pay_url'] ?? '', 'start=pay_pay1abc'), 'create: pay_id + payment_link returned');
$log = $mock('/__state')['log'];
ok($log[0]['body']['price'] === 144000 && $log[0]['body']['callback_url'] === 'https://bot.example.com/payment/tetraminator_webhook.php?order_id=ord1abc123', 'create: price (int toman) and callback_url with our order id');
ok($log[0]['ctype'] === 'application/json', 'create: JSON content type');
$mock('/__fail?n=2');
$r = createPayTetraminator(60000, 'ord2abc123');
ok(!empty($r['pay_url']) && count($mock('/__state')['log']) === 4, 'create: two 500s are retried, third try succeeds');
$mock('/__fail?n=5');
$before = count($mock('/__state')['log']);
$r = createPayTetraminator(60000, 'ord3abc123');
ok(empty($r['pay_url']) && ($r['http_code'] ?? 0) === 500 && count($mock('/__state')['log']) === $before + 3, 'create: gives up after 3 tries');
$mock('/__fail?n=0');
$before = count($mock('/__state')['log']);
$r = createPayTetraminator(1000, 'ord4abc123');
ok(empty($r['pay_url']) && ($r['http_code'] ?? 0) === 400 && count($mock('/__state')['log']) === $before + 1, 'create: 400 (amount below 50,000) is final, no retry');
$SETTINGS['tetraminator_api_key'] = 'wrong';
$r = createPayTetraminator(60000, 'ord5abc123');
ok(($r['http_code'] ?? 0) === 401, 'create: wrong key -> 401, final');
$SETTINGS['tetraminator_api_key'] = '0';
$r = createPayTetraminator(60000, 'ord6abc123');
ok(($r['error'] ?? '') === 'tetraminator_api_key not set', 'create: no key set -> clear error, no request');
$SETTINGS['tetraminator_api_key'] = 'testkey';

// ---- inquiry
$mock('/__set?pay_id=pay1abc&status=pending');
$i = tetraminatorInquiry('pay1abc');
ok($i['ok'] && !$i['paid'], 'inquiry: pending is not paid');
$mock('/__set?pay_id=pay1abc&status=paid&amount=144000');
$i = tetraminatorInquiry('pay1abc');
ok($i['ok'] && $i['paid'] && $i['amount'] === 144000, 'inquiry: paid + amount');
$mock('/__set?pay_id=pay1abc&wrong_id=1');
ok(!tetraminatorInquiry('pay1abc')['paid'], 'inquiry: an answer about another pay_id is never accepted');
$mock('/__set?pay_id=pay1abc&wrong_id=');
$mock('/__set?pay_id=pay2abc&http500=1');
$i = tetraminatorInquiry('pay2abc');
ok(!$i['ok'] && !$i['paid'], 'inquiry: HTTP 500 = could not ask (not "unpaid")');
ok(!tetraminatorInquiry('nope123')['ok'], 'inquiry: unknown pay_id');

// ---- settle
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec("CREATE TABLE Payment_report (id_user TEXT, id_order TEXT, time TEXT, price TEXT, payment_Status TEXT, Payment_Method TEXT, id_invoice TEXT, dec_not_confirmed TEXT)");
$mk = function ($id, $price, $payId, $status = 'Unpaid', $method = 'tetraminator') use ($pdo) {
    $pdo->prepare("INSERT INTO Payment_report VALUES ('1001', ?, '2026/11/03 10:00:00', ?, ?, ?, 'x|y', ?)")->execute([$id, $price, $status, $method, $payId]);
    return $pdo->query("SELECT * FROM Payment_report WHERE id_order = " . $pdo->quote($id))->fetch(PDO::FETCH_ASSOC);
};
$status = fn($id) => $pdo->query("SELECT payment_Status FROM Payment_report WHERE id_order = " . $pdo->quote($id))->fetchColumn();
$delivered = [];
$deliver = function ($id) use (&$delivered) { $delivered[] = $id; };

$mock('/__set?pay_id=pay3abc&status=pending&amount=60000');
$o = $mk('sA', 60000, 'pay3abc');
$r = tetraminatorSettle($pdo, $o, $deliver);
ok($r['result'] === 'unpaid' && $delivered === [] && $status('sA') === 'Unpaid', 'settle: not paid at the gateway -> nothing delivered, order stays open');
$mock('/__set?pay_id=pay3abc&status=paid&amount=60000');
$r = tetraminatorSettle($pdo, $o, $deliver);
ok($r['result'] === 'paid' && $delivered === ['sA'] && $status('sA') === 'paid' && $r['billed'] === 60000 && $r['pay_id'] === 'pay3abc', 'settle: paid at the gateway -> delivered once, order marked paid');
$r = tetraminatorSettle($pdo, $pdo->query("SELECT * FROM Payment_report WHERE id_order='sA'")->fetch(PDO::FETCH_ASSOC), $deliver);
ok($r['result'] === 'already' && $delivered === ['sA'], 'settle: repeated callback / button press does not deliver again');
$r = tetraminatorSettle($pdo, $o, $deliver); // a stale copy of the row (status still "Unpaid") — two requests racing
ok($r['result'] === 'already' && $delivered === ['sA'], 'settle: a racing request with a stale row is stopped by the claim (delivered once)');

$mock('/__set?pay_id=pay4abc&status=paid&amount=50000');
$o = $mk('sB', 144000, 'pay4abc');
$r = tetraminatorSettle($pdo, $o, $deliver);
ok($r['result'] === 'amount_mismatch' && $status('sB') === 'Unpaid' && count($delivered) === 1, 'settle: paid amount below the bill -> not credited');
$mock('/__set?pay_id=pay4abc&status=paid&amount=144000');
$r = tetraminatorSettle($pdo, $o, $deliver);
ok($r['result'] === 'paid' && $status('sB') === 'paid', 'settle: same order once the amount is right -> credited');

$o = $mk('sC', 60000, 'pay2abc'); // inquiry answers 500
$r = tetraminatorSettle($pdo, $o, $deliver);
ok($r['result'] === 'error' && $status('sC') === 'Unpaid' && count($delivered) === 2, 'settle: gateway unreachable -> error, order untouched (can be retried)');

$o = $mk('sD', 60000, '');
ok(tetraminatorSettle($pdo, $o, $deliver)['result'] === 'error', 'settle: order without pay_id -> error');
$o = $mk('sE', 60000, 'pay3abc', 'Unpaid', 'variza');
$r = tetraminatorSettle($pdo, $o, $deliver);
ok($r['result'] === 'error' && $status('sE') === 'Unpaid' && count($delivered) === 2, 'settle: other gateways\' orders are never touched');

$mock('/__set?pay_id=pay5abc&status=paid&amount=60000');
$o = $mk('sF', 60000, 'pay5abc', 'reject');
$r = tetraminatorSettle($pdo, $o, $deliver);
ok($r['result'] === 'paid' && $r['before'] === 'reject', 'settle: money really arrived for an order an admin had rejected -> credited, and reported as such');

$mock('/__set?pay_id=pay6abc&status=paid&amount=60000');
$o = $mk('sG', 60000, 'pay6abc');
$r = tetraminatorSettle($pdo, $o, function ($id) { throw new RuntimeException('panel down'); });
ok($r['result'] === 'delivery_failed' && $status('sG') === 'paid' && $r['error'] === 'panel down', 'settle: delivery exception -> reported, order stays paid (no double delivery on retry)');

echo $fail ? "\n$fail FAILED\n" : "\nall passed\n";
exit($fail ? 1 : 0);
