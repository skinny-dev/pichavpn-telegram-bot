<?php
// Bridge from the bot's existing accounting data into the ledger. Idempotent and safe to run any time:
//   expenses            -> Dr expense account (by kind)            / Cr «unspecified account»      (legacy_expense:<id>)
//   capital_entries     -> Dr «unspecified account»                / Cr capital                    (legacy_capital:<id>)
//   Payment_report cost / capital_injection (Mirza-Pro rows)       same as above                   (legacy_cost:<id>, legacy_capital:p<id>)
//   Payment_report paid customer payments (cash received)          Dr money account by method / Cr sales revenue (legacy_payment:<id>)
//   'low balance by admin' (wallet withdrawal)                     Dr sales returns / Cr unspecified (legacy_payment:<id>)
// Policy (same as the bot's «آمار»): revenue is recognised when the customer's money arrives (wallet top-ups, admin-registered
// sales); internal wallet spending, admin gifts and expenses are not revenue. Rows that cannot be understood are listed, not guessed.
// Edited legacy rows are reversed and re-posted; deleted ones are reversed.

require_once __DIR__ . '/engine.php';
if (!function_exists('accGuessKind')) {
    require_once __DIR__ . '/../stats_report.php';
}

function finLegacyKindAccount(string $kind): string
{
    return ['purchase' => 'cogs', 'salary' => 'exp_salary', 'advertising' => 'exp_advertising', 'server' => 'exp_server', 'tools' => 'exp_tools', 'fee' => 'exp_fee',
        'tax' => 'exp_tax', 'general' => 'exp_general', 'dividend' => 'dividends'][$kind] ?? 'exp_general';
}

/** which money account a customer payment method lands in (system_key) */
function finMethodAccount(string $method): string
{
    $m = strtolower($method);
    if (in_array($m, ['manual invoice', 'add order by admin', 'extend by admin'], true)) {
        return 'cash';
    }
    if (strpos($m, 'cart') !== false || strpos($m, 'card') !== false) {
        return 'bank_main';
    }
    if (preg_match('/plisio|nowpay|arze|crypto|trx|ton|usdt/', $m)) {
        return 'crypto';
    }
    if (preg_match('/zarinpal|aqaye|tetra|iranpay|variza|star|after pay|nextpay|idpay|payping|gateway|digi/', $m)) {
        return 'gateway';
    }
    return 'legacy_cash';
}

function finLegacyEntry(PDO $pdo, string $type, string $id, string $hash, array $lines, int $ts, string $memo, array &$stats): void
{
    $find = $pdo->prepare("SELECT id, source_hash FROM fin_journal WHERE source_type = ? AND source_id = ? AND status = 'posted' ORDER BY id DESC LIMIT 1");
    $find->execute([$type, $id]);
    $cur = $find->fetch(PDO::FETCH_ASSOC);
    if ($cur && $cur['source_hash'] === $hash) {
        return;
    }
    try {
        if ($cur) {
            finReverseEntry($pdo, (int) $cur['id'], 'ویرایش در سیستم قدیمی', 'sync');
            $stats['reposted']++;
        } else {
            $stats[$type]++;
        }
        finPostEntry($pdo, ['date' => $ts, 'memo' => $memo, 'lines' => $lines, 'source_type' => $type, 'source_id' => $id, 'source_key' => $type . ':' . $id . ':' . substr($hash, 0, 10), 'source_hash' => $hash, 'user' => 'sync']);
    } catch (Throwable $e) {
        $stats['issues'][] = "{$type} #{$id}: " . $e->getMessage();
    }
}

