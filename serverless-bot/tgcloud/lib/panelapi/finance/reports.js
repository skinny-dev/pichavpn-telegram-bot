// finance/reports.php: financial reports and read models, all derived from the journal.
import { qAll, qOne, qVal } from '../qb.js'
import { str, now } from '../util.js'
import { jd, statsPeriod } from '../stats.js'
import { jalaliToGregorian } from '../../sms.js'
import { phpRound } from '../../fmt.js'
import * as E from './engine.js'
import { FinError } from './engine.js'

export const COUNTED = "('posted','reversed')" // reversed originals stay in the books: the mirror entry nets them to zero
const TZ = 12600

/** [start, end, title] for today|week|month|quarter|year|all|custom (Tehran time, Jalali calendar) */
export function finRange(key, from = null, to = null) {
  const at = now()
  const mk = (jy, jm, jdd) => { const [gy, gm, gd] = jalaliToGregorian(jy, jm, jdd); return Date.UTC(gy, gm - 1, gd) / 1000 - TZ }
  const [jy, jm] = jd('Y/n', at).split('/').map(Number)
  switch (key) {
    case 'today': return { start: statsPeriod('today').start, end: at, title: 'امروز' }
    case 'week': {
      const d0 = Math.floor((at + TZ) / 86400) * 86400 - TZ
      const w = new Date((d0 + TZ) * 1000).getUTCDay() // 0 = Sunday
      return { start: d0 - ((w + 1) % 7) * 86400, end: at, title: 'این هفته' } // weeks start on Saturday
    }
    case 'month': return { start: mk(jy, jm, 1), end: at, title: 'این ماه' }
    case 'quarter': return { start: mk(jy, Math.trunc((jm - 1) / 3) * 3 + 1, 1), end: at, title: 'این فصل' }
    case 'year': return { start: mk(jy, 1, 1), end: at, title: 'امسال' }
    case 'custom':
      if (from === null || to === null || from > to) throw new FinError('بازه‌ی زمانی نامعتبر است')
      return { start: from, end: to, title: 'بازه‌ی دلخواه' }
    default: return { start: 0, end: at, title: 'از ابتدا' }
  }
}

/** {accountId: {d, c}} for entries dated within [from, to] */
export async function finSums(from, to) {
  const out = {}
  for (const r of await qAll(`SELECT l.account_id, SUM(l.debit) d, SUM(l.credit) c FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE j.status IN ${COUNTED} AND j.entry_date BETWEEN ? AND ? GROUP BY l.account_id`, [from, to])) out[Number(r.account_id)] = { d: Number(r.d), c: Number(r.c) }
  return out
}
export const finNatural = (acct, s) => (E.finNaturalDebit(acct) ? s.d - s.c : s.c - s.d)
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
export async function finAllAccounts(withArchived = true) {
  const c = [...(await E.accountsCache()).id.values()].sort((a, b) => cmp(String(a.code), String(b.code)))
  return withArchived ? c : c.filter((a) => Number(a.archived) === 0)
}

/** group of an income-statement account: sales | cogs | opex | other_income | other_expense */
export function finPlGroup(a) {
  const c = String(a.code)
  if (a.type === 'revenue') return c.startsWith('43') || c.startsWith('44') ? 'other_income' : 'sales'
  if (c.startsWith('51')) return 'cogs'
  if (c.startsWith('55')) return 'other_expense'
  return 'opex'
}

export async function finProfitLoss(from, to) {
  const sums = await finSums(from, to)
  const groups = { sales: [], cogs: [], opex: [], other_income: [], other_expense: [] }
  const tot = { sales: 0, cogs: 0, opex: 0, other_income: 0, other_expense: 0 }
  for (const a of await finAllAccounts()) {
    if (!['revenue', 'expense'].includes(a.type) || !sums[Number(a.id)]) continue
    const v = finNatural(a, sums[Number(a.id)])
    if (v === 0) continue
    const g = finPlGroup(a)
    groups[g].push({ id: Number(a.id), code: a.code, name: a.name, amount: v })
    tot[g] += v
  }
  const gross = tot.sales - tot.cogs, operating = gross - tot.opex, net = operating + tot.other_income - tot.other_expense
  return { from, to, groups, totals: tot, gross_profit: gross, operating_profit: operating, net_profit: net, gross_margin: tot.sales > 0 ? phpRound((gross * 100) / tot.sales, 1) : null, net_margin: tot.sales > 0 ? phpRound((net * 100) / tot.sales, 1) : null }
}

