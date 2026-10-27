// dashboard/finance_api.php: the «fin_» routes. Every route checks a finance permission; engine errors become clean JSON errors.
import { qAll, qOne, qRun, qVal } from '../qb.js'
import { fail as pfail, str, now } from '../util.js'
import { sendmessage } from '../../tg.js'
import { numberFormat } from '../../php.js'
import * as E from './engine.js'
import * as R from './reports.js'
import { finSyncLegacy, finMaybeSync } from './legacy.js'

const rangeOf = (inn) => {
  const key = str(inn.range ?? 'month')
  if (key === 'custom') { const r = R.finRange('custom', E.finParseDate(inn.from ?? ''), E.finParseDate(inn.to ?? '') + 86399); return [r.start, r.end, key] }
  const r = R.finRange(['today', 'week', 'month', 'quarter', 'year', 'all'].includes(key) ? key : 'month')
  return [r.start, r.end, key]
}
const pageOf = (inn) => Math.max(1, parseInt(inn.page ?? 1) || 1)
const perOf = (inn) => parseInt(inn.per ?? 50) || 0
const asOf = (inn) => (inn.as_of ? E.finParseDate(inn.as_of) + 86399 : null)
const dirOf = (inn, key = 'kind') => ((inn[key] ?? 'sale') === 'purchase' ? 'purchase' : 'sale')

