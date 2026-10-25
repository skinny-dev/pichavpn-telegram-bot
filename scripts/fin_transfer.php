<?php
// Record money moving between two boxes (gateway settlement to the bank, profit to the USDT wallet …).
//
//   php scripts/fin_transfer.php --amount=4454631 --from=gateway --to=bank_main --date=1405/08/03 --memo="تسویه واریزا (پایا)"
//
//   --from / --to   a box: system key (gateway, bank_main, cash, crypto, legacy_cash), account code (1120) or exact name
//                   («SwapWallet (تتر)», «صندوق بلو»). A name that does not exist yet is created (--kind=bank|crypto|cash|wallet).
//   --fee=N         optional fee kept by the gateway/bank: recorded as an expense («کارمزد درگاه و بانک») from --from
//   --date          YYYY-MM-DD or Jalali 1405/08/03; default today
// The same amount + date + boxes is never recorded twice. A transfer never changes profit.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/jdf.php';
require_once $root . '/finance/engine.php';

$o = [];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--([a-z]+)=(.*)$/s', $a, $m)) {
        $o[$m[1]] = trim($m[2]);
    }
}
$num = fn($v) => (int) preg_replace('/\D/', '', strtr((string) $v, ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']));

/** a money box by system key, code or name; created by name when --kind is given */
function ftBox(PDO $pdo, string $ref, ?string $kind): array
{
    $a = finAccount($pdo, $ref);
    if (!$a) {
        $st = $pdo->prepare("SELECT id FROM fin_accounts WHERE name = ? LIMIT 1");
        $st->execute([$ref]);
        $id = $st->fetchColumn();
        $a = $id ? finAccount($pdo, (int) $id) : null;
    }
    if (!$a) {
        if (!$kind) {
            throw new RuntimeException("صندوق «{$ref}» پیدا نشد (برای ساختنش --kind=bank یا crypto بدهید)");
        }
        $code = 1142;
        while ($pdo->query("SELECT COUNT(*) FROM fin_accounts WHERE code = '$code'")->fetchColumn()) {
            $code++;
        }
        $a = finAccount($pdo, finSaveAccount($pdo, ['code' => (string) $code, 'name' => $ref, 'type' => 'asset', 'parent_code' => '1100', 'money_kind' => $kind], 'cli'));
        echo "📦 صندوق «{$ref}» ساخته شد\n";
    }
    if (empty($a['money_kind'])) {
        throw new RuntimeException("«{$a['name']}» صندوق/حساب پول نیست");
    }
    return $a;
}

try {
    $amount = $num($o['amount'] ?? 0);
    if ($amount <= 0 || empty($o['from']) || empty($o['to'])) {
        throw new RuntimeException('--amount و --from و --to لازم است');
    }
    $date = $o['date'] ?? date('Y-m-d');
    if (preg_match('#^(1[34]\d\d)[/-](\d{1,2})[/-](\d{1,2})$#', strtr($date, ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']), $m)) {
        [$gy, $gm, $gd] = jalali_to_gregorian((int) $m[1], (int) $m[2], (int) $m[3]);
        $date = sprintf('%04d-%02d-%02d', $gy, $gm, $gd);
    }
    $from = ftBox($pdo, $o['from'], $o['kind'] ?? null);
    $to = ftBox($pdo, $o['to'], $o['kind'] ?? null);
    $d0 = finParseDate($date);
    $dup = $pdo->prepare("SELECT ref, id FROM fin_txn WHERE type = 'transfer' AND status = 'posted' AND total = ? AND money_account_id = ? AND to_account_id = ? AND txn_date BETWEEN ? AND ?");
    $dup->execute([$amount, $from['id'], $to['id'], $d0 - 43200, $d0 + 129600]);
    if ($row = $dup->fetch(PDO::FETCH_ASSOC)) {
        echo "⏭ قبلاً ثبت شده (TRF-{$row['id']}) — دوباره ثبت نشد\n";
        exit(0);
    }
    $have = finAccountBalance($pdo, $from['id']);
    if ($have < $amount && empty($from['allow_negative'])) {
        throw new RuntimeException("در دفاتر، موجودی «{$from['name']}» فقط " . number_format($have) . " تومان است (کمتر از " . number_format($amount)
            . "). یعنی پول‌هایی که به این صندوق آمده کامل ثبت نشده؛ اول آن‌ها را ثبت کنید یا مبدأ دیگری بدهید.");
    }
    $r = finTransfer($pdo, ['amount' => $amount, 'from_account' => $from['id'], 'to_account' => $to['id'], 'date' => $date, 'memo' => $o['memo'] ?? null], 'cli');
    echo "✅ انتقال ثبت شد: " . number_format($amount) . " تومان  «{$from['name']}» ← «{$to['name']}» ({$r['ref']})\n";
    $fee = $num($o['fee'] ?? 0);
    if ($fee > 0) {
        finCreateExpense($pdo, ['amount' => $fee, 'category_account' => 'exp_fee', 'money_account' => $from['id'], 'date' => $date, 'memo' => 'کارمزد ' . ($o['memo'] ?? 'تسویه')], 'cli');
        echo "✅ کارمزد " . number_format($fee) . " تومان به‌عنوان هزینه ثبت شد\n";
    }
    echo "   موجودی‌ها: «{$from['name']}» " . number_format(finAccountBalance($pdo, $from['id'])) . " | «{$to['name']}» " . number_format(finAccountBalance($pdo, $to['id'])) . "\n";
} catch (Throwable $e) {
    fwrite(STDERR, '❌ ' . $e->getMessage() . "\n");
    exit(1);
}
