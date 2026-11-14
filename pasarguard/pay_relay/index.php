<?php
// Picha payment relay — the only web part left after the bot moved to Telegram Serverless.
// It keeps what payment services push (the Variza webhook, the bank-SMS forwarder) in a small queue that the bot
// pulls. It checks nothing itself: the bot verifies the Variza signature and the forwarder token with the secrets
// it already has. No database, no bot token, no secrets here except the bot's pull key.
//
//   POST /variza          Variza webhook
//   POST /paychi?order_id=…  Paychi's webhook (signed; the bot verifies and always inquires)
//   GET  /tetraminator?order_id=…   Tetraminator's callback (no body, no signature; the bot verifies it with an inquiry)
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
foreach (['Authorization', 'X-Admin-Token', 'X-Token', 'X-Api-Key', 'X-Webhook-Signature', 'X-Paychi-Signature', 'Content-Type'] as $h) {
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

if ($path === '/paychi') {
    // Paychi's webhook (POST, signed with t=…,v1=…) or a bare GET: both only name an order; the bot verifies the signature when it has a secret and always asks Paychi
    $orderId = (string) ($_GET['order_id'] ?? '');
    if ($orderId !== '' && !preg_match('/^[A-Za-z0-9]{6,40}$/', $orderId)) {
        reply(400, ['status' => 'bad order_id']);
    }
    if ($orderId === '' && $raw === '') {
        reply(400, ['status' => 'empty']);
    }
    withQueue(['type' => 'paychi', 'query' => $orderId !== '' ? ['order_id' => $orderId] : [], 'body' => $raw, 'headers' => $headers]);
    reply(200, ['status' => 'queued']);
}

if (in_array($path, ['/tetraminator', '/tetraminator_webhook.php', '/payment/tetraminator_webhook.php'], true)) {
    $orderId = (string) ($_GET['order_id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9]{6,40}$/', $orderId)) {
        reply(400, ['status' => 'missing order_id']);
    }
    withQueue(['type' => 'tetraminator', 'query' => ['order_id' => $orderId]]);
    reply(200, ['status' => 'queued']);
}

if (in_array($path, ['/sms', '/sms_webhook.php', '/payment/sms_webhook.php'], true)) {
    withQueue(['type' => 'sms', 'body' => $raw, 'post' => $_POST, 'query' => $_GET, 'headers' => $headers]);
    reply(200, ['ok' => true, 'status' => 'queued']);
}

// the bot asks the relay to create a Variza payment: Variza may refuse foreign servers, and this server can reach it
// through the SSH tunnel to the Iranian server (VARIZA_PROXY in the settings, made by install.sh with an Iranian IP)
if ($path === '/variza_create') {
    if (RELAY_KEY === '' || !hash_equals(RELAY_KEY, headerValue('X-Relay-Key'))) {
        reply(401, ['ok' => false]);
    }
    $in = json_decode($raw, true);
    if (!is_array($in) || !is_string($in['token'] ?? null) || !is_array($in['payload'] ?? null)) {
        reply(400, ['ok' => false, 'error' => 'bad request']);
    }
    // the API address can be another Variza-compatible service (Paychi Variz: https://<host>/api/compat/variza/v1); https on 443 only, no credentials in the URL
    $base = 'https://variza.ir/api/v1';
    if (isset($in['api_url'])) {
        $u = rtrim((string) $in['api_url'], '/');
        if (!preg_match('#^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:443)?(/[A-Za-z0-9._~/-]*)?$#', $u)) {
            reply(400, ['ok' => false, 'error' => 'bad api_url']);
        }
        $base = $u;
    }
    $ch = curl_init($base . '/pay');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json', 'Authorization: Bearer ' . $in['token']],
        CURLOPT_POSTFIELDS => json_encode($in['payload'], JSON_UNESCAPED_UNICODE),
    ]);
    if (defined('VARIZA_PROXY') && VARIZA_PROXY !== '') {
        curl_setopt($ch, CURLOPT_PROXY, VARIZA_PROXY);
        curl_setopt($ch, CURLOPT_NOPROXY, '');
    }
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    reply(200, ['ok' => $body !== false, 'http_code' => $code, 'body' => $body === false ? null : $body, 'error' => $body === false ? $err : null]);
}

if ($path === '/pull') {
    if (RELAY_KEY === '' || !hash_equals(RELAY_KEY, headerValue('X-Relay-Key'))) {
        reply(401, ['ok' => false]);
    }
    reply(200, ['ok' => true, 'events' => withQueue(null, (int) ($_GET['after'] ?? 0), (int) ($_GET['ack'] ?? 0))]);
}

reply(404, ['ok' => false]);
