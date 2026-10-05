<?php
/*
 * Receives bank SMS from the Mirza SMS Forwarder app and auto-approves matching
 * card-to-card top-ups. Auth: the forwarder's "Admin token" (PaySetting sms_webhook_token).
 * Every request is logged (token redacted) to storage/sms_webhook.log.
 */
chdir(__DIR__);
date_default_timezone_set('Asia/Tehran');
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../sms_pay.php';

header('Content-Type: application/json; charset=utf-8');

function smsLog(string $line): void
{
    $dir = __DIR__ . '/../storage';
    @file_put_contents($dir . '/sms_webhook.log', '[' . date('Y-m-d H:i:s') . '] ' . $line . "\n", FILE_APPEND | LOCK_EX);
}
function smsReply(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

$raw = file_get_contents('php://input', false, null, 0, 65536) ?: '';
$headers = [];
foreach (getallheaders() as $k => $v) {
    $headers[strtolower($k)] = $v;
}
$p = smsExtractPayload($raw, $_POST, $_GET, $headers);
$ip = $_SERVER['REMOTE_ADDR'] ?? '?';

$st = $pdo->prepare("SELECT ValuePay FROM PaySetting WHERE NamePay = 'sms_webhook_token'");
$st->execute();
$expected = (string) $st->fetchColumn();
if ($expected === '' || $p['token'] === '' || !hash_equals($expected, $p['token'])) {
    smsLog("DENIED ip=$ip method={$_SERVER['REQUEST_METHOD']} keys=" . implode(',', $p['keys']) . ' headers=' . implode(',', array_keys($headers)));
    smsReply(401, ['ok' => false, 'error' => 'unauthorized']);
}
$mode = $pdo->query("SELECT ValuePay FROM PaySetting WHERE NamePay = 'smsautoconfirm'")->fetchColumn();
if ($p['text'] === '') {
    smsLog("EMPTY ip=$ip keys=" . implode(',', $p['keys']) . ' body=' . substr(str_replace($expected, '***', $raw), 0, 300));
    smsReply(400, ['ok' => false, 'error' => 'no text found']);
}
if ($mode !== 'onsms') {
    smsLog("DISABLED ip=$ip bank={$p['bank']} (smsautoconfirm off) — not processed");
    smsReply(200, ['ok' => true, 'status' => 'disabled']);
}

require_once __DIR__ . '/../botapi.php';
require_once __DIR__ . '/../panels.php';
require_once __DIR__ . '/../function.php';
require_once __DIR__ . '/../keyboard.php';
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../jdf.php';
$ManagePanel = new ManagePanel();
$setting = select("setting", "*");
$textbotlang = languagechange();

$notify = function (string $text) use ($setting): void {
    if (strlen($setting['Channel_Report'] ?? '') > 0) {
        $topic = select("topicid", "idreport", "report", "paymentreport", "select")['idreport'] ?? null;
        $args = ['chat_id' => $setting['Channel_Report'], 'text' => $text, 'parse_mode' => 'HTML'];
        if ($topic) {
            $args['message_thread_id'] = $topic;
        }
        telegram('sendmessage', $args);
    }
};

$approve = 'smsApproveOrder';

$res = smsProcess($pdo, $p['text'], $p['bank'], $approve);

$amt = $res['parsed']['amount_rial'] ?? 0;
smsLog("OK ip=$ip bank={$p['bank']} status={$res['status']} amount_rial=$amt order=" . ($res['order']['id_order'] ?? '-'));
if (in_array($res['status'], ['unmatched', 'ambiguous', 'review'], true) && $amt > 0) {
    $why = ['unmatched' => 'سفارش بازی با این مبلغ پیدا نشد', 'ambiguous' => 'چند سفارش هم‌مبلغ وجود دارد', 'review' => 'نیاز به بررسی دستی'][$res['status']];
    $notify("⚠️ واریز بانکی بدون تطبیق\n💰 " . number_format(intdiv($amt, 10)) . " تومان\n❗️ $why");
}
smsReply(200, ['ok' => true, 'status' => $res['status']]);
