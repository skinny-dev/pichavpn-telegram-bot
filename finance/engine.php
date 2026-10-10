<?php
// Financial engine: double-entry ledger + the business transactions that feed it.
//
//   Business layer  (sales, purchases, expenses, payments, transfers, capital ...)  -> fin_txn (+ fin_alloc, fin_parties)
//   Ledger layer    (balanced journal entries, always Debit total = Credit total)   -> fin_journal / fin_journal_lines / fin_accounts
//   Reports         (P&L, balance sheet, cash flow ...)                             -> finance/reports.php
//
// Rules: amounts are integers in the base currency (toman); every posting is atomic; posted records are never deleted,
// they are reversed (a new mirrored entry) so history and audit trail stay intact; accounts are looked up by system_key,
// never by hard-coded id.

final class FinError extends RuntimeException
{
    public int $http;

    public function __construct(string $message, int $http = 422)
    {
        parent::__construct($message);
        $this->http = $http;
    }
}

// ------------------------------------------------------------------ small helpers

function finAtomic(PDO $pdo, callable $fn)
{
    if ($pdo->inTransaction()) {
        return $fn();
    }
    $pdo->beginTransaction();
    try {
        $r = $fn();
        $pdo->commit();
        return $r;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

function finAudit(PDO $pdo, ?string $user, string $action, string $entity, $id, $detail = null): void
{
    $pdo->prepare("INSERT INTO fin_audit (at, user, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)")
        ->execute([time(), $user, $action, $entity, (string) $id, $detail === null ? null : (is_string($detail) ? $detail : json_encode($detail, JSON_UNESCAPED_UNICODE))]);
}

function finSetting(PDO $pdo, string $key, $default = null)
{
    $st = $pdo->prepare("SELECT v FROM fin_settings WHERE k = ?");
    $st->execute([$key]);
    $v = $st->fetchColumn();
    return $v === false ? $default : $v;
}

function finSetSetting(PDO $pdo, string $key, $value): void
{
    $pdo->prepare("INSERT INTO fin_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)")->execute([$key, (string) $value]);
}

/** unix | '' (now) | 1405/07/14 [15:30] | 2026-10-06 -> unix. */
function finParseDate($v): int
{
    if ($v === null || $v === '') {
        return time();
    }
    if (is_int($v) || (is_string($v) && ctype_digit($v) && strlen($v) >= 9)) {
        return (int) $v;
    }
    if (!function_exists('accParseDateTime')) {
        require_once __DIR__ . '/../stats_report.php';
    }
    $t = accParseDateTime((string) $v);
    if ($t === null) {
        throw new FinError('تاریخ نامعتبر است (مثلاً 1405/07/14 یا 1405/07/14 15:30)');
    }
    return $t;
}

function finAmount($v, string $label = 'مبلغ', bool $allowZero = false): int
{
    $s = trim((string) $v);
    $s = str_replace([',', '٬', ' '], '', strtr($s, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
    if ($s === '' || !preg_match('/^\d{1,15}$/', $s)) {
        throw new FinError("«{$label}» باید یک عدد صحیح و مثبت باشد");
    }
    $n = (int) $s;
    if ($n === 0 && !$allowZero) {
        throw new FinError("«{$label}» باید بیشتر از صفر باشد");
    }
    return $n;
}

// ------------------------------------------------------------------ accounts

function finAccountsCache(?PDO $pdo = null, bool $reset = false): array
{
    static $cache = null;
    if ($reset) {
        $cache = null;
    }
    if ($cache === null && $pdo) {
        $cache = ['id' => [], 'key' => [], 'code' => []];
        foreach ($pdo->query("SELECT * FROM fin_accounts")->fetchAll(PDO::FETCH_ASSOC) as $a) {
            $cache['id'][(int) $a['id']] = $a;
            $cache['code'][$a['code']] = $a;
            if ($a['system_key'] !== null && $a['system_key'] !== '') {
                $cache['key'][$a['system_key']] = $a;
            }
        }
    }
    return $cache ?? ['id' => [], 'key' => [], 'code' => []];
}

/** account row by numeric id, system_key or code; null if unknown */
function finAccount(PDO $pdo, $ref): ?array
{
    $c = finAccountsCache($pdo);
    if (is_int($ref) || (is_string($ref) && ctype_digit($ref) && !isset($c['code'][$ref]))) {
        return $c['id'][(int) $ref] ?? null;
    }
    return $c['key'][$ref] ?? $c['code'][$ref] ?? null;
}

function finAccountOrFail(PDO $pdo, $ref, ?array $types = null, bool $forPosting = true): array
{
    $a = finAccount($pdo, $ref);
    if (!$a) {
        throw new FinError('حساب مالی پیدا نشد');
    }
    if ($forPosting && (int) $a['archived'] === 1) {
        throw new FinError("حساب «{$a['name']}» بایگانی شده و قابل استفاده نیست");
    }
    if ($forPosting && (int) $a['is_postable'] !== 1) {
        throw new FinError("روی حساب «{$a['name']}» نمی‌شود سند ثبت کرد (حساب گروه است)");
    }
    if ($types !== null && !in_array($a['type'], $types, true)) {
        throw new FinError("حساب «{$a['name']}» برای این کار مناسب نیست");
    }
    return $a;
}

function finIsMoney(array $a): bool
{
    return $a['money_kind'] !== null && $a['money_kind'] !== '';
}

/** natural side: asset/expense grow with debit; liability/equity/revenue with credit */
function finNaturalDebit(array $a): bool
{
    return in_array($a['type'], ['asset', 'expense'], true);
}

// ------------------------------------------------------------------ journal

/**
 * Post a balanced journal entry atomically.
 * $e: date, memo, lines[[account, debit|credit, party_id?, memo?]], source_type, source_id, source_key?, source_hash?, txn_id?,
 *     user?, reason?, status? (posted|draft)
 * Returns the entry id. If source_key already exists the existing id is returned (idempotent imports).
 */
function finPostEntry(PDO $pdo, array $e): int
{
    $lines = $e['lines'] ?? [];
    if (count($lines) < 2) {
        throw new FinError('هر سند حسابداری حداقل دو ردیف دارد');
    }
    $key = $e['source_key'] ?? null;
    if ($key !== null) {
        $st = $pdo->prepare("SELECT id FROM fin_journal WHERE source_key = ?");
        $st->execute([$key]);
        if (($id = $st->fetchColumn()) !== false) {
            return (int) $id;
        }
    }
    $norm = [];
    $dr = $cr = 0;
    foreach ($lines as $l) {
        $acc = finAccountOrFail($pdo, $l['account'] ?? ($l['account_id'] ?? null));
        $d = (int) ($l['debit'] ?? 0);
        $c = (int) ($l['credit'] ?? 0);
        if ($d < 0 || $c < 0 || ($d > 0) === ($c > 0)) {
            throw new FinError('هر ردیف سند باید فقط بدهکار یا فقط بستانکار باشد');
        }
        $dr += $d;
        $cr += $c;
        $norm[] = [(int) $acc['id'], $d, $c, isset($l['party_id']) && $l['party_id'] ? (int) $l['party_id'] : null, isset($l['memo']) ? mb_substr((string) $l['memo'], 0, 300) : null];
    }
    if ($dr !== $cr || $dr <= 0) {
        throw new FinError('جمع بدهکار و بستانکار سند برابر نیست');
    }
    $status = in_array($e['status'] ?? 'posted', ['posted', 'draft'], true) ? ($e['status'] ?? 'posted') : 'posted';
    return finAtomic($pdo, function () use ($pdo, $e, $norm, $key, $status) {
        $pdo->prepare("INSERT INTO fin_journal (entry_date, memo, source_type, source_id, source_key, source_hash, txn_id, status, reason, created_by, created_at, currency, rate)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                (int) ($e['date'] ?? time()), isset($e['memo']) ? mb_substr((string) $e['memo'], 0, 500) : null, $e['source_type'] ?? 'manual',
                isset($e['source_id']) ? (string) $e['source_id'] : null, $key, $e['source_hash'] ?? null, $e['txn_id'] ?? null, $status,
                $e['reason'] ?? null, $e['user'] ?? null, time(), $e['currency'] ?? 'IRT', $e['rate'] ?? 1,
            ]);
        $id = (int) $pdo->lastInsertId();
        $pdo->prepare("UPDATE fin_journal SET entry_no = ? WHERE id = ?")->execute(['JE-' . str_pad((string) $id, 6, '0', STR_PAD_LEFT), $id]);
        $ins = $pdo->prepare("INSERT INTO fin_journal_lines (entry_id, account_id, debit, credit, party_id, memo) VALUES (?,?,?,?,?,?)");
        foreach ($norm as [$acc, $d, $c, $party, $memo]) {
            $ins->execute([$id, $acc, $d, $c, $party, $memo]);
        }
        return $id;
    });
}

/** Mirror an entry (swapped sides), mark the original reversed. Returns the reversal entry id. */
function finReverseEntry(PDO $pdo, int $entryId, string $reason, ?string $user = null, ?int $date = null): int
{
    return finAtomic($pdo, function () use ($pdo, $entryId, $reason, $user, $date) {
        $st = $pdo->prepare("SELECT * FROM fin_journal WHERE id = ? FOR UPDATE");
        $st->execute([$entryId]);
        $je = $st->fetch(PDO::FETCH_ASSOC);
        if (!$je) {
            throw new FinError('سند پیدا نشد', 404);
        }
        if ($je['status'] !== 'posted') {
            throw new FinError('این سند قبلاً برگشت خورده یا ثبت نهایی نیست');
        }
        $ls = $pdo->prepare("SELECT * FROM fin_journal_lines WHERE entry_id = ?");
        $ls->execute([$entryId]);
        $lines = [];
        foreach ($ls->fetchAll(PDO::FETCH_ASSOC) as $l) {
            $lines[] = ['account' => (int) $l['account_id'], 'debit' => (int) $l['credit'], 'credit' => (int) $l['debit'], 'party_id' => $l['party_id'], 'memo' => $l['memo']];
        }
        // the mirror may touch archived accounts: allowed, it only undoes history (finPostEntryRaw skips the archived check)
        $rev = finPostEntryRaw($pdo, [
            'date' => $date ?? (int) $je['entry_date'], 'memo' => 'برگشت سند ' . $je['entry_no'] . ($reason !== '' ? ' — ' . $reason : ''), 'lines' => $lines,
            'source_type' => 'reversal', 'source_id' => (string) $entryId, 'txn_id' => $je['txn_id'], 'user' => $user, 'reason' => $reason,
        ]);
        $pdo->prepare("UPDATE fin_journal SET reversal_of = ? WHERE id = ?")->execute([$entryId, $rev]);
        $pdo->prepare("UPDATE fin_journal SET status = 'reversed', reversed_by = ? WHERE id = ?")->execute([$rev, $entryId]);
        finAudit($pdo, $user, 'reverse', 'journal', $entryId, ['reversal' => $rev, 'reason' => $reason]);
        return $rev;
    });
}

/** like finPostEntry but without the archived/postable check (used only for reversals of history) */
function finPostEntryRaw(PDO $pdo, array $e): int
{
    $dr = $cr = 0;
    foreach ($e['lines'] as $l) {
        $dr += (int) $l['debit'];
        $cr += (int) $l['credit'];
    }
    if ($dr !== $cr || $dr <= 0) {
        throw new FinError('جمع بدهکار و بستانکار سند برابر نیست');
    }
    $pdo->prepare("INSERT INTO fin_journal (entry_date, memo, source_type, source_id, txn_id, status, reason, created_by, created_at) VALUES (?,?,?,?,?,'posted',?,?,?)")
        ->execute([(int) $e['date'], mb_substr((string) $e['memo'], 0, 500), $e['source_type'], $e['source_id'] ?? null, $e['txn_id'] ?? null, $e['reason'] ?? null, $e['user'] ?? null, time()]);
    $id = (int) $pdo->lastInsertId();
    $pdo->prepare("UPDATE fin_journal SET entry_no = ? WHERE id = ?")->execute(['JE-' . str_pad((string) $id, 6, '0', STR_PAD_LEFT), $id]);
    $ins = $pdo->prepare("INSERT INTO fin_journal_lines (entry_id, account_id, debit, credit, party_id, memo) VALUES (?,?,?,?,?,?)");
    foreach ($e['lines'] as $l) {
        $ins->execute([$id, (int) $l['account'], (int) $l['debit'], (int) $l['credit'], $l['party_id'] ?? null, $l['memo'] ?? null]);
    }
    return $id;
}

/** Balance of one account at a point in time (natural side). Posted + reversed entries both count, so a reversal nets to zero. */
function finAccountBalance(PDO $pdo, $account, ?int $asOf = null): int
{
    $a = finAccountOrFail($pdo, $account, null, false);
    $sql = "SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id
            WHERE l.account_id = ? AND j.status IN ('posted','reversed')" . ($asOf !== null ? " AND j.entry_date <= ?" : '');
    $st = $pdo->prepare($sql);
    $st->execute($asOf !== null ? [$a['id'], $asOf] : [$a['id']]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    return finNaturalDebit($a) ? (int) $r['d'] - (int) $r['c'] : (int) $r['c'] - (int) $r['d'];
}

function finEnsureFunds(PDO $pdo, $account, int $amount, ?int $asOf = null): void
{
    $a = finAccountOrFail($pdo, $account, null, false);
    if ((int) $a['allow_negative'] === 1) {
        return;
    }
    $bal = finAccountBalance($pdo, $a['id'], $asOf);
    if ($bal < $amount) {
        throw new FinError('موجودی «' . $a['name'] . '» کافی نیست (موجودی: ' . number_format($bal) . ' تومان)');
    }
}

// ------------------------------------------------------------------ parties

function finParty(PDO $pdo, $id, bool $mustBeActive = true): array
{
    $st = $pdo->prepare("SELECT * FROM fin_parties WHERE id = ?");
    $st->execute([(int) $id]);
    $p = $st->fetch(PDO::FETCH_ASSOC);
    if (!$p) {
        throw new FinError('طرف حساب پیدا نشد', 404);
    }
    if ($mustBeActive && (int) $p['archived'] === 1) {
        throw new FinError('طرف حساب بایگانی شده است');
    }
    return $p;
}

function finPartyRoles(): array
{
    return ['customer' => 'مشتری', 'supplier' => 'تأمین‌کننده', 'employee' => 'کارمند', 'partner' => 'شریک', 'shareholder' => 'سهامدار', 'investor' => 'سرمایه‌گذار', 'lender' => 'وام‌دهنده', 'borrower' => 'وام‌گیرنده', 'other' => 'سایر'];
}

function finSaveParty(PDO $pdo, array $d, ?string $user = null): int
{
    $name = trim((string) ($d['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 200) {
        throw new FinError('نام طرف حساب لازم است');
    }
    $roles = array_values(array_intersect(array_map('trim', (array) ($d['roles'] ?? ['customer'])), array_keys(finPartyRoles())));
    if (!$roles) {
        $roles = ['customer'];
    }
    $tg = isset($d['tg_user_id']) && trim((string) $d['tg_user_id']) !== '' ? trim((string) $d['tg_user_id']) : null;
    return finAtomic($pdo, function () use ($pdo, $d, $name, $roles, $tg, $user) {
        if (!empty($d['id'])) {
            finParty($pdo, $d['id'], false);
            $pdo->prepare("UPDATE fin_parties SET name=?, roles=?, phone=?, email=?, tg_user_id=?, note=?, archived=? WHERE id=?")
                ->execute([$name, implode(',', $roles), $d['phone'] ?? null, $d['email'] ?? null, $tg, $d['note'] ?? null, !empty($d['archived']) ? 1 : 0, (int) $d['id']]);
            finAudit($pdo, $user, 'update', 'party', $d['id']);
            return (int) $d['id'];
        }
        $pdo->prepare("INSERT INTO fin_parties (name, roles, phone, email, tg_user_id, note, created_at) VALUES (?,?,?,?,?,?,?)")
            ->execute([$name, implode(',', $roles), $d['phone'] ?? null, $d['email'] ?? null, $tg, $d['note'] ?? null, time()]);
        $id = (int) $pdo->lastInsertId();
        finAudit($pdo, $user, 'create', 'party', $id, ['name' => $name]);
        return $id;
    });
}

/** the party that represents a Telegram customer (created on first use from the `user` table) */
function finPartyForTelegramUser(PDO $pdo, string $tgId): int
{
    $st = $pdo->prepare("SELECT id FROM fin_parties WHERE tg_user_id = ?");
    $st->execute([$tgId]);
    if (($id = $st->fetchColumn()) !== false) {
        return (int) $id;
    }
    $u = $pdo->prepare("SELECT username, namecustom FROM user WHERE id = ?");
    $u->execute([$tgId]);
    $row = $u->fetch(PDO::FETCH_ASSOC) ?: [];
    $name = trim((string) ($row['namecustom'] ?? ''));
    if ($name === '' || $name === 'none') {
        $name = trim((string) ($row['username'] ?? ''));
    }
    if ($name === '' || $name === 'none') {
        $name = 'کاربر ' . $tgId;
    }
    $pdo->prepare("INSERT IGNORE INTO fin_parties (name, roles, tg_user_id, created_at) VALUES (?, 'customer', ?, ?)")->execute([$name, $tgId, time()]);
    $st->execute([$tgId]);
    return (int) $st->fetchColumn();
}

// ------------------------------------------------------------------ business transactions (fin_txn)

function finTxnInsert(PDO $pdo, array $t): int
{
    $cols = ['type', 'txn_date', 'party_id', 'money_account_id', 'to_account_id', 'category_account_id', 'subtotal', 'discount', 'tax', 'total', 'paid', 'returned',
        'due_date', 'payment_method', 'status', 'parent_txn_id', 'loan_id', 'asset_id', 'memo', 'meta', 'reason', 'created_by'];
    $vals = [];
    foreach ($cols as $c) {
        $vals[$c] = $t[$c] ?? (in_array($c, ['subtotal', 'discount', 'tax', 'total', 'paid', 'returned'], true) ? 0 : null);
    }
    $vals['status'] = $vals['status'] ?? 'posted';
    $vals['created_at'] = time();
    $names = array_keys($vals);
    $pdo->prepare("INSERT INTO fin_txn (" . implode(',', $names) . ") VALUES (" . implode(',', array_fill(0, count($names), '?')) . ")")->execute(array_values($vals));
    $id = (int) $pdo->lastInsertId();
    $prefix = ['sale' => 'SALE', 'purchase' => 'BILL', 'expense' => 'EXP', 'income' => 'INC', 'receipt' => 'RCPT', 'payment' => 'PAY', 'transfer' => 'TRF',
        'capital_in' => 'CAP', 'capital_out' => 'DRAW', 'distribution' => 'DIST', 'loan_in' => 'LOAN', 'loan_out' => 'LEND', 'loan_payment' => 'LPAY',
        'refund_sale' => 'RET', 'refund_purchase' => 'PRET', 'asset_purchase' => 'ASSET', 'depreciation' => 'DEP', 'adjustment' => 'ADJ'][$t['type']] ?? 'TXN';
    $ref = $prefix . '-' . $id;
    $pdo->prepare("UPDATE fin_txn SET ref = ? WHERE id = ?")->execute([$ref, $id]);
    return $id;
}

function finTxn(PDO $pdo, $id, bool $lock = false): array
{
    $st = $pdo->prepare("SELECT * FROM fin_txn WHERE id = ?" . ($lock ? ' FOR UPDATE' : ''));
    $st->execute([(int) $id]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t) {
        throw new FinError('تراکنش پیدا نشد', 404);
    }
    return $t;
}

function finLinkJournal(PDO $pdo, int $txnId, int $journalId): void
{
    $pdo->prepare("UPDATE fin_txn SET journal_id = ? WHERE id = ?")->execute([$journalId, $txnId]);
    $pdo->prepare("UPDATE fin_journal SET txn_id = ? WHERE id = ?")->execute([$txnId, $journalId]);
}

function finOutstanding(array $doc): int
{
    return max(0, (int) $doc['total'] - (int) $doc['paid'] - ((int) $doc['returned'] - (int) ($doc['refunded'] ?? 0)));
}

function finRecalcPaid(PDO $pdo, int $docId): void
{
    $st = $pdo->prepare("SELECT COALESCE(SUM(a.amount),0) FROM fin_alloc a JOIN fin_txn p ON p.id = a.payment_txn_id WHERE a.doc_txn_id = ? AND p.status = 'posted'");
    $st->execute([$docId]);
    $pdo->prepare("UPDATE fin_txn SET paid = ? WHERE id = ?")->execute([(int) $st->fetchColumn(), $docId]);
}

/** payment state of a sale/bill: paid | partial | unpaid | overdue | refunded | cancelled */
function finDocState(array $doc, ?int $now = null): string
{
    $now = $now ?? time();
    if (in_array($doc['status'], ['cancelled', 'reversed'], true)) {
        return 'cancelled';
    }
    $out = finOutstanding($doc);
    if ((int) $doc['total'] > 0 && (int) $doc['returned'] >= (int) $doc['total']) {
        return 'refunded';
    }
    if ($out === 0) {
        return 'paid';
    }
    if (!empty($doc['due_date']) && (int) $doc['due_date'] < $now) {
        return 'overdue';
    }
    return (int) $doc['paid'] > 0 ? 'partial' : 'unpaid';
}

/** items: [{name, qty, price}] -> [lines, subtotal]; at least a total is required */
function finItems($items, ?int $fallbackAmount = null): array
{
    $out = [];
    $sub = 0;
    foreach ((array) $items as $it) {
        $name = trim((string) ($it['name'] ?? ''));
        $qty = (float) ($it['qty'] ?? 1);
        $price = finAmount($it['price'] ?? 0, 'قیمت واحد', true);
        if ($name === '' && $price === 0) {
            continue;
        }
        if ($qty <= 0) {
            throw new FinError('تعداد باید بیشتر از صفر باشد');
        }
        $line = (int) round($qty * $price);
        $out[] = ['name' => mb_substr($name, 0, 200), 'qty' => $qty, 'price' => $price, 'total' => $line];
        $sub += $line;
    }
    if (!$out && $fallbackAmount !== null) {
        return [[], $fallbackAmount];
    }
    if (!$out) {
        throw new FinError('حداقل یک ردیف کالا/خدمت یا مبلغ لازم است');
    }
    return [$out, $sub];
}

/** discount/tax math shared by sales and bills; tax is a percentage of (subtotal - discount) or a fixed amount */
function finTotals(int $subtotal, $discount, $taxRate, $taxAmount = null): array
{
    $discount = $discount === null || $discount === '' ? 0 : finAmount($discount, 'تخفیف', true);
    if ($discount > $subtotal) {
        throw new FinError('تخفیف از مبلغ کل بیشتر است');
    }
    $base = $subtotal - $discount;
    if ($taxAmount !== null && $taxAmount !== '') {
        $tax = finAmount($taxAmount, 'مالیات', true);
    } else {
        $rate = $taxRate === null || $taxRate === '' ? 0.0 : (float) $taxRate;
        if ($rate < 0 || $rate > 100) {
            throw new FinError('نرخ مالیات نامعتبر است');
        }
        $tax = (int) round($base * $rate / 100);
    }
    return [$discount, $tax, $base + $tax];
}

function finMoneyAccount(PDO $pdo, $id): array
{
    $a = finAccountOrFail($pdo, $id);
    if (!finIsMoney($a)) {
        throw new FinError('«' . $a['name'] . '» حساب صندوق/بانک نیست');
    }
    return $a;
}

// ---- allocation of a payment to documents (invoices / bills)

/**
 * $allocs: [docId => amount]. If empty and $auto, settle the oldest open documents of the party first.
 * Never allocates more than the document's outstanding amount.
 */
function finAllocate(PDO $pdo, int $paymentTxnId, string $docType, int $partyId, int $amount, array $allocs, bool $auto): array
{
    $result = [];
    $sum = 0;
    if ($allocs) {
        foreach ($allocs as $docId => $amt) {
            $amt = finAmount($amt, 'مبلغ تخصیص');
            $doc = finTxn($pdo, (int) $docId, true);
            if ($doc['type'] !== $docType || (int) $doc['party_id'] !== $partyId || $doc['status'] !== 'posted') {
                throw new FinError('سند انتخاب‌شده برای این طرف حساب معتبر نیست');
            }
            if ($amt > finOutstanding($doc)) {
                throw new FinError('مبلغ از مانده‌ی ' . $doc['ref'] . ' بیشتر است (مانده: ' . number_format(finOutstanding($doc)) . ' تومان)');
            }
            $result[(int) $docId] = $amt;
            $sum += $amt;
        }
    } elseif ($auto) {
        $st = $pdo->prepare("SELECT * FROM fin_txn WHERE type = ? AND party_id = ? AND status = 'posted' AND total - paid - (returned - refunded) > 0 ORDER BY COALESCE(due_date, txn_date), id FOR UPDATE");
        $st->execute([$docType, $partyId]);
        $left = $amount;
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $doc) {
            if ($left <= 0) {
                break;
            }
            $take = min($left, finOutstanding($doc));
            $result[(int) $doc['id']] = $take;
            $left -= $take;
            $sum += $take;
        }
    }
    if ($sum !== $amount) {
        $open = $pdo->prepare("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE type = ? AND party_id = ? AND status = 'posted'");
        $open->execute([$docType, $partyId]);
        throw new FinError($sum > $amount ? 'جمع تخصیص‌ها از مبلغ پرداخت بیشتر است'
            : 'مبلغ از مانده‌ی بدهی/طلب بیشتر است (مانده‌ی کل: ' . number_format((int) $open->fetchColumn()) . ' تومان)');
    }
    $ins = $pdo->prepare("INSERT INTO fin_alloc (payment_txn_id, doc_txn_id, amount, created_at) VALUES (?,?,?,?)");
    foreach ($result as $docId => $amt) {
        $ins->execute([$paymentTxnId, $docId, $amt, time()]);
        finRecalcPaid($pdo, $docId);
    }
    return $result;
}

// ------------------------------------------------------------------ services

/**
 * Sale: revenue (+tax) against the customer's receivable; an optional immediate payment becomes a separate receipt.
 * d: date, party_id (required unless fully paid), items[] | amount, discount, tax_rate|tax, revenue_account (default sales),
 *    paid_now, money_account, payment_method, due_date, memo
 */
function finCreateSale(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $date = finParseDate($d['date'] ?? '');
        [$items, $sub] = finItems($d['items'] ?? [], isset($d['amount']) && $d['amount'] !== '' ? finAmount($d['amount']) : null);
        [$discount, $tax, $total] = finTotals($sub, $d['discount'] ?? 0, $d['tax_rate'] ?? 0, $d['tax'] ?? null);
        if ($total <= 0) {
            throw new FinError('مبلغ فروش باید بیشتر از صفر باشد');
        }
        $paidNow = isset($d['paid_now']) && $d['paid_now'] !== '' ? finAmount($d['paid_now'], 'مبلغ دریافتی', true) : 0;
        if ($paidNow > $total) {
            throw new FinError('مبلغ دریافتی از مبلغ فروش بیشتر است');
        }
        $partyId = !empty($d['party_id']) ? (int) finParty($pdo, $d['party_id'])['id'] : null;
        if ($partyId === null && $paidNow < $total) {
            throw new FinError('برای فروش نسیه یا قسطی، مشتری را انتخاب کنید');
        }
        $due = !empty($d['due_date']) ? finParseDate($d['due_date']) : null;
        $rev = finAccountOrFail($pdo, $d['revenue_account'] ?? 'revenue_sales', ['revenue']);
        $txnId = finTxnInsert($pdo, ['type' => 'sale', 'txn_date' => $date, 'party_id' => $partyId, 'category_account_id' => $rev['id'], 'subtotal' => $sub, 'discount' => $discount,
            'tax' => $tax, 'total' => $total, 'due_date' => $due, 'payment_method' => $d['payment_method'] ?? null, 'memo' => $d['memo'] ?? null,
            'meta' => json_encode(['items' => $items, 'channel' => $d['channel'] ?? null], JSON_UNESCAPED_UNICODE), 'created_by' => $user]);
        // fully paid cash sale without a customer: money goes straight in, no receivable and no receipt document
        $direct = $partyId === null;
        $directAcc = $direct ? finMoneyAccount($pdo, $d['money_account'] ?? 'cash') : null;
        if ($direct) {
            $pdo->prepare("UPDATE fin_txn SET paid = ?, money_account_id = ? WHERE id = ?")->execute([$total, $directAcc['id'], $txnId]);
        }
        $lines = [$direct ? ['account' => $directAcc['id'], 'debit' => $total, 'memo' => 'فروش نقدی'] : ['account' => 'ar', 'debit' => $total, 'party_id' => $partyId, 'memo' => 'فروش'], ['account' => $rev['id'], 'credit' => $sub - $discount, 'memo' => 'فروش']];
        if ($tax > 0) {
            $lines[] = ['account' => 'tax_payable', 'credit' => $tax, 'memo' => 'مالیات فروش'];
        }
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'فروش ' . ($d['memo'] ?? ''), 'lines' => $lines, 'source_type' => 'sale', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'sale', $txnId, ['total' => $total]);
        $receipt = null;
        if ($paidNow > 0 && !$direct) {
            $receipt = finReceivePayment($pdo, ['date' => $date, 'party_id' => $partyId, 'amount' => $paidNow, 'money_account' => $d['money_account'] ?? 'cash',
                'payment_method' => $d['payment_method'] ?? null, 'allocations' => [$txnId => $paidNow], 'memo' => 'دریافت همزمان با فروش'], $user);
        }
        return ['id' => $txnId, 'ref' => 'SALE-' . $txnId, 'total' => $total, 'receipt_id' => $receipt['id'] ?? null];
    });
}

/** Receive money from a customer and settle receivables (never more than they owe). */
function finReceivePayment(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $amount = finAmount($d['amount'] ?? 0);
        $party = finParty($pdo, $d['party_id'] ?? 0);
        $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
        $date = finParseDate($d['date'] ?? '');
        $txnId = finTxnInsert($pdo, ['type' => 'receipt', 'txn_date' => $date, 'party_id' => $party['id'], 'money_account_id' => $acc['id'], 'total' => $amount, 'paid' => $amount,
            'payment_method' => $d['payment_method'] ?? null, 'memo' => $d['memo'] ?? null, 'created_by' => $user]);
        $allocs = finAllocate($pdo, $txnId, 'sale', (int) $party['id'], $amount, (array) ($d['allocations'] ?? []), true);
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'دریافت از ' . $party['name'], 'source_type' => 'receipt', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user,
            'lines' => [['account' => $acc['id'], 'debit' => $amount, 'party_id' => $party['id']], ['account' => 'ar', 'credit' => $amount, 'party_id' => $party['id']]]]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'receipt', $txnId, ['amount' => $amount, 'allocations' => $allocs]);
        return ['id' => $txnId, 'ref' => 'RCPT-' . $txnId, 'allocations' => $allocs];
    });
}

