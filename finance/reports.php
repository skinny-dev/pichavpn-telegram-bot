<?php
// Financial reports and read models: overview, P&L, balance sheet, cash flow, trial balance, ledger, receivables/payables,
// activity timeline, search and party profile. Everything is derived from the journal (the authoritative record).

require_once __DIR__ . '/engine.php';
if (!function_exists('statsPeriod')) {
    require_once __DIR__ . '/../stats_report.php';
}

const FIN_COUNTED = "('posted','reversed')"; // reversed originals stay in the books: the mirror entry nets them to zero

/** [start, end, title] for today|week|month|quarter|year|all|custom (Tehran time, Jalali calendar) */
function finRange(string $key, ?int $from = null, ?int $to = null): array
{
    $now = time();
    $tz = new DateTimeZone('Asia/Tehran');
    $mk = function (int $jy, int $jm, int $jd) use ($tz) {
        [$gy, $gm, $gd] = jalali_to_gregorian($jy, $jm, $jd);
        return (new DateTime(sprintf('%04d-%02d-%02d 00:00:00', $gy, $gm, $gd), $tz))->getTimestamp();
    };
    [$jy, $jm] = array_map('intval', explode('/', jdate('Y/n', $now, '', 'Asia/Tehran', 'en')));
    switch ($key) {
        case 'today':
            return ['start' => statsPeriod('today')['start'], 'end' => $now, 'title' => 'امروز'];
        case 'week':
            $d0 = (new DateTime('@' . $now))->setTimezone($tz)->setTime(0, 0, 0);
            $d0->modify('-' . ((((int) $d0->format('w')) + 1) % 7) . ' days'); // weeks start on Saturday
            return ['start' => $d0->getTimestamp(), 'end' => $now, 'title' => 'این هفته'];
        case 'month':
            return ['start' => $mk($jy, $jm, 1), 'end' => $now, 'title' => 'این ماه'];
        case 'quarter':
            return ['start' => $mk($jy, intdiv($jm - 1, 3) * 3 + 1, 1), 'end' => $now, 'title' => 'این فصل'];
        case 'year':
            return ['start' => $mk($jy, 1, 1), 'end' => $now, 'title' => 'امسال'];
        case 'custom':
            if ($from === null || $to === null || $from > $to) {
                throw new FinError('بازه‌ی زمانی نامعتبر است');
            }
            return ['start' => $from, 'end' => $to, 'title' => 'بازه‌ی دلخواه'];
        default:
            return ['start' => 0, 'end' => $now, 'title' => 'از ابتدا'];
    }
}