export async function finBalanceSheet(asOf = null) {
  asOf = asOf ?? now()
  const sums = await finSums(0, asOf)
  const sec = { asset: [], liability: [], equity: [] }
  const tot = { asset: 0, liability: 0, equity: 0 }
  let earn = 0
  for (const a of await finAllAccounts()) {
    const v = finNatural(a, sums[Number(a.id)] ?? { d: 0, c: 0 })
    if (a.type === 'revenue') earn += v
    else if (a.type === 'expense') earn -= v
    else { if (v !== 0) sec[a.type].push({ id: Number(a.id), code: a.code, name: a.name, amount: v }); tot[a.type] += v }
  }
  const equityTotal = tot.equity + earn
  return { as_of: asOf, assets: sec.asset, liabilities: sec.liability, equity: sec.equity, current_earnings: earn, totals: { assets: tot.asset, liabilities: tot.liability, equity: equityTotal, liabilities_and_equity: tot.liability + equityTotal }, balanced: tot.asset === tot.liability + equityTotal }
}

function cashClass(a) {
  const k = str(a.system_key)
  if (String(a.code).startsWith('15') || k === 'loan_receivable') return 'investing'
  if (['capital', 'drawings', 'dividends', 'loan_payable', 'retained'].includes(k)) return 'financing'
  return 'operating'
}
async function moneyTotal(asOf) {
  let sum = 0
  for (const a of await finAllAccounts()) if (E.finIsMoney(a)) sum += await E.finAccountBalance(a.id, asOf)
  return sum
}
export async function finCashFlow(from, to) {
  const rows = await qAll(`SELECT a.id, a.code, a.name, a.system_key, SUM(l.credit - l.debit) f FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id
    WHERE j.status IN ${COUNTED} AND j.entry_date BETWEEN ? AND ? AND (a.money_kind IS NULL OR a.money_kind = '')
      AND EXISTS (SELECT 1 FROM fin_journal_lines l2 JOIN fin_accounts a2 ON a2.id = l2.account_id WHERE l2.entry_id = l.entry_id AND a2.money_kind IS NOT NULL AND a2.money_kind != '')
    GROUP BY a.id, a.code, a.name, a.system_key HAVING f != 0 ORDER BY a.code`, [from, to])
  const sec = { operating: [], investing: [], financing: [] }
  const tot = { operating: 0, investing: 0, financing: 0 }
  for (const r of rows) { const cls = cashClass(r); sec[cls].push({ code: r.code, name: r.name, amount: Number(r.f) }); tot[cls] += Number(r.f) }
  const net = tot.operating + tot.investing + tot.financing
  const opening = await moneyTotal(from - 1), closing = await moneyTotal(to)
  return { from, to, sections: sec, totals: tot, net_change: net, opening, closing, reconciled: opening + net === closing }
}

export async function finTrialBalance(asOf = null) {
  const sums = await finSums(0, asOf ?? now())
  const rows = []
  let td = 0, tc = 0
  for (const a of await finAllAccounts()) {
    const s = sums[Number(a.id)]
    if (!s || (s.d === 0 && s.c === 0)) continue
    const bal = s.d - s.c
    rows.push({ id: Number(a.id), code: a.code, name: a.name, type: a.type, debit: s.d, credit: s.c, balance_debit: Math.max(0, bal), balance_credit: Math.max(0, -bal) })
    td += Math.max(0, bal); tc += Math.max(0, -bal)
  }
  return { rows, total_debit: td, total_credit: tc, balanced: td === tc }
}