/** @return array counters + 'issues' (rows that could not be understood) */
function finSyncLegacy(PDO $pdo, int $limit = 20000): array
{
    $stats = ['legacy_expense' => 0, 'legacy_capital' => 0, 'legacy_cost' => 0, 'legacy_payment' => 0, 'reposted' => 0, 'reversed' => 0, 'issues' => []];
    $pdo->exec("SET time_zone = '+03:30'");
    $has = function (string $t) use ($pdo) {
        return (bool) $pdo->query("SHOW TABLES LIKE " . $pdo->quote($t))->fetchColumn();
    };
    $seen = ['legacy_expense' => [], 'legacy_capital' => []];

    if ($has('expenses')) {
        $hasKind = (bool) $pdo->query("SHOW COLUMNS FROM expenses LIKE 'kind'")->fetchColumn();
        foreach ($pdo->query("SELECT * FROM expenses ORDER BY id LIMIT $limit")->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $amount = (int) $r['amount'];
            $seen['legacy_expense'][(string) $r['id']] = true;
            if ($amount <= 0) {
                $stats['issues'][] = "هزینه #{$r['id']} مبلغ صفر/منفی دارد و ثبت نشد";
                continue;
            }
            $kind = $hasKind && $r['kind'] !== '' && $r['kind'] !== null ? (string) $r['kind'] : 'general';
            $acct = finLegacyKindAccount($kind);
            $hash = md5($amount . '|' . $kind . '|' . $r['created_at'] . '|' . $r['description']);
            $lines = $kind === 'dividend' ? [['account' => 'dividends', 'debit' => $amount], ['account' => 'legacy_cash', 'credit' => $amount]]
                                          : [['account' => $acct, 'debit' => $amount, 'memo' => $r['description']], ['account' => 'legacy_cash', 'credit' => $amount]];
            finLegacyEntry($pdo, 'legacy_expense', (string) $r['id'], $hash, $lines, (int) $r['created_at'], trim((string) $r['description']) !== '' ? (string) $r['description'] : 'هزینه', $stats);
        }
    }
    if ($has('capital_entries')) {
        foreach ($pdo->query("SELECT * FROM capital_entries ORDER BY id LIMIT $limit")->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $amount = (int) $r['amount'];
            $seen['legacy_capital'][(string) $r['id']] = true;
            if ($amount <= 0) {
                $stats['issues'][] = "ورود سرمایه #{$r['id']} مبلغ صفر/منفی دارد و ثبت نشد";
                continue;
            }
            $hash = md5($amount . '|' . $r['created_at'] . '|' . $r['description']);
            finLegacyEntry($pdo, 'legacy_capital', (string) $r['id'], $hash, [['account' => 'legacy_cash', 'debit' => $amount], ['account' => 'capital', 'credit' => $amount]], (int) $r['created_at'],
                trim((string) $r['description']) !== '' ? (string) $r['description'] : 'ورود سرمایه', $stats);
        }
    }
    // entries whose source row was deleted
    foreach ($seen as $type => $ids) {
        $st = $pdo->prepare("SELECT id, source_id FROM fin_journal WHERE source_type = ? AND status = 'posted'");
        $st->execute([$type]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $j) {
            if (!isset($ids[$j['source_id']]) && strncmp((string) $j['source_id'], 'p', 1) !== 0) {
                finReverseEntry($pdo, (int) $j['id'], 'حذف از سیستم قدیمی', 'sync');
                $stats['reversed']++;
            }
        }
    }

    if ($has('Payment_report')) {
        // new rows only: anti-join on the idempotency key keeps this fast on large tables
        $st = $pdo->query("SELECT p.* FROM Payment_report p
            WHERE (p.payment_Status = 'paid' OR p.Payment_Method IN ('cost','capital_injection'))
              AND p.Payment_Method NOT IN ('cost_migrated','capital_migrated','add balance by admin','wallet')
              AND NOT EXISTS (SELECT 1 FROM fin_journal j WHERE j.source_type IN ('legacy_payment','legacy_cost','legacy_capital') AND j.source_id = CONVERT(CONCAT('p', p.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci)
            ORDER BY p.id LIMIT $limit");
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $price = (int) preg_replace('/[^0-9]/', '', (string) $r['price']);
            $ts = accParseDateTime((string) $r['time']);
            if ($ts === null) {
                $stats['issues'][] = "پرداخت #{$r['id']} تاریخ نامعتبر دارد ({$r['time']}) و ثبت نشد";
                continue;
            }
            if ($price <= 0) {
                continue;
            }
            $pid = 'p' . $r['id'];
            $method = (string) $r['Payment_Method'];
            if ($method === 'cost') {
                $desc = trim((string) ($r['dec_not_confirmed'] ?? ''));
                $acct = finLegacyKindAccount(accGuessKind($desc) ?? 'general');
                finLegacyEntry($pdo, 'legacy_cost', $pid, md5('c' . $price . $ts), [['account' => $acct, 'debit' => $price], ['account' => 'legacy_cash', 'credit' => $price]], $ts, $desc !== '' ? $desc : 'هزینه', $stats);
            } elseif ($method === 'capital_injection') {
                finLegacyEntry($pdo, 'legacy_capital', $pid, md5('k' . $price . $ts), [['account' => 'legacy_cash', 'debit' => $price], ['account' => 'capital', 'credit' => $price]], $ts, 'ورود سرمایه', $stats);
            } elseif ($method === 'low balance by admin') {
                finLegacyEntry($pdo, 'legacy_payment', $pid, md5('w' . $price . $ts), [['account' => 'sales_returns', 'debit' => $price], ['account' => 'legacy_cash', 'credit' => $price]], $ts, 'کسر موجودی کیف پول (بازپرداخت)', $stats);
            } else {
                $uid = (string) $r['id_user'];
                $money = finMethodAccount($method);
                $lines = [['account' => $money, 'debit' => $price], ['account' => 'revenue_sales', 'credit' => $price]];
                finLegacyEntry($pdo, 'legacy_payment', $pid, md5('r' . $price . $ts . $method), $lines, $ts, 'پرداخت مشتری ' . $uid . ' · ' . $method . ' · ' . $r['id_order'], $stats);
            }
        }
    }
    finSetSetting($pdo, 'legacy_last_sync', (string) time());
    finSetSetting($pdo, 'legacy_last_stats', json_encode($stats, JSON_UNESCAPED_UNICODE));
    return $stats;
}

/** run the sync at most once every $every seconds (called from the panel API) */
function finMaybeSync(PDO $pdo, int $every = 60): ?array
{
    if (time() - (int) finSetting($pdo, 'legacy_last_sync', 0) < $every) {
        return null;
    }
    return finSyncLegacy($pdo, 1500); // small batches inside web requests; scripts/fin_sync.php does the big first import
}