/** [accountId => [d, c]] for entries dated within [$from, $to] */
function finSums(PDO $pdo, int $from, int $to): array
{
    $st = $pdo->prepare("SELECT l.account_id, SUM(l.debit) d, SUM(l.credit) c FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id
                         WHERE j.status IN " . FIN_COUNTED . " AND j.entry_date BETWEEN ? AND ? GROUP BY l.account_id");
    $st->execute([$from, $to]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[(int) $r['account_id']] = ['d' => (int) $r['d'], 'c' => (int) $r['c']];
    }
    return $out;
}

function finNatural(array $acct, array $s): int
{
    return finNaturalDebit($acct) ? $s['d'] - $s['c'] : $s['c'] - $s['d'];
}

function finAllAccounts(PDO $pdo, bool $withArchived = true): array
{
    finAccountsCache($pdo);
    $c = finAccountsCache($pdo)['id'];
    uasort($c, fn($a, $b) => strcmp($a['code'], $b['code']));
    return $withArchived ? array_values($c) : array_values(array_filter($c, fn($a) => (int) $a['archived'] === 0));
}

// ------------------------------------------------------------------ profit & loss

/** group of an income-statement account: sales | cogs | opex | other_income | other_expense */
function finPlGroup(array $a): string
{
    $c = $a['code'];
    if ($a['type'] === 'revenue') {
        return (strncmp($c, '43', 2) === 0 || strncmp($c, '44', 2) === 0) ? 'other_income' : 'sales';
    }
    if (strncmp($c, '51', 2) === 0) {
        return 'cogs';
    }
    if (strncmp($c, '55', 2) === 0) {
        return 'other_expense';
    }
    return 'opex';
}

function finProfitLoss(PDO $pdo, int $from, int $to): array
{
    $sums = finSums($pdo, $from, $to);
    $groups = ['sales' => [], 'cogs' => [], 'opex' => [], 'other_income' => [], 'other_expense' => []];
    $tot = array_fill_keys(array_keys($groups), 0);
    foreach (finAllAccounts($pdo) as $a) {
        if (!in_array($a['type'], ['revenue', 'expense'], true) || !isset($sums[(int) $a['id']])) {
            continue;
        }
        $v = finNatural($a, $sums[(int) $a['id']]);
        if ($v === 0) {
            continue;
        }
        $g = finPlGroup($a);
        $groups[$g][] = ['id' => (int) $a['id'], 'code' => $a['code'], 'name' => $a['name'], 'amount' => $v];
        $tot[$g] += $v;
    }
    $gross = $tot['sales'] - $tot['cogs'];
    $operating = $gross - $tot['opex'];
    $net = $operating + $tot['other_income'] - $tot['other_expense'];
    return ['from' => $from, 'to' => $to, 'groups' => $groups, 'totals' => $tot, 'gross_profit' => $gross, 'operating_profit' => $operating, 'net_profit' => $net,
        'gross_margin' => $tot['sales'] > 0 ? round($gross * 100 / $tot['sales'], 1) : null, 'net_margin' => $tot['sales'] > 0 ? round($net * 100 / $tot['sales'], 1) : null];
}

// ------------------------------------------------------------------ balance sheet

function finBalanceSheet(PDO $pdo, ?int $asOf = null): array
{
    $asOf = $asOf ?? time();
    $sums = finSums($pdo, 0, $asOf);
    $sec = ['asset' => [], 'liability' => [], 'equity' => []];
    $tot = ['asset' => 0, 'liability' => 0, 'equity' => 0];
    $earn = 0;
    foreach (finAllAccounts($pdo) as $a) {
        $s = $sums[(int) $a['id']] ?? ['d' => 0, 'c' => 0];
        $v = finNatural($a, $s);
        if ($a['type'] === 'revenue') {
            $earn += $v;
        } elseif ($a['type'] === 'expense') {
            $earn -= $v;
        } else {
            if ($v !== 0) {
                $sec[$a['type']][] = ['id' => (int) $a['id'], 'code' => $a['code'], 'name' => $a['name'], 'amount' => $v];
            }
            $tot[$a['type']] += $v;
        }
    }
    $equityTotal = $tot['equity'] + $earn;
    return ['as_of' => $asOf, 'assets' => $sec['asset'], 'liabilities' => $sec['liability'], 'equity' => $sec['equity'], 'current_earnings' => $earn,
        'totals' => ['assets' => $tot['asset'], 'liabilities' => $tot['liability'], 'equity' => $equityTotal, 'liabilities_and_equity' => $tot['liability'] + $equityTotal],
        'balanced' => $tot['asset'] === $tot['liability'] + $equityTotal];
}

// ------------------------------------------------------------------ cash flow

function finCashClass(array $a): string
{
    $k = (string) $a['system_key'];
    if (strncmp($a['code'], '15', 2) === 0 || $k === 'loan_receivable') {
        return 'investing';
    }
    if (in_array($k, ['capital', 'drawings', 'dividends', 'loan_payable', 'retained'], true)) {
        return 'financing';
    }
    return 'operating';
}

function finMoneyTotal(PDO $pdo, ?int $asOf): int
{
    $sum = 0;
    foreach (finAllAccounts($pdo) as $a) {
        if (finIsMoney($a)) {
            $sum += finAccountBalance($pdo, $a['id'], $asOf);
        }
    }
    return $sum;
}

function finCashFlow(PDO $pdo, int $from, int $to): array
{
    $st = $pdo->prepare("SELECT a.id, a.code, a.name, a.system_key, SUM(l.credit - l.debit) f
        FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id
        WHERE j.status IN " . FIN_COUNTED . " AND j.entry_date BETWEEN ? AND ? AND (a.money_kind IS NULL OR a.money_kind = '')
          AND EXISTS (SELECT 1 FROM fin_journal_lines l2 JOIN fin_accounts a2 ON a2.id = l2.account_id WHERE l2.entry_id = l.entry_id AND a2.money_kind IS NOT NULL AND a2.money_kind != '')
        GROUP BY a.id, a.code, a.name, a.system_key HAVING f != 0 ORDER BY a.code");
    $st->execute([$from, $to]);
    $sec = ['operating' => [], 'investing' => [], 'financing' => []];
    $tot = ['operating' => 0, 'investing' => 0, 'financing' => 0];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $cls = finCashClass($r);
        $sec[$cls][] = ['code' => $r['code'], 'name' => $r['name'], 'amount' => (int) $r['f']];
        $tot[$cls] += (int) $r['f'];
    }
    $net = array_sum($tot);
    $opening = finMoneyTotal($pdo, $from - 1);
    $closing = finMoneyTotal($pdo, $to);
    return ['from' => $from, 'to' => $to, 'sections' => $sec, 'totals' => $tot, 'net_change' => $net, 'opening' => $opening, 'closing' => $closing, 'reconciled' => $opening + $net === $closing];
}

// ------------------------------------------------------------------ trial balance & ledger

function finTrialBalance(PDO $pdo, ?int $asOf = null): array
{
    $sums = finSums($pdo, 0, $asOf ?? time());
    $rows = [];
    $td = $tc = 0;
    foreach (finAllAccounts($pdo) as $a) {
        $s = $sums[(int) $a['id']] ?? null;
        if (!$s || ($s['d'] === 0 && $s['c'] === 0)) {
            continue;
        }
        $bal = $s['d'] - $s['c'];
        $rows[] = ['id' => (int) $a['id'], 'code' => $a['code'], 'name' => $a['name'], 'type' => $a['type'], 'debit' => $s['d'], 'credit' => $s['c'], 'balance_debit' => max(0, $bal), 'balance_credit' => max(0, -$bal)];
        $td += max(0, $bal);
        $tc += max(0, -$bal);
    }
    return ['rows' => $rows, 'total_debit' => $td, 'total_credit' => $tc, 'balanced' => $td === $tc];
}

/** Account ledger with running balance (natural side), newest last within the page; opening balance from before $from. */
function finLedger(PDO $pdo, $account, int $from, int $to, int $page = 1, int $per = 100, ?int $partyId = null): array
{
    $a = finAccountOrFail($pdo, $account, null, false);
    $natural = finNaturalDebit($a);
    $pw = $partyId ? " AND l.party_id = " . (int) $partyId : '';
    $open = $pdo->prepare("SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id
                           WHERE l.account_id = ? AND j.status IN " . FIN_COUNTED . " AND j.entry_date < ?$pw");
    $open->execute([$a['id'], $from]);
    $o = $open->fetch(PDO::FETCH_ASSOC);
    $opening = $natural ? (int) $o['d'] - (int) $o['c'] : (int) $o['c'] - (int) $o['d'];
    $cnt = $pdo->prepare("SELECT COUNT(*) FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status IN " . FIN_COUNTED . " AND j.entry_date BETWEEN ? AND ?$pw");
    $cnt->execute([$a['id'], $from, $to]);
    $total = (int) $cnt->fetchColumn();
    $per = max(10, min(500, $per));
    $page = max(1, $page);
    // running balance needs everything before this page: sum the rows that precede it
    $skip = ($page - 1) * $per;
    $pre = 0;
    if ($skip > 0) {
        $p = $pdo->prepare("SELECT COALESCE(SUM(x.debit),0) d, COALESCE(SUM(x.credit),0) c FROM (SELECT l.debit, l.credit FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id
              WHERE l.account_id = ? AND j.status IN " . FIN_COUNTED . " AND j.entry_date BETWEEN ? AND ?$pw ORDER BY j.entry_date, j.id, l.id LIMIT $skip) x");
        $p->execute([$a['id'], $from, $to]);
        $pp = $p->fetch(PDO::FETCH_ASSOC);
        $pre = $natural ? (int) $pp['d'] - (int) $pp['c'] : (int) $pp['c'] - (int) $pp['d'];
    }
    $st = $pdo->prepare("SELECT j.id entry_id, j.entry_no, j.entry_date, j.memo, j.source_type, j.txn_id, l.debit, l.credit, l.party_id, p.name party_name
        FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id LEFT JOIN fin_parties p ON p.id = l.party_id
        WHERE l.account_id = ? AND j.status IN " . FIN_COUNTED . " AND j.entry_date BETWEEN ? AND ?$pw ORDER BY j.entry_date, j.id, l.id LIMIT $per OFFSET $skip");
    $st->execute([$a['id'], $from, $to]);
    $run = $opening + $pre;
    $rows = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $run += $natural ? (int) $r['debit'] - (int) $r['credit'] : (int) $r['credit'] - (int) $r['debit'];
        $rows[] = $r + ['balance' => $run];
    }
    // money boxes: how much came in / went out of it, by kind (capital added, owner withdrawals, expenses, transfers …)
    $breakdown = [];
    if (!empty($a['money_kind'])) {
        $b = $pdo->prepare("SELECT COALESCE(t.type, j.source_type, 'other') k, COALESCE(SUM(l.debit),0) inn, COALESCE(SUM(l.credit),0) outt
            FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id LEFT JOIN fin_txn t ON t.id = j.txn_id
            WHERE l.account_id = ? AND j.status IN " . FIN_COUNTED . " AND j.entry_date BETWEEN ? AND ?$pw GROUP BY k ORDER BY (SUM(l.debit) + SUM(l.credit)) DESC");
        $b->execute([$a['id'], $from, $to]);
        foreach ($b->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $breakdown[] = ['kind' => (string) $r['k'], 'in' => (int) $r['inn'], 'out' => (int) $r['outt']];
        }
    }
    return ['account' => ['id' => (int) $a['id'], 'code' => $a['code'], 'name' => $a['name'], 'type' => $a['type']], 'opening' => $opening, 'rows' => $rows, 'total' => $total, 'page' => $page, 'per' => $per,
        'closing' => finAccountBalance($pdo, $a['id'], $to), 'breakdown' => $breakdown];
}

// ------------------------------------------------------------------ money accounts

function finMoneyAccounts(PDO $pdo): array
{
    $out = [];
    $since = time() - 30 * 86400;
    foreach (finAllAccounts($pdo) as $a) {
        if (!finIsMoney($a)) {
            continue;
        }
        $bal = finAccountBalance($pdo, $a['id']);
        $st = $pdo->prepare("SELECT COALESCE(SUM(l.debit),0) i, COALESCE(SUM(l.credit),0) o FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id
                             WHERE l.account_id = ? AND j.status IN " . FIN_COUNTED . " AND j.entry_date >= ?");
        $st->execute([$a['id'], $since]);
        $io = $st->fetch(PDO::FETCH_ASSOC);
        $last = $pdo->prepare("SELECT MAX(j.entry_date) FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status IN " . FIN_COUNTED);
        $last->execute([$a['id']]);
        $out[] = ['id' => (int) $a['id'], 'code' => $a['code'], 'name' => $a['name'], 'kind' => $a['money_kind'], 'balance' => $bal, 'incoming_30d' => (int) $io['i'], 'outgoing_30d' => (int) $io['o'],
            'last_activity' => $last->fetchColumn() ?: null, 'archived' => (int) $a['archived'], 'allow_negative' => (int) $a['allow_negative']];
    }
    return $out;
}

// ------------------------------------------------------------------ overview (dashboard KPIs)

function finOverview(PDO $pdo, int $from, int $to): array
{
    $pl = finProfitLoss($pdo, $from, $to);
    $bs = finBalanceSheet($pdo, $to);
    $money = ['cash' => 0, 'bank' => 0, 'other' => 0];
    foreach (finMoneyAccounts($pdo) as $m) {
        if ($m['archived']) {
            continue;
        }
        $money[$m['kind'] === 'cash' ? 'cash' : ($m['kind'] === 'bank' ? 'bank' : 'other')] += $m['balance'];
    }
    $bal = function (string $key) use ($pdo, $to) {
        $a = finAccount($pdo, $key);
        return $a ? finAccountBalance($pdo, $a['id'], $to) : 0;
    };
    $overdue = $pdo->prepare("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE type = ? AND status = 'posted' AND due_date IS NOT NULL AND due_date < ? AND total - paid - (returned - refunded) > 0");
    $overdue->execute(['sale', time()]);
    $overdueAr = (int) $overdue->fetchColumn();
    $overdue->execute(['purchase', time()]);
    $overdueAp = (int) $overdue->fetchColumn();
    // revenue vs expense per day (or per month for long ranges)
    $span = max(1, (int) ceil(($to - $from) / 86400));
    $fmt = $span > 100 ? '%Y-%m' : '%Y-%m-%d';
    $st = $pdo->prepare("SELECT DATE_FORMAT(FROM_UNIXTIME(j.entry_date + 12600), '$fmt') k, a.type t, SUM(l.credit - l.debit) v
        FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id
        WHERE j.status IN " . FIN_COUNTED . " AND j.entry_date BETWEEN ? AND ? AND a.type IN ('revenue','expense') GROUP BY k, t ORDER BY k");
    $st->execute([$from, $to]);
    $series = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $series[$r['k']] = ($series[$r['k']] ?? ['date' => $r['k'], 'revenue' => 0, 'expense' => 0]);
        $series[$r['k']][$r['t'] === 'revenue' ? 'revenue' : 'expense'] += $r['t'] === 'revenue' ? (int) $r['v'] : -(int) $r['v'];
    }
    $wallet = 0;
    try {
        $wallet = (int) $pdo->query("SELECT COALESCE(SUM(Balance),0) FROM user")->fetchColumn();
    } catch (Throwable $e) {
    }
    return [
        'range' => ['from' => $from, 'to' => $to],
        'cash' => $money['cash'], 'bank' => $money['bank'], 'other_money' => $money['other'], 'money_total' => array_sum($money),
        'revenue' => $pl['totals']['sales'] + $pl['totals']['other_income'], 'sales' => $pl['totals']['sales'], 'cogs' => $pl['totals']['cogs'],
        'expenses' => $pl['totals']['opex'] + $pl['totals']['other_expense'], 'gross_profit' => $pl['gross_profit'], 'net_profit' => $pl['net_profit'],
        'net_margin' => $pl['net_margin'], 'receivables' => $bal('ar'), 'payables' => $bal('ap'), 'overdue_receivables' => $overdueAr, 'overdue_payables' => $overdueAp,
        'inventory' => $bal('inventory'), 'tax_payable' => $bal('tax_payable'), 'loans_payable' => $bal('loan_payable'), 'loans_receivable' => $bal('loan_receivable'),
        'capital' => $bal('capital'), 'equity' => $bs['totals']['equity'], 'customer_wallets_info' => $wallet, 'series' => array_values($series),
    ];
}

// ------------------------------------------------------------------ receivables / payables

function finAging(PDO $pdo, string $docType): array
{
    $now = time();
    $today0 = statsPeriod('today')['start'];
    $st = $pdo->prepare("SELECT t.*, p.name party_name FROM fin_txn t LEFT JOIN fin_parties p ON p.id = t.party_id
                         WHERE t.type = ? AND t.status = 'posted' AND t.total - t.paid - (t.returned - t.refunded) > 0 ORDER BY COALESCE(t.due_date, t.txn_date), t.id");
    $st->execute([$docType]);
    $sum = ['total' => 0, 'overdue' => 0, 'due_today' => 0, 'due_soon' => 0, 'later' => 0, 'no_due' => 0];
    $parties = [];
    $docs = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $t) {
        $out = finOutstanding($t);
        $due = $t['due_date'] !== null ? (int) $t['due_date'] : null;
        $bucket = $due === null ? 'no_due' : ($due < $today0 ? 'overdue' : ($due < $today0 + 86400 ? 'due_today' : ($due < $today0 + 8 * 86400 ? 'due_soon' : 'later')));
        $sum[$bucket] += $out;
        $sum['total'] += $out;
        $pid = (int) $t['party_id'];
        $parties[$pid] = $parties[$pid] ?? ['party_id' => $pid, 'name' => $t['party_name'] ?? '—', 'total' => 0, 'paid' => 0, 'remaining' => 0, 'overdue' => 0, 'next_due' => null, 'docs' => 0];
        $parties[$pid]['total'] += (int) $t['total'];
        $parties[$pid]['paid'] += (int) $t['paid'];
        $parties[$pid]['remaining'] += $out;
        $parties[$pid]['docs']++;
        if ($bucket === 'overdue') {
            $parties[$pid]['overdue'] += $out;
        }
        if ($due !== null && ($parties[$pid]['next_due'] === null || $due < $parties[$pid]['next_due'])) {
            $parties[$pid]['next_due'] = $due;
        }
        $docs[] = ['id' => (int) $t['id'], 'ref' => $t['ref'], 'party_id' => $pid, 'party_name' => $t['party_name'], 'date' => (int) $t['txn_date'], 'due_date' => $due, 'total' => (int) $t['total'],
            'paid' => (int) $t['paid'], 'outstanding' => $out, 'state' => finDocState($t, $now), 'bucket' => $bucket];
    }
    $collected = $pdo->prepare("SELECT COALESCE(SUM(paid),0) FROM fin_txn WHERE type = ? AND status = 'posted'");
    $collected->execute([$docType]);
    $last = $pdo->prepare("SELECT MAX(p.txn_date) FROM fin_txn p WHERE p.party_id = ? AND p.type = ? AND p.status = 'posted'");
    $list = array_values($parties);
    usort($list, fn($a, $b) => $b['remaining'] <=> $a['remaining']);
    foreach ($list as &$pa) {
        $last->execute([$pa['party_id'], $docType === 'sale' ? 'receipt' : 'payment']);
        $pa['last_payment'] = $last->fetchColumn() ?: null;
    }
    unset($pa);
    return ['summary' => $sum + ['collected' => (int) $collected->fetchColumn()], 'parties' => $list, 'docs' => $docs];
}

// ------------------------------------------------------------------ activity / timeline

function finActivityTitle(array $j): string
{
    static $labels = ['sale' => 'فروش', 'purchase' => 'خرید', 'expense' => 'هزینه', 'income' => 'درآمد', 'receipt' => 'دریافت پول', 'payment' => 'پرداخت',
        'transfer' => 'انتقال', 'capital_in' => 'ورود سرمایه', 'capital_out' => 'برداشت از سرمایه', 'distribution' => 'تقسیم سود', 'loan' => 'وام', 'loan_payment' => 'قسط وام',
        'refund_sale' => 'برگشت از فروش', 'asset_purchase' => 'خرید دارایی', 'depreciation' => 'استهلاک', 'reversal' => 'برگشت سند', 'manual' => 'سند دستی',
        'legacy_expense' => 'هزینه', 'legacy_capital' => 'ورود سرمایه', 'legacy_payment' => 'پرداخت مشتری', 'legacy_cost' => 'هزینه'];
    return $labels[$j['source_type']] ?? $j['source_type'];
}

/** filters: q, type (source_type), account, party, from, to, status, direction (in|out) ; paginated, newest first */
function finActivity(PDO $pdo, array $f, int $page = 1, int $per = 50): array
{
    $where = ["j.status IN ('posted','reversed','draft')"];
    $params = [];
    if (!empty($f['from'])) {
        $where[] = 'j.entry_date >= ?';
        $params[] = (int) $f['from'];
    }
    if (!empty($f['to'])) {
        $where[] = 'j.entry_date <= ?';
        $params[] = (int) $f['to'];
    }
    if (!empty($f['type'])) {
        $types = [(string) $f['type']];
        if ($f['type'] === 'expense') {
            $types = ['expense', 'legacy_expense', 'legacy_cost'];
        } elseif ($f['type'] === 'capital_in') {
            $types = ['capital_in', 'legacy_capital'];
        } elseif ($f['type'] === 'receipt') {
            $types = ['receipt', 'legacy_payment'];
        }
        $where[] = 'j.source_type IN (' . implode(',', array_map([$pdo, 'quote'], $types)) . ')';
    }
    if (!empty($f['account'])) {
        $where[] = 'EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.entry_id = j.id AND l.account_id = ?)';
        $params[] = (int) $f['account'];
    }
    if (!empty($f['party'])) {
        $where[] = 'EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.entry_id = j.id AND l.party_id = ?)';
        $params[] = (int) $f['party'];
    }
    $q = trim((string) ($f['q'] ?? ''));
    if ($q !== '') {
        $like = '%' . addcslashes($q, '%_\\') . '%';
        $or = ['j.memo LIKE ?', 'j.entry_no LIKE ?', 't.ref LIKE ?', 't.memo LIKE ?', 'EXISTS (SELECT 1 FROM fin_journal_lines l JOIN fin_parties p ON p.id = l.party_id WHERE l.entry_id = j.id AND p.name LIKE ?)'];
        array_push($params, $like, $like, $like, $like, $like);
        $digits = str_replace([',', '٬', ' '], '', strtr($q, '۰۱۲۳۴۵۶۷۸۹', '0123456789'));
        if (ctype_digit($digits) && $digits !== '') {
            $or[] = 'EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.entry_id = j.id AND (l.debit = ? OR l.credit = ?))';
            array_push($params, (int) $digits, (int) $digits);
        }
        $where[] = '(' . implode(' OR ', $or) . ')';
    }
    $dir = $f['direction'] ?? '';
    $moneySql = "(SELECT COALESCE(SUM(l.debit - l.credit),0) FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id AND a.money_kind IS NOT NULL AND a.money_kind != '' WHERE l.entry_id = j.id)";
    if ($dir === 'in') {
        $where[] = "$moneySql > 0";
    } elseif ($dir === 'out') {
        $where[] = "$moneySql < 0";
    }
    $w = ' WHERE ' . implode(' AND ', $where);
    $from = "FROM fin_journal j LEFT JOIN fin_txn t ON t.id = j.txn_id";
    $cnt = $pdo->prepare("SELECT COUNT(*) $from$w");
    $cnt->execute($params);
    $total = (int) $cnt->fetchColumn();
    $per = max(10, min(200, $per));
    $page = max(1, $page);
    $st = $pdo->prepare("SELECT j.id, j.entry_no, j.entry_date, j.memo, j.source_type, j.status, j.txn_id, t.ref, t.type txn_type, t.party_id,
            $moneySql AS money_effect, (SELECT COALESCE(SUM(debit),0) FROM fin_journal_lines WHERE entry_id = j.id) AS amount,
            (SELECT p.name FROM fin_journal_lines l JOIN fin_parties p ON p.id = l.party_id WHERE l.entry_id = j.id LIMIT 1) AS party_name
        $from$w ORDER BY j.entry_date DESC, j.id DESC LIMIT $per OFFSET " . (($page - 1) * $per));
    $st->execute($params);
    $rows = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $r['title'] = finActivityTitle($r);
        $r['direction'] = (int) $r['money_effect'] > 0 ? 'in' : ((int) $r['money_effect'] < 0 ? 'out' : 'none');
        $rows[] = $r;
    }
    return ['rows' => $rows, 'total' => $total, 'page' => $page, 'per' => $per];
}

function finEntryDetail(PDO $pdo, int $id): array
{
    $st = $pdo->prepare("SELECT j.*, t.ref, t.type txn_type FROM fin_journal j LEFT JOIN fin_txn t ON t.id = j.txn_id WHERE j.id = ?");
    $st->execute([$id]);
    $j = $st->fetch(PDO::FETCH_ASSOC);
    if (!$j) {
        throw new FinError('سند پیدا نشد', 404);
    }
    $ls = $pdo->prepare("SELECT l.*, a.code, a.name account_name, p.name party_name FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id LEFT JOIN fin_parties p ON p.id = l.party_id WHERE l.entry_id = ? ORDER BY l.id");
    $ls->execute([$id]);
    $au = $pdo->prepare("SELECT * FROM fin_audit WHERE (entity = 'journal' AND entity_id = ?) OR (entity != 'journal' AND entity_id = ?) ORDER BY id DESC LIMIT 30");
    $au->execute([(string) $id, (string) ($j['txn_id'] ?? 0)]);
    $j['title'] = finActivityTitle($j);
    return ['entry' => $j, 'lines' => $ls->fetchAll(PDO::FETCH_ASSOC), 'audit' => $au->fetchAll(PDO::FETCH_ASSOC)];
}

function finTxnDetail(PDO $pdo, int $id): array
{
    $t = finTxn($pdo, $id);
    $t['state'] = in_array($t['type'], ['sale', 'purchase'], true) ? finDocState($t) : null;
    $t['outstanding'] = in_array($t['type'], ['sale', 'purchase'], true) ? finOutstanding($t) : null;
    $t['meta'] = $t['meta'] ? json_decode($t['meta'], true) : null;
    $party = $t['party_id'] ? $pdo->query("SELECT id, name FROM fin_parties WHERE id = " . (int) $t['party_id'])->fetch(PDO::FETCH_ASSOC) : null;
    $al = $pdo->prepare("SELECT a.*, t.ref, t.txn_date, t.status FROM fin_alloc a JOIN fin_txn t ON t.id = " . (in_array($t['type'], ['sale', 'purchase'], true) ? 'a.payment_txn_id' : 'a.doc_txn_id') . "
                         WHERE " . (in_array($t['type'], ['sale', 'purchase'], true) ? 'a.doc_txn_id' : 'a.payment_txn_id') . " = ? ORDER BY a.id");
    $al->execute([$id]);
    $docs = $pdo->prepare("SELECT id, kind, name, size, created_at FROM fin_docs WHERE txn_id = ?");
    $docs->execute([$id]);
    $ref = $pdo->prepare("SELECT id, ref, type, total, txn_date, status FROM fin_txn WHERE parent_txn_id = ? ORDER BY id");
    $ref->execute([$id]);
    return ['txn' => $t, 'party' => $party, 'links' => $al->fetchAll(PDO::FETCH_ASSOC), 'documents' => $docs->fetchAll(PDO::FETCH_ASSOC), 'children' => $ref->fetchAll(PDO::FETCH_ASSOC),
        'journal' => $t['journal_id'] ? finEntryDetail($pdo, (int) $t['journal_id']) : null];
}

// ------------------------------------------------------------------ parties

function finPartyProfile(PDO $pdo, int $id): array
{
    $p = finParty($pdo, $id, false);
    $bal = function (string $type) use ($pdo, $id) {
        $st = $pdo->prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(paid),0) paid, COALESCE(SUM(returned),0) ret, COALESCE(SUM(CASE WHEN status='posted' THEN total - paid - (returned - refunded) ELSE 0 END),0) rem
                             FROM fin_txn WHERE party_id = ? AND type = ? AND status = 'posted'");
        $st->execute([$id, $type]);
        return $st->fetch(PDO::FETCH_ASSOC);
    };
    $sales = $bal('sale');
    $bills = $bal('purchase');
    $last = $pdo->prepare("SELECT t.id, t.ref, t.type, t.txn_date, t.total, t.status, t.memo FROM fin_txn t WHERE t.party_id = ? ORDER BY t.txn_date DESC, t.id DESC LIMIT 50");
    $last->execute([$id]);
    $notes = [];
    $own = finOwnershipAt($pdo);
    return ['party' => $p + ['roles_list' => array_values(array_filter(explode(',', (string) $p['roles'])))],
        'receivable' => ['count' => (int) $sales['n'], 'total' => (int) $sales['total'], 'paid' => (int) $sales['paid'], 'remaining' => (int) $sales['rem']],
        'payable' => ['count' => (int) $bills['n'], 'total' => (int) $bills['total'], 'paid' => (int) $bills['paid'], 'remaining' => (int) $bills['rem']],
        'net_balance' => (int) $sales['rem'] - (int) $bills['rem'], 'ownership' => $own[$id] ?? null, 'transactions' => $last->fetchAll(PDO::FETCH_ASSOC), 'notes' => $notes];
}

function finPartiesList(PDO $pdo, string $q = '', string $role = '', int $page = 1, int $per = 50): array
{
    $where = ['p.archived = 0'];
    $params = [];
    if ($q !== '') {
        $where[] = '(p.name LIKE ? OR p.phone LIKE ? OR p.tg_user_id LIKE ?)';
        $like = '%' . addcslashes($q, '%_\\') . '%';
        array_push($params, $like, $like, $like);
    }
    if ($role !== '') {
        $where[] = 'FIND_IN_SET(?, p.roles) > 0';
        $params[] = $role;
    }
    $w = ' WHERE ' . implode(' AND ', $where);
    $cnt = $pdo->prepare("SELECT COUNT(*) FROM fin_parties p$w");
    $cnt->execute($params);
    $per = max(10, min(200, $per));
    $st = $pdo->prepare("SELECT p.*,
        (SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE party_id = p.id AND type = 'sale' AND status = 'posted') AS receivable,
        (SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE party_id = p.id AND type = 'purchase' AND status = 'posted') AS payable
        FROM fin_parties p$w ORDER BY p.name LIMIT $per OFFSET " . ((max(1, $page) - 1) * $per));
    $st->execute($params);
    return ['rows' => $st->fetchAll(PDO::FETCH_ASSOC), 'total' => (int) $cnt->fetchColumn(), 'page' => max(1, $page), 'per' => $per];
}

// ------------------------------------------------------------------ partners / capital

function finPartners(PDO $pdo): array
{
    $now = time();
    $own = finOwnershipAt($pdo, $now);
    $rows = [];
    $ids = array_keys($own);
    $st = $pdo->query("SELECT DISTINCT party_id FROM fin_ownership");
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $pid) {
        $ids[] = (int) $pid;
    }
    $cap = $pdo->prepare("SELECT COALESCE(SUM(l.credit - l.debit),0) FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id
                          WHERE l.party_id = ? AND a.system_key = ? AND j.status IN " . FIN_COUNTED);
    foreach (array_unique($ids) as $pid) {
        $p = $pdo->query("SELECT id, name FROM fin_parties WHERE id = " . (int) $pid)->fetch(PDO::FETCH_ASSOC);
        if (!$p) {
            continue;
        }
        $cap->execute([$pid, 'capital']);
        $invested = (int) $cap->fetchColumn();
        $cap->execute([$pid, 'drawings']);
        $withdrawn = -(int) $cap->fetchColumn();
        $cap->execute([$pid, 'dividends']);
        $profit = -(int) $cap->fetchColumn();
        $rows[] = ['party_id' => (int) $pid, 'name' => $p['name'], 'percent' => $own[$pid] ?? 0, 'invested' => $invested, 'withdrawn' => $withdrawn, 'profit_share' => $profit];
    }
    $hist = $pdo->query("SELECT o.id, o.party_id, p.name, o.percent, o.effective_from, o.note FROM fin_ownership o JOIN fin_parties p ON p.id = o.party_id ORDER BY o.effective_from DESC, o.id DESC LIMIT 200")->fetchAll(PDO::FETCH_ASSOC);
    usort($rows, fn($a, $b) => $b['percent'] <=> $a['percent']);
    return ['partners' => $rows, 'history' => $hist, 'total_percent' => array_sum($own)];
}

// ------------------------------------------------------------------ loans & assets lists

function finLoansList(PDO $pdo): array
{
    $rows = $pdo->query("SELECT l.*, p.name party_name FROM fin_loans l JOIN fin_parties p ON p.id = l.party_id ORDER BY l.status, l.id DESC")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$l) {
        $l['remaining'] = finLoanRemaining($pdo, (int) $l['id']);
        $l['paid_principal'] = (int) $l['principal'] - $l['remaining'];
    }
    return $rows;
}

function finAssetsList(PDO $pdo): array
{
    $rows = $pdo->query("SELECT a.*, c.name class_name FROM fin_assets a LEFT JOIN fin_accounts c ON c.id = a.asset_account_id ORDER BY a.status, a.id DESC")->fetchAll(PDO::FETCH_ASSOC);
    $dep = $pdo->prepare("SELECT COALESCE(SUM(l.credit),0) FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE j.source_type = 'depreciation' AND j.source_id = ? AND j.status IN " . FIN_COUNTED . " AND l.credit > 0");
    foreach ($rows as &$a) {
        $dep->execute([(string) $a['id']]);
        $a['accumulated_depreciation'] = (int) $dep->fetchColumn();
        $a['book_value'] = (int) $a['cost'] - $a['accumulated_depreciation'];
    }
    return $rows;
}

// ------------------------------------------------------------------ global search

function finSearch(PDO $pdo, string $q, int $limit = 8): array
{
    $q = trim($q);
    if ($q === '') {
        return ['parties' => [], 'transactions' => [], 'accounts' => [], 'entries' => []];
    }
    $like = '%' . addcslashes($q, '%_\\') . '%';
    $digits = str_replace([',', '٬', ' '], '', strtr($q, '۰۱۲۳۴۵۶۷۸۹', '0123456789'));
    $p = $pdo->prepare("SELECT id, name, roles, phone FROM fin_parties WHERE archived = 0 AND (name LIKE ? OR phone LIKE ? OR tg_user_id LIKE ?) ORDER BY name LIMIT $limit");
    $p->execute([$like, $like, $like]);
    $sql = "SELECT t.id, t.ref, t.type, t.txn_date, t.total, t.status, t.memo, p.name party_name FROM fin_txn t LEFT JOIN fin_parties p ON p.id = t.party_id WHERE (t.ref LIKE ? OR t.memo LIKE ? OR p.name LIKE ?";
    $params = [$like, $like, $like];
    if (ctype_digit($digits) && $digits !== '') {
        $sql .= " OR t.total = ?";
        $params[] = (int) $digits;
    }
    $t = $pdo->prepare($sql . ") ORDER BY t.txn_date DESC, t.id DESC LIMIT $limit");
    $t->execute($params);
    $a = $pdo->prepare("SELECT id, code, name, type, money_kind FROM fin_accounts WHERE archived = 0 AND (name LIKE ? OR code LIKE ?) ORDER BY code LIMIT $limit");
    $a->execute([$like, $like]);
    $e = $pdo->prepare("SELECT id, entry_no, entry_date, memo, source_type FROM fin_journal WHERE entry_no LIKE ? OR memo LIKE ? ORDER BY entry_date DESC LIMIT $limit");
    $e->execute([$like, $like]);
    return ['parties' => $p->fetchAll(PDO::FETCH_ASSOC), 'transactions' => $t->fetchAll(PDO::FETCH_ASSOC), 'accounts' => $a->fetchAll(PDO::FETCH_ASSOC), 'entries' => $e->fetchAll(PDO::FETCH_ASSOC)];
}

// ------------------------------------------------------------------ integrity check

/** Cross-checks that must always hold. Returns a list of problems (empty = healthy). */
function finIntegrity(PDO $pdo): array
{
    $bad = [];
    $r = $pdo->query("SELECT j.id, j.entry_no, SUM(l.debit) d, SUM(l.credit) c FROM fin_journal j JOIN fin_journal_lines l ON l.entry_id = j.id GROUP BY j.id, j.entry_no HAVING d != c")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($r as $x) {
        $bad[] = "سند {$x['entry_no']} تراز نیست ({$x['d']} ≠ {$x['c']})";
    }
    $tb = finTrialBalance($pdo);
    if (!$tb['balanced']) {
        $bad[] = 'تراز آزمایشی متعادل نیست';
    }
    $bs = finBalanceSheet($pdo);
    if (!$bs['balanced']) {
        $bad[] = 'ترازنامه متعادل نیست (دارایی‌ها ≠ بدهی‌ها + حقوق صاحبان سرمایه)';
    }
    $docs = $pdo->query("SELECT t.id, t.ref, t.paid, COALESCE((SELECT SUM(a.amount) FROM fin_alloc a JOIN fin_txn p ON p.id = a.payment_txn_id WHERE a.doc_txn_id = t.id AND p.status = 'posted'),0) s
                         FROM fin_txn t WHERE t.type IN ('sale','purchase') AND t.status = 'posted' AND t.party_id IS NOT NULL") /* customer-less cash sales carry their money inside the sale, no allocations */->fetchAll(PDO::FETCH_ASSOC);
    foreach ($docs as $d) {
        if ((int) $d['paid'] !== (int) $d['s']) {
            $bad[] = "مبلغ پرداخت‌شده‌ی {$d['ref']} با تخصیص‌ها نمی‌خواند";
        }
    }
    foreach (['sale' => 'ar', 'purchase' => 'ap'] as $type => $key) {
        $acct = finAccount($pdo, $key);
        $open = (int) $pdo->query("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE type = '$type' AND status = 'posted'")->fetchColumn();
        $led = finAccountBalance($pdo, $acct['id']);
        // legacy entries do not touch AR/AP, so the document-level and ledger-level totals must agree exactly
        if ($open !== $led) {
            $bad[] = "مانده‌ی " . ($type === 'sale' ? 'دریافتنی‌ها' : 'پرداختنی‌ها') . " در اسناد ($open) با دفتر کل ($led) نمی‌خواند";
        }
    }
    return $bad;
}