/** route → [permission, handler(in, user, role)] */
const ROUTES = {
  fin_overview: ['view', async (i) => { await finMaybeSync(); const [a, b, k] = rangeOf(i); return { overview: await R.finOverview(a, b), range_key: k, last_sync: parseInt(await E.finSetting('legacy_last_sync', 0)) || 0 } }],
  fin_pl: ['reports.view', async (i) => { await finMaybeSync(); const [a, b] = rangeOf(i); return { report: await R.finProfitLoss(a, b) } }],
  fin_bs: ['reports.view', async (i) => { await finMaybeSync(); return { report: await R.finBalanceSheet(asOf(i)) } }],
  fin_cf: ['reports.view', async (i) => { await finMaybeSync(); const [a, b] = rangeOf(i); return { report: await R.finCashFlow(a, b) } }],
  fin_tb: ['reports.view', async (i) => ({ report: await R.finTrialBalance(asOf(i)) })],
  fin_ledger: ['reports.view', async (i) => { const [a, b] = rangeOf({ range: 'all', ...i }); return { report: await R.finLedger(i.account ?? 0, a, b, pageOf(i), perOf(i) || 100, i.party ? parseInt(i.party) : null) } }],
  fin_money: ['view', async () => ({ accounts: await R.finMoneyAccounts() })],
  fin_activity: ['view', async (i) => { await finMaybeSync(); const f = { ...i }; if (i.range && i.range !== 'all') { const [a, b] = rangeOf(i); f.from = a; f.to = b } return R.finActivity(f, pageOf(i), perOf(i) || 50) }],
  fin_entry: ['view', async (i) => R.finEntryDetail(parseInt(i.id ?? 0) || 0)],
  fin_txn: ['view', async (i) => R.finTxnDetail(parseInt(i.id ?? 0) || 0)],
  fin_aging: ['view', async (i) => R.finAging(dirOf(i))],
  fin_parties: ['view', async (i) => ({ ...(await R.finPartiesList(str(i.q).trim(), str(i.role), parseInt(i.page ?? 1) || 1, parseInt(i.per ?? 50) || 50)), roles: E.finPartyRoles() })],
  fin_party: ['view', async (i) => R.finPartyProfile(parseInt(i.id ?? 0) || 0)],
  fin_partners: ['capital.manage', async () => ({ ...(await R.finPartners()), can_distribute: true })],
  fin_loans: ['view', async () => ({ loans: await R.finLoansList() })],
  fin_assets: ['view', async () => ({ assets: await R.finAssetsList() })],
  fin_accounts: ['view', async () => { const out = []; for (const a of await R.finAllAccounts()) out.push({ ...a, balance: await E.finAccountBalance(Number(a.id)) }); return { accounts: out } }],
  fin_search: ['view', async (i) => R.finSearch(str(i.q))],
  fin_integrity: ['reports.view', async () => { let st = {}; try { st = JSON.parse((await E.finSetting('legacy_last_stats', '{}')) || '{}') } catch { st = {} } return { problems: await R.finIntegrity(), last_sync: parseInt(await E.finSetting('legacy_last_sync', 0)) || 0, last_stats: st } }],
  fin_audit: ['sensitive', async (i) => { const per = 50; return { rows: await qAll(`SELECT * FROM fin_audit ORDER BY id DESC LIMIT ${per} OFFSET ${(pageOf(i) - 1) * per}`, []), total: Number(await qVal('SELECT COUNT(*) FROM fin_audit', [])) } }],
  fin_meta: ['view', async (i, u, role) => {
    const acc = await R.finAllAccounts(false)
    const pick = (f) => acc.filter(f).map((a) => ({ id: Number(a.id), code: a.code, name: a.name, money_kind: a.money_kind, system_key: a.system_key }))
    const recent = await qAll("SELECT category_account_id id, COUNT(*) n, MAX(id) last FROM fin_txn WHERE type = 'expense' AND category_account_id IS NOT NULL GROUP BY category_account_id ORDER BY last DESC LIMIT 5", [])
    const lastAcc = await qVal("SELECT money_account_id FROM fin_txn WHERE money_account_id IS NOT NULL AND type IN ('expense','receipt','payment') ORDER BY id DESC LIMIT 1", [])
    const taxes = await qAll('SELECT id, name, rate, kind FROM fin_taxes WHERE archived = 0 ORDER BY name', [])
    const perms = []
    for (const p of Object.keys(E.finPermissionCatalog())) if (await E.finCan(role, p)) perms.push(p)
    return { money_accounts: pick((a) => E.finIsMoney(a)), expense_accounts: pick((a) => a.type === 'expense' && Number(a.is_postable) === 1), revenue_accounts: pick((a) => a.type === 'revenue' && Number(a.is_postable) === 1),
      asset_accounts: pick((a) => String(a.code).startsWith('15') && Number(a.is_postable) === 1 && a.system_key !== 'accum_dep'), roles: E.finPartyRoles(), taxes, recent_expense_accounts: recent.map((r) => Number(r.id)), last_money_account: lastAcc ? Number(lastAcc) : null, permissions: perms,
      payment_methods: { cash: 'نقد', card: 'کارت به کارت', transfer: 'حواله / پایا', gateway: 'درگاه پرداخت', crypto: 'ارز دیجیتال', cheque: 'چک', other: 'سایر' } }
  }],
  fin_defaults: ['view', async (i) => {
    const pid = parseInt(i.party ?? 0) || 0
    if (!pid) return []
    const p = await E.finParty(pid)
    const kind = dirOf(i)
    const outstanding = Number(await qVal("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE party_id = ? AND type = ? AND status = 'posted'", [pid, kind]))
    const pm = await qOne("SELECT payment_method, money_account_id FROM fin_txn WHERE party_id = ? AND type IN ('receipt','payment') AND status = 'posted' ORDER BY id DESC LIMIT 1", [pid])
    const docs = await qAll("SELECT id, ref, txn_date, due_date, total, paid, returned, refunded FROM fin_txn WHERE party_id = ? AND type = ? AND status = 'posted' AND total - paid - (returned - refunded) > 0 ORDER BY COALESCE(due_date, txn_date), id", [pid, kind])
    const recentItems = new Map()
    for (const m of await qAll("SELECT meta FROM fin_txn WHERE party_id = ? AND type = 'sale' AND meta IS NOT NULL ORDER BY id DESC LIMIT 5", [pid])) { try { for (const it of JSON.parse(m.meta).items ?? []) recentItems.set(it.name, it) } catch { /* no items */ } }
    return { party: { id: Number(p.id), name: p.name }, outstanding, last_payment: pm, open_docs: docs.map((d) => ({ ...d, outstanding: E.finOutstanding(d) })), recent_items: [...recentItems.values()].slice(0, 6) }
  }],

  // ---------------- writes
  fin_sale: ['sale.create', (i, u) => E.finCreateSale(i, u)],
  fin_purchase: ['purchase.create', (i, u) => E.finCreatePurchase(i, u)],
  fin_expense: ['expense.create', (i, u) => E.finCreateExpense(i, u)],
  fin_income: ['expense.create', (i, u) => E.finCreateIncome(i, u)],
  fin_receipt: ['payment.manage', (i, u) => E.finReceivePayment(i, u)],
  fin_payment: ['payment.manage', (i, u) => E.finMakePayment(i, u)],
  fin_transfer: ['accounts.manage', (i, u) => E.finTransfer(i, u)],
  fin_capital: ['capital.manage', (i, u) => E.finCapital(i, (i.direction ?? 'in') === 'out' ? 'out' : 'in', u)],
  fin_distribute: ['capital.manage', (i, u) => E.finDistribute(i, u)],
  fin_ownership: ['capital.manage', async (i, u) => { const shares = {}; for (const row of Array.isArray(i.shares) ? i.shares : []) shares[parseInt(row.party_id ?? 0) || 0] = row.percent ?? 0; await E.finSetOwnership(shares, E.finParseDate(i.date ?? ''), i.note ?? null, u); return { ok: true } }],
  fin_refund: ['sale.cancel', (i, u) => E.finRefundSale(i, u)],
  fin_cancel: ['sale.cancel', async (i, u) => { await E.finCancelTxn(parseInt(i.id ?? 0) || 0, str(i.reason), u); return { ok: true } }],
  fin_party_save: ['payment.manage', async (i, u) => ({ id: await E.finSaveParty(i, u) })],
  fin_loan: ['capital.manage', (i, u) => E.finCreateLoan(i, u)],
  fin_loan_pay: ['capital.manage', (i, u) => E.finLoanPayment(i, u)],
  fin_asset: ['accounts.manage', (i, u) => E.finBuyAsset(i, u)],
  fin_depreciate: ['accounts.manage', async (i, u) => ({ posted: await E.finDepreciate(null, u) })],
  fin_account_save: ['chart.manage', async (i, u) => ({ id: await E.finSaveAccount(i, u) })],
  fin_tax_save: ['chart.manage', async (i) => {
    const name = str(i.name).trim(), rate = parseFloat(i.rate ?? 0) || 0
    if (name === '' || rate < 0 || rate > 100) E.fail('نام و نرخ مالیات (۰ تا ۱۰۰) لازم است')
    const kind = (i.kind ?? 'sales') === 'purchase' ? 'purchase' : 'sales'
    if (i.id) { await qRun('UPDATE fin_taxes SET name = ?, rate = ?, kind = ?, archived = ? WHERE id = ?', [name, rate, kind, i.archived ? 1 : 0, parseInt(i.id)]); return { id: parseInt(i.id) } }
    const r = await qRun('INSERT INTO fin_taxes (name, rate, kind) VALUES (?,?,?)', [name, rate, kind])
    return { id: Number(r.lastInsertRowid) }
  }],
  fin_perm_save: ['chart.manage', async (i, u) => {
    const role = str(i.role)
    if (!['Seller', 'support'].includes(role)) E.fail('فقط نقش‌های فروشنده و پشتیبان قابل تنظیم‌اند')
    const cat = Object.keys(E.finPermissionCatalog())
    const list = (Array.isArray(i.permissions) ? i.permissions : []).filter((p) => cat.includes(p))
    await E.finSetSetting('perm:' + role, JSON.stringify(list))
    await E.finAudit(u, 'permissions', 'role', role, list)
    return { ok: true }
  }],
  fin_settings: ['chart.manage', async () => {
    const perms = {}
    for (const r of ['Seller', 'support']) { try { perms[r] = JSON.parse((await E.finSetting('perm:' + r, '[]')) || '[]') || [] } catch { perms[r] = [] } }
    const accounts = []
    for (const a of await R.finAllAccounts()) accounts.push({ ...a, balance: await E.finAccountBalance(Number(a.id)) })
    return { perms, catalog: E.finPermissionCatalog(), taxes: await qAll('SELECT * FROM fin_taxes ORDER BY archived, name', []), accounts }
  }],
  fin_remind: ['payment.manage', async (i, u) => {
    const party = await E.finParty(i.party_id ?? 0)
    if (!party.tg_user_id) E.fail('این طرف حساب به تلگرام وصل نیست (آیدی عددی تلگرام را در پروفایلش ثبت کنید)')
    const due = Number(await qVal("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE party_id = ? AND type = 'sale' AND status = 'posted'", [Number(party.id)]))
    if (due <= 0) E.fail('این مشتری طلب بازی ندارد')
    let text = str(i.text).trim()
    if (text === '') text = '🔔 یادآوری پرداخت\n\nمانده‌ی حساب شما: ' + numberFormat(due) + ' تومان\nلطفاً در اولین فرصت پرداخت را انجام دهید. در صورت پرداخت قبلی، این پیام را نادیده بگیرید.'
    const res = await sendmessage(party.tg_user_id, text, null, 'HTML')
    if (!res || res.ok === false || res === false) E.fail('ارسال به تلگرام ناموفق بود: ' + ((res && res.description) || 'نامشخص'), 502)
    await E.finAudit(u, 'remind', 'party', party.id, { due })
    return { sent: true, due }
  }],
  fin_sync: ['accounts.manage', async (i, u) => { const stats = await finSyncLegacy(); await E.finDepreciate(null, 'sync'); return stats }],
}

export async function route(r, q, body, admin) {
  const def = ROUTES[r]
  if (!def) pfail('مسیر پیدا نشد', 404)
  const [perm, handler] = def
  if (!(await E.finCan(admin.rule, perm))) pfail('دسترسی به این بخش مالی برای شما مجاز نیست', 403)
  const input = { ...q, ...body }
  const data = await handler(input, admin.username, admin.rule)
  return { ok: true, ...(data && typeof data === 'object' && !Array.isArray(data) ? data : Array.isArray(data) && !data.length ? {} : { result: data }) }
}