/**
 * Purchase / bill from a supplier: Dr expense|asset|inventory (+ input tax), Cr payable. Optional immediate payment.
 * d: date, party_id, category_account (any expense/asset account), items[]|amount, discount, tax_rate|tax, paid_now, money_account, due_date, memo
 */
function finCreatePurchase(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $date = finParseDate($d['date'] ?? '');
        [$items, $sub] = finItems($d['items'] ?? [], isset($d['amount']) && $d['amount'] !== '' ? finAmount($d['amount']) : null);
        [$discount, $tax, $total] = finTotals($sub, $d['discount'] ?? 0, $d['tax_rate'] ?? 0, $d['tax'] ?? null);
        $paidNow = isset($d['paid_now']) && $d['paid_now'] !== '' ? finAmount($d['paid_now'], 'مبلغ پرداختی', true) : 0;
        if ($paidNow > $total) {
            throw new FinError('مبلغ پرداختی از مبلغ خرید بیشتر است');
        }
        $partyId = !empty($d['party_id']) ? (int) finParty($pdo, $d['party_id'])['id'] : null;
        if ($partyId === null && $paidNow < $total) {
            throw new FinError('برای خرید نسیه، تأمین‌کننده را انتخاب کنید');
        }
        $cat = finAccountOrFail($pdo, $d['category_account'] ?? 'cogs', ['expense', 'asset']);
        if (finIsMoney($cat) || in_array($cat['system_key'], ['ar', 'ap'], true)) {
            throw new FinError('دسته‌ی خرید نامعتبر است');
        }
        $due = !empty($d['due_date']) ? finParseDate($d['due_date']) : null;
        $txnId = finTxnInsert($pdo, ['type' => 'purchase', 'txn_date' => $date, 'party_id' => $partyId, 'category_account_id' => $cat['id'], 'subtotal' => $sub, 'discount' => $discount,
            'tax' => $tax, 'total' => $total, 'due_date' => $due, 'payment_method' => $d['payment_method'] ?? null, 'memo' => $d['memo'] ?? null,
            'meta' => json_encode(['items' => $items], JSON_UNESCAPED_UNICODE), 'created_by' => $user]);
        $lines = [['account' => $cat['id'], 'debit' => $sub - $discount, 'memo' => 'خرید'], ['account' => 'ap', 'credit' => $total, 'party_id' => $partyId, 'memo' => 'خرید']];
        if ($tax > 0) {
            $lines[] = ['account' => 'tax_receivable', 'debit' => $tax, 'memo' => 'مالیات خرید'];
        }
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'خرید ' . ($d['memo'] ?? ''), 'lines' => $lines, 'source_type' => 'purchase', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'purchase', $txnId, ['total' => $total]);
        $pay = null;
        if ($paidNow > 0) {
            $pay = finMakePayment($pdo, ['date' => $date, 'party_id' => $partyId, 'amount' => $paidNow, 'money_account' => $d['money_account'] ?? 'cash',
                'payment_method' => $d['payment_method'] ?? null, 'allocations' => [$txnId => $paidNow], 'memo' => 'پرداخت همزمان با خرید'], $user);
        }
        return ['id' => $txnId, 'ref' => 'BILL-' . $txnId, 'total' => $total, 'payment_id' => $pay['id'] ?? null];
    });
}

