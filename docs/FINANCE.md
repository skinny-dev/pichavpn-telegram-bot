# Finance system (panel «مالی»)

A financial layer built **into** the existing Picha management panel, not next to it. Business people use sales / expenses /
receipts / transfers; underneath, every event becomes a balanced double-entry journal entry.

```
Management layer   panel pages + quick actions + the bot's own data (customers, payments, expenses)
        ↓
Transaction layer  fin_txn (+ fin_alloc, fin_parties)      finance/engine.php  (services)
        ↓
Ledger layer       fin_journal / fin_journal_lines / fin_accounts   (Debit total = Credit total, always)
        ↓
Reporting layer    finance/reports.php  → P&L, balance sheet, cash flow, trial balance, ledger, aging, timeline, search
```

## 1. What existed before (analysis)
| Existing | What it was | What we did |
|---|---|---|
| `expenses` (+`kind`), `capital_entries`, `Payment_report` rows `cost` / `capital_injection` (Mirza-Pro) | flat accounting rows, written by the bot commands (`/expense`, `/ad`, `/capital`, …) and the panel «داده‌های حسابداری» | **kept untouched**. A bridge (`finance/legacy.php`) turns them into journal entries (idempotent, edit/delete aware) |
| `Payment_report` paid rows (customer money in) | cash received from customers / admin-registered sales | become `Dr money account / Cr sales revenue` (same policy as the bot's «آمار»: revenue = cash received) |
| `invoice` (VPN orders), `user.Balance` (customer wallets) | operational data | not duplicated; wallet balances are shown as information (liability) |
| `stats_report.php` P&L | accountant-style statement from legacy tables | unchanged; `scripts/fin_sync.php --check` reconciles it with the ledger (matches to the toman on test data) |
| panel `admin` table, roles | `administrator` / `support` / `Seller` | reused; finance permissions are checked per route (`finCan`) |

Not reusable / new: parties, chart of accounts, journal, receivables/payables documents, transfers, partners/ownership history, loans, assets.

## 2. Data model (all tables are created by `php table.php`, nothing is dropped)
- `fin_accounts` – chart of accounts. Configurable (add/rename/archive); code looks accounts up by `system_key`, never by id. Money accounts (cash/bank/gateway/crypto/wallet/other) are asset accounts with `money_kind`.
- `fin_journal` / `fin_journal_lines` – the books. Statuses draft/posted/reversed/cancelled; `reversal_of`/`reversed_by`; `source_type/source_id/source_key` (idempotency + traceability); `created_by/at`, `approved_by/at`, `reason`; `currency`+`rate` (multi-currency ready, base = toman).
- `fin_txn` – business transactions: sale, purchase(bill), expense, income, receipt, payment, transfer, capital_in/out, distribution, loan_in/out/payment, refund_sale, asset_purchase… Header-per-event, `ref` like `SALE-12`, `paid/returned/refunded` caches that `finIntegrity()` reconciles against `fin_alloc` and the ledger.
- `fin_alloc` – payment → document allocations (a sale and its payments are separate events).
- `fin_parties` – one identity with several roles (customer, supplier, employee, partner, shareholder, investor, lender, borrower, other); optional link to a Telegram customer.
- `fin_ownership` – ownership % history (append-only; January 60/40 and March 50/30/20 both stay).
- `fin_loans`, `fin_assets` (+ monthly straight-line depreciation, idempotent), `fin_taxes`, `fin_settings`, `fin_audit`, `fin_docs` (table ready).

## 3. Accounting rules enforced in code
- Every entry balances (rejected otherwise); header accounts and archived accounts cannot be posted to.
- Atomic: every service runs in one DB transaction (a sale + its payment succeed or fail together).
- Posted records are never deleted: cancelling creates a mirror entry (original is flagged `reversed`, both stay in the books and net to zero). A document with payments/refunds must have those cancelled first.
- No overpayment (receipts ≤ receivable, payments ≤ payable), no spending/transfer above an account's balance (except accounts flagged `allow_negative`, e.g. the «unspecified legacy account»), no transfer to the same account, no refund above what is left.
- Capital, loans and transfers are never revenue/expense; tax is kept as liability/asset, not mixed into revenue/expense; owner drawings and dividends are equity, not expenses.
- Ownership changes append rows; distributions split by the ownership in force on the date (rounding remainder goes to the last partner).

## 4. Legacy bridge policy (please read)
- Customer payments (`Payment_report` paid, except wallet spending / admin gifts / unpaid) → revenue when the money arrives; money account chosen by payment method (card → bank, zarinpal/… → gateway, crypto, admin sales → cash).
- Legacy expenses / capital have no account information, so their money side is the **«حساب نامشخص (انتقال از سیستم قبلی)»**. Its balance is simply (capital + receipts − expenses) of the old data. Move real balances into your real cash/bank accounts with a Transfer and it stays honest.
- Rows that cannot be understood (bad date, zero amount) are listed in the panel / `fin_sync.php`, never guessed.
- The bot's own «آمار» still reads the legacy tables. Entries created in the new Finance section live in the ledger only (phase 2: let the bot's `/expense`, `/ad` … write through the finance engine).

## 5. Panel (mobile + desktop)
Sidebar/bottom bar → **مالی** with sections: بررسی کلی · تراکنش‌ها · پول و بانک · طلب‌ها · بدهی‌ها · طرف‌حساب‌ها · سرمایه و شرکا · وام و دارایی · گزارش‌ها · تنظیمات.
- Quick actions (`+` button, or `N`): sale, expense, receive money, pay money, transfer, income, purchase, capital, party. Forms are bottom sheets on phones, dialogs on desktop; smart defaults (last account, recent categories/items, party outstanding, open documents, prefilled settle amount).
- Tables become cards on phones (no horizontal scrolling); global search (`/`) over parties, transactions, accounts, entries (by name, ref, amount, memo).
- Every transaction opens a detail with its financial effect (journal lines), payments, refunds and audit trail; actions: receive/pay, refund, cancel (reason required).
- Reports: P&L, balance sheet (checks A = L + E), cash flow (operating/investing/financing, reconciled with account balances), trial balance, ledger per account with running balance, sales/expense breakdown by category, tax position; CSV export and print.
- Settings: chart of accounts / categories, taxes, per-role permissions, ledger health check and audit log.

## 6. Operating it
```bash
php scripts/fin_sync.php --check     # first import + integrity + reconciliation against the bot's «آمار»
# the panel also syncs small batches automatically (at most once a minute)
```
Permissions (`finPermissionCatalog`): administrator has everything; Seller/support get nothing unless granted in Settings → دسترسی‌ها (support accounts still only see the live-chat page of the web panel).

## 7. Tests
`php tests/finance_test.php` (83 engine checks on a throw-away DB) · `python3 tests/api_test.py …` (finance API incl. permissions) · `node tests/finance_e2e.mjs` (browser: capital → expense → part-paid sale → collect → search → report, desktop + phone viewport, no horizontal scroll, no console errors).

## 8. Not done yet (explicitly)
- Inventory/warehouses and COGS-on-sale (accounts `inventory`/`cogs` exist; the VPN business has no physical stock).
- Multi-currency UI/conversion (columns and rate fields exist, everything is toman today).
- Document attachments upload (`fin_docs` table exists), approval workflow UI (fields exist), period locking.
- Bot commands writing through the finance engine; importing bot customers into parties in bulk; XLSX/PDF export (CSV + browser print exist).
