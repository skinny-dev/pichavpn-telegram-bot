<?php
// Picha payment relay — the only web part left after the bot moved to Telegram Serverless.
// It keeps what payment services push (the Variza webhook, the bank-SMS forwarder) in a small queue that the bot
// pulls. It checks nothing itself: the bot verifies the Variza signature and the forwarder token with the secrets
// it already has. No database, no bot token, no secrets here except the bot's pull key.
//
//   POST /variza          Variza webhook
//   GET  /variza_return   the page Variza sends the customer back to
//   POST /sms             the SMS forwarder
//   GET  /pull?after=N    the bot (header X-Relay-Key): events after N; &ack=M forgets everything up to M
//
// Settings: /etc/picha-relay.php (made by install.sh): RELAY_KEY, RELAY_DIR.

declare(strict_types=1);
require getenv('PICHA_RELAY_CONF') ?: '/etc/picha-relay.php';

const MAX_BODY = 65536;
const MAX_EVENTS = 5000;         // a flood cannot grow the queue for ever
const KEEP_SECONDS = 7 * 86400;

function reply(int $code, array $body): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}
function headerValue(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (!empty($_SERVER[$key])) {
        return (string) $_SERVER[$key];
    }
    foreach (function_exists('getallheaders') ? getallheaders() : [] as $k => $v) {
        if (strtolower((string) $k) === strtolower($name)) {
            return (string) $v;
        }
    }
    return '';
}
/** read, filter and rewrite the queue under one lock; $add is appended with the next number */
function withQueue(?array $add, int $after = 0, int $ack = 0): array
{
    $file = rtrim(RELAY_DIR, '/') . '/queue.jsonl';
    $fh = fopen($file, 'c+');
    flock($fh, LOCK_EX);
    $rows = [];
    $seq = 0;
    while (($line = fgets($fh)) !== false) {
        $e = json_decode($line, true);
        if (!is_array($e) || !isset($e['seq'])) {
            continue;
        }
        $seq = max($seq, (int) $e['seq']);
        $age = time() - (int) ($e['at'] ?? 0);
        if ($age > KEEP_SECONDS || ((int) $e['seq'] <= $ack && $age > 3600)) {
            continue; // old, or acknowledged an hour ago
        }
        $rows[] = $e;
    }
    if ($add !== null) {
        if (count($rows) >= MAX_EVENTS) {
            flock($fh, LOCK_UN);
            fclose($fh);
            reply(503, ['ok' => false, 'error' => 'queue full']);
        }
        $rows[] = ['seq' => $seq + 1, 'at' => time()] + $add;
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, implode('', array_map(fn($e) => json_encode($e, JSON_UNESCAPED_UNICODE) . "\n", $rows)));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return array_values(array_slice(array_filter($rows, fn($e) => (int) $e['seq'] > $after), 0, 100));
}

$path = '/' . trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
$path = (string) preg_replace('#^/index\.php#', '', $path) ?: '/';
$raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY);
$headers = [];
foreach (['Authorization', 'X-Admin-Token', 'X-Token', 'X-Api-Key', 'X-Webhook-Signature', 'Content-Type'] as $h) {
    if (($v = headerValue($h)) !== '') {
        $headers[strtolower($h)] = mb_substr($v, 0, 500);
    }
}

if (in_array($path, ['/variza', '/variza_webhook.php', '/payment/variza_webhook.php'], true)) {
    if ($raw === '') {
        reply(400, ['status' => 'empty body']);
    }
    withQueue(['type' => 'variza', 'body' => $raw, 'headers' => $headers]);
    reply(200, ['status' => 'queued']);
}

if (in_array($path, ['/variza_return', '/variza_return.php', '/payment/variza.php'], true)) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<body style="font-family:Tahoma,sans-serif;text-align:center;padding:48px 20px">'
        . '<div style="font-size:44px">&#8986;</div><h2 style="color:#3498db">پرداخت ثبت شد</h2>'
        . '<p style="color:#666">پرداخت شما دریافت شد و ظرف چند لحظه در ربات تأیید می‌شود. به ربات برگردید؛ اگر تا چند دقیقه تأیید نشد، دکمهٔ «پرداخت کردم» را بزنید.</p>'
        . '</body></html>';
    exit;
}

if (in_array($path, ['/sms', '/sms_webhook.php', '/payment/sms_webhook.php'], true)) {
    withQueue(['type' => 'sms', 'body' => $raw, 'post' => $_POST, 'query' => $_GET, 'headers' => $headers]);
    reply(200, ['ok' => true, 'status' => 'queued']);
}

if ($path === '/pull') {
    if (RELAY_KEY === '' || !hash_equals(RELAY_KEY, headerValue('X-Relay-Key'))) {
        reply(401, ['ok' => false]);
    }
    reply(200, ['ok' => true, 'events' => withQueue(null, (int) ($_GET['after'] ?? 0), (int) ($_GET['ack'] ?? 0))]);
}

reply(404, ['ok' => false]);
