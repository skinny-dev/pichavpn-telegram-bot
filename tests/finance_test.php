<?php
// php tests/finance_test.php   (needs a local MySQL where root can create databases; uses a throw-away database)
chdir(__DIR__ . '/..');
date_default_timezone_set('Asia/Tehran');
$dbName = 'fin_test_' . getmypid();
$pdo = new PDO('mysql:host=localhost;charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec("CREATE DATABASE `$dbName` CHARACTER SET utf8mb4");
$pdo->exec("USE `$dbName`");
register_shutdown_function(function () use ($pdo, $dbName) {
    $pdo->exec("DROP DATABASE IF EXISTS `$dbName`");
});
$pdo->exec("SET NAMES utf8mb4");
require_once 'finance/engine.php';
require_once 'finance/reports.php';
require_once 'finance/legacy.php';
foreach (glob('db/tables/fin_*.php') as $file) {
    $def = require $file;
    $pdo->exec("CREATE TABLE `" . basename($file, '.php') . "` (" . $def['create'] . ") " . $def['options']);
    foreach ($def['seed'] ?? [] as $row) {
        $cols = array_keys($row);
        $pdo->prepare("INSERT IGNORE INTO `" . basename($file, '.php') . "` (`" . implode('`,`', $cols) . "`) VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")")->execute(array_values($row));
    }
}
// legacy tables the bridge reads
$pdo->exec("CREATE TABLE expenses (id INT AUTO_INCREMENT PRIMARY KEY, amount BIGINT, description VARCHAR(500), created_at INT, admin_id VARCHAR(100), kind VARCHAR(30))");
$pdo->exec("CREATE TABLE capital_entries (id INT AUTO_INCREMENT PRIMARY KEY, amount BIGINT, description VARCHAR(500), created_at INT, admin_id VARCHAR(100))");
$pdo->exec("CREATE TABLE Payment_report (id INT AUTO_INCREMENT PRIMARY KEY, id_user VARCHAR(200), id_order VARCHAR(200), time VARCHAR(200), price VARCHAR(200), payment_Status VARCHAR(100), Payment_Method VARCHAR(200), dec_not_confirmed TEXT)");
$pdo->exec("CREATE TABLE user (id VARCHAR(200) PRIMARY KEY, username VARCHAR(200), namecustom VARCHAR(200), Balance INT DEFAULT 0)");

$fail = 0;
function ok($c, $m, $extra = '') { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . ($c ? '' : '  -> ' . $extra) . "\n"; if (!$c) $fail++; }
function throws(callable $f, string $needle, string $m) {
    try { $f(); ok(false, $m, 'no exception'); } catch (FinError $e) { ok(strpos($e->getMessage(), $needle) !== false, $m, $e->getMessage()); }
}
$bal = fn($k) => finAccountBalance($pdo, $k);
$cnt = fn($t) => (int) $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn();
$T = strtotime(date('Y-m-d') . ' 12:00:00');
$jan = strtotime('2026-01-10 10:00:00');

// ---- chart & empty books
ok($cnt('fin_accounts') >= 50, 'chart of accounts is seeded');
ok(finAccount($pdo, 'cash') && finAccount($pdo, '1110') && finAccount($pdo, 'ar')['type'] === 'asset', 'accounts resolve by system key and by code');
ok(finTrialBalance($pdo)['balanced'] && !finIntegrity($pdo), 'empty books are balanced and healthy');

// ---- journal rules
throws(fn() => finPostEntry($pdo, ['lines' => [['account' => 'cash', 'debit' => 100], ['account' => 'revenue_sales', 'credit' => 90]]]), 'برابر نیست', 'unbalanced entry is rejected');
throws(fn() => finPostEntry($pdo, ['lines' => [['account' => 'cash', 'debit' => 100]]]), 'دو ردیف', 'single-line entry is rejected');
throws(fn() => finPostEntry($pdo, ['lines' => [['account' => '1000', 'debit' => 100], ['account' => 'revenue_sales', 'credit' => 100]]]), 'حساب گروه', 'header accounts cannot be posted to');
throws(fn() => finPostEntry($pdo, ['lines' => [['account' => 'cash', 'debit' => 100, 'credit' => 100], ['account' => 'revenue_sales', 'credit' => 0, 'debit' => 0]]]), 'فقط بدهکار', 'a line cannot be both sides');
ok($cnt('fin_journal') === 0, 'rejected entries leave nothing behind');

// ---- parties
$ali = finSaveParty($pdo, ['name' => 'علی', 'roles' => ['customer', 'supplier', 'partner']], 'admin');
$reza = finSaveParty($pdo, ['name' => 'رضا', 'roles' => ['partner']], 'admin');
$sara = finSaveParty($pdo, ['name' => 'سارا', 'roles' => ['partner', 'lender']], 'admin');
ok(finParty($pdo, $ali)['roles'] === 'customer,supplier,partner', 'one party, several roles');

// ---- capital, funds check, expense
throws(fn() => finCreateExpense($pdo, ['amount' => 1000000, 'category_account' => 'exp_server', 'money_account' => 'cash', 'date' => $jan]), 'موجودی', 'cannot spend more than the account holds');
$cap = finCapital($pdo, ['amount' => 50000000, 'money_account' => 'bank_main', 'party_id' => $ali, 'date' => $jan], 'in', 'admin');
ok($bal('bank_main') === 50000000 && $bal('capital') === 50000000, 'owner investment: money in, capital up (not revenue)');
ok(finProfitLoss($pdo, 0, $T)['totals']['sales'] === 0, 'capital is not revenue');
$tr = finTransfer($pdo, ['from_account' => 'bank_main', 'to_account' => 'cash', 'amount' => 5000000, 'date' => $jan, 'reference' => 'T-1'], 'admin');
ok($bal('bank_main') === 45000000 && $bal('cash') === 5000000, 'transfer moves money between accounts');
ok(finProfitLoss($pdo, 0, $T)['totals']['opex'] === 0, 'a transfer is not an expense');
throws(fn() => finTransfer($pdo, ['from_account' => 'cash', 'to_account' => 'bank_main', 'amount' => 99999999]), 'کافی نیست', 'cannot transfer more than available');
throws(fn() => finTransfer($pdo, ['from_account' => 'cash', 'to_account' => 'cash', 'amount' => 1]), 'نباید یکی', 'same account transfer rejected');
$exp = finCreateExpense($pdo, ['amount' => 1000000, 'category_account' => 'exp_advertising', 'money_account' => 'cash', 'date' => $jan, 'memo' => 'کمپین'], 'admin');
ok($bal('cash') === 4000000 && $bal('exp_advertising') === 1000000, 'expense: money out, expense up');

// ---- sale + payment are separate events
$sale = finCreateSale($pdo, ['party_id' => $ali, 'items' => [['name' => 'اشتراک', 'qty' => 2, 'price' => 5000000]], 'paid_now' => 4000000, 'money_account' => 'bank_main', 'due_date' => $T + 86400 * 5, 'date' => $T], 'admin');
$s = finTxn($pdo, $sale['id']);
ok((int) $s['total'] === 10000000 && (int) $s['paid'] === 4000000 && finOutstanding($s) === 6000000, 'sale 10M, paid 4M, receivable 6M');
ok($bal('ar') === 6000000 && $bal('revenue_sales') === 10000000, 'ledger: receivable 6M, revenue 10M');
ok(finDocState($s, $T) === 'partial' && $sale['receipt_id'] > 0, 'state partial; the payment is its own receipt transaction');
throws(fn() => finReceivePayment($pdo, ['party_id' => $ali, 'amount' => 6000001, 'money_account' => 'bank_main']), 'بیشتر', 'cannot receive more than the customer owes');
throws(fn() => finReceivePayment($pdo, ['party_id' => $ali, 'amount' => 100, 'money_account' => 'bank_main', 'allocations' => [$sale['id'] => 6000001]]), 'بیشتر', 'allocation above outstanding is rejected');
$r1 = finReceivePayment($pdo, ['party_id' => $ali, 'amount' => 2000000, 'money_account' => 'cash', 'date' => $T], 'admin');
ok(finOutstanding(finTxn($pdo, $sale['id'])) === 4000000 && $bal('ar') === 4000000, 'partial receipt settles the oldest document');
$r2 = finReceivePayment($pdo, ['party_id' => $ali, 'amount' => 4000000, 'money_account' => 'bank_main', 'date' => $T], 'admin');
ok(finDocState(finTxn($pdo, $sale['id']), $T) === 'paid' && $bal('ar') === 0, 'fully paid');
throws(fn() => finReceivePayment($pdo, ['party_id' => $ali, 'amount' => 1, 'money_account' => 'cash']), 'بیشتر', 'nothing left to collect');
throws(fn() => finCancelTxn($pdo, $sale['id'], 'اشتباه'), 'پرداخت دارد', 'a sale with payments cannot be cancelled directly');

// ---- tax, discount
$taxed = finCreateSale($pdo, ['party_id' => $reza, 'amount' => 1000000, 'discount' => 100000, 'tax_rate' => 10, 'date' => $T]);
$tt = finTxn($pdo, $taxed['id']);
ok((int) $tt['tax'] === 90000 && (int) $tt['total'] === 990000 && $bal('tax_payable') === 90000, 'discount then 10% tax: total 990k, tax payable 90k (not revenue)');
throws(fn() => finCreateSale($pdo, ['amount' => 1000, 'date' => $T]), 'مشتری', 'credit sale needs a customer');
throws(fn() => finCreateSale($pdo, ['party_id' => $reza, 'amount' => 1000, 'discount' => 5000]), 'تخفیف', 'discount above total rejected');

// ---- refunds
$ref = finRefundSale($pdo, ['sale_id' => $taxed['id'], 'amount' => 330000, 'reason' => 'مرجوعی', 'date' => $T], 'admin');
$tt = finTxn($pdo, $taxed['id']);
ok($ref['cash_back'] === 0 && finOutstanding($tt) === 660000 && $bal('sales_returns') === -300000 && $bal('tax_payable') === 60000, 'refund of an unpaid sale reduces the receivable and reverses tax');
throws(fn() => finRefundSale($pdo, ['sale_id' => $taxed['id'], 'amount' => 700000]), 'بیشتر', 'cannot refund more than what is left');
$ref2 = finRefundSale($pdo, ['sale_id' => $sale['id'], 'amount' => 1000000, 'money_account' => 'bank_main', 'date' => $T], 'admin');
ok($ref2['cash_back'] === 1000000, 'refund of a paid sale pays money back');
throws(fn() => finCancelTxn($pdo, $r1['id'], 'x'), 'برگشت خورده', 'a payment of a refunded invoice cannot be cancelled first');

// ---- purchases & payables
$po = finCreatePurchase($pdo, ['party_id' => $ali, 'amount' => 2000000, 'category_account' => 'cogs', 'due_date' => $T + 86400, 'date' => $T], 'admin');
ok($bal('ap') === 2000000 && $bal('cogs') === 2000000, 'purchase on credit: payable + cost of goods');
throws(fn() => finMakePayment($pdo, ['party_id' => $ali, 'amount' => 2000001, 'money_account' => 'bank_main']), 'بیشتر', 'cannot pay more than owed');
throws(fn() => finMakePayment($pdo, ['party_id' => $ali, 'amount' => 500000, 'money_account' => 'crypto']), 'کافی نیست', 'cannot pay from an empty account');
finMakePayment($pdo, ['party_id' => $ali, 'amount' => 500000, 'money_account' => 'bank_main', 'date' => $T]);
ok(finDocState(finTxn($pdo, $po['id']), $T) === 'partial' && $bal('ap') === 1500000, 'supplier partly paid');
$ag = finAging($pdo, 'purchase');
ok($ag['summary']['total'] === 1500000 && $ag['summary']['due_soon'] === 1500000, 'payables aging');

// ---- cancel / reverse keeps history
$before = $bal('exp_advertising');
finCancelTxn($pdo, $exp['id'], 'ثبت اشتباه', 'admin');
ok($bal('exp_advertising') === $before - 1000000 && finTxn($pdo, $exp['id'])['status'] === 'reversed', 'cancelled expense is reversed, not deleted');
ok((int) $pdo->query("SELECT COUNT(*) FROM fin_journal WHERE status = 'reversed'")->fetchColumn() === 1 && $cnt('fin_journal') > 5, 'history preserved: original + mirror entry exist');
throws(fn() => finCancelTxn($pdo, $exp['id'], 'again'), 'قبلاً', 'cannot cancel twice');
throws(fn() => finCancelTxn($pdo, $po['id'], ''), 'دلیل', 'cancel needs a reason');

// ---- atomicity
$tx = $cnt('fin_txn');
$je = $cnt('fin_journal');
$pdo->exec("UPDATE fin_accounts SET archived = 1 WHERE system_key = 'crypto'");
finAccountsCache(null, true);
try { finCreateSale($pdo, ['party_id' => $ali, 'amount' => 500000, 'paid_now' => 500000, 'money_account' => 'crypto', 'date' => $T]); ok(false, 'archived account refused'); } catch (FinError $e) { ok(strpos($e->getMessage(), 'بایگانی') !== false, 'archived account cannot be used'); }
ok($cnt('fin_txn') === $tx && $cnt('fin_journal') === $je && (int) $pdo->query("SELECT COUNT(*) FROM fin_alloc")->fetchColumn() >= 0, 'a failed multi-step operation leaves nothing half-written (sale rolled back with its failed payment)');
$pdo->exec("UPDATE fin_accounts SET archived = 0 WHERE system_key = 'crypto'");
finAccountsCache(null, true);

// ---- partners with ownership history
finSetOwnership($pdo, [$ali => 60, $reza => 40], $jan, 'ابتدای سال', 'admin');
$march = strtotime('2026-03-20 10:00:00');
finSetOwnership($pdo, [$ali => 50, $reza => 30, $sara => 20], $march, 'ورود سارا', 'admin');
ok(finOwnershipAt($pdo, strtotime('2026-02-01')) == [$ali => 60.0, $reza => 40.0], 'January ownership is preserved');
ok(finOwnershipAt($pdo, $T) == [$ali => 50.0, $reza => 30.0, $sara => 20.0], 'March ownership applies afterwards');
throws(fn() => finSetOwnership($pdo, [$ali => 50, $reza => 30], $T, null), '۱۰۰', 'ownership must total 100');
$d = finDistribute($pdo, ['amount' => 1000001, 'money_account' => 'bank_main', 'date' => $T], 'admin');
$lines = $pdo->query("SELECT party_id, debit FROM fin_journal_lines WHERE entry_id = (SELECT journal_id FROM fin_txn WHERE id = {$d['id']}) AND debit > 0 ORDER BY party_id")->fetchAll();
ok(array_sum(array_column($lines, 'debit')) === 1000001 && count($lines) === 3, 'profit distribution splits by ownership and loses no rounding unit');
$pa = finPartners($pdo);
ok(count($pa['history']) >= 5 && abs($pa['total_percent'] - 100) < 0.001, 'partner report: history kept, current total 100%');
$w = finCapital($pdo, ['amount' => 1000000, 'money_account' => 'bank_main', 'party_id' => $ali], 'out', 'admin');
ok($bal('drawings') === -1000000 && finProfitLoss($pdo, 0, $T + 86400)['totals']['opex'] >= 0, 'owner drawings are equity (contra), not an expense');

// ---- loans
$loan = finCreateLoan($pdo, ['party_id' => $sara, 'principal' => 10000000, 'direction' => 'borrowed', 'money_account' => 'bank_main', 'date' => $T], 'admin');
ok($bal('loan_payable') === 10000000, 'loan received is a liability, not revenue');
finLoanPayment($pdo, ['loan_id' => $loan['id'], 'principal' => 2000000, 'interest' => 100000, 'money_account' => 'bank_main', 'date' => $T], 'admin');
ok(finLoanRemaining($pdo, $loan['id']) === 8000000 && $bal('exp_interest') === 100000, 'installment: principal reduces the loan, interest is an expense');
throws(fn() => finLoanPayment($pdo, ['loan_id' => $loan['id'], 'principal' => 9000000, 'money_account' => 'bank_main']), 'بیشتر', 'cannot repay more than the loan');

// ---- assets & depreciation
$asset = finBuyAsset($pdo, ['name' => 'لپ‌تاپ', 'cost' => 12000000, 'salvage' => 0, 'useful_life_months' => 12, 'asset_account' => 'fixed_computers', 'money_account' => 'bank_main', 'date' => strtotime('2026-07-05')], 'admin');
$n1 = finDepreciate($pdo, $T, 'sync');
$n2 = finDepreciate($pdo, $T, 'sync');
ok($n1 === 3 && $n2 === 0, 'depreciation posts each month once (Mehr/Shahrivar/Mordad end-of-month entries), re-running adds nothing', "$n1/$n2");
ok($bal('accum_dep') === -3000000 && $bal('exp_depreciation') === 3000000, 'accumulated depreciation and expense match');
ok(finAssetsList($pdo)[0]['book_value'] === 9000000, 'book value = cost - accumulated depreciation');

// ---- reports must agree with each other
$bs = finBalanceSheet($pdo, $T + 86400);
$tb = finTrialBalance($pdo, $T + 86400);
ok($bs['balanced'] && $tb['balanced'], 'balance sheet and trial balance both balance', json_encode([$bs['totals'], $tb['total_debit'], $tb['total_credit']]));
$pl = finProfitLoss($pdo, 0, $T + 86400);
ok($pl['net_profit'] === $bs['current_earnings'], 'P&L net profit equals current earnings on the balance sheet');
ok($pl['totals']['sales'] === 10000000 + 900000 - 300000 - 1000000, 'net sales = sales - returns (9.6M)', (string) $pl['totals']['sales']);
$cf = finCashFlow($pdo, 0, $T + 86400);
ok($cf['reconciled'] && $cf['totals']['financing'] !== 0 && $cf['totals']['investing'] === -12000000, 'cash flow reconciles with money balances; asset purchase is investing', json_encode($cf['totals']) . " {$cf['opening']}+{$cf['net_change']} vs {$cf['closing']}");
ok(!finIntegrity($pdo), 'integrity check is clean after all operations', json_encode(finIntegrity($pdo), JSON_UNESCAPED_UNICODE));
$led = finLedger($pdo, 'bank_main', 0, $T + 86400);
ok(end($led['rows'])['balance'] === $led['closing'] && $led['closing'] === $bal('bank_main'), 'ledger running balance ends at the account balance');
$ov = finOverview($pdo, finRange('year')['start'], $T + 86400);
ok($ov['money_total'] === array_sum(array_map(fn($m) => $m['balance'], finMoneyAccounts($pdo))) && $ov['receivables'] === $bal('ar'), 'overview KPIs match the ledger');

// ---- activity, search, party profile
$act = finActivity($pdo, ['type' => 'sale']);
ok($act['total'] === 2 && $act['rows'][0]['title'] === 'فروش', 'activity timeline filters by type');
$in = finActivity($pdo, ['direction' => 'in']);
ok($in['total'] > 0 && !array_filter($in['rows'], fn($r) => $r['direction'] !== 'in'), 'activity: money-in filter');
$sr = finSearch($pdo, 'علی');
ok(count($sr['parties']) === 1, 'search finds parties');
$sr = finSearch($pdo, '10,000,000');
ok(count($sr['transactions']) >= 1, 'search finds a transaction by amount');
$prof = finPartyProfile($pdo, $ali);
ok($prof['receivable']['count'] === 1 && $prof['payable']['remaining'] === 1500000 && $prof['net_balance'] === -1500000, 'party profile: receivable, payable and net balance in one place');
ok(finCan($pdo, 'administrator', 'sale.cancel') && !finCan($pdo, 'support', 'view'), 'permissions: administrator can, support cannot by default');
finSetSetting($pdo, 'perm:Seller', json_encode(['view', 'sale.create']));
ok(finCan($pdo, 'Seller', 'sale.create') && !finCan($pdo, 'Seller', 'sale.cancel'), 'permissions are configurable per role');

// ---- legacy bridge
$pdo->exec("INSERT INTO expenses (amount, description, created_at, admin_id, kind) VALUES (1500000,'سرور آلمان',$T,'1','server'),(300000,'حقوق پشتیبان',$T,'1','salary'),(700000,'سهم شریک',$T,'1','dividend')");
$pdo->exec("INSERT INTO capital_entries (amount, description, created_at, admin_id) VALUES (9000000,'سرمایه اولیه',$jan,'1')");
$pdo->exec("INSERT INTO Payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,dec_not_confirmed) VALUES
  ('1','o1','$T','200000','paid','cart to cart',''),('2','o2','2026/10/08 10:00:00','300000','paid','zarinpal',''),('3','o3','$T','50000','paid','wallet',''),
  ('4','o4','$T','80000','paid','add balance by admin',''),('5','o5','$T','90000','waiting','cart to cart',''),('6','o6','$T','25000','paid','low balance by admin',''),
  ('','c1','$T','400000','cost','cost','تبلیغ اینستاگرام'),('','k1','$jan','5000000','investment','capital_injection',''),('7','o7','not-a-date','1000','paid','zarinpal','')");
$pre = $bal('revenue_sales');
$st = finSyncLegacy($pdo);
ok($st['legacy_expense'] === 3 && $st['legacy_capital'] === 2 && $st['legacy_cost'] === 1 && $st['legacy_payment'] === 3, 'legacy rows imported once', json_encode($st, JSON_UNESCAPED_UNICODE));
ok($bal('revenue_sales') === $pre + 500000, 'customer payments become revenue; wallet spending, admin gifts and unpaid are not');
ok(count($st['issues']) === 1 && strpos($st['issues'][0], 'تاریخ') !== false, 'an unreadable row is reported, not guessed', json_encode($st['issues'], JSON_UNESCAPED_UNICODE));
ok($bal('bank_main') !== null && finAccountBalance($pdo, 'gateway') === 300000, 'payment method decides the money account (gateway)');
ok($bal('exp_advertising') >= 400000 && $bal('exp_server') === 1500000 && $bal('dividends') <= -700000, 'legacy kinds map to the right accounts');
$st2 = finSyncLegacy($pdo);
ok($st2['legacy_expense'] + $st2['legacy_capital'] + $st2['legacy_cost'] + $st2['legacy_payment'] + $st2['reposted'] + $st2['reversed'] === 0, 'second sync changes nothing (idempotent)');
$pdo->exec("UPDATE expenses SET amount = 2000000 WHERE description = 'سرور آلمان'");
$st3 = finSyncLegacy($pdo);
ok($st3['reposted'] === 1 && $bal('exp_server') === 2000000, 'an edited legacy expense is reversed and re-posted');
$pdo->exec("DELETE FROM expenses WHERE description = 'حقوق پشتیبان'");
$st4 = finSyncLegacy($pdo);
ok($st4['reversed'] === 1 && $bal('exp_salary') === 0, 'a deleted legacy expense is reversed');
ok(finBalanceSheet($pdo)['balanced'] && finTrialBalance($pdo)['balanced'] && !finIntegrity($pdo), 'books still balance after the legacy bridge');

// ---- chart management
$nid = finSaveAccount($pdo, ['code' => '5330', 'name' => 'پیک و ارسال', 'type' => 'expense', 'parent_code' => '5000']);
ok(finAccount($pdo, '5330')['name'] === 'پیک و ارسال', 'custom expense category can be added');
throws(fn() => finSaveAccount($pdo, ['code' => '5330', 'name' => 'dup', 'type' => 'expense']), 'قبلاً', 'duplicate account code rejected');
$cashId = finAccount($pdo, 'cash')['id'];
throws(fn() => finSaveAccount($pdo, ['id' => $cashId, 'code' => '1110', 'name' => 'صندوق', 'type' => 'asset', 'money_kind' => 'cash', 'archived' => 1]), 'موجودی', 'an account that holds money cannot be archived');
finCreateExpense($pdo, ['amount' => 1000, 'category_account' => '5330', 'money_account' => 'bank_main', 'date' => $T]);
ok($bal('5330') === 1000, 'new category is immediately usable');

// ---- cash sale without a customer (e.g. Instagram buyer)
$cash0 = $bal('cash');
$cs = finCreateSale($pdo, ['amount' => 250000, 'paid_now' => 250000, 'money_account' => 'cash', 'items' => [['name' => 'Sell Random Config', 'qty' => 1, 'price' => 250000]], 'date' => $T]);
ok($bal('cash') === $cash0 + 250000 && $cs['receipt_id'] === null, 'customer-less cash sale puts money straight into the cash account');
ok(finTxn($pdo, $cs['id'])['paid'] == 250000 && finDocState(finTxn($pdo, $cs['id'])) === 'paid', 'customer-less sale is marked fully paid');
ok(!finIntegrity($pdo), 'integrity check accepts a customer-less cash sale', json_encode(finIntegrity($pdo), JSON_UNESCAPED_UNICODE));
$csr = finRefundSale($pdo, ['sale_id' => $cs['id'], 'amount' => 50000, 'money_account' => 'cash', 'date' => $T]);
ok($csr['cash_back'] === 50000 && $bal('cash') === $cash0 + 200000, 'refund of a customer-less sale pays cash back');
throws(fn() => finCancelTxn($pdo, $cs['id'], 'x'), 'برگشتی', 'sale with a return must have the return cancelled first');
finCancelTxn($pdo, $csr['id'], 'اشتباه', 'admin');
finCancelTxn($pdo, $cs['id'], 'اشتباه', 'admin');
ok($bal('cash') === $cash0, 'cancelling a customer-less cash sale restores the cash balance');
ok(finBalanceSheet($pdo)['balanced'] && finTrialBalance($pdo)['balanced'] && !finIntegrity($pdo), 'books balance after customer-less sale, refund and cancel');

echo "\nFAILED: $fail\n";
exit($fail ? 1 : 0);