/** Pay a supplier and settle payables (never more than owed, never more than the account holds). */
function finMakePayment(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $amount = finAmount($d['amount'] ?? 0);
        $party = finParty($pdo, $d['party_id'] ?? 0);
        $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
        $date = finParseDate($d['date'] ?? '');
        finEnsureFunds($pdo, $acc['id'], $amount, $date);
        $txnId = finTxnInsert($pdo, ['type' => 'payment', 'txn_date' => $date, 'party_id' => $party['id'], 'money_account_id' => $acc['id'], 'total' => $amount, 'paid' => $amount,
            'payment_method' => $d['payment_method'] ?? null, 'memo' => $d['memo'] ?? null, 'created_by' => $user]);
        $allocs = finAllocate($pdo, $txnId, 'purchase', (int) $party['id'], $amount, (array) ($d['allocations'] ?? []), true);
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'پرداخت به ' . $party['name'], 'source_type' => 'payment', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user,
            'lines' => [['account' => 'ap', 'debit' => $amount, 'party_id' => $party['id']], ['account' => $acc['id'], 'credit' => $amount, 'party_id' => $party['id']]]]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'payment', $txnId, ['amount' => $amount, 'allocations' => $allocs]);
        return ['id' => $txnId, 'ref' => 'PAY-' . $txnId, 'allocations' => $allocs];
    });
}

