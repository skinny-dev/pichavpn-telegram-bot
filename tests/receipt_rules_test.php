<?php
// php tests/receipt_rules_test.php
require __DIR__ . '/../receipt_rules.php';
$f = 0;
function t($n, $c) { global $f; echo ($c ? 'PASS ' : 'FAIL ') . $n . "\n"; if (!$c) $f++; }
date_default_timezone_set('Asia/Tehran');
$now = strtotime('2026-10-13 12:00:00');
$o = fn($st, $m, $t) => ['payment_Status' => $st, 'Payment_Method' => $m, 'time' => $t];
$g = receiptGate($o('Unpaid', 'variza', '2026/10/13 11:59:00'), $now, 5, 0);
t('variza receipt 1 min after order is ACCEPTED (no forced wait), flagged 4 min early', $g['action'] === 'ok' && $g['early'] === 4);
t('variza after the delay: ok, not early', receiptGate($o('Unpaid', 'variza', '2026/10/13 11:50:00'), $now, 5, 0) === ['action' => 'ok', 'early' => 0]);
t('card to card never early', receiptGate($o('Unpaid', 'cart to cart', '2026/10/13 11:59:59'), $now, 5, 0) === ['action' => 'ok', 'early' => 0]);
t('a receipt for ANOTHER order a minute ago no longer blocks (2 recent < limit)', receiptGate($o('Unpaid', 'cart to cart', '2026/10/13 11:00:00'), $now, 5, 2)['action'] === 'ok');
t('flood: 3 receipts in 10 min -> spam', receiptGate($o('Unpaid', 'cart to cart', '2026/10/13 11:00:00'), $now, 5, 3)['action'] === 'spam');
t('admins are never rate limited', receiptGate($o('Unpaid', 'variza', '2026/10/13 11:00:00'), $now, 5, 9, true)['action'] === 'ok');
t('paid / expired / rejected / already sent', receiptGate($o('paid', 'variza', ''), $now, 5, 0)['action'] === 'paid' && receiptGate($o('expire', 'variza', ''), $now, 5, 0)['action'] === 'expired'
    && receiptGate($o('reject', 'cart to cart', ''), $now, 5, 0)['action'] === 'rejected' && receiptGate($o('waiting', 'variza', ''), $now, 5, 0)['action'] === 'already');
t('unix-time order time also works', receiptGate($o('Unpaid', 'variza', (string) ($now - 60)), $now, 5, 0)['early'] === 4);
exit($f ? 1 : 0);
