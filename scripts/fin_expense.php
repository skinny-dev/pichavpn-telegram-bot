<?php
// Record an expense paid from a money box (bank / crypto wallet …) in the finance section, from the terminal.
//
//   php scripts/fin_expense.php --amount=13088975 --box="SwapWallet (تتر)" --kind=crypto --category=exp_server \
//       --payee=AEZA --date=2026-10-24 --memo="AEZA سرورهای خارجی — 48.73 USDT (BSC) 0x53B8…5a14"
//
//   --box       money account name; created if it does not exist (--kind = bank | crypto | cash | wallet | other)
//   --category  expense account: system key (exp_server, exp_tools, exp_advertising, exp_general …) or code (5220)
//   --payee     supplier; created if it does not exist
//   --date      YYYY-MM-DD (Gregorian) or 1405/08/02 (Jalali); default today
// The same amount + date + memo is never recorded twice (re-running is safe).
// A new box may go negative: the expense is recorded even before the money that came into the box is; record that
// money later (capital in / transfer) and the balance becomes right.

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
try {
    if (empty($o['amount']) || empty($o['box'])) {
        throw new RuntimeException('--amount و --box لازم است (php scripts/fin_expense.php را بدون آرگومان ببینید)');
    }
    $amount = (int) preg_replace('/\D/', '', strtr($o['amount'], ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']));
    $date = $o['date'] ?? date('Y-m-d');
    if (preg_match('#^(1[34]\d\d)[/-](\d{1,2})[/-](\d{1,2})$#', $date, $m)) { // Jalali
        [$gy, $gm, $gd] = jalali_to_gregorian((int) $m[1], (int) $m[2], (int) $m[3]);
        $date = sprintf('%04d-%02d-%02d', $gy, $gm, $gd);
    }
    $memo = (string) ($o['memo'] ?? '');

    // the box
    $st = $pdo->prepare("SELECT * FROM fin_accounts WHERE name = ? AND money_kind IS NOT NULL LIMIT 1");
    $st->execute([$o['box']]);
    $box = $st->fetch(PDO::FETCH_ASSOC);
    if (!$box) {
        $code = 1141;
        while ($pdo->query("SELECT COUNT(*) FROM fin_accounts WHERE code = '$code'")->fetchColumn()) {
            $code++;
        }
        $id = finSaveAccount($pdo, ['code' => (string) $code, 'name' => $o['box'], 'type' => 'asset', 'parent_code' => '1100', 'money_kind' => $o['kind'] ?? 'crypto', 'allow_negative' => 1], 'cli');
        $box = finAccount($pdo, $id);
        echo "📦 صندوق «{$o['box']}» ساخته شد (کد $code)\n";
    }
    // the payee
    $partyId = null;
    if (!empty($o['payee'])) {
        $st = $pdo->prepare("SELECT id FROM fin_parties WHERE name = ? LIMIT 1");
        $st->execute([$o['payee']]);
        $partyId = $st->fetchColumn() ?: finSaveParty($pdo, ['name' => $o['payee'], 'roles' => ['supplier']], 'cli');
    }
    // never twice
    $dup = $pdo->prepare("SELECT ref FROM fin_txn WHERE type = 'expense' AND status = 'posted' AND total = ? AND txn_date BETWEEN ? AND ? AND COALESCE(memo,'') = ?");
    $d0 = finParseDate($date);
    $dup->execute([$amount, $d0 - 43200, $d0 + 129600, $memo]);
    if ($ref = $dup->fetchColumn()) {
        echo "⏭ قبلاً ثبت شده ($ref) — دوباره ثبت نشد\n";
        exit(0);
    }
    $r = finCreateExpense($pdo, ['amount' => $amount, 'category_account' => $o['category'] ?? 'exp_server', 'money_account' => $box['id'], 'date' => $date, 'memo' => $memo,
        'party_id' => $partyId], 'cli');
    echo "✅ هزینه ثبت شد: " . number_format($amount) . " تومان از «{$box['name']}»" . (!empty($o['payee']) ? " به {$o['payee']}" : '') . " (" . ($r['ref'] ?? $r['id']) . ")\n";
    echo "   موجودی «{$box['name']}» الان: " . number_format(finAccountBalance($pdo, $box['id'])) . " تومان\n";
} catch (Throwable $e) {
    fwrite(STDERR, '❌ ' . $e->getMessage() . "\n");
    exit(1);
}