/**
 * Expense. Paid now from a money account, or on credit (payable to a supplier).
 * d: date, amount, category_account (expense account), money_account | party_id (+due_date), tax_rate|tax, memo
 */
function finCreateExpense(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $date = finParseDate($d['date'] ?? '');
        $net = finAmount($d['amount'] ?? 0);
        [, $tax, $total] = finTotals($net, 0, $d['tax_rate'] ?? 0, $d['tax'] ?? null);
        $cat = finAccountOrFail($pdo, $d['category_account'] ?? 'exp_general', ['expense']);
        $onCredit = !empty($d['on_credit']);
        $partyId = !empty($d['party_id']) ? (int) finParty($pdo, $d['party_id'])['id'] : null;
        $memo = $d['memo'] ?? null;
        if ($onCredit) {
            if ($partyId === null) {
                throw new FinError('برای هزینه‌ی نسیه، تأمین‌کننده را انتخاب کنید');
            }
            $txnId = finTxnInsert($pdo, ['type' => 'purchase', 'txn_date' => $date, 'party_id' => $partyId, 'category_account_id' => $cat['id'], 'subtotal' => $net, 'tax' => $tax, 'total' => $total,
                'due_date' => !empty($d['due_date']) ? finParseDate($d['due_date']) : null, 'memo' => $memo, 'meta' => json_encode(['expense' => true]), 'created_by' => $user]);
            $lines = [['account' => $cat['id'], 'debit' => $net], ['account' => 'ap', 'credit' => $total, 'party_id' => $partyId]];
            $ref = 'BILL-' . $txnId;
        } else {
            $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
            finEnsureFunds($pdo, $acc['id'], $total, $date);
            $txnId = finTxnInsert($pdo, ['type' => 'expense', 'txn_date' => $date, 'party_id' => $partyId, 'money_account_id' => $acc['id'], 'category_account_id' => $cat['id'],
                'subtotal' => $net, 'tax' => $tax, 'total' => $total, 'paid' => $total, 'payment_method' => $d['payment_method'] ?? null, 'memo' => $memo, 'created_by' => $user]);
            $lines = [['account' => $cat['id'], 'debit' => $net, 'party_id' => $partyId], ['account' => $acc['id'], 'credit' => $total, 'party_id' => $partyId]];
            $ref = 'EXP-' . $txnId;
        }
        if ($tax > 0) {
            $lines[] = ['account' => 'tax_receivable', 'debit' => $tax];
        }
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => ($cat['name'] . ($memo ? ' — ' . $memo : '')), 'lines' => $lines, 'source_type' => $onCredit ? 'purchase' : 'expense', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'expense', $txnId, ['total' => $total, 'category' => $cat['name']]);
        return ['id' => $txnId, 'ref' => $ref, 'total' => $total];
    });
}

