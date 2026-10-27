<?php
// Fake Bot API for the PHP side of the diff: records every call as JSON lines in $LOG (env TGMOCK_LOG or ./calls.jsonl).
$log = getenv('TGMOCK_LOG') ?: __DIR__ . '/calls.jsonl';
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/file/bot[^/]+/(.+)$#', $p, $f)) { echo "BYTES-of-" . $f[1]; exit; }
preg_match('#^/bot([^/]+)/(\w+)#', $p, $mm);
$m = strtolower($mm[2] ?? '?');
$b = $_POST ?: (json_decode(file_get_contents('php://input'), true) ?: []);
foreach ($b as $k => $v) {
    if (is_string($v) && in_array($k, ['reply_markup', 'results', 'menu_button'], true)) { $d = json_decode($v, true); if ($d !== null) $b[$k] = $d; }
}
file_put_contents($log, json_encode(['m' => $m, 'p' => $b], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
header('Content-Type: application/json');
$n = (int) @file_get_contents($log . '.n') + 1; file_put_contents($log . '.n', $n);
switch ($m) {
    case 'getchatmember': echo json_encode(['ok' => true, 'result' => ['status' => 'member', 'user' => ['id' => (int) ($b['user_id'] ?? 0)]]]); break;
    case 'getme': echo json_encode(['ok' => true, 'result' => ['id' => 1, 'is_bot' => true, 'username' => 'pichanet_bot', 'first_name' => 'Picha']]); break;
    case 'getfile': echo json_encode(['ok' => true, 'result' => ['file_path' => 'f/' . ($b['file_id'] ?? 'x')]]); break;
    default: echo json_encode(['ok' => true, 'result' => ['message_id' => 5000 + $n, 'chat' => ['id' => (int) ($b['chat_id'] ?? 0)], 'date' => time()]]);
}
