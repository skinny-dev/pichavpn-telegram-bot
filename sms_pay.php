<?php
/*
 * Card-to-card auto approval from bank SMS (Blu "واریز پول" messages forwarded by
 * the Android SMS-forwarder app). Pure helpers first, DB/side effects below.
 */

const SMS_STATUS_OPEN = ['Unpaid', 'waiting'];

function smsNormalizeDigits(string $s): string
{
    return strtr($s, [
        '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
        '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
        '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        '٬' => ',', '،' => ',',
    ]);
}

/** @return array{kind:string,amount_rial:int,balance_rial:?int,sms_time:?string}|null */
function smsParse(string $text): ?array
{
    $t = smsNormalizeDigits($text);
    $kind = null;
    if (preg_match('/به\s*حساب\s*شما\s*نشست|واریز\s*پول/u', $t)) {
        $kind = 'deposit';
    }
    if (preg_match('/از\s*حساب\s*شما\s*پرید|برداشت\s*پول/u', $t)) {
        $kind = $kind === 'deposit' ? null : 'withdraw'; // contradictory text: refuse
    }
    if ($kind === null) {
        return null;
    }
    // first "<number> ریال" is the amount; the one after «موجودی» is the balance
    $body = preg_replace('/موجودی.*$/us', '', $t);
    if (!preg_match('/(\d[\d,]*)\s*ریال/u', $body, $m)) {
        return null;
    }
    $amount = (int) str_replace(',', '', $m[1]);
    if ($amount <= 0) {
        return null;
    }
    $balance = null;
    if (preg_match('/موجودی\s*:?\s*(\d[\d,]*)/u', $t, $b)) {
        $balance = (int) str_replace(',', '', $b[1]);
    }
    $time = null;
    if (preg_match('/(\d{1,2}):(\d{2})/', $t, $tm)) {
        $time = sprintf('%02d:%s', (int) $tm[1], $tm[2]);
        if (preg_match('/(\d{4})[.\/-](\d{2})[.\/-](\d{2})/', $t, $d)) {
            $time = "$d[1]/$d[2]/$d[3] $time";
        }
    }
    return ['kind' => $kind, 'amount_rial' => $amount, 'balance_rial' => $balance, 'sms_time' => $time];
}

function smsWindowSeconds(PDO $pdo): int
{
    $st = $pdo->prepare("SELECT ValuePay FROM PaySetting WHERE NamePay = 'sms_match_window'");
    $st->execute();
    $v = $st->fetchColumn();
    return max(10, (int) ($v === false ? 180 : $v)) * 60;
}

function smsReportTs(array $row): int
{
    $t = (string) ($row['time'] ?? '');
    return ctype_digit($t) ? (int) $t : (int) strtotime($t);
}

/** Open card-to-card reports whose price equals $toman and are still inside the window. */
function smsOpenReports(PDO $pdo, ?int $toman = null, ?int $now = null): array
{
    $now = $now ?? time();
    $win = smsWindowSeconds($pdo);
    $st = $pdo->prepare("SELECT * FROM Payment_report WHERE Payment_Method = 'cart to cart' AND payment_Status IN ('Unpaid','waiting')");
    $st->execute();
    $out = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
        $ts = smsReportTs($r);
        if ($ts <= 0 || $now - $ts > $win) {
            continue;
        }
        if ($toman !== null && (int) $r['price'] !== $toman) {
            continue;
        }
        $out[] = $r;
    }
    return $out;
}

/** Base toman amount + a random 1..999 offset that no other open order uses. */
function smsUniqueAmount(PDO $pdo, int $base): int
{
    $used = [];
    foreach (smsOpenReports($pdo) as $r) {
        $used[(int) $r['price']] = true;
    }
    $free = [];
    for ($o = 1; $o <= 999; $o++) {
        if (!isset($used[$base + $o])) {
            $free[] = $o;
        }
    }
    if (!$free) {
        return $base + random_int(1000, 9999);
    }
    return $base + $free[random_int(0, count($free) - 1)];
}

/**
 * Store + match one SMS. Returns ['status'=>..., 'order'=>row|null, 'duplicate'=>bool].
 * Statuses: ignored (not a deposit / unparsable), unmatched, ambiguous,
 * review (matched but not safely approvable), matched.
 * Approval itself is injected so tests do not need Telegram/panels.
 */