/** Other income (interest, commission, affiliate ...): Dr money (or receivable), Cr income account. Not a sale. */
function finCreateIncome(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $date = finParseDate($d['date'] ?? '');
        $amount = finAmount($d['amount'] ?? 0);
        $inc = finAccountOrFail($pdo, $d['income_account'] ?? 'revenue_other', ['revenue']);
        $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
        $partyId = !empty($d['party_id']) ? (int) finParty($pdo, $d['party_id'])['id'] : null;
        $txnId = finTxnInsert($pdo, ['type' => 'income', 'txn_date' => $date, 'party_id' => $partyId, 'money_account_id' => $acc['id'], 'category_account_id' => $inc['id'], 'subtotal' => $amount,
            'total' => $amount, 'paid' => $amount, 'payment_method' => $d['payment_method'] ?? null, 'memo' => $d['memo'] ?? null, 'created_by' => $user]);
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => $inc['name'] . (!empty($d['memo']) ? ' — ' . $d['memo'] : ''), 'source_type' => 'income', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user,
            'lines' => [['account' => $acc['id'], 'debit' => $amount, 'party_id' => $partyId], ['account' => $inc['id'], 'credit' => $amount, 'party_id' => $partyId]]]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'income', $txnId, ['amount' => $amount]);
        return ['id' => $txnId, 'ref' => 'INC-' . $txnId, 'total' => $amount];
    });
}

/** Move money between two of our own accounts. Not an expense, not income. */
function finTransfer(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $date = finParseDate($d['date'] ?? '');
        $amount = finAmount($d['amount'] ?? 0);
        $from = finMoneyAccount($pdo, $d['from_account'] ?? 0);
        $to = finMoneyAccount($pdo, $d['to_account'] ?? 0);
        if ((int) $from['id'] === (int) $to['id']) {
            throw new FinError('حساب مبدأ و مقصد نباید یکی باشد');
        }
        finEnsureFunds($pdo, $from['id'], $amount, $date);
        $txnId = finTxnInsert($pdo, ['type' => 'transfer', 'txn_date' => $date, 'money_account_id' => $from['id'], 'to_account_id' => $to['id'], 'total' => $amount, 'paid' => $amount,
            'memo' => ($d['reference'] ?? '') !== '' ? trim($d['reference'] . ' ' . ($d['memo'] ?? '')) : ($d['memo'] ?? null), 'created_by' => $user]);
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'انتقال ' . $from['name'] . ' ← ' . $to['name'], 'source_type' => 'transfer', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user,
            'lines' => [['account' => $to['id'], 'debit' => $amount], ['account' => $from['id'], 'credit' => $amount]]]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'transfer', $txnId, ['from' => $from['name'], 'to' => $to['name'], 'amount' => $amount]);
        return ['id' => $txnId, 'ref' => 'TRF-' . $txnId, 'total' => $amount];
    });
}

/** Owner invests (Dr money, Cr capital) or withdraws (Dr drawings, Cr money). Capital is never revenue. */
function finCapital(PDO $pdo, array $d, string $direction, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $direction, $user) {
        $date = finParseDate($d['date'] ?? '');
        $amount = finAmount($d['amount'] ?? 0);
        $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
        $partyId = !empty($d['party_id']) ? (int) finParty($pdo, $d['party_id'])['id'] : null;
        $in = $direction === 'in';
        if (!$in) {
            finEnsureFunds($pdo, $acc['id'], $amount, $date);
        }
        $txnId = finTxnInsert($pdo, ['type' => $in ? 'capital_in' : 'capital_out', 'txn_date' => $date, 'party_id' => $partyId, 'money_account_id' => $acc['id'], 'total' => $amount, 'paid' => $amount,
            'memo' => $d['memo'] ?? null, 'created_by' => $user]);
        $lines = $in ? [['account' => $acc['id'], 'debit' => $amount, 'party_id' => $partyId], ['account' => 'capital', 'credit' => $amount, 'party_id' => $partyId]]
                     : [['account' => 'drawings', 'debit' => $amount, 'party_id' => $partyId], ['account' => $acc['id'], 'credit' => $amount, 'party_id' => $partyId]];
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => $in ? 'ورود سرمایه' : 'برداشت از سرمایه', 'lines' => $lines, 'source_type' => $in ? 'capital_in' : 'capital_out', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', $in ? 'capital_in' : 'capital_out', $txnId, ['amount' => $amount]);
        return ['id' => $txnId, 'ref' => ($in ? 'CAP-' : 'DRAW-') . $txnId, 'total' => $amount];
    });
}

