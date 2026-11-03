<?php
// Router script for `php -S`: a stand-in for api.tetraminator.com used by tests/tetraminator_test.php.
$file = getenv('TETRA_MOCK_STATE') ?: sys_get_temp_dir() . '/tetra_mock_state.json';
$fh = fopen($file, 'c+');
flock($fh, LOCK_EX);
$raw = stream_get_contents($fh);
$st = $raw !== '' ? json_decode($raw, true) : null;
$st = is_array($st) ? $st : ['n' => 0, 'fail' => 0, 'pays' => [], 'log' => []];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$key = $_SERVER['HTTP_X_API_KEY'] ?? '';
$out = function (int $code, array $body) use (&$st, $fh) {
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($st));
    flock($fh, LOCK_UN);
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($body);
    exit;
};
if ($path === '/__fail') {
    $st['fail'] = (int) ($_GET['n'] ?? 0);
    $out(200, ['ok' => true]);
}
if ($path === '/__set') {
    $id = (string) ($_GET['pay_id'] ?? '');
    $st['pays'][$id] = array_merge($st['pays'][$id] ?? ['price' => 0], array_filter(['status' => $_GET['status'] ?? null, 'amount' => isset($_GET['amount']) ? (int) $_GET['amount'] : null, 'wrong_id' => $_GET['wrong_id'] ?? null, 'http500' => $_GET['http500'] ?? null], fn($v) => $v !== null));
    $out(200, ['ok' => true]);
}
if ($path === '/__gateway') {
    $st['gateway'] = (int) ($_GET['on'] ?? 0);
    $out(200, ['ok' => true]);
}
if ($path === '/__links') { // what the next invoice answers: ?drop=url,payment_link  ?http=1 makes the url a plain http link
    $st['drop'] = array_filter(explode(',', (string) ($_GET['drop'] ?? '')));
    $st['http'] = (int) ($_GET['http'] ?? 0);
    $out(200, ['ok' => true]);
}
if ($path === '/__state') {
    $out(200, $st);
}
if ($key !== 'testkey') {
    $out(401, ['status' => false, 'message' => 'Invalid API key']);
}
if ($method === 'POST' && $path === '/v1/invoice/create') {
    $in = json_decode(file_get_contents('php://input'), true) ?: [];
    $st['log'][] = ['path' => $path, 'ctype' => $_SERVER['CONTENT_TYPE'] ?? '', 'body' => $in];
    if ($st['fail'] > 0) {
        $st['fail']--;
        $out(500, ['status' => false, 'message' => 'temporary']);
    }
    if ((int) ($in['price'] ?? 0) < 50000 || empty($in['callback_url'])) {
        $out(400, ['status' => false, 'message' => 'bad request']);
    }
    $id = 'pay' . (++$st['n']) . 'abc';
    $st['pays'][$id] = ['price' => (int) $in['price'], 'status' => 'pending', 'amount' => (int) $in['price']];
    $body = ['status' => true, 'message' => 'Invoice created successfully', 'pay_id' => $id,
        'url' => ($st['http'] ?? 0 ? 'http' : 'https') . "://tetraminator.com/invoice/$id",
        'payment_link' => "https://t.me/tetraminator_bot?start=pay_$id",
        'mini_app_link' => "https://t.me/tetraminator_bot/pay?startapp=$id"];
    if (!empty($st['gateway'])) {
        $body['gateway_link'] = "https://tetraminator.com/gateway/$id";
    }
    foreach ($st['drop'] ?? [] as $k) {
        unset($body[$k]);
    }
    $out(201, $body);
}
if ($method === 'GET' && preg_match('#^/v1/payment/inquiry/([A-Za-z0-9]+)$#', $path, $m)) {
    $p = $st['pays'][$m[1]] ?? null;
    if (!$p) {
        $out(404, ['status' => false, 'message' => 'not found']);
    }
    if (!empty($p['http500'])) {
        $out(500, ['status' => false]);
    }
    $out(200, ['status' => true, 'payment_status' => $p['status'], 'pay_id' => !empty($p['wrong_id']) ? 'someoneelse' : $m[1], 'amount' => (int) $p['amount']]);
}
$out(404, ['status' => false]);
