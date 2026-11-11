<?php
/*
 * Pending-payment watch: ask the gateway (the truth) about orders that are still open on our side, deliver the ones that
 * are really paid, and tell the report group about anything a person has to look at, so the customer is not left waiting.
 *
 *   pendingWatchRun($pdo, ['hours' => 24, 'deliver' => true, 'alert' => true])  -> list of findings
 *
 * Tetraminator can be asked about an order at any time (inquiry), so those are settled automatically (atomic claim, delivered
 * once; the same path as the «پرداخت کردم» button). Variza has no inquiry here: its orders are only reported (paid-undelivered
 * and long-waiting) for a person to check in the Variza panel. Nothing here changes an order the gateway does not confirm.
 */

require_once __DIR__ . '/tetraminator.php';

const PW_STATE = __DIR__ . '/storage/pending_watch.json';

function pwState(): array
{
    $s = is_file(PW_STATE) ? json_decode((string) @file_get_contents(PW_STATE), true) : null;
    return is_array($s) ? $s : [];
}

function pwSave(array $s): void
{
    @mkdir(dirname(PW_STATE), 0775, true);
    // keep the file small: forget orders older than 10 days
    $cut = time() - 10 * 86400;
    $s = array_filter($s, fn($v) => (int) ($v['at'] ?? 0) >= $cut);
    @file_put_contents(PW_STATE, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function pwTime($v): int
{
    if (ctype_digit((string) $v)) {
        return (int) $v;
    }
    $t = DateTime::createFromFormat('Y/m/d H:i:s', (string) $v, new DateTimeZone('Asia/Tehran'));
    return $t ? $t->getTimestamp() : (strtotime((string) $v) ?: 0);
}

/**
 * @param array $o hours (default 24), deliver (settle Tetraminator orders the gateway confirms), alert (post to the report group),
 *                 wait (minutes before a still-unpaid order is mentioned, default 15), limit (max inquiries per run, default 40)
 * @return array[] findings: [order, user, amount, method, status, age_min, kind, note]
 *   kind: delivered | paid_undelivered | amount_mismatch | delivery_failed | waiting_long | receipt_waiting | inquiry_error
 */
function pendingWatchRun(PDO $pdo, array $o = []): array
{
    $hours = (float) ($o['hours'] ?? 24);
    $deliver = !empty($o['deliver']);
    $alert = !empty($o['alert']);
    $waitMin = (int) ($o['wait'] ?? 15);
    $limit = (int) ($o['limit'] ?? 40);
    $since = time() - (int) round($hours * 3600);
    $now = time();
    $out = [];

    $rows = $pdo->query("SELECT * FROM Payment_report WHERE Payment_Method IN ('tetraminator','variza')
                         AND payment_Status IN ('Unpaid','waiting','expire','paid') ORDER BY time DESC LIMIT 600")->fetchAll(PDO::FETCH_ASSOC);
    $asked = 0;
    foreach ($rows as $p) {
        $t = pwTime($p['time']);
        if ($t < $since) {
            continue;
        }
        $age = (int) round(($now - $t) / 60);
        $base = ['order' => $p['id_order'], 'user' => (string) $p['id_user'], 'amount' => (int) $p['price'], 'method' => $p['Payment_Method'],
            'status' => $p['payment_Status'], 'age_min' => $age];
        $status = $p['payment_Status'];

        if ($p['Payment_Method'] === 'tetraminator' && $status !== 'paid') {
            if ($asked >= $limit) {
                continue;
            }
            $asked++;
            if (!$deliver) {
                $inq = tetraminatorInquiry(trim((string) $p['dec_not_confirmed']));
                if (!$inq['ok']) {
                    $out[] = $base + ['kind' => 'inquiry_error', 'note' => $inq['error']];
                } elseif ($inq['paid']) {
                    $out[] = $base + ['kind' => $inq['amount'] >= (int) $p['price'] ? 'paid_undelivered' : 'amount_mismatch', 'note' => 'پول در درگاه تأیید شده: ' . number_format($inq['amount'])];
                }
                continue;
            }
            $r = tetraminatorSettle($pdo, $p, fn($id) => DirectPayment($id));
            switch ($r['result']) {
                case 'paid':
                    $out[] = $base + ['kind' => 'delivered', 'note' => 'درگاه تأیید کرد و سرویس تحویل شد'];
                    try {
                        $tb = languagechange();
                        tetraminatorAfterPaid($p, $r, $tb);
                    } catch (Throwable $e) {
                        error_log('pending_watch: after-paid: ' . $e->getMessage());
                    }
                    break;
                case 'delivery_failed':
                    $out[] = $base + ['kind' => 'delivery_failed', 'note' => 'پول رسیده ولی تحویل خطا داد: ' . ($r['error'] ?? '')];
                    break;
                case 'amount_mismatch':
                    $out[] = $base + ['kind' => 'amount_mismatch', 'note' => 'پرداخت‌شده ' . number_format((int) $r['amount']) . ' از فاکتور ' . number_format((int) $r['billed']) . ' کمتر است'];
                    break;
                case 'unpaid':
                    if (in_array($status, ['Unpaid', 'waiting'], true) && $age >= $waitMin) {
                        $out[] = $base + ['kind' => 'waiting_long', 'note' => 'هنوز پرداختی در درگاه نیست'];
                    }
                    break;
                case 'error':
                    $out[] = $base + ['kind' => 'inquiry_error', 'note' => (string) ($r['error'] ?? '')];
                    break;
            }
            continue;
        }

        if ($p['Payment_Method'] === 'variza') {
            if ($status === 'waiting') {
                $out[] = $base + ['kind' => 'receipt_waiting', 'note' => 'رسید فرستاده؛ منتظر تأیید ادمین'];
            } elseif ($status === 'Unpaid' && $age >= $waitMin) {
                $out[] = $base + ['kind' => 'waiting_long', 'note' => 'تأییدی از واریزا نرسیده؛ در پنل واریزا چک کنید'];
            }
        }
    }

    if ($alert && $out) {
        pwAlert($out);
    }
    return $out;
}

/** one message per new finding set; an order is mentioned once per kind */
function pwAlert(array $findings): void
{
    $state = pwState();
    $fresh = [];
    foreach ($findings as $f) {
        if ($f['kind'] === 'inquiry_error') {
            continue;
        }
        $key = $f['order'] . ':' . $f['kind'];
        if (isset($state[$key])) {
            continue;
        }
        $state[$key] = ['at' => time()];
        $fresh[] = $f;
    }
    if (!$fresh) {
        return;
    }
    $setting = select("setting", "*");
    $topic = select("topicid", "idreport", "report", "paymentreport", "select")['idreport'] ?? null;
    if (empty($setting['Channel_Report']) || !$topic) {
        pwSave($state);
        return;
    }
    $label = ['delivered' => '✅ خودکار تحویل شد', 'paid_undelivered' => '🚨 پول رسیده، تحویل نشده', 'amount_mismatch' => '⚠️ مبلغ نامطابق',
        'delivery_failed' => '🚨 پول رسیده، تحویل خطا داد', 'waiting_long' => '⏳ مشتری منتظر است', 'receipt_waiting' => '🧾 رسید منتظر تأیید'];
    $lines = [];
    foreach ($fresh as $f) {
        $lines[] = ($label[$f['kind']] ?? $f['kind']) . "\n"
            . "🧾 <code>{$f['order']}</code> · " . number_format($f['amount']) . " تومان · " . ($f['method'] === 'tetraminator' ? 'تترامینیتور' : 'واریزا') . "\n"
            . "👤 <code>{$f['user']}</code> · {$f['age_min']} دقیقه پیش\n" . $f['note'];
    }
    foreach (array_chunk($lines, 6) as $chunk) {
        telegram('sendmessage', ['chat_id' => $setting['Channel_Report'], 'message_thread_id' => $topic,
            'text' => "💳 <b>پرداخت‌های نیازمند بررسی</b>\n\n" . implode("\n\n", $chunk) . "\n\nپنل ← پرداخت‌های معلق", 'parse_mode' => 'HTML']);
    }
    pwSave($state);
}