/** ownership percentages in force at $asOf: [partyId => percent] */
function finOwnershipAt(PDO $pdo, ?int $asOf = null): array
{
    $asOf = $asOf ?? time();
    $st = $pdo->prepare("SELECT o.party_id, o.percent FROM fin_ownership o
                         JOIN (SELECT party_id, MAX(effective_from) mf FROM fin_ownership WHERE effective_from <= ? GROUP BY party_id) m ON m.party_id = o.party_id AND m.mf = o.effective_from
                         WHERE o.percent > 0 ORDER BY o.id");
    $st->execute([$asOf]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[(int) $r['party_id']] = (float) $r['percent'];
    }
    return $out;
}

/** Set the ownership table as of a date. History is kept: new rows, nothing is overwritten. $shares: [partyId => percent] must total 100. */
function finSetOwnership(PDO $pdo, array $shares, int $effectiveFrom, ?string $note, ?string $user = null): void
{
    $total = 0.0;
    foreach ($shares as $pid => $pct) {
        finParty($pdo, $pid);
        $pct = (float) $pct;
        if ($pct < 0 || $pct > 100) {
            throw new FinError('درصد مالکیت نامعتبر است');
        }
        $total += $pct;
    }
    if (abs($total - 100.0) > 0.0001) {
        throw new FinError('جمع درصد مالکیت باید ۱۰۰ باشد (الان ' . rtrim(rtrim(number_format($total, 4, '.', ''), '0'), '.') . ')');
    }
    finAtomic($pdo, function () use ($pdo, $shares, $effectiveFrom, $note, $user) {
        // parties that held shares before but are not in the new table drop to 0 as of this date
        $before = finOwnershipAt($pdo, $effectiveFrom - 1);
        foreach ($before as $pid => $_) {
            if (!isset($shares[$pid])) {
                $shares[$pid] = 0;
            }
        }
        $ins = $pdo->prepare("INSERT INTO fin_ownership (party_id, percent, effective_from, note, created_by, created_at) VALUES (?,?,?,?,?,?)");
        foreach ($shares as $pid => $pct) {
            $ins->execute([(int) $pid, (float) $pct, $effectiveFrom, $note, $user, time()]);
        }
        finAudit($pdo, $user, 'ownership', 'partners', $effectiveFrom, ['shares' => $shares]);
    });
}

/** Distribute profit to partners by the ownership in force on the date: one entry, one line per partner. */
function finDistribute(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $date = finParseDate($d['date'] ?? '');
        $amount = finAmount($d['amount'] ?? 0);
        $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
        $own = finOwnershipAt($pdo, $date);
        if (!$own) {
            throw new FinError('ابتدا درصد مالکیت شرکا را ثبت کنید');
        }
        finEnsureFunds($pdo, $acc['id'], $amount, $date);
        $txnId = finTxnInsert($pdo, ['type' => 'distribution', 'txn_date' => $date, 'money_account_id' => $acc['id'], 'total' => $amount, 'paid' => $amount, 'memo' => $d['memo'] ?? null,
            'meta' => json_encode(['ownership' => $own]), 'created_by' => $user]);
        $lines = [];
        $given = 0;
        $ids = array_keys($own);
        foreach ($ids as $i => $pid) {
            $part = $i === count($ids) - 1 ? $amount - $given : (int) floor($amount * $own[$pid] / 100);
            $given += $part;
            if ($part > 0) {
                $lines[] = ['account' => 'dividends', 'debit' => $part, 'party_id' => $pid, 'memo' => 'سهم ' . $own[$pid] . '٪'];
            }
        }
        $lines[] = ['account' => $acc['id'], 'credit' => $amount];
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'تقسیم سود', 'lines' => $lines, 'source_type' => 'distribution', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'distribution', $txnId, ['amount' => $amount, 'ownership' => $own]);
        return ['id' => $txnId, 'ref' => 'DIST-' . $txnId, 'total' => $amount];
    });
}

/** Return of a sale: reverses revenue/tax; reduces the receivable first, the rest is paid back from a money account. */
function finRefundSale(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $sale = finTxn($pdo, $d['sale_id'] ?? 0, true);
        if ($sale['type'] !== 'sale' || $sale['status'] !== 'posted') {
            throw new FinError('فاکتور فروش معتبر نیست');
        }
        $date = finParseDate($d['date'] ?? '');
        $amount = finAmount($d['amount'] ?? $sale['total']);
        $refundable = (int) $sale['total'] - (int) $sale['returned'];
        if ($amount > $refundable) {
            throw new FinError('مبلغ برگشتی از مبلغ قابل برگشت بیشتر است (حداکثر: ' . number_format($refundable) . ' تومان)');
        }
        // split the returned amount into net revenue and tax proportionally
        $tax = (int) round($amount * ((int) $sale['tax']) / max(1, (int) $sale['total']));
        $net = $amount - $tax;
        $reduceAr = min($amount, finOutstanding($sale));
        $cashBack = $amount - $reduceAr;
        $lines = [['account' => 'sales_returns', 'debit' => $net, 'memo' => 'برگشت از فروش']];
        if ($tax > 0) {
            $lines[] = ['account' => 'tax_payable', 'debit' => $tax];
        }
        if ($reduceAr > 0) {
            $lines[] = ['account' => 'ar', 'credit' => $reduceAr, 'party_id' => $sale['party_id']];
        }
        $acc = null;
        if ($cashBack > 0) {
            $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
            finEnsureFunds($pdo, $acc['id'], $cashBack, $date);
            $lines[] = ['account' => $acc['id'], 'credit' => $cashBack, 'party_id' => $sale['party_id']];
        }
        $txnId = finTxnInsert($pdo, ['type' => 'refund_sale', 'txn_date' => $date, 'party_id' => $sale['party_id'], 'money_account_id' => $acc['id'] ?? null, 'total' => $amount, 'paid' => $cashBack,
            'parent_txn_id' => $sale['id'], 'memo' => $d['memo'] ?? null, 'reason' => $d['reason'] ?? null, 'created_by' => $user]);
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'برگشت از فروش ' . $sale['ref'], 'lines' => $lines, 'source_type' => 'refund_sale', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user, 'reason' => $d['reason'] ?? null]);
        finLinkJournal($pdo, $txnId, $je);
        $pdo->prepare("UPDATE fin_txn SET returned = returned + ?, refunded = refunded + ? WHERE id = ?")->execute([$amount, $cashBack, $sale['id']]);
        finAudit($pdo, $user, 'create', 'refund_sale', $txnId, ['sale' => $sale['ref'], 'amount' => $amount, 'cash_back' => $cashBack]);
        return ['id' => $txnId, 'ref' => 'RET-' . $txnId, 'total' => $amount, 'cash_back' => $cashBack];
    });
}

/**
 * Cancel (reverse) a posted transaction. Documents with payments or returns must have those cancelled first.
 */
function finCancelTxn(PDO $pdo, int $id, string $reason, ?string $user = null): void
{
    if (trim($reason) === '') {
        throw new FinError('دلیل ابطال را بنویسید');
    }
    finAtomic($pdo, function () use ($pdo, $id, $reason, $user) {
        $t = finTxn($pdo, $id, true);
        if ($t['status'] !== 'posted') {
            throw new FinError('این تراکنش قبلاً ابطال شده است');
        }
        if (in_array($t['type'], ['receipt', 'payment'], true)) {
            $ret = $pdo->prepare("SELECT COUNT(*) FROM fin_alloc a JOIN fin_txn d ON d.id = a.doc_txn_id WHERE a.payment_txn_id = ? AND d.returned > 0");
            $ret->execute([$id]);
            if ((int) $ret->fetchColumn() > 0) {
                throw new FinError('این پرداخت به فاکتوری مربوط است که برگشت خورده؛ ابتدا برگشتی را ابطال کنید');
            }
        }
        if (in_array($t['type'], ['sale', 'purchase'], true)) {
            if ((int) $t['paid'] > 0 && $t['party_id'] !== null) { // a customer-less cash sale carries its money inside the sale itself
                throw new FinError('این سند پرداخت دارد؛ ابتدا پرداخت‌ها را ابطال کنید');
            }
            if ((int) $t['returned'] > 0) {
                throw new FinError('این سند برگشتی دارد؛ ابتدا برگشتی‌ها را ابطال کنید');
            }
        }
        if ($t['type'] === 'refund_sale') {
            $pdo->prepare("UPDATE fin_txn SET returned = GREATEST(0, returned - ?), refunded = GREATEST(0, refunded - ?) WHERE id = ?")->execute([(int) $t['total'], (int) $t['paid'], (int) $t['parent_txn_id']]);
        }
        if ($t['journal_id']) {
            finReverseEntry($pdo, (int) $t['journal_id'], $reason, $user);
        }
        $pdo->prepare("UPDATE fin_txn SET status = 'reversed', reason = ?, updated_by = ?, updated_at = ? WHERE id = ?")->execute([$reason, $user, time(), $id]);
        if (in_array($t['type'], ['receipt', 'payment'], true)) {
            $docs = $pdo->prepare("SELECT doc_txn_id FROM fin_alloc WHERE payment_txn_id = ?");
            $docs->execute([$id]);
            foreach ($docs->fetchAll(PDO::FETCH_COLUMN) as $docId) {
                finRecalcPaid($pdo, (int) $docId);
            }
        }
        finAudit($pdo, $user, 'cancel', $t['type'], $id, ['reason' => $reason]);
    });
}