function smsProcess(PDO $pdo, string $text, string $bank, callable $approve, ?int $now = null): array
{
    $now = $now ?? time();
    $fp = sha1(smsNormalizeDigits(trim($text)) . '|' . strtolower($bank));
    $parsed = smsParse($text);

    $ins = $pdo->prepare("INSERT IGNORE INTO sms_inbox (fingerprint,received_at,bank,kind,amount_rial,balance_rial,sms_time,status,note) VALUES (?,?,?,?,?,?,?,?,?)");
    $kind = $parsed['kind'] ?? 'unknown';
    $status = $parsed === null ? 'ignored' : ($kind === 'deposit' ? 'unmatched' : 'ignored');
    $ins->execute([$fp, $now, $bank, $kind, $parsed['amount_rial'] ?? 0, $parsed['balance_rial'] ?? null, $parsed['sms_time'] ?? null, $status, null]);
    if ($ins->rowCount() === 0) {
        return ['status' => 'duplicate', 'order' => null, 'duplicate' => true, 'parsed' => $parsed];
    }
    $id = (int) $pdo->lastInsertId();
    $set = function (string $st, ?string $order = null, ?string $note = null) use ($pdo, $id): void {
        $pdo->prepare("UPDATE sms_inbox SET status = ?, id_order = ?, note = ? WHERE id = ?")->execute([$st, $order, $note, $id]);
    };
    if ($parsed === null || $kind !== 'deposit') {
        return ['status' => 'ignored', 'order' => null, 'duplicate' => false, 'parsed' => $parsed];
    }
    if ($parsed['amount_rial'] % 10 !== 0) {
        $set('review', null, 'amount not a whole toman');
        return ['status' => 'review', 'order' => null, 'duplicate' => false, 'parsed' => $parsed];
    }
    $toman = intdiv($parsed['amount_rial'], 10);
    $cands = smsOpenReports($pdo, $toman, $now);
    if (count($cands) === 0) {
        $set('unmatched');
        return ['status' => 'unmatched', 'order' => null, 'duplicate' => false, 'parsed' => $parsed];
    }
    if (count($cands) > 1) {
        $set('ambiguous', null, count($cands) . ' open orders with this amount');
        return ['status' => 'ambiguous', 'order' => null, 'duplicate' => false, 'parsed' => $parsed];
    }
    $order = $cands[0];
    // atomic claim: only one SMS / admin / cron may flip it
    $claim = $pdo->prepare("UPDATE Payment_report SET payment_Status = 'paid', dec_not_confirmed = ? WHERE id_order = ? AND payment_Status IN ('Unpaid','waiting')");
    $claim->execute(['تأیید خودکار با پیامک بانک', $order['id_order']]);
    if ($claim->rowCount() === 0) {
        $set('review', $order['id_order'], 'order changed concurrently');
        return ['status' => 'review', 'order' => $order, 'duplicate' => false, 'parsed' => $parsed];
    }
    $set('matched', $order['id_order']);
    $approve($order);
    return ['status' => 'matched', 'order' => $order, 'duplicate' => false, 'parsed' => $parsed];
}

/** Pull the SMS text / bank / token out of whatever the forwarder sends. */
function smsExtractPayload(string $raw, array $post, array $query, array $headers): array
{
    $data = [];
    $json = json_decode($raw, true);
    if (is_array($json)) {
        $data = $json;
    } elseif ($post) {
        $data = $post;
    }
    $flat = [];
    $walk = function ($v, string $k = '') use (&$walk, &$flat): void {
        if (is_array($v)) {
            foreach ($v as $kk => $vv) {
                $walk($vv, strtolower((string) $kk));
            }
        } elseif ($k !== '') {
            $flat[$k] = (string) $v;
        }
    };
    $walk($data);
    $pick = function (array $keys) use ($flat): string {
        foreach ($keys as $k) {
            if (isset($flat[$k]) && $flat[$k] !== '') {
                return $flat[$k];
            }
        }
        return '';
    };
    // Mirza SMS Forwarder style: {"<token>_<bank>": "<sms text>"}
    $keyToken = '';
    $keyBank = '';
    $keyText = '';
    foreach ($flat as $k => $v) {
        if (preg_match('/^([a-z0-9]{16,})_([a-z0-9]{2,20})$/', $k, $km) && $v !== '') {
            [$keyToken, $keyBank, $keyText] = [$km[1], $km[2], $v];
            break;
        }
    }
    $text = $keyText !== '' ? $keyText : $pick(['text', 'message', 'body', 'sms', 'content', 'msg', 'notification', 'big_text', 'title']);
    if ($text === '' && !is_array($json) && !$post) {
        $text = trim($raw);
    }
    // title + text both can matter (notification: title "بلو", text "واریز...")
    $title = $flat['title'] ?? '';
    if ($text !== '' && $title !== '' && $title !== $text && !str_contains($text, $title)) {
        $text = $title . "\n" . $text;
    }
    $bank = $keyBank !== '' ? $keyBank : strtolower($pick(['bank', 'bank_code', 'bankcode', 'code']));
    $token = $keyToken;
    foreach ($token !== '' ? [] : ['authorization', 'x-admin-token', 'x-token', 'x-api-key'] as $h) {
        if (!empty($headers[$h])) {
            $token = trim(preg_replace('/^Bearer\s+/i', '', $headers[$h]));
            break;
        }
    }
    if ($token === '') {
        $token = $pick(['token', 'admin_token', 'admintoken']) ?: ($query['token'] ?? '');
    }
    // never let a token-looking field name reach the logs
    $keys = array_map(fn($k) => preg_replace('/^[a-z0-9]{16,}(?=_)/', '<token>', (string) $k), array_keys($flat));
    return ['text' => $text, 'bank' => $bank, 'token' => $token, 'keys' => $keys];
}