/** account ledger with a running balance (natural side); the opening balance is everything before `from` */
export async function finLedger(account, from, to, page = 1, per = 100, partyId = null) {
  const a = await E.finAccountOrFail(account, null, false)
  const natural = E.finNaturalDebit(a)
  const pw = partyId ? ' AND l.party_id = ' + parseInt(partyId) : ''
  const o = await qOne(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status IN ${COUNTED} AND j.entry_date < ?${pw}`, [Number(a.id), from])
  const opening = natural ? Number(o.d) - Number(o.c) : Number(o.c) - Number(o.d)
  const total = Number(await qVal(`SELECT COUNT(*) FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status IN ${COUNTED} AND j.entry_date BETWEEN ? AND ?${pw}`, [Number(a.id), from, to]))
  per = Math.max(10, Math.min(500, per)); page = Math.max(1, page)
  const skip = (page - 1) * per
  let pre = 0
  if (skip > 0) {
    const pp = await qOne(`SELECT COALESCE(SUM(x.debit),0) d, COALESCE(SUM(x.credit),0) c FROM (SELECT l.debit, l.credit FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status IN ${COUNTED} AND j.entry_date BETWEEN ? AND ?${pw} ORDER BY j.entry_date, j.id, l.id LIMIT ${skip}) x`, [Number(a.id), from, to])
    pre = natural ? Number(pp.d) - Number(pp.c) : Number(pp.c) - Number(pp.d)
  }
  let run = opening + pre
  const rows = (await qAll(`SELECT j.id entry_id, j.entry_no, j.entry_date, j.memo, j.source_type, j.txn_id, l.debit, l.credit, l.party_id, p.name party_name FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id LEFT JOIN fin_parties p ON p.id = l.party_id
    WHERE l.account_id = ? AND j.status IN ${COUNTED} AND j.entry_date BETWEEN ? AND ?${pw} ORDER BY j.entry_date, j.id, l.id LIMIT ${per} OFFSET ${skip}`, [Number(a.id), from, to])).map((r) => { run += natural ? Number(r.debit) - Number(r.credit) : Number(r.credit) - Number(r.debit); return { ...r, balance: run } })
  const breakdown = []
  if (a.money_kind) {
    for (const r of await qAll(`SELECT COALESCE(t.type, j.source_type, 'other') k, COALESCE(SUM(l.debit),0) inn, COALESCE(SUM(l.credit),0) outt FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id LEFT JOIN fin_txn t ON t.id = j.txn_id
      WHERE l.account_id = ? AND j.status IN ${COUNTED} AND j.entry_date BETWEEN ? AND ?${pw} GROUP BY k ORDER BY (SUM(l.debit) + SUM(l.credit)) DESC, k`, [Number(a.id), from, to])) breakdown.push({ kind: String(r.k), in: Number(r.inn), out: Number(r.outt) })
  }
  return { account: { id: Number(a.id), code: a.code, name: a.name, type: a.type }, opening, rows, total, page, per, closing: await E.finAccountBalance(a.id, to), breakdown }
}

// ------------------------------------------------------------------ money accounts
export async function finMoneyAccounts() {
  const out = []
  const since = now() - 30 * 86400
  for (const a of await finAllAccounts()) {
    if (!E.finIsMoney(a)) continue
    const bal = await E.finAccountBalance(a.id)
    const io = await qOne(`SELECT COALESCE(SUM(l.debit),0) i, COALESCE(SUM(l.credit),0) o FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status IN ${COUNTED} AND j.entry_date >= ?`, [Number(a.id), since])
    const last = await qVal(`SELECT MAX(j.entry_date) FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status IN ${COUNTED}`, [Number(a.id)])
    out.push({ id: Number(a.id), code: a.code, name: a.name, kind: a.money_kind, balance: bal, incoming_30d: Number(io.i), outgoing_30d: Number(io.o), last_activity: last ? Number(last) : null, archived: Number(a.archived), allow_negative: Number(a.allow_negative) })
  }
  return out
}

// ------------------------------------------------------------------ overview
export async function finOverview(from, to) {
  const pl = await finProfitLoss(from, to)
  const bs = await finBalanceSheet(to)
  const money = { cash: 0, bank: 0, other: 0 }
  for (const m of await finMoneyAccounts()) if (!m.archived) money[m.kind === 'cash' ? 'cash' : m.kind === 'bank' ? 'bank' : 'other'] += m.balance
  const bal = async (key) => { const a = await E.finAccount(key); return a ? E.finAccountBalance(a.id, to) : 0 }
  const od = async (type) => Number(await qVal("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE type = ? AND status = 'posted' AND due_date IS NOT NULL AND due_date < ? AND total - paid - (returned - refunded) > 0", [type, now()]))
  const overdueAr = await od('sale'), overdueAp = await od('purchase')
  const span = Math.max(1, Math.ceil((to - from) / 86400))
  const fmt = span > 100 ? '%Y-%m' : '%Y-%m-%d'
  const series = new Map()
  for (const r of await qAll(`SELECT strftime('${fmt}', j.entry_date + 12600, 'unixepoch') k, a.type t, SUM(l.credit - l.debit) v FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id
      WHERE j.status IN ${COUNTED} AND j.entry_date BETWEEN ? AND ? AND a.type IN ('revenue','expense') GROUP BY k, t ORDER BY k`, [from, to])) {
    if (!series.has(r.k)) series.set(r.k, { date: r.k, revenue: 0, expense: 0 })
    series.get(r.k)[r.t === 'revenue' ? 'revenue' : 'expense'] += r.t === 'revenue' ? Number(r.v) : -Number(r.v)
  }
  const wallet = Number(await qVal('SELECT COALESCE(SUM(CAST(Balance AS INTEGER)),0) FROM user', []))
  return { range: { from, to }, cash: money.cash, bank: money.bank, other_money: money.other, money_total: money.cash + money.bank + money.other,
    revenue: pl.totals.sales + pl.totals.other_income, sales: pl.totals.sales, cogs: pl.totals.cogs, expenses: pl.totals.opex + pl.totals.other_expense, gross_profit: pl.gross_profit, net_profit: pl.net_profit, net_margin: pl.net_margin,
    receivables: await bal('ar'), payables: await bal('ap'), overdue_receivables: overdueAr, overdue_payables: overdueAp, inventory: await bal('inventory'), tax_payable: await bal('tax_payable'), loans_payable: await bal('loan_payable'), loans_receivable: await bal('loan_receivable'),
    capital: await bal('capital'), equity: bs.totals.equity, customer_wallets_info: wallet, series: [...series.values()] }
}

// ------------------------------------------------------------------ receivables / payables
export async function finAging(docType) {
  const at = now()
  const today0 = statsPeriod('today').start
  const sum = { total: 0, overdue: 0, due_today: 0, due_soon: 0, later: 0, no_due: 0 }
  const parties = new Map(), docs = []
  for (const t of await qAll("SELECT t.*, p.name party_name FROM fin_txn t LEFT JOIN fin_parties p ON p.id = t.party_id WHERE t.type = ? AND t.status = 'posted' AND t.total - t.paid - (t.returned - t.refunded) > 0 ORDER BY COALESCE(t.due_date, t.txn_date), t.id", [docType])) {
    const out = E.finOutstanding(t)
    const due = t.due_date !== null ? Number(t.due_date) : null
    const bucket = due === null ? 'no_due' : due < today0 ? 'overdue' : due < today0 + 86400 ? 'due_today' : due < today0 + 8 * 86400 ? 'due_soon' : 'later'
    sum[bucket] += out; sum.total += out
    const pid = Number(t.party_id)
    if (!parties.has(pid)) parties.set(pid, { party_id: pid, name: t.party_name ?? '—', total: 0, paid: 0, remaining: 0, overdue: 0, next_due: null, docs: 0 })
    const p = parties.get(pid)
    p.total += Number(t.total); p.paid += Number(t.paid); p.remaining += out; p.docs++
    if (bucket === 'overdue') p.overdue += out
    if (due !== null && (p.next_due === null || due < p.next_due)) p.next_due = due
    docs.push({ id: Number(t.id), ref: t.ref, party_id: pid, party_name: t.party_name, date: Number(t.txn_date), due_date: due, total: Number(t.total), paid: Number(t.paid), outstanding: out, state: E.finDocState(t, at), bucket })
  }
  const collected = Number(await qVal("SELECT COALESCE(SUM(paid),0) FROM fin_txn WHERE type = ? AND status = 'posted'", [docType]))
  const list = [...parties.values()].sort((a, b) => b.remaining - a.remaining)
  for (const pa of list) { const l = await qVal("SELECT MAX(p.txn_date) FROM fin_txn p WHERE p.party_id = ? AND p.type = ? AND p.status = 'posted'", [pa.party_id, docType === 'sale' ? 'receipt' : 'payment']); pa.last_payment = l ? Number(l) : null }
  return { summary: { ...sum, collected }, parties: list, docs }
}

// ------------------------------------------------------------------ activity / timeline
const ACT_LABELS = { sale: 'فروش', purchase: 'خرید', expense: 'هزینه', income: 'درآمد', receipt: 'دریافت پول', payment: 'پرداخت', transfer: 'انتقال', capital_in: 'ورود سرمایه', capital_out: 'برداشت از سرمایه', distribution: 'تقسیم سود', loan: 'وام', loan_payment: 'قسط وام',
  refund_sale: 'برگشت از فروش', asset_purchase: 'خرید دارایی', depreciation: 'استهلاک', reversal: 'برگشت سند', manual: 'سند دستی', legacy_expense: 'هزینه', legacy_capital: 'ورود سرمایه', legacy_payment: 'پرداخت مشتری', legacy_cost: 'هزینه' }
export const finActivityTitle = (j) => ACT_LABELS[j.source_type] ?? j.source_type
const likeEsc = (q) => String(q).replace(/[%_\\]/g, (c) => '\\' + c)

export async function finActivity(f, page = 1, per = 50) {
  const where = ["j.status IN ('posted','reversed','draft')"], params = []
  if (f.from) { where.push('j.entry_date >= ?'); params.push(parseInt(f.from)) }
  if (f.to) { where.push('j.entry_date <= ?'); params.push(parseInt(f.to)) }
  if (f.type) {
    let types = [String(f.type)]
    if (f.type === 'expense') types = ['expense', 'legacy_expense', 'legacy_cost']
    else if (f.type === 'capital_in') types = ['capital_in', 'legacy_capital']
    else if (f.type === 'receipt') types = ['receipt', 'legacy_payment']
    where.push('j.source_type IN (' + types.map(() => '?').join(',') + ')'); params.push(...types)
  }
  if (f.account) { where.push('EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.entry_id = j.id AND l.account_id = ?)'); params.push(parseInt(f.account)) }
  if (f.party) { where.push('EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.entry_id = j.id AND l.party_id = ?)'); params.push(parseInt(f.party)) }
  const q = str(f.q).trim()
  if (q !== '') {
    const like = '%' + likeEsc(q) + '%'
    const or = ["j.memo LIKE ? ESCAPE '\\'", "j.entry_no LIKE ? ESCAPE '\\'", "t.ref LIKE ? ESCAPE '\\'", "t.memo LIKE ? ESCAPE '\\'", "EXISTS (SELECT 1 FROM fin_journal_lines l JOIN fin_parties p ON p.id = l.party_id WHERE l.entry_id = j.id AND p.name LIKE ? ESCAPE '\\')"]
    params.push(like, like, like, like, like)
    const digits = q.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0)).replace(/[,٬ ]/g, '')
    if (/^\d+$/.test(digits)) { or.push('EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.entry_id = j.id AND (l.debit = ? OR l.credit = ?))'); params.push(parseInt(digits), parseInt(digits)) }
    where.push('(' + or.join(' OR ') + ')')
  }
  const moneySql = "(SELECT COALESCE(SUM(l.debit - l.credit),0) FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id AND a.money_kind IS NOT NULL AND a.money_kind != '' WHERE l.entry_id = j.id)"
  if (f.direction === 'in') where.push(`${moneySql} > 0`)
  else if (f.direction === 'out') where.push(`${moneySql} < 0`)
  const w = ' WHERE ' + where.join(' AND ')
  const from = 'FROM fin_journal j LEFT JOIN fin_txn t ON t.id = j.txn_id'
  const total = Number(await qVal(`SELECT COUNT(*) ${from}${w}`, params))
  per = Math.max(10, Math.min(200, per)); page = Math.max(1, page)
  const rows = (await qAll(`SELECT j.id, j.entry_no, j.entry_date, j.memo, j.source_type, j.status, j.txn_id, t.ref, t.type txn_type, t.party_id, ${moneySql} AS money_effect, (SELECT COALESCE(SUM(debit),0) FROM fin_journal_lines WHERE entry_id = j.id) AS amount,
      (SELECT p.name FROM fin_journal_lines l JOIN fin_parties p ON p.id = l.party_id WHERE l.entry_id = j.id LIMIT 1) AS party_name ${from}${w} ORDER BY j.entry_date DESC, j.id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, params))
    .map((r) => ({ ...r, title: finActivityTitle(r), direction: Number(r.money_effect) > 0 ? 'in' : Number(r.money_effect) < 0 ? 'out' : 'none' }))
  return { rows, total, page, per }
}

