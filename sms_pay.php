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
    $text = $pick(['text', 'message', 'body', 'sms', 'content', 'msg', 'notification', 'big_text', 'title']);
    if ($text === '' && !is_array($json) && !$post) {
        $text = trim($raw);
    }
    // title + text both can matter (notification: title "بلو", text "واریز...")
    $title = $flat['title'] ?? '';
    if ($text !== '' && $title !== '' && $title !== $text && !str_contains($text, $title)) {
        $text = $title . "\n" . $text;
    }
    $bank = strtolower($pick(['bank', 'bank_code', 'bankcode', 'code']));
    $token = '';
    foreach (['authorization', 'x-admin-token', 'x-token', 'x-api-key'] as $h) {
        if (!empty($headers[$h])) {
            $token = trim(preg_replace('/^Bearer\s+/i', '', $headers[$h]));
            break;
        }
    }
    if ($token === '') {
        $token = $pick(['token', 'admin_token', 'admintoken']) ?: ($query['token'] ?? '');
    }
    return ['text' => $text, 'bank' => $bank, 'token' => $token, 'keys' => array_keys($flat)];
}