// ------------------------------------------------------------------ loans & assets

/** Borrowed money (direction 'borrowed': Dr money, Cr loan payable) or lent money ('lent': Dr loan receivable, Cr money). Principal is never revenue/expense. */
function finCreateLoan(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $date = finParseDate($d['date'] ?? '');
        $amount = finAmount($d['principal'] ?? $d['amount'] ?? 0, 'اصل وام');
        $dir = ($d['direction'] ?? 'borrowed') === 'lent' ? 'lent' : 'borrowed';
        $party = finParty($pdo, $d['party_id'] ?? 0);
        $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
        $rate = (float) ($d['interest_rate'] ?? 0);
        if ($dir === 'lent') {
            finEnsureFunds($pdo, $acc['id'], $amount, $date);
        }
        $pdo->prepare("INSERT INTO fin_loans (party_id, direction, principal, interest_rate, start_date, installments, note, created_at) VALUES (?,?,?,?,?,?,?,?)")
            ->execute([$party['id'], $dir, $amount, $rate, $date, max(1, (int) ($d['installments'] ?? 1)), $d['memo'] ?? null, time()]);
        $loanId = (int) $pdo->lastInsertId();
        $txnId = finTxnInsert($pdo, ['type' => $dir === 'borrowed' ? 'loan_in' : 'loan_out', 'txn_date' => $date, 'party_id' => $party['id'], 'money_account_id' => $acc['id'], 'total' => $amount, 'paid' => $amount,
            'loan_id' => $loanId, 'memo' => $d['memo'] ?? null, 'created_by' => $user]);
        $lines = $dir === 'borrowed' ? [['account' => $acc['id'], 'debit' => $amount, 'party_id' => $party['id']], ['account' => 'loan_payable', 'credit' => $amount, 'party_id' => $party['id']]]
                                     : [['account' => 'loan_receivable', 'debit' => $amount, 'party_id' => $party['id']], ['account' => $acc['id'], 'credit' => $amount, 'party_id' => $party['id']]];
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => $dir === 'borrowed' ? 'دریافت وام از ' . $party['name'] : 'پرداخت وام به ' . $party['name'], 'lines' => $lines,
            'source_type' => 'loan', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'loan', $loanId, ['direction' => $dir, 'principal' => $amount]);
        return ['id' => $loanId, 'txn_id' => $txnId, 'ref' => ($dir === 'borrowed' ? 'LOAN-' : 'LEND-') . $txnId];
    });
}

function finLoanRemaining(PDO $pdo, int $loanId): int
{
    $l = $pdo->prepare("SELECT principal FROM fin_loans WHERE id = ?");
    $l->execute([$loanId]);
    $principal = (int) $l->fetchColumn();
    $r = $pdo->prepare("SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(meta,'$.principal')) AS SIGNED)),0) FROM fin_txn WHERE loan_id = ? AND type = 'loan_payment' AND status = 'posted'");
    $r->execute([$loanId]);
    return $principal - (int) $r->fetchColumn();
}

/** One installment: principal reduces the loan balance, interest is an expense (borrowed) or income (lent). */
function finLoanPayment(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $loan = $pdo->prepare("SELECT * FROM fin_loans WHERE id = ? FOR UPDATE");
        $loan->execute([(int) ($d['loan_id'] ?? 0)]);
        $loan = $loan->fetch(PDO::FETCH_ASSOC);
        if (!$loan) {
            throw new FinError('وام پیدا نشد', 404);
        }
        $date = finParseDate($d['date'] ?? '');
        $principal = finAmount($d['principal'] ?? 0, 'اصل قسط', true);
        $interest = finAmount($d['interest'] ?? 0, 'سود قسط', true);
        if ($principal + $interest <= 0) {
            throw new FinError('مبلغ قسط باید بیشتر از صفر باشد');
        }
        $remaining = finLoanRemaining($pdo, (int) $loan['id']);
        if ($principal > $remaining) {
            throw new FinError('اصل قسط از مانده‌ی وام بیشتر است (مانده: ' . number_format($remaining) . ' تومان)');
        }
        $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
        $borrowed = $loan['direction'] === 'borrowed';
        if ($borrowed) {
            finEnsureFunds($pdo, $acc['id'], $principal + $interest, $date);
        }
        $txnId = finTxnInsert($pdo, ['type' => 'loan_payment', 'txn_date' => $date, 'party_id' => $loan['party_id'], 'money_account_id' => $acc['id'], 'total' => $principal + $interest, 'paid' => $principal + $interest,
            'loan_id' => $loan['id'], 'memo' => $d['memo'] ?? null, 'meta' => json_encode(['principal' => $principal, 'interest' => $interest]), 'created_by' => $user]);
        $lines = [];
        if ($borrowed) {
            if ($principal > 0) {
                $lines[] = ['account' => 'loan_payable', 'debit' => $principal, 'party_id' => $loan['party_id']];
            }
            if ($interest > 0) {
                $lines[] = ['account' => 'exp_interest', 'debit' => $interest, 'party_id' => $loan['party_id']];
            }
            $lines[] = ['account' => $acc['id'], 'credit' => $principal + $interest, 'party_id' => $loan['party_id']];
        } else {
            $lines[] = ['account' => $acc['id'], 'debit' => $principal + $interest, 'party_id' => $loan['party_id']];
            if ($principal > 0) {
                $lines[] = ['account' => 'loan_receivable', 'credit' => $principal, 'party_id' => $loan['party_id']];
            }
            if ($interest > 0) {
                $lines[] = ['account' => 'revenue_interest', 'credit' => $interest, 'party_id' => $loan['party_id']];
            }
        }
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'قسط وام', 'lines' => $lines, 'source_type' => 'loan_payment', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user]);
        finLinkJournal($pdo, $txnId, $je);
        if (finLoanRemaining($pdo, (int) $loan['id']) <= 0) {
            $pdo->prepare("UPDATE fin_loans SET status = 'closed' WHERE id = ?")->execute([$loan['id']]);
        }
        finAudit($pdo, $user, 'create', 'loan_payment', $txnId, ['principal' => $principal, 'interest' => $interest]);
        return ['id' => $txnId, 'ref' => 'LPAY-' . $txnId];
    });
}