export async function finEntryDetail(id) {
  const j = await qOne('SELECT j.*, t.ref, t.type txn_type FROM fin_journal j LEFT JOIN fin_txn t ON t.id = j.txn_id WHERE j.id = ?', [id])
  if (!j) throw new FinError('سند پیدا نشد', 404)
  const lines = await qAll('SELECT l.*, a.code, a.name account_name, p.name party_name FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id LEFT JOIN fin_parties p ON p.id = l.party_id WHERE l.entry_id = ? ORDER BY l.id', [id])
  const audit = await qAll("SELECT * FROM fin_audit WHERE (entity = 'journal' AND entity_id = ?) OR (entity != 'journal' AND entity_id = ?) ORDER BY id DESC LIMIT 30", [String(id), String(j.txn_id ?? 0)])
  return { entry: { ...j, title: finActivityTitle(j) }, lines, audit }
}

export async function finTxnDetail(id) {
  const t = await E.finTxn(id)
  const doc = ['sale', 'purchase'].includes(t.type)
  t.state = doc ? E.finDocState(t) : null
  t.outstanding = doc ? E.finOutstanding(t) : null
  try { t.meta = t.meta ? JSON.parse(t.meta) : null } catch { t.meta = null }
  const party = t.party_id ? await qOne('SELECT id, name FROM fin_parties WHERE id = ?', [Number(t.party_id)]) : null
  const links = await qAll(`SELECT a.*, t.ref, t.txn_date, t.status FROM fin_alloc a JOIN fin_txn t ON t.id = ${doc ? 'a.payment_txn_id' : 'a.doc_txn_id'} WHERE ${doc ? 'a.doc_txn_id' : 'a.payment_txn_id'} = ? ORDER BY a.id`, [id])
  const documents = await qAll('SELECT id, kind, name, size, created_at FROM fin_docs WHERE txn_id = ?', [id])
  const children = await qAll('SELECT id, ref, type, total, txn_date, status FROM fin_txn WHERE parent_txn_id = ? ORDER BY id', [id])
  return { txn: t, party, links, documents, children, journal: t.journal_id ? await finEntryDetail(Number(t.journal_id)) : null }
}

