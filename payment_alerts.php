<?php
// Payment gateway alerts → the report group, in their own topic «💳 خطای درگاه پرداخت» (created once).
//   paymentErrorReport()   a payment link could not be made (called next to every «errorLinkPayment» message)
//   paymentGatewayProbe()  every 10 minutes (cron): is the gateway reachable from the bot? alerts on down / back up
// The same gateway + reason is sent at most once per 10 minutes; the next alert says how many were held back.

const PA_STATE = __DIR__ . '/storage/payment_alerts.json';
const PA_TOPIC = '💳 خطای درگاه پرداخت';
const PA_QUIET = 600;

function paState(): array
{
    $s = is_file(PA_STATE) ? json_decode((string) @file_get_contents(PA_STATE), true) : null;
    return is_array($s) ? $s : [];
}

function paSave(array $s): void
{
    @mkdir(dirname(PA_STATE), 0775, true);
    @file_put_contents(PA_STATE, json_encode($s, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

function paGatewayName(string $g): string
{
    $map = ['variza' => 'واریزا', 'tetraminator' => 'تترامینیتور', 'zarinpal' => 'زرین‌پال', 'aqayepardakht' => 'آقای پرداخت', 'plisio' => 'Plisio (ارز دیجیتال)', 'nowpayment' => 'NowPayments (ارز دیجیتال)',
        'iranpay1' => 'ایران‌پی ۱', 'iranpay2' => 'ایران‌پی ۲', 'iranpay3' => 'ایران‌پی ۳', 'iranpay4' => 'ایران‌پی ۴', 'digitaltron' => 'دیجیتال‌ترون (ترون)',
        'startelegrams' => 'استارز تلگرام', 'cart_to_offline' => 'کارت به کارت'];
    return $map[$g] ?? $g;
}

/** A gateway's raw error → [short reason in Persian, tip or '']. */
function paReason($detail, string $gateway): array
{
    $raw = is_string($detail) ? $detail : json_encode($detail, JSON_UNESCAPED_UNICODE);
    $l = strtolower((string) $raw);
    $code = is_array($detail) ? (int) ($detail['http_code'] ?? 0) : 0;
    if ($code === 0 && preg_match('/http (\d{3})/', $l, $m)) {
        $code = (int) $m[1];
    }
    $tip = $gateway === 'variza' ? 'اگر از ایران باز است:  php scripts/variza_proxy.php test' : '';
    if (strpos($l, 'timed out') !== false || strpos($l, 'timeout') !== false) {
        return ['⏱ درگاه جواب نداد (timeout) — سرور ربات به درگاه نمی‌رسد', $tip];
    }
    if (strpos($l, 'could not resolve') !== false) {
        return ['🌐 دامنه درگاه پیدا نشد (DNS)', $tip];
    }
    if (strpos($l, 'failed to connect') !== false || strpos($l, 'connection refused') !== false || strpos($l, 'proxy') !== false) {
        return ['🔌 اتصال به درگاه برقرار نشد' . (strpos($l, '127.0.0.1') !== false ? ' (تونل ایران قطع است)' : ''), $gateway === 'variza' ? 'systemctl restart picha-iran-tunnel   سپس   php scripts/variza_proxy.php test' : ''];
    }
    if (strpos($l, 'not set') !== false) {
        return ['🔑 توکن/کلید درگاه در ربات تنظیم نشده', 'تنظیمات درگاه در پنل ادمین ربات'];
    }
    if ($code === 401 || $code === 403) {
        return ["🔑 درگاه دسترسی نداد (HTTP $code) — توکن اشتباه یا منقضی", 'توکن جدید از پنل درگاه بگیرید و در ربات بزنید'];
    }
    if ($gateway === 'variza' && function_exists('varizaLimitReached') && varizaLimitReached(is_array($detail) ? $detail : [])) {
        return ['🚫 محدودیت اشتراک واریزا — سقف ساخت لینک پر شده', 'اشتراک واریزا را در پنل آن‌ها بررسی یا ارتقا دهید. تا ۳۰ دقیقه دکمهٔ واریزا از منوی پرداخت مخفی است و بعد خودش دوباره امتحان می‌شود'];
    }
    if ($code === 400 || $code === 422) {
        return ["⚠️ درگاه درخواست را رد کرد (HTTP $code) — مبلغ یا تنظیمات", ''];
    }
    if ($code >= 520 && $code <= 524) {
        return ["🔥 سرور خود درگاه جواب نمی‌دهد (HTTP $code، Cloudflare)", $gateway === 'tetraminator' ? 'مشکل از طرف تترامینیتور است. دکمهٔ آن تا ۱۰ دقیقه از منو مخفی می‌شود و بعد خودش دوباره امتحان می‌شود؛ اگر ادامه داشت به پشتیبانی تترامینیتور خبر بدهید' : 'معمولاً موقتی است'];
    }
    if ($code >= 500) {
        return ["🔥 خطای خود درگاه (HTTP $code)", 'معمولاً موقتی است؛ اگر ادامه داشت با پشتیبانی درگاه تماس بگیرید'];
    }
    return ['❓ لینک پرداخت ساخته نشد', ''];
}

/** Thread id of a topic in the report group, created the first time. null when the group has no topics / no rights. */
function paTopicId(): ?int
{
    $setting = function_exists('select') ? select("setting", "*") : [];
    $chat = (string) ($setting['Channel_Report'] ?? '');
    if ($chat === '' || $chat === '0') {
        return null;
    }
    $s = paState();
    if (($s['topic_chat'] ?? '') === $chat && !empty($s['topic_id'])) {
        return (int) $s['topic_id'];
    }
    $r = telegram('createForumTopic', ['chat_id' => $chat, 'name' => PA_TOPIC, 'icon_color' => 16478047]);
    if (empty($r['ok'])) {
        return null;
    }
    $s['topic_chat'] = $chat;
    $s['topic_id'] = (int) $r['result']['message_thread_id'];
    paSave($s);
    return (int) $s['topic_id'];
}

function paSend(string $html): void
{
    $setting = select("setting", "*");
    $chat = (string) ($setting['Channel_Report'] ?? '');
    if ($chat === '' || $chat === '0') {
        return;
    }
    $topic = paTopicId();
    if ($topic === null) { // no topic possible: fall back to the bot's error topic
        $topic = (int) (select("topicid", "idreport", "report", "errorreport", "select")['idreport'] ?? 0);
    }
    telegram('sendmessage', array_filter(['chat_id' => $chat, 'message_thread_id' => $topic ?: null, 'text' => $html, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true], fn($v) => $v !== null));
}

/** A payment link could not be made for a customer. Never throws (a report must not break the purchase flow). */
function paymentErrorReport($gateway, $userId, $username, $amount, $detail): void
{
    try {
        $gateway = (string) $gateway;
        [$reason, $tip] = paReason($detail, $gateway);
        $s = paState();
        $k = 'err:' . $gateway . ':' . md5($reason);
        $now = time();
        $held = (int) ($s[$k]['held'] ?? 0);
        if ($now - (int) ($s[$k]['sent'] ?? 0) < PA_QUIET) {
            $s[$k]['held'] = $held + 1; // same problem a moment ago: count it, report it with the next alert
            paSave($s);
            return;
        }
        $s[$k] = ['sent' => $now, 'held' => 0];
        paSave($s);
        $raw = is_string($detail) ? $detail : json_encode($detail, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $raw = preg_replace('/(Bearer|token|api[_-]?key)[^,"]{0,80}/i', '$1 …', (string) $raw); // never echo credentials
        $L = ['💳 <b>خطا در ساخت لینک پرداخت</b>', '', '🏦 درگاه: <b>' . htmlspecialchars(paGatewayName($gateway)) . '</b>', '❗️ علت: ' . htmlspecialchars($reason)];
        $L[] = '👤 کاربر: <code>' . htmlspecialchars((string) $userId) . '</code>' . ($username && $username !== 'none' ? ' @' . htmlspecialchars((string) $username) : '');
        if ((int) $amount > 0) {
            $L[] = '💰 مبلغ: ' . number_format((int) $amount) . ' تومان';
        }
        $L[] = '🕒 ' . (function_exists('jdate') ? jdate('Y/m/d H:i', $now, '', 'Asia/Tehran') : date('Y-m-d H:i', $now));
        if ($held > 0) {
            $L[] = '🔁 همین خطا ' . number_format($held) . ' بار دیگر هم در ۱۰ دقیقه قبل رخ داد';
        }
        $L[] = '🔎 <code>' . htmlspecialchars(mb_substr($raw, 0, 300)) . '</code>';
        if ($tip !== '') {
            $L[] = '💡 ' . htmlspecialchars($tip);
        }
        paSend(implode("\n", $L));
    } catch (Throwable $e) {
        error_log('paymentErrorReport: ' . $e->getMessage());
    }
}

/** Is a gateway reachable from the bot (through its proxy when one is set)? [ok, detail] */
function paProbe(string $url, string $proxy = ''): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_NOBODY => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false]);
    if ($proxy !== '' && $proxy !== '0') {
        curl_setopt($ch, CURLOPT_PROXY, $proxy);
        curl_setopt($ch, CURLOPT_NOPROXY, '');
    }
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$code > 0 && $code < 500, $code > 0 ? "HTTP $code" : $err];
}