/** Buy a fixed asset (Dr asset account, Cr money/payable) and register it for depreciation. */
function finBuyAsset(PDO $pdo, array $d, ?string $user = null): array
{
    return finAtomic($pdo, function () use ($pdo, $d, $user) {
        $date = finParseDate($d['date'] ?? '');
        $cost = finAmount($d['cost'] ?? 0, 'بهای خرید');
        $name = trim((string) ($d['name'] ?? ''));
        if ($name === '') {
            throw new FinError('نام دارایی لازم است');
        }
        $acct = finAccountOrFail($pdo, $d['asset_account'] ?? 'fixed_equipment', ['asset']);
        if (finIsMoney($acct) || $acct['system_key'] === 'accum_dep' || strncmp($acct['code'], '15', 2) !== 0) {
            throw new FinError('حساب دارایی ثابت نامعتبر است');
        }
        $life = max(1, (int) ($d['useful_life_months'] ?? 36));
        $salvage = finAmount($d['salvage'] ?? 0, 'ارزش اسقاط', true);
        if ($salvage >= $cost) {
            throw new FinError('ارزش اسقاط باید کمتر از بهای خرید باشد');
        }
        $partyId = !empty($d['party_id']) ? (int) finParty($pdo, $d['party_id'])['id'] : null;
        $onCredit = !empty($d['on_credit']);
        if ($onCredit && $partyId === null) {
            throw new FinError('برای خرید نسیه، تأمین‌کننده را انتخاب کنید');
        }
        $pdo->prepare("INSERT INTO fin_assets (name, class, asset_account_id, cost, salvage, purchase_date, useful_life_months, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
            ->execute([$name, $d['class'] ?? 'equipment', $acct['id'], $cost, $salvage, $date, $life, $d['memo'] ?? null, time()]);
        $assetId = (int) $pdo->lastInsertId();
        if ($onCredit) {
            $txnId = finTxnInsert($pdo, ['type' => 'purchase', 'txn_date' => $date, 'party_id' => $partyId, 'category_account_id' => $acct['id'], 'subtotal' => $cost, 'total' => $cost, 'asset_id' => $assetId,
                'due_date' => !empty($d['due_date']) ? finParseDate($d['due_date']) : null, 'memo' => $name, 'meta' => json_encode(['asset' => true]), 'created_by' => $user]);
            $lines = [['account' => $acct['id'], 'debit' => $cost], ['account' => 'ap', 'credit' => $cost, 'party_id' => $partyId]];
        } else {
            $acc = finMoneyAccount($pdo, $d['money_account'] ?? 'cash');
            finEnsureFunds($pdo, $acc['id'], $cost, $date);
            $txnId = finTxnInsert($pdo, ['type' => 'asset_purchase', 'txn_date' => $date, 'party_id' => $partyId, 'money_account_id' => $acc['id'], 'category_account_id' => $acct['id'], 'subtotal' => $cost, 'total' => $cost,
                'paid' => $cost, 'asset_id' => $assetId, 'memo' => $name, 'created_by' => $user]);
            $lines = [['account' => $acct['id'], 'debit' => $cost], ['account' => $acc['id'], 'credit' => $cost]];
        }
        $je = finPostEntry($pdo, ['date' => $date, 'memo' => 'خرید دارایی ' . $name, 'lines' => $lines, 'source_type' => 'asset_purchase', 'source_id' => $txnId, 'txn_id' => $txnId, 'user' => $user]);
        finLinkJournal($pdo, $txnId, $je);
        finAudit($pdo, $user, 'create', 'asset', $assetId, ['name' => $name, 'cost' => $cost]);
        return ['id' => $assetId, 'txn_id' => $txnId];
    });
}

/** Straight-line monthly depreciation up to $asOf; idempotent per asset+month (source_key). Returns the number of entries posted. */
function finDepreciate(PDO $pdo, ?int $asOf = null, ?string $user = null): int
{
    $asOf = $asOf ?? time();
    $n = 0;
    foreach ($pdo->query("SELECT * FROM fin_assets WHERE status = 'active'")->fetchAll(PDO::FETCH_ASSOC) as $a) {
        $monthly = (int) floor(((int) $a['cost'] - (int) $a['salvage']) / max(1, (int) $a['useful_life_months']));
        if ($monthly <= 0) {
            continue;
        }
        $start = (new DateTime('@' . $a['purchase_date']))->setTimezone(new DateTimeZone('Asia/Tehran'));
        $cursor = (clone $start)->modify('first day of next month')->setTime(0, 0, 0);
        $depreciated = 0;
        for ($m = 1; $m <= (int) $a['useful_life_months']; $m++) {
            $when = (clone $cursor)->modify('-1 second'); // end of the month that just finished
            if ($when->getTimestamp() > $asOf) {
                break;
            }
            $amount = min($monthly, (int) $a['cost'] - (int) $a['salvage'] - $depreciated);
            if ($amount <= 0) {
                break;
            }
            $key = 'dep:' . $a['id'] . ':' . $when->format('Ym');
            $before = (int) $pdo->query("SELECT COUNT(*) FROM fin_journal WHERE source_key = " . $pdo->quote($key))->fetchColumn();
            if ($before === 0) {
                finPostEntry($pdo, ['date' => $when->getTimestamp(), 'memo' => 'استهلاک ' . $a['name'] . ' ' . $when->format('Y-m'), 'source_type' => 'depreciation', 'source_id' => $a['id'], 'source_key' => $key, 'user' => $user,
                    'lines' => [['account' => 'exp_depreciation', 'debit' => $amount], ['account' => 'accum_dep', 'credit' => $amount]]]);
                $n++;
            }
            $depreciated += $amount;
            $cursor->modify('first day of next month');
        }
    }
    return $n;
}

// ------------------------------------------------------------------ chart of accounts management

function finSaveAccount(PDO $pdo, array $d, ?string $user = null): int
{
    $name = trim((string) ($d['name'] ?? ''));
    $code = trim((string) ($d['code'] ?? ''));
    if ($name === '' || !preg_match('/^\d{3,10}$/', $code)) {
        throw new FinError('نام و کد حساب (۳ تا ۱۰ رقم) لازم است');
    }
    $type = (string) ($d['type'] ?? '');
    if (!in_array($type, ['asset', 'liability', 'equity', 'revenue', 'expense'], true)) {
        throw new FinError('نوع حساب نامعتبر است');
    }
    $moneyKind = ($d['money_kind'] ?? '') !== '' ? (string) $d['money_kind'] : null;
    if ($moneyKind !== null && ($type !== 'asset' || !in_array($moneyKind, ['cash', 'bank', 'gateway', 'wallet', 'crypto', 'other'], true))) {
        throw new FinError('فقط حساب‌های دارایی می‌توانند صندوق/بانک باشند');
    }
    return finAtomic($pdo, function () use ($pdo, $d, $name, $code, $type, $moneyKind, $user) {
        $dup = $pdo->prepare("SELECT id FROM fin_accounts WHERE code = ? AND id != ?");
        $dup->execute([$code, (int) ($d['id'] ?? 0)]);
        if ($dup->fetchColumn()) {
            throw new FinError('این کد حساب قبلاً استفاده شده است');
        }
        if (!empty($d['id'])) {
            $cur = finAccount($pdo, (int) $d['id']);
            if (!$cur) {
                throw new FinError('حساب پیدا نشد', 404);
            }
            if ($cur['type'] !== $type && (int) $pdo->query("SELECT COUNT(*) FROM fin_journal_lines WHERE account_id = " . (int) $cur['id'])->fetchColumn() > 0) {
                throw new FinError('نوع حسابی که سند دارد قابل تغییر نیست');
            }
            if (!empty($d['archived']) && finIsMoney($cur) && finAccountBalance($pdo, $cur['id']) !== 0) {
                throw new FinError('حساب دارای موجودی را نمی‌شود بایگانی کرد؛ اول موجودی را منتقل کنید');
            }
            $pdo->prepare("UPDATE fin_accounts SET code=?, name=?, type=?, parent_code=?, money_kind=?, is_postable=?, allow_negative=?, archived=?, sort_order=? WHERE id=?")
                ->execute([$code, $name, $type, $d['parent_code'] ?? $cur['parent_code'], $moneyKind, isset($d['is_postable']) ? (int) (bool) $d['is_postable'] : $cur['is_postable'],
                    isset($d['allow_negative']) ? (int) (bool) $d['allow_negative'] : $cur['allow_negative'], !empty($d['archived']) ? 1 : 0, (int) ($d['sort_order'] ?? $cur['sort_order']), (int) $d['id']]);
            $id = (int) $d['id'];
            finAudit($pdo, $user, 'update', 'account', $id, ['code' => $code, 'name' => $name]);
        } else {
            $pdo->prepare("INSERT INTO fin_accounts (code, name, type, parent_code, money_kind, is_postable, allow_negative, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
                ->execute([$code, $name, $type, $d['parent_code'] ?? null, $moneyKind, isset($d['is_postable']) ? (int) (bool) $d['is_postable'] : 1, !empty($d['allow_negative']) ? 1 : 0, (int) ($d['sort_order'] ?? 500), time()]);
            $id = (int) $pdo->lastInsertId();
            finAudit($pdo, $user, 'create', 'account', $id, ['code' => $code, 'name' => $name]);
        }
        finAccountsCache(null, true);
        return $id;
    });
}

// ------------------------------------------------------------------ permissions

function finPermissionCatalog(): array
{
    return [
        'view' => 'مشاهده مالی', 'sale.create' => 'ثبت فروش', 'sale.cancel' => 'ابطال/برگشت فروش', 'purchase.create' => 'ثبت خرید', 'expense.create' => 'ثبت هزینه',
        'payment.manage' => 'مدیریت پرداخت‌ها', 'accounts.manage' => 'مدیریت صندوق و بانک', 'capital.manage' => 'سرمایه و شرکا', 'reports.view' => 'مشاهده گزارش‌ها',
        'reports.export' => 'خروجی گزارش‌ها', 'chart.manage' => 'مدیریت سرفصل حساب‌ها', 'approve' => 'تأیید تراکنش‌ها', 'sensitive' => 'اطلاعات حساس مالی',
    ];
}

/** Role -> permissions. administrator = everything. Other roles get what is stored in fin_settings «perm:<role>» (JSON list), none by default. */
function finCan(PDO $pdo, ?string $role, string $perm): bool
{
    if ($role === 'administrator') {
        return true;
    }
    if (!$role) {
        return false;
    }
    $list = json_decode((string) finSetting($pdo, 'perm:' . $role, '[]'), true);
    return is_array($list) && (in_array('*', $list, true) || in_array($perm, $list, true));
}
