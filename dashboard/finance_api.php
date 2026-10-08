<?php
// Finance routes of the panel API (all start with «fin_»). Included by api.php after authentication + CSRF.
// Every route checks a finance permission; engine errors (FinError) become clean JSON errors; writes are atomic in the engine.

require_once __DIR__ . '/../finance/engine.php';
require_once __DIR__ . '/../finance/reports.php';
require_once __DIR__ . '/../finance/legacy.php';

/** route => [permission, handler(PDO, array $in, ?string $user): mixed] ; GET routes read $_GET, POST routes read the JSON body */
function picha_finance_routes(): array
{
    $range = function (array $in): array {
        $key = (string) ($in['range'] ?? 'month');
        if ($key === 'custom') {
            $r = finRange('custom', finParseDate($in['from'] ?? ''), finParseDate($in['to'] ?? '') + 86399);
            return [$r['start'], $r['end'], $key];
        }
        $r = finRange(in_array($key, ['today', 'week', 'month', 'quarter', 'year', 'all'], true) ? $key : 'month');
        return [$r['start'], $r['end'], $key];
    };
    $page = fn(array $in) => max(1, (int) ($in['page'] ?? 1));
    $per = fn(array $in) => (int) ($in['per'] ?? 50);

    return [
        // ---------------- reads
        'fin_overview' => ['view', function ($pdo, $in) use ($range) {
            finMaybeSync($pdo);
            [$a, $b, $k] = $range($in);
            return ['overview' => finOverview($pdo, $a, $b), 'range_key' => $k, 'last_sync' => (int) finSetting($pdo, 'legacy_last_sync', 0)];
        }],
        'fin_pl' => ['reports.view', function ($pdo, $in) use ($range) {
            finMaybeSync($pdo);
            [$a, $b] = $range($in);
            return ['report' => finProfitLoss($pdo, $a, $b)];
        }],
        'fin_bs' => ['reports.view', function ($pdo, $in) {
            finMaybeSync($pdo);
            return ['report' => finBalanceSheet($pdo, !empty($in['as_of']) ? finParseDate($in['as_of']) + 86399 : null)];
        }],
        'fin_cf' => ['reports.view', function ($pdo, $in) use ($range) {
            finMaybeSync($pdo);
            [$a, $b] = $range($in);
            return ['report' => finCashFlow($pdo, $a, $b)];
        }],
        'fin_tb' => ['reports.view', fn($pdo, $in) => ['report' => finTrialBalance($pdo, !empty($in['as_of']) ? finParseDate($in['as_of']) + 86399 : null)]],
        'fin_ledger' => ['reports.view', function ($pdo, $in) use ($range, $page, $per) {
            [$a, $b] = $range($in + ['range' => 'all']);
            return ['report' => finLedger($pdo, $in['account'] ?? 0, $a, $b, $page($in), $per($in) ?: 100, !empty($in['party']) ? (int) $in['party'] : null)];
        }],
        'fin_money' => ['view', fn($pdo) => ['accounts' => finMoneyAccounts($pdo)]],
        'fin_activity' => ['view', function ($pdo, $in) use ($range, $page, $per) {
            finMaybeSync($pdo);
            $f = $in;
            if (!empty($in['range']) && $in['range'] !== 'all') {
                [$f['from'], $f['to']] = $range($in);
            }
            return finActivity($pdo, $f, $page($in), $per($in) ?: 50);
        }],
        'fin_entry' => ['view', fn($pdo, $in) => finEntryDetail($pdo, (int) ($in['id'] ?? 0))],
        'fin_txn' => ['view', fn($pdo, $in) => finTxnDetail($pdo, (int) ($in['id'] ?? 0))],
        'fin_aging' => ['view', fn($pdo, $in) => finAging($pdo, ($in['kind'] ?? 'sale') === 'purchase' ? 'purchase' : 'sale')],
        'fin_parties' => ['view', fn($pdo, $in) => finPartiesList($pdo, trim((string) ($in['q'] ?? '')), (string) ($in['role'] ?? ''), (int) ($in['page'] ?? 1), (int) ($in['per'] ?? 50)) + ['roles' => finPartyRoles()]],
        'fin_party' => ['view', fn($pdo, $in) => finPartyProfile($pdo, (int) ($in['id'] ?? 0))],
        'fin_partners' => ['capital.manage', fn($pdo) => finPartners($pdo) + ['can_distribute' => true]],
        'fin_loans' => ['view', fn($pdo) => ['loans' => finLoansList($pdo)]],
        'fin_assets' => ['view', fn($pdo) => ['assets' => finAssetsList($pdo)]],
        'fin_accounts' => ['view', fn($pdo) => ['accounts' => array_map(function ($a) use ($pdo) {
            $a['balance'] = finAccountBalance($pdo, (int) $a['id']);
            return $a;
        }, finAllAccounts($pdo))]],
        'fin_search' => ['view', fn($pdo, $in) => finSearch($pdo, (string) ($in['q'] ?? ''))],
        'fin_integrity' => ['reports.view', fn($pdo) => ['problems' => finIntegrity($pdo), 'last_sync' => (int) finSetting($pdo, 'legacy_last_sync', 0), 'last_stats' => json_decode((string) finSetting($pdo, 'legacy_last_stats', '{}'), true)]],
        'fin_audit' => ['sensitive', function ($pdo, $in) use ($page) {
            $per = 50;
            $st = $pdo->prepare("SELECT * FROM fin_audit ORDER BY id DESC LIMIT $per OFFSET " . (($page($in) - 1) * $per));
            $st->execute();
            return ['rows' => $st->fetchAll(PDO::FETCH_ASSOC), 'total' => (int) $pdo->query("SELECT COUNT(*) FROM fin_audit")->fetchColumn()];
        }],
        'fin_meta' => ['view', function ($pdo, $in, $user, $role) {
            $acc = finAllAccounts($pdo, false);
            $pick = fn($f) => array_values(array_map(fn($a) => ['id' => (int) $a['id'], 'code' => $a['code'], 'name' => $a['name'], 'money_kind' => $a['money_kind'], 'system_key' => $a['system_key']], array_filter($acc, $f)));
            // smart defaults: what this business usually does
            $recent = $pdo->query("SELECT category_account_id id, COUNT(*) n, MAX(id) last FROM fin_txn WHERE type = 'expense' AND category_account_id IS NOT NULL GROUP BY category_account_id ORDER BY last DESC LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);
            $lastAcc = $pdo->query("SELECT money_account_id FROM fin_txn WHERE money_account_id IS NOT NULL AND type IN ('expense','receipt','payment') ORDER BY id DESC LIMIT 1")->fetchColumn();
            $taxes = $pdo->query("SELECT id, name, rate, kind FROM fin_taxes WHERE archived = 0 ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
            return [
                'money_accounts' => $pick(fn($a) => finIsMoney($a)),
                'expense_accounts' => $pick(fn($a) => $a['type'] === 'expense' && (int) $a['is_postable'] === 1),
                'revenue_accounts' => $pick(fn($a) => $a['type'] === 'revenue' && (int) $a['is_postable'] === 1),
                'asset_accounts' => $pick(fn($a) => strncmp($a['code'], '15', 2) === 0 && (int) $a['is_postable'] === 1 && $a['system_key'] !== 'accum_dep'),
                'roles' => finPartyRoles(), 'taxes' => $taxes, 'recent_expense_accounts' => array_map('intval', array_column($recent, 'id')), 'last_money_account' => $lastAcc ? (int) $lastAcc : null,
                'permissions' => array_keys(array_filter(finPermissionCatalog(), fn($label, $p) => finCan($pdo, $role, $p), ARRAY_FILTER_USE_BOTH)),
                'payment_methods' => ['cash' => 'نقد', 'card' => 'کارت به کارت', 'transfer' => 'حواله / پایا', 'gateway' => 'درگاه پرداخت', 'crypto' => 'ارز دیجیتال', 'cheque' => 'چک', 'other' => 'سایر'],
            ];
        }],
        'fin_defaults' => ['view', function ($pdo, $in) {
            $pid = (int) ($in['party'] ?? 0);
            if (!$pid) {
                return [];
            }
            $p = finParty($pdo, $pid);
            $st = $pdo->prepare("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE party_id = ? AND type = ? AND status = 'posted'");
            $st->execute([$pid, ($in['kind'] ?? 'sale') === 'purchase' ? 'purchase' : 'sale']);
            $pm = $pdo->prepare("SELECT payment_method, money_account_id FROM fin_txn WHERE party_id = ? AND type IN ('receipt','payment') AND status = 'posted' ORDER BY id DESC LIMIT 1");
            $pm->execute([$pid]);
            $docs = $pdo->prepare("SELECT id, ref, txn_date, due_date, total, paid, returned, refunded FROM fin_txn WHERE party_id = ? AND type = ? AND status = 'posted' AND total - paid - (returned - refunded) > 0 ORDER BY COALESCE(due_date, txn_date), id");
            $docs->execute([$pid, ($in['kind'] ?? 'sale') === 'purchase' ? 'purchase' : 'sale']);
            $items = $pdo->prepare("SELECT meta FROM fin_txn WHERE party_id = ? AND type = 'sale' AND meta IS NOT NULL ORDER BY id DESC LIMIT 5");
            $items->execute([$pid]);
            $recentItems = [];
            foreach ($items->fetchAll(PDO::FETCH_COLUMN) as $m) {
                foreach ((json_decode($m, true)['items'] ?? []) as $it) {
                    $recentItems[$it['name']] = $it;
                }
            }
            return ['party' => ['id' => (int) $p['id'], 'name' => $p['name']], 'outstanding' => (int) $st->fetchColumn(), 'last_payment' => $pm->fetch(PDO::FETCH_ASSOC) ?: null,
                'open_docs' => array_map(fn($d) => $d + ['outstanding' => finOutstanding($d)], $docs->fetchAll(PDO::FETCH_ASSOC)), 'recent_items' => array_slice(array_values($recentItems), 0, 6)];
        }],

        // ---------------- writes
        'fin_sale' => ['sale.create', fn($pdo, $in, $u) => finCreateSale($pdo, $in, $u)],
        'fin_purchase' => ['purchase.create', fn($pdo, $in, $u) => finCreatePurchase($pdo, $in, $u)],
        'fin_expense' => ['expense.create', fn($pdo, $in, $u) => finCreateExpense($pdo, $in, $u)],
        'fin_income' => ['expense.create', fn($pdo, $in, $u) => finCreateIncome($pdo, $in, $u)],
        'fin_receipt' => ['payment.manage', fn($pdo, $in, $u) => finReceivePayment($pdo, $in, $u)],
        'fin_payment' => ['payment.manage', fn($pdo, $in, $u) => finMakePayment($pdo, $in, $u)],
        'fin_transfer' => ['accounts.manage', fn($pdo, $in, $u) => finTransfer($pdo, $in, $u)],
        'fin_capital' => ['capital.manage', fn($pdo, $in, $u) => finCapital($pdo, $in, ($in['direction'] ?? 'in') === 'out' ? 'out' : 'in', $u)],
        'fin_distribute' => ['capital.manage', fn($pdo, $in, $u) => finDistribute($pdo, $in, $u)],
        'fin_ownership' => ['capital.manage', function ($pdo, $in, $u) {
            $shares = [];
            foreach ((array) ($in['shares'] ?? []) as $row) {
                $shares[(int) ($row['party_id'] ?? 0)] = $row['percent'] ?? 0;
            }
            finSetOwnership($pdo, $shares, finParseDate($in['date'] ?? ''), $in['note'] ?? null, $u);
            return ['ok' => true];
        }],
        'fin_refund' => ['sale.cancel', fn($pdo, $in, $u) => finRefundSale($pdo, $in, $u)],
        'fin_cancel' => ['sale.cancel', function ($pdo, $in, $u) {
            finCancelTxn($pdo, (int) ($in['id'] ?? 0), (string) ($in['reason'] ?? ''), $u);
            return ['ok' => true];
        }],
        'fin_party_save' => ['payment.manage', fn($pdo, $in, $u) => ['id' => finSaveParty($pdo, $in, $u)]],
        'fin_loan' => ['capital.manage', fn($pdo, $in, $u) => finCreateLoan($pdo, $in, $u)],
        'fin_loan_pay' => ['capital.manage', fn($pdo, $in, $u) => finLoanPayment($pdo, $in, $u)],
        'fin_asset' => ['accounts.manage', fn($pdo, $in, $u) => finBuyAsset($pdo, $in, $u)],
        'fin_depreciate' => ['accounts.manage', fn($pdo, $in, $u) => ['posted' => finDepreciate($pdo, null, $u)]],
        'fin_account_save' => ['chart.manage', fn($pdo, $in, $u) => ['id' => finSaveAccount($pdo, $in, $u)]],
        'fin_tax_save' => ['chart.manage', function ($pdo, $in, $u) {
            $name = trim((string) ($in['name'] ?? ''));
            $rate = (float) ($in['rate'] ?? 0);
            if ($name === '' || $rate < 0 || $rate > 100) {
                throw new FinError('نام و نرخ مالیات (۰ تا ۱۰۰) لازم است');
            }
            if (!empty($in['id'])) {
                $pdo->prepare("UPDATE fin_taxes SET name = ?, rate = ?, kind = ?, archived = ? WHERE id = ?")->execute([$name, $rate, ($in['kind'] ?? 'sales') === 'purchase' ? 'purchase' : 'sales', !empty($in['archived']) ? 1 : 0, (int) $in['id']]);
                return ['id' => (int) $in['id']];
            }
            $pdo->prepare("INSERT INTO fin_taxes (name, rate, kind) VALUES (?,?,?)")->execute([$name, $rate, ($in['kind'] ?? 'sales') === 'purchase' ? 'purchase' : 'sales']);
            return ['id' => (int) $pdo->lastInsertId()];
        }],
        'fin_perm_save' => ['chart.manage', function ($pdo, $in, $u) {
            $role = (string) ($in['role'] ?? '');
            if (!in_array($role, ['Seller', 'support'], true)) {
                throw new FinError('فقط نقش‌های فروشنده و پشتیبان قابل تنظیم‌اند');
            }
            $list = array_values(array_intersect((array) ($in['permissions'] ?? []), array_keys(finPermissionCatalog())));
            finSetSetting($pdo, 'perm:' . $role, json_encode($list));
            finAudit($pdo, $u, 'permissions', 'role', $role, $list);
            return ['ok' => true];
        }],
        'fin_sync' => ['accounts.manage', function ($pdo, $in, $u) {
            $stats = finSyncLegacy($pdo);
            finDepreciate($pdo, null, 'sync');
            return $stats;
        }],
    ];
}

function picha_finance_route(string $route, PDO $pdo, string $role, ?string $user): void
{
    $routes = picha_finance_routes();
    if (!isset($routes[$route])) {
        fail('مسیر پیدا نشد', 404);
    }
    [$perm, $handler] = $routes[$route];
    if (!finCan($pdo, $role, $perm)) {
        fail('دسترسی به این بخش مالی برای شما مجاز نیست', 403);
    }
    $in = $_SERVER['REQUEST_METHOD'] === 'GET' ? $_GET : array_merge($_GET, body());
    $data = $handler($pdo, $in, $user, $role);
    out(['ok' => true] + (is_array($data) ? $data : ['result' => $data]));
}