// ------------------------------------------------------------------ parties
export async function finPartyProfile(id) {
  const p = await E.finParty(id, false)
  const bal = (type) => qOne("SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(paid),0) paid, COALESCE(SUM(returned),0) ret, COALESCE(SUM(CASE WHEN status='posted' THEN total - paid - (returned - refunded) ELSE 0 END),0) rem FROM fin_txn WHERE party_id = ? AND type = ? AND status = 'posted'", [id, type])
  const sales = await bal('sale'), bills = await bal('purchase')
  const txns = await qAll('SELECT t.id, t.ref, t.type, t.txn_date, t.total, t.status, t.memo FROM fin_txn t WHERE t.party_id = ? ORDER BY t.txn_date DESC, t.id DESC LIMIT 50', [id])
  const own = await E.finOwnershipAt()
  return { party: { ...p, roles_list: String(p.roles ?? '').split(',').filter((x) => x !== '') },
    receivable: { count: Number(sales.n), total: Number(sales.total), paid: Number(sales.paid), remaining: Number(sales.rem) }, payable: { count: Number(bills.n), total: Number(bills.total), paid: Number(bills.paid), remaining: Number(bills.rem) },
    net_balance: Number(sales.rem) - Number(bills.rem), ownership: own[id] ?? null, transactions: txns, notes: [] }
}

