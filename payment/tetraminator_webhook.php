<?php
// Tetraminator callback: GET (or POST) .../payment/tetraminator_webhook.php?order_id=<our order id>, no body, no signature.
// It only tells us WHICH order to look at. The money is credited after an inquiry to Tetraminator's API (see tetraminator.php).

ini_set('error_log', 'error_log');
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../botapi.php';
require_once __DIR__ . '/../panels/Api/Marzban.php';
require_once __DIR__ . '/../function.php';
require_once __DIR__ . '/../panels.php';
require_once __DIR__ . '/../keyboard.php';
require_once __DIR__ . '/../jdf.php';
require __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../tetraminator.php';

$ManagePanel = new ManagePanel();
$textbotlang = languagechange();

function tetraminator_respond(int $code, string $msg): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['status' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

$orderId = (string) ($_GET['order_id'] ?? $_POST['order_id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{6,40}$/', $orderId)) {
    tetraminator_respond(400, 'missing order_id');
}
$payment = select("Payment_report", "*", "id_order", $orderId, "select");
if (!is_array($payment) || ($payment['Payment_Method'] ?? '') !== 'tetraminator') {
    error_log("tetraminator webhook: unknown order {$orderId}");
    tetraminator_respond(404, 'order not found');
}

$res = tetraminatorSettle($pdo, $payment, fn($id) => DirectPayment($id, __DIR__ . "/../images.jpg"));
switch ($res['result']) {
    case 'paid':
        tetraminatorAfterPaid($payment, $res, $textbotlang);
        tetraminator_respond(200, 'ok');
    case 'already':
        tetraminator_respond(200, 'already paid');
    case 'unpaid':
        tetraminator_respond(200, 'not paid');
    case 'amount_mismatch':
        error_log("tetraminator webhook: amount mismatch for {$orderId}: billed {$res['billed']}, got {$res['amount']}");
        tetraminator_respond(400, 'amount mismatch');
    case 'delivery_failed':
        tetraminator_respond(500, 'delivery failed');
    default:
        error_log("tetraminator webhook: inquiry failed for {$orderId}: " . ($res['error'] ?? '?'));
        tetraminator_respond(503, 'try again');
}