/**
 * Catch-up: the customer pressed "I paid" (or an admin asked) and the matching deposit
 * SMS already arrived earlier and is still unclaimed in sms_inbox. Only a single,
 * unclaimed deposit of exactly this amount, received no more than 15 minutes before the
 * order was created, and within the last 24h, is accepted.
 * @return bool true when the order was approved
 */
function smsReconcileOrder(PDO $pdo, array $order, callable $approve, ?int $now = null): bool
{
    $now = $now ?? time();
    if (($order['Payment_Method'] ?? '') !== 'cart to cart' || !in_array($order['payment_Status'] ?? '', SMS_STATUS_OPEN, true)) {
        return false;
    }
    $ots = smsReportTs($order);
    if ($ots <= 0) {
        return false;
    }
    $rial = (int) $order['price'] * 10;
    $st = $pdo->prepare("SELECT id FROM sms_inbox WHERE kind = 'deposit' AND status = 'unmatched' AND amount_rial = ? AND received_at >= ? AND received_at >= ? ORDER BY id DESC");
    $st->execute([$rial, $ots - 900, $now - 86400]);
    $ids = $st->fetchAll(PDO::FETCH_COLUMN);
    if (count($ids) !== 1) {
        return false;
    }
    // the same amount must not be wanted by another open order
    if (count(smsOpenReports($pdo, (int) $order['price'], $now)) !== 1) {
        return false;
    }
    $c1 = $pdo->prepare("UPDATE sms_inbox SET status = 'matched', id_order = ?, note = 'catch-up' WHERE id = ? AND status = 'unmatched'");
    $c1->execute([$order['id_order'], $ids[0]]);
    if ($c1->rowCount() === 0) {
        return false;
    }
    $c2 = $pdo->prepare("UPDATE Payment_report SET payment_Status = 'paid', dec_not_confirmed = ? WHERE id_order = ? AND payment_Status IN ('Unpaid','waiting')");
    $c2->execute(['تأیید خودکار با پیامک بانک (دریافت قبل از ثبت درخواست)', $order['id_order']]);
    if ($c2->rowCount() === 0) {
        $pdo->prepare("UPDATE sms_inbox SET status = 'unmatched', id_order = NULL, note = NULL WHERE id = ?")->execute([$ids[0]]);
        return false;
    }
    $approve($order);
    return true;
}

/** Credit the wallet / deliver the service for an auto-approved order and tell the report group. */
function smsApproveOrder(array $order): void
{
    global $textbotlang, $setting;
    DirectPayment($order['id_order'], __DIR__ . "/images.jpg");
    $cash = select("PaySetting", "ValuePay", "NamePay", "chashbackcart", "select")['ValuePay'] ?? '0';
    $user = select("user", "*", "id", $order['id_user'], "select");
    if ($cash != "0" && $user) {
        $bonus = ($order['price'] * $cash) / 100;
        update("user", "Balance", intval($user['Balance']) + $bonus, "id", $user['id']);
        sendmessage($user['id'], sprintf($textbotlang['users']['Balance']['giftDeposit'], $bonus), null, 'HTML');
    }
    if (strlen($setting['Channel_Report'] ?? '') > 0) {
        $topic = select("topicid", "idreport", "report", "paymentreport", "select")['idreport'] ?? null;
        $args = ['chat_id' => $setting['Channel_Report'], 'parse_mode' => 'HTML',
            'text' => "✅ پرداخت کارت‌به‌کارت با پیامک بانک تأیید شد\n👤 کاربر: <code>{$order['id_user']}</code>\n💰 مبلغ: " . number_format((int) $order['price']) . " تومان\n🧾 سفارش: <code>{$order['id_order']}</code>"];
        if ($topic) {
            $args['message_thread_id'] = $topic;
        }
        telegram('sendmessage', $args);
    }
}

/** Store a deposit SMS as unclaimed (admin import of a missed message). Returns the parsed deposit or null. */
function smsStoreUnclaimed(PDO $pdo, string $text, string $bank = 'blu', ?int $now = null): ?array
{
    $parsed = smsParse($text);
    if ($parsed === null || $parsed['kind'] !== 'deposit') {
        return null;
    }
    $fp = sha1(smsNormalizeDigits(trim($text)) . '|' . strtolower($bank));
    $ins = $pdo->prepare("INSERT IGNORE INTO sms_inbox (fingerprint,received_at,bank,kind,amount_rial,balance_rial,sms_time,status,note) VALUES (?,?,?,?,?,?,?,'unmatched','imported')");
    $ins->execute([$fp, $now ?? time(), $bank, 'deposit', $parsed['amount_rial'], $parsed['balance_rial'], $parsed['sms_time']]);
    return $ins->rowCount() === 1 ? $parsed : null;
}