export async function finPartiesList(q = '', role = '', page = 1, per = 50) {
  const where = ['p.archived = 0'], params = []
  if (q !== '') { where.push("(p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\' OR p.tg_user_id LIKE ? ESCAPE '\\')"); const like = '%' + likeEsc(q) + '%'; params.push(like, like, like) }
  if (role !== '') { where.push("(',' || p.roles || ',') LIKE '%,' || ? || ',%'"); params.push(role) }
  const w = ' WHERE ' + where.join(' AND ')
  const total = Number(await qVal(`SELECT COUNT(*) FROM fin_parties p${w}`, params))
  per = Math.max(10, Math.min(200, per)); page = Math.max(1, page)
  const rows = await qAll(`SELECT p.*, (SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE party_id = p.id AND type = 'sale' AND status = 'posted') AS receivable,
      (SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE party_id = p.id AND type = 'purchase' AND status = 'posted') AS payable FROM fin_parties p${w} ORDER BY p.name LIMIT ${per} OFFSET ${(page - 1) * per}`, params)
  return { rows, total, page, per }
}

// ------------------------------------------------------------------ partners / capital
export async function finPartners() {
  const own = await E.finOwnershipAt(now())
  const ids = new Set(Object.keys(own).map(Number))
  for (const r of await qAll('SELECT DISTINCT party_id FROM fin_ownership', [])) ids.add(Number(r.party_id))
  const rows = []
  const cap = async (pid, key) => Number(await qVal(`SELECT COALESCE(SUM(l.credit - l.debit),0) FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id JOIN fin_accounts a ON a.id = l.account_id WHERE l.party_id = ? AND a.system_key = ? AND j.status IN ${COUNTED}`, [pid, key]))
  for (const pid of ids) {
    const p = await qOne('SELECT id, name FROM fin_parties WHERE id = ?', [pid])
    if (!p) continue
    rows.push({ party_id: pid, name: p.name, percent: own[pid] ?? 0, invested: await cap(pid, 'capital'), withdrawn: -(await cap(pid, 'drawings')), profit_share: -(await cap(pid, 'dividends')) })
  }
  const history = await qAll('SELECT o.id, o.party_id, p.name, o.percent, o.effective_from, o.note FROM fin_ownership o JOIN fin_parties p ON p.id = o.party_id ORDER BY o.effective_from DESC, o.id DESC LIMIT 200', [])
  rows.sort((a, b) => b.percent - a.percent)
  return { partners: rows, history, total_percent: Object.values(own).reduce((x, y) => x + y, 0) }
}

