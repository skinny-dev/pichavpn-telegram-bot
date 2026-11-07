<?php
// «پرداخت‌های معلق»: payments that need a human — waiting for Variza / a receipt review, expired, rejected,
// and the dangerous kind: paid but the order / renewal was never delivered.

/** Purpose of a Payment_report row from its id_invoice ("getconfigafterpay|user", "getextenduser|user%value", ...). */
function picha_pay_purpose(string $idInvoice): array
{
    $p = explode('|', $idInvoice, 2);
    $map = ['refunded' => 'refunded', 'getconfigafterpay' => 'new', 'getextenduser' => 'renew', 'getextravolumeuser' => 'volume', 'getextratimeuser' => 'time'];
    $kind = $map[$p[0]] ?? 'topup';
    $target = '';
    $value = '';
    if ($kind !== 'topup') {
        $rest = explode('%', (string) ($p[1] ?? ''), 2);
        $target = (string) $rest[0];
        $value = (string) ($rest[1] ?? '');
    }
    return ['kind' => $kind, 'target' => $target, 'value' => $value];
}

/** Was a paid payment actually delivered? true / false / null (= cannot tell automatically). */
function picha_pay_delivered(PDO $pdo, array $row, array $purpose): ?bool
{
    if ($purpose['kind'] === 'new') {
        $q = $pdo->prepare("SELECT Status FROM invoice WHERE username = ? ORDER BY CAST(time_sell AS UNSIGNED) DESC LIMIT 1");
        $q->execute([$purpose['target']]);
        $st = $q->fetchColumn();
        return $st === false ? false : in_array(strtolower((string) $st), ['active', 'sendedwarn', 'send_on_hold', 'end_of_time', 'end_of_volume', 'disabled', 'disablebyadmin'], true);
    }
    if ($purpose['kind'] === 'renew') {
        $q = $pdo->prepare("SELECT status FROM service_other WHERE username = ? AND id_user = ? AND value LIKE CONCAT('%', ?, '%') ORDER BY id DESC LIMIT 1");
        $q->execute([$purpose['target'], (string) $row['id_user'], $purpose['value']]);
        $st = $q->fetchColumn();
        return $st === false ? null : strtolower((string) $st) === 'paid';
    }
    return null;
}

function picha_pay_pending(PDO $pdo, int $days): array
{
    $days = max(1, min(60, $days));
    $since = date('Y/m/d', time() - $days * 86400);
    $q = $pdo->prepare("SELECT p.id, p.id_order, p.id_user, p.time, p.price, p.payment_Status, p.Payment_Method, p.id_invoice, p.dec_not_confirmed, u.username AS tg_username, u.namecustom
        FROM Payment_report p LEFT JOIN user u ON u.id = p.id_user
        WHERE p.`time` >= ? AND (p.payment_Status IN ('Unpaid','waiting','expire','reject') OR (p.payment_Status = 'paid' AND p.id_invoice REGEXP '^get(configafterpay|extenduser|extravolumeuser|extratimeuser)\\\\|'))
        ORDER BY p.id DESC LIMIT 500");
    $q->execute([$since]);
    $rows = [];
    $counts = ['not_delivered' => 0, 'waiting' => 0, 'unpaid' => 0, 'expire' => 0, 'reject' => 0];
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $purpose = picha_pay_purpose((string) $r['id_invoice']);
        $status = (string) $r['payment_Status'];
        if ($status === 'paid') {
            if (picha_pay_delivered($pdo, $r, $purpose) !== false) {
                continue; // paid and delivered (or not checkable): nothing to do
            }
            $problem = 'not_delivered';
        } else {
            $problem = ['Unpaid' => 'unpaid', 'waiting' => 'waiting', 'expire' => 'expire', 'reject' => 'reject'][$status];
        }
        $counts[$problem]++;
        $rows[] = [
            'id_order' => (string) $r['id_order'], 'time' => (string) $r['time'], 'id_user' => (string) $r['id_user'],
            'user' => (string) ($r['namecustom'] ?: ($r['tg_username'] && $r['tg_username'] !== 'none' ? '@' . $r['tg_username'] : $r['id_user'])),
            'price' => (int) $r['price'], 'method' => (string) $r['Payment_Method'], 'status' => $status, 'problem' => $problem,
            'kind' => $purpose['kind'], 'target' => $purpose['target'],
            'ref' => in_array($r['Payment_Method'], ['variza', 'tetraminator'], true) ? (string) $r['dec_not_confirmed'] : '',
        ];
    }
    return ['rows' => $rows, 'counts' => $counts, 'days' => $days];
}

/**
 * Admin confirms a payment from the panel (same as «تایید پرداخت» in the bot): claim it, then deliver.
 * For a payment that is already paid but whose NEW order was never delivered, only the delivery is retried
 * (DirectPayment is idempotent for new orders; renewals are never re-run automatically to avoid a double extension).
 */
function picha_pay_confirm(PDO $pdo, string $orderId, bool $allowRejected): array
{
    $q = $pdo->prepare("SELECT * FROM Payment_report WHERE id_order = ?");
    $q->execute([$orderId]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new PichaError('پرداخت پیدا نشد', 404);
    }
    $purpose = picha_pay_purpose((string) $row['id_invoice']);
    if ($purpose['kind'] === 'refunded') {
        throw new PichaError('این پرداخت قبلاً به کیف پول مشتری برگشت داده شده (سفارشش ساخته نشد یا حذف شده بود)', 409);
    }
    if ($row['payment_Status'] === 'paid') {
        if ($purpose['kind'] !== 'new') {
            throw new PichaError('این پرداخت قبلاً تأیید شده؛ تمدید/افزایش را دستی در پنل VPN انجام دهید (برای جلوگیری از دوبار تمدید، خودکار تکرار نمی‌شود)', 409);
        }
        if (picha_pay_delivered($pdo, $row, $purpose)) {
            throw new PichaError('این سفارش قبلاً تحویل شده است', 409);
        }
    } else {
        if ($row['payment_Status'] === 'reject' && !$allowRejected) {
            throw new PichaError('این پرداخت قبلاً رد شده؛ اگر مطمئنید پول رسیده، دوباره با تأیید «رد شده» بزنید', 409);
        }
        $claim = $pdo->prepare("UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ? AND payment_Status <> 'paid'");
        $claim->execute([$orderId]);
        if ($claim->rowCount() === 0) {
            throw new PichaError('این پرداخت هم‌زمان توسط ادمین دیگری تأیید شد', 409);
        }
    }
    picha_bot_layer();
    $cwd = getcwd();
    try {
        chdir(dirname(__DIR__)); // the bot code uses paths relative to its own folder
        DirectPayment($orderId, dirname(__DIR__) . '/images.jpg');
    } catch (Throwable $e) {
        error_log('panel pay_confirm: DirectPayment failed for ' . $orderId . ': ' . $e->getMessage());
        throw new PichaError('پرداخت تأیید شد ولی تحویل سرویس خطا داد: ' . $e->getMessage(), 502);
    } finally {
        chdir($cwd);
    }
    $after = $pdo->prepare("SELECT * FROM Payment_report WHERE id_order = ?");
    $after->execute([$orderId]);
    $delivered = picha_pay_delivered($pdo, $after->fetch(PDO::FETCH_ASSOC) ?: $row, $purpose);
    return ['ok' => true, 'kind' => $purpose['kind'], 'delivered' => $delivered];
}