/** Cron: checks the active gateways; reports when one becomes unreachable (twice in a row) and when it is back. */
function paymentGatewayProbe(): void
{
    $checks = [];
    $token = trim((string) getPaySettingValue('variza_api_token', ''));
    if ($token !== '' && $token !== '0') {
        $checks['variza'] = ['https://variza.ir/', trim((string) getPaySettingValue('variza_proxy', ''))];
    }
    $tetraKey = trim((string) getPaySettingValue('tetraminator_api_key', ''));
    if ($tetraKey !== '' && $tetraKey !== '0' && getPaySettingValue('tetraminator_status', '') === 'ontetraminator') {
        $checks['tetraminator'] = ['https://api.tetraminator.com/', ''];
    }
    $s = paState();
    foreach ($checks as $g => [$url, $proxy]) {
        [$ok, $detail] = paProbe($url, $proxy);
        $st = $s['probe'][$g] ?? ['down' => false, 'fails' => 0, 'since' => 0];
        if ($ok) {
            if (!empty($st['down'])) {
                $mins = max(1, (int) round((time() - (int) $st['since']) / 60));
                paSend("✅ <b>درگاه " . htmlspecialchars(paGatewayName($g)) . " دوباره در دسترس است</b>\n⏱ مدت قطعی: حدود " . number_format($mins) . ' دقیقه');
            }
            $st = ['down' => false, 'fails' => 0, 'since' => 0];
        } else {
            $st['fails'] = (int) $st['fails'] + 1;
            if (empty($st['down']) && $st['fails'] >= 2) {
                $st['down'] = true;
                $st['since'] = time();
                [$reason, $tip] = paReason($detail, $g);
                paSend("🚨 <b>درگاه " . htmlspecialchars(paGatewayName($g)) . " از سرور ربات در دسترس نیست</b>\n❗️ " . htmlspecialchars($reason)
                    . ($proxy !== '' ? "\n🔀 از طریق تونل ایران بررسی شد" : '') . "\n🔎 <code>" . htmlspecialchars($detail) . '</code>'
                    . "\n⚠️ مشتری‌ها با این درگاه نمی‌توانند پرداخت کنند" . ($tip !== '' ? "\n💡 " . htmlspecialchars($tip) : ''));
            }
        }
        $s['probe'][$g] = $st;
    }
    paSave($s);
}

/** One line per failed service creation (storage/order_failures.jsonl) so scripts/failed_orders.php knows exactly what failed. */
function orderFailLog(string $kind, $userId, string $service, $price, string $paymentId, $reason, string $panel = ''): void
{
    $line = json_encode(['at' => time(), 'kind' => $kind, 'user' => (string) $userId, 'service' => $service, 'price' => (int) $price,
        'payment' => $paymentId, 'panel' => $panel, 'reason' => mb_substr(is_string($reason) ? $reason : json_encode($reason, JSON_UNESCAPED_UNICODE), 0, 300)], JSON_UNESCAPED_UNICODE);
    @file_put_contents(__DIR__ . '/storage/order_failures.jsonl', $line . "\n", FILE_APPEND | LOCK_EX);
}