// ------------------------------------------------------------------ loans & assets lists
export async function finLoansList() {
  const rows = await qAll('SELECT l.*, p.name party_name FROM fin_loans l JOIN fin_parties p ON p.id = l.party_id ORDER BY l.status, l.id DESC', [])
  for (const l of rows) { l.remaining = await E.finLoanRemaining(Number(l.id)); l.paid_principal = (parseInt(l.principal) || 0) - l.remaining }
  return rows
}
export async function finAssetsList() {
  const rows = await qAll('SELECT a.*, c.name class_name FROM fin_assets a LEFT JOIN fin_accounts c ON c.id = a.asset_account_id ORDER BY a.status, a.id DESC', [])
  for (const a of rows) {
    a.accumulated_depreciation = Number(await qVal(`SELECT COALESCE(SUM(l.credit),0) FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE j.source_type = 'depreciation' AND j.source_id = ? AND j.status IN ${COUNTED} AND l.credit > 0`, [String(a.id)]))
    a.book_value = (parseInt(a.cost) || 0) - a.accumulated_depreciation
  }
  return rows
}

// ------------------------------------------------------------------ global search
export async function finSearch(q, limit = 8) {
  q = str(q).trim()
  if (q === '') return { parties: [], transactions: [], accounts: [], entries: [] }
  const like = '%' + likeEsc(q) + '%'
  const digits = q.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0)).replace(/[,٬ ]/g, '')
  const parties = await qAll(`SELECT id, name, roles, phone FROM fin_parties WHERE archived = 0 AND (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR tg_user_id LIKE ? ESCAPE '\\') ORDER BY name LIMIT ${limit}`, [like, like, like])
  let sql = "SELECT t.id, t.ref, t.type, t.txn_date, t.total, t.status, t.memo, p.name party_name FROM fin_txn t LEFT JOIN fin_parties p ON p.id = t.party_id WHERE (t.ref LIKE ? ESCAPE '\\' OR t.memo LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'"
  const params = [like, like, like]
  if (/^\d+$/.test(digits)) { sql += ' OR t.total = ?'; params.push(parseInt(digits)) }
  const transactions = await qAll(sql + `) ORDER BY t.txn_date DESC, t.id DESC LIMIT ${limit}`, params)
  const accounts = await qAll(`SELECT id, code, name, type, money_kind FROM fin_accounts WHERE archived = 0 AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\') ORDER BY code LIMIT ${limit}`, [like, like])
  const entries = await qAll(`SELECT id, entry_no, entry_date, memo, source_type FROM fin_journal WHERE entry_no LIKE ? ESCAPE '\\' OR memo LIKE ? ESCAPE '\\' ORDER BY entry_date DESC LIMIT ${limit}`, [like, like])
  return { parties, transactions, accounts, entries }
}

