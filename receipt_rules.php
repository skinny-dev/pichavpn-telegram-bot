<?php
// When may a customer send a payment receipt? Pure function (no DB / Telegram), shared by the Variza and card-to-card buttons.
//
// Old rules: Variza = no receipt at all before N minutes (customers stared at "wait X minutes" and gave up),
// card-to-card = any receipt in the last 2 minutes (even for ANOTHER order) blocked the next one.
// New rules: never make a paying customer wait. A Variza receipt sent early is accepted and only marked for the admins
// ("Variza may still confirm it by itself"); flood protection counts receipts per user over 10 minutes instead.

const RECEIPT_SPAM_LIMIT = 3;      // receipts per user ...
const RECEIPT_SPAM_WINDOW = 600;   // ... in this many seconds

/**
 * @param array $order        Payment_report row (payment_Status, time, Payment_Method)
 * @param int   $recent       receipts this user sent in the last RECEIPT_SPAM_WINDOW seconds (all orders)
 * @return array{action:string, early:int}  action: ok|paid|expired|rejected|already|spam; early = minutes Variza may still need (0 = none)
 */
function receiptGate(array $order, int $now, int $varizaDelayMin, int $recent, bool $isAdmin = false): array
{
    $status = (string) ($order['payment_Status'] ?? '');
    $map = ['paid' => 'paid', 'expire' => 'expired', 'reject' => 'rejected', 'waiting' => 'already'];
    if (isset($map[$status])) {
        return ['action' => $map[$status], 'early' => 0];
    }
    if (!$isAdmin && $recent >= RECEIPT_SPAM_LIMIT) {
        return ['action' => 'spam', 'early' => 0];
    }
    $early = 0;
    if (($order['Payment_Method'] ?? '') === 'variza') {
        $t = (string) ($order['time'] ?? '');
        $created = ctype_digit($t) ? (int) $t : (int) strtotime($t);
        $left = $created > 0 ? $created + max(0, $varizaDelayMin) * 60 - $now : 0;
        $early = $left > 0 ? (int) ceil($left / 60) : 0;
    }
    return ['action' => 'ok', 'early' => $early];
}

/** Bot side of receiptGate: counts the user's recent receipts, tells the customer why when refused. true = ask for the photo. */
function receiptAllowed(PDO $pdo, array $order, $userId, bool $isAdmin, array $textbotlang): bool
{
    $q = $pdo->prepare("SELECT COUNT(*) FROM Payment_report WHERE id_user = ? AND at_updated > ? AND payment_Status IN ('waiting','paid','reject')");
    $q->execute([(string) $userId, date('Y/m/d H:i:s', time() - RECEIPT_SPAM_WINDOW)]);
    $delay = intval(select("PaySetting", "ValuePay", "NamePay", "variza_receipt_delay", "select")['ValuePay'] ?? 5);
    $gate = receiptGate($order, time(), $delay, (int) $q->fetchColumn(), $isAdmin);
    $b = $textbotlang['users']['Balance'];
    $msg = [
        'paid' => $b['alreadyConfirmed'],
        'expired' => $b['transactionExpired'],
        'rejected' => $b['varizaReceiptRejected'] ?? '❌ این پرداخت رد شده است.',
        'already' => $b['varizaReceiptWaiting'] ?? '✅ رسید شما قبلاً ثبت شده است.',
        'spam' => $b['receiptTooMany'] ?? $b['receiptCooldown'],
    ][$gate['action']] ?? null;
    if ($msg !== null) {
        sendmessage($userId, $msg, null, 'HTML');
        return false;
    }
    return true;
}