// ------------------------------------------------------------------ integrity check
export async function finIntegrity() {
  const bad = []
  for (const x of await qAll('SELECT j.id, j.entry_no, SUM(l.debit) d, SUM(l.credit) c FROM fin_journal j JOIN fin_journal_lines l ON l.entry_id = j.id GROUP BY j.id, j.entry_no HAVING d != c', [])) bad.push(`سند ${x.entry_no} تراز نیست (${x.d} ≠ ${x.c})`)
  if (!(await finTrialBalance()).balanced) bad.push('تراز آزمایشی متعادل نیست')
  if (!(await finBalanceSheet()).balanced) bad.push('ترازنامه متعادل نیست (دارایی‌ها ≠ بدهی‌ها + حقوق صاحبان سرمایه)')
  for (const d of await qAll("SELECT t.id, t.ref, t.paid, COALESCE((SELECT SUM(a.amount) FROM fin_alloc a JOIN fin_txn p ON p.id = a.payment_txn_id WHERE a.doc_txn_id = t.id AND p.status = 'posted'),0) s FROM fin_txn t WHERE t.type IN ('sale','purchase') AND t.status = 'posted' AND t.party_id IS NOT NULL", [])) {
    if (Number(d.paid) !== Number(d.s)) bad.push(`مبلغ پرداخت‌شده‌ی ${d.ref} با تخصیص‌ها نمی‌خواند`)
  }
  for (const [type, key] of [['sale', 'ar'], ['purchase', 'ap']]) {
    const acct = await E.finAccount(key)
    const open = Number(await qVal(`SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE type = '${type}' AND status = 'posted'`, []))
    const led = await E.finAccountBalance(acct.id)
    if (open !== led) bad.push('مانده‌ی ' + (type === 'sale' ? 'دریافتنی‌ها' : 'پرداختنی‌ها') + ` در اسناد (${open}) با دفتر کل (${led}) نمی‌خواند`)
  }
  return bad
}
