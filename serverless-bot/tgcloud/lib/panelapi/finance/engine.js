// finance/engine.php: double-entry ledger + the business transactions that feed it.
//   business layer  (sales, purchases, expenses, payments, transfers, capital …) → fin_txn (+ fin_alloc, fin_parties)
//   ledger layer    (balanced journal entries)                                    → fin_journal / fin_journal_lines / fin_accounts
// Amounts are integers (toman). Posted records are never deleted: they are reversed by a mirrored entry.
// Telegram Serverless has no multi-statement transaction: every check runs before the first write, so a failed request leaves nothing half done.
import { qAll, qOne, qRun, qVal } from '../qb.js'
import { PanelError, latinDigits, now, str } from '../util.js'
import { accParseDateTime } from '../stats.js'
import { numberFormat } from '../../php.js'

export class FinError extends PanelError { constructor(message, http = 422) { super(message, http) } }
export const fail = (m, http = 422) => { throw new FinError(m, http) }

export const finAtomic = async (fn) => fn()
const r2 = (x) => Math.round(x)

export async function finAudit(user, action, entity, id, detail = null) {
  await qRun('INSERT INTO fin_audit (at, user, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)', [now(), user, action, entity, String(id), detail === null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail)])
}
export async function finSetting(key, def = null) {
  const v = await qVal('SELECT v FROM fin_settings WHERE k = ?', [key])
  return v === null ? def : v
}
export async function finSetSetting(key, value) {
  await qRun('INSERT INTO fin_settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [key, String(value)])
}

/** unix | '' (now) | 1405/07/14 [15:30] | 2026-10-06 → unix */
export function finParseDate(v) {
  if (v === null || v === undefined || v === '') return now()
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{9,}$/.test(v))) return Number(v)
  const t = accParseDateTime(String(v))
  if (t === null) fail('تاریخ نامعتبر است (مثلاً 1405/07/14 یا 1405/07/14 15:30)')
  return t
}
export function finAmount(v, label = 'مبلغ', allowZero = false) {
  const s = latinDigits(str(v).trim()).replace(/[,٬ ]/g, '')
  if (s === '' || !/^\d{1,15}$/.test(s)) fail(`«${label}» باید یک عدد صحیح و مثبت باشد`)
  const n = parseInt(s, 10)
  if (n === 0 && !allowZero) fail(`«${label}» باید بیشتر از صفر باشد`)
  return n
}

// ------------------------------------------------------------------ accounts
let cache = null, cacheAt = 0
export const finAccountsReset = () => { cache = null }
export async function accountsCache() {
  if (!cache || Date.now() - cacheAt > 5000) {
    cache = { id: new Map(), key: new Map(), code: new Map() }
    for (const a of await qAll('SELECT * FROM fin_accounts', [])) {
      cache.id.set(Number(a.id), a); cache.code.set(String(a.code), a)
      if (a.system_key !== null && a.system_key !== '') cache.key.set(String(a.system_key), a)
    }
    cacheAt = Date.now()
  }
  return cache
}
/** account row by numeric id, system_key or code; null if unknown */
export async function finAccount(ref) {
  const c = await accountsCache()
  if (typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref) && !c.code.has(ref))) return c.id.get(Number(ref)) ?? null
  return c.key.get(ref) ?? c.code.get(ref) ?? null
}
export async function finAccountOrFail(ref, types = null, forPosting = true) {
  const a = await finAccount(ref)
  if (!a) fail('حساب مالی پیدا نشد')
  if (forPosting && Number(a.archived) === 1) fail(`حساب «${a.name}» بایگانی شده و قابل استفاده نیست`)
  if (forPosting && Number(a.is_postable) !== 1) fail(`روی حساب «${a.name}» نمی‌شود سند ثبت کرد (حساب گروه است)`)
  if (types !== null && !types.includes(a.type)) fail(`حساب «${a.name}» برای این کار مناسب نیست`)
  return a
}
export const finIsMoney = (a) => a.money_kind !== null && a.money_kind !== undefined && a.money_kind !== ''
/** natural side: asset/expense grow with debit; liability/equity/revenue with credit */
export const finNaturalDebit = (a) => ['asset', 'expense'].includes(a.type)

// ------------------------------------------------------------------ journal
/** post a balanced journal entry. e: date, memo, lines[{account, debit|credit, party_id?, memo?}], source_type, source_id, source_key?, source_hash?, txn_id?, user?, reason?, status? */
export async function finPostEntry(e) {
  const lines = e.lines || []
  if (lines.length < 2) fail('هر سند حسابداری حداقل دو ردیف دارد')
  const key = e.source_key ?? null
  if (key !== null) { const id = await qVal('SELECT id FROM fin_journal WHERE source_key = ?', [key]); if (id !== null) return Number(id) }
  const norm = []
  let dr = 0, cr = 0
  for (const l of lines) {
    const acc = await finAccountOrFail(l.account ?? l.account_id ?? null)
    const d = parseInt(l.debit ?? 0) || 0, c = parseInt(l.credit ?? 0) || 0
    if (d < 0 || c < 0 || (d > 0) === (c > 0)) fail('هر ردیف سند باید فقط بدهکار یا فقط بستانکار باشد')
    dr += d; cr += c
    norm.push([Number(acc.id), d, c, l.party_id ? Number(l.party_id) : null, l.memo !== undefined && l.memo !== null ? [...String(l.memo)].slice(0, 300).join('') : null])
  }
  if (dr !== cr || dr <= 0) fail('جمع بدهکار و بستانکار سند برابر نیست')
  const status = ['posted', 'draft'].includes(e.status ?? 'posted') ? e.status ?? 'posted' : 'posted'
  const r = await qRun('INSERT INTO fin_journal (entry_date, memo, source_type, source_id, source_key, source_hash, txn_id, status, reason, created_by, created_at, currency, rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [parseInt(e.date ?? now()), e.memo !== undefined && e.memo !== null ? [...String(e.memo)].slice(0, 500).join('') : null, e.source_type ?? 'manual', e.source_id !== undefined && e.source_id !== null ? String(e.source_id) : null, key, e.source_hash ?? null, e.txn_id ?? null, status, e.reason ?? null, e.user ?? null, now(), e.currency ?? 'IRT', e.rate ?? 1])
  const id = Number(r.lastInsertRowid)
  await qRun('UPDATE fin_journal SET entry_no = ? WHERE id = ?', ['JE-' + String(id).padStart(6, '0'), id])
  for (const [acc, d, c, party, memo] of norm) await qRun('INSERT INTO fin_journal_lines (entry_id, account_id, debit, credit, party_id, memo) VALUES (?,?,?,?,?,?)', [id, acc, d, c, party, memo])
  return id
}

/** like finPostEntry without the archived/postable check (only for reversals of history) */
async function finPostEntryRaw(e) {
  let dr = 0, cr = 0
  for (const l of e.lines) { dr += parseInt(l.debit) || 0; cr += parseInt(l.credit) || 0 }
  if (dr !== cr || dr <= 0) fail('جمع بدهکار و بستانکار سند برابر نیست')
  const r = await qRun("INSERT INTO fin_journal (entry_date, memo, source_type, source_id, txn_id, status, reason, created_by, created_at) VALUES (?,?,?,?,?,'posted',?,?,?)",
    [parseInt(e.date), [...String(e.memo)].slice(0, 500).join(''), e.source_type, e.source_id ?? null, e.txn_id ?? null, e.reason ?? null, e.user ?? null, now()])
  const id = Number(r.lastInsertRowid)
  await qRun('UPDATE fin_journal SET entry_no = ? WHERE id = ?', ['JE-' + String(id).padStart(6, '0'), id])
  for (const l of e.lines) await qRun('INSERT INTO fin_journal_lines (entry_id, account_id, debit, credit, party_id, memo) VALUES (?,?,?,?,?,?)', [id, parseInt(l.account), parseInt(l.debit), parseInt(l.credit), l.party_id ?? null, l.memo ?? null])
  return id
}

/** mirror an entry (swapped sides), mark the original reversed; returns the reversal's id */
export async function finReverseEntry(entryId, reason, user = null, date = null) {
  const je = await qOne('SELECT * FROM fin_journal WHERE id = ?', [entryId])
  if (!je) fail('سند پیدا نشد', 404)
  if (je.status !== 'posted') fail('این سند قبلاً برگشت خورده یا ثبت نهایی نیست')
  const lines = (await qAll('SELECT * FROM fin_journal_lines WHERE entry_id = ?', [entryId])).map((l) => ({ account: Number(l.account_id), debit: Number(l.credit), credit: Number(l.debit), party_id: l.party_id, memo: l.memo }))
  const rev = await finPostEntryRaw({ date: date ?? Number(je.entry_date), memo: 'برگشت سند ' + je.entry_no + (reason !== '' ? ' — ' + reason : ''), lines, source_type: 'reversal', source_id: String(entryId), txn_id: je.txn_id, user, reason })
  await qRun('UPDATE fin_journal SET reversal_of = ? WHERE id = ?', [entryId, rev])
  await qRun("UPDATE fin_journal SET status = 'reversed', reversed_by = ? WHERE id = ?", [rev, entryId])
  await finAudit(user, 'reverse', 'journal', entryId, { reversal: rev, reason })
  return rev
}

/** balance of one account at a point in time (natural side); posted + reversed entries both count, so a reversal nets to zero */
export async function finAccountBalance(account, asOf = null) {
  const a = await finAccountOrFail(account, null, false)
  const r = await qOne(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM fin_journal_lines l JOIN fin_journal j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status IN ('posted','reversed')` + (asOf !== null ? ' AND j.entry_date <= ?' : ''), asOf !== null ? [Number(a.id), asOf] : [Number(a.id)])
  return finNaturalDebit(a) ? Number(r.d) - Number(r.c) : Number(r.c) - Number(r.d)
}
export async function finEnsureFunds(account, amount, asOf = null) {
  const a = await finAccountOrFail(account, null, false)
  if (Number(a.allow_negative) === 1) return
  const bal = await finAccountBalance(a.id, asOf)
  if (bal < amount) fail('موجودی «' + a.name + '» کافی نیست (موجودی: ' + numberFormat(bal) + ' تومان)')
}

// ------------------------------------------------------------------ parties
export async function finParty(id, mustBeActive = true) {
  const p = await qOne('SELECT * FROM fin_parties WHERE id = ?', [parseInt(id) || 0])
  if (!p) fail('طرف حساب پیدا نشد', 404)
  if (mustBeActive && Number(p.archived) === 1) fail('طرف حساب بایگانی شده است')
  return p
}
export const finPartyRoles = () => ({ customer: 'مشتری', supplier: 'تأمین‌کننده', employee: 'کارمند', partner: 'شریک', shareholder: 'سهامدار', investor: 'سرمایه‌گذار', lender: 'وام‌دهنده', borrower: 'وام‌گیرنده', other: 'سایر' })

export async function finSaveParty(d, user = null) {
  const name = str(d.name).trim()
  if (name === '' || [...name].length > 200) fail('نام طرف حساب لازم است')
  const list = (Array.isArray(d.roles) ? d.roles : d.roles ? [d.roles] : ['customer']).map((x) => String(x).trim()).filter((x) => x in finPartyRoles())
  const roles = list.length ? list : ['customer']
  const tg = d.tg_user_id !== undefined && d.tg_user_id !== null && str(d.tg_user_id).trim() !== '' ? str(d.tg_user_id).trim() : null
  if (d.id) {
    await finParty(d.id, false)
    await qRun('UPDATE fin_parties SET name=?, roles=?, phone=?, email=?, tg_user_id=?, note=?, archived=? WHERE id=?', [name, roles.join(','), d.phone ?? null, d.email ?? null, tg, d.note ?? null, d.archived ? 1 : 0, parseInt(d.id)])
    await finAudit(user, 'update', 'party', d.id)
    return parseInt(d.id)
  }
  const r = await qRun('INSERT INTO fin_parties (name, roles, phone, email, tg_user_id, note, created_at) VALUES (?,?,?,?,?,?,?)', [name, roles.join(','), d.phone ?? null, d.email ?? null, tg, d.note ?? null, now()])
  const id = Number(r.lastInsertRowid)
  await finAudit(user, 'create', 'party', id, { name })
  return id
}

/** the party that represents a Telegram customer (created on first use from the `user` table) */
export async function finPartyForTelegramUser(tgId) {
  let id = await qVal('SELECT id FROM fin_parties WHERE tg_user_id = ?', [tgId])
  if (id !== null) return Number(id)
  const row = (await qOne('SELECT username, namecustom FROM user WHERE id = ?', [tgId])) || {}
  let name = str(row.namecustom).trim()
  if (name === '' || name === 'none') name = str(row.username).trim()
  if (name === '' || name === 'none') name = 'کاربر ' + tgId
  await qRun("INSERT OR IGNORE INTO fin_parties (name, roles, tg_user_id, created_at) VALUES (?, 'customer', ?, ?)", [name, tgId, now()])
  return Number(await qVal('SELECT id FROM fin_parties WHERE tg_user_id = ?', [tgId]))
}

// ------------------------------------------------------------------ business transactions (fin_txn)
const TXN_COLS = ['type', 'txn_date', 'party_id', 'money_account_id', 'to_account_id', 'category_account_id', 'subtotal', 'discount', 'tax', 'total', 'paid', 'returned', 'due_date', 'payment_method', 'status', 'parent_txn_id', 'loan_id', 'asset_id', 'memo', 'meta', 'reason', 'created_by']
const PREFIX = { sale: 'SALE', purchase: 'BILL', expense: 'EXP', income: 'INC', receipt: 'RCPT', payment: 'PAY', transfer: 'TRF', capital_in: 'CAP', capital_out: 'DRAW', distribution: 'DIST', loan_in: 'LOAN', loan_out: 'LEND', loan_payment: 'LPAY', refund_sale: 'RET', refund_purchase: 'PRET', asset_purchase: 'ASSET', depreciation: 'DEP', adjustment: 'ADJ' }
export async function finTxnInsert(t) {
  const vals = {}
  for (const c of TXN_COLS) vals[c] = t[c] ?? (['subtotal', 'discount', 'tax', 'total', 'paid', 'returned'].includes(c) ? 0 : null)
  vals.status = vals.status ?? 'posted'
  vals.created_at = now()
  const names = Object.keys(vals)
  const r = await qRun(`INSERT INTO fin_txn (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, Object.values(vals))
  const id = Number(r.lastInsertRowid)
  await qRun('UPDATE fin_txn SET ref = ? WHERE id = ?', [(PREFIX[t.type] ?? 'TXN') + '-' + id, id])
  return id
}
export async function finTxn(id) {
  const t = await qOne('SELECT * FROM fin_txn WHERE id = ?', [parseInt(id) || 0])
  if (!t) fail('تراکنش پیدا نشد', 404)
  return t
}
export async function finLinkJournal(txnId, journalId) {
  await qRun('UPDATE fin_txn SET journal_id = ? WHERE id = ?', [journalId, txnId])
  await qRun('UPDATE fin_journal SET txn_id = ? WHERE id = ?', [txnId, journalId])
}
export const finOutstanding = (doc) => Math.max(0, (parseInt(doc.total) || 0) - (parseInt(doc.paid) || 0) - ((parseInt(doc.returned) || 0) - (parseInt(doc.refunded) || 0)))
export async function finRecalcPaid(docId) {
  const s = Number(await qVal("SELECT COALESCE(SUM(a.amount),0) FROM fin_alloc a JOIN fin_txn p ON p.id = a.payment_txn_id WHERE a.doc_txn_id = ? AND p.status = 'posted'", [docId]))
  await qRun('UPDATE fin_txn SET paid = ? WHERE id = ?', [s, docId])
}
/** payment state of a sale/bill: paid | partial | unpaid | overdue | refunded | cancelled */
export function finDocState(doc, at = null) {
  at = at ?? now()
  if (['cancelled', 'reversed'].includes(doc.status)) return 'cancelled'
  const out = finOutstanding(doc)
  if (parseInt(doc.total) > 0 && parseInt(doc.returned) >= parseInt(doc.total)) return 'refunded'
  if (out === 0) return 'paid'
  if (doc.due_date && parseInt(doc.due_date) < at) return 'overdue'
  return parseInt(doc.paid) > 0 ? 'partial' : 'unpaid'
}
/** items: [{name, qty, price}] → [lines, subtotal]; at least a total is required */
export function finItems(items, fallbackAmount = null) {
  const out = []
  let sub = 0
  for (const it of Array.isArray(items) ? items : []) {
    const name = str(it.name).trim()
    const qty = parseFloat(it.qty ?? 1)
    const price = finAmount(it.price ?? 0, 'قیمت واحد', true)
    if (name === '' && price === 0) continue
    if (!(qty > 0)) fail('تعداد باید بیشتر از صفر باشد')
    const line = r2(qty * price)
    out.push({ name: [...name].slice(0, 200).join(''), qty, price, total: line })
    sub += line
  }
  if (!out.length && fallbackAmount !== null) return [[], fallbackAmount]
  if (!out.length) fail('حداقل یک ردیف کالا/خدمت یا مبلغ لازم است')
  return [out, sub]
}
/** discount/tax math shared by sales and bills; tax is a percentage of (subtotal − discount) or a fixed amount */
export function finTotals(subtotal, discount, taxRate, taxAmount = null) {
  discount = discount === null || discount === undefined || discount === '' ? 0 : finAmount(discount, 'تخفیف', true)
  if (discount > subtotal) fail('تخفیف از مبلغ کل بیشتر است')
  const base = subtotal - discount
  let tax
  if (taxAmount !== null && taxAmount !== undefined && taxAmount !== '') tax = finAmount(taxAmount, 'مالیات', true)
  else {
    const rate = taxRate === null || taxRate === undefined || taxRate === '' ? 0 : parseFloat(taxRate) || 0
    if (rate < 0 || rate > 100) fail('نرخ مالیات نامعتبر است')
    tax = r2((base * rate) / 100)
  }
  return [discount, tax, base + tax]
}
export async function finMoneyAccount(id) {
  const a = await finAccountOrFail(id)
  if (!finIsMoney(a)) fail('«' + a.name + '» حساب صندوق/بانک نیست')
  return a
}

/** allocate a payment to documents; allocs = {docId: amount}; empty + auto = settle the oldest open documents first */
export async function finAllocate(paymentTxnId, docType, partyId, amount, allocs, auto) {
  const result = new Map()
  let sum = 0
  const entries = Object.entries(allocs || {})
  if (entries.length) {
    for (const [docId, amt0] of entries) {
      const amt = finAmount(amt0, 'مبلغ تخصیص')
      const doc = await finTxn(parseInt(docId))
      if (doc.type !== docType || Number(doc.party_id) !== partyId || doc.status !== 'posted') fail('سند انتخاب‌شده برای این طرف حساب معتبر نیست')
      if (amt > finOutstanding(doc)) fail('مبلغ از مانده‌ی ' + doc.ref + ' بیشتر است (مانده: ' + numberFormat(finOutstanding(doc)) + ' تومان)')
      result.set(parseInt(docId), amt); sum += amt
    }
  } else if (auto) {
    let left = amount
    for (const doc of await qAll("SELECT * FROM fin_txn WHERE type = ? AND party_id = ? AND status = 'posted' AND total - paid - (returned - refunded) > 0 ORDER BY COALESCE(due_date, txn_date), id", [docType, partyId])) {
      if (left <= 0) break
      const take = Math.min(left, finOutstanding(doc))
      result.set(Number(doc.id), take); left -= take; sum += take
    }
  }
  if (sum !== amount) {
    const open = Number(await qVal("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE type = ? AND party_id = ? AND status = 'posted'", [docType, partyId]))
    fail(sum > amount ? 'جمع تخصیص‌ها از مبلغ پرداخت بیشتر است' : 'مبلغ از مانده‌ی بدهی/طلب بیشتر است (مانده‌ی کل: ' + numberFormat(open) + ' تومان)')
  }
  for (const [docId, amt] of result) { await qRun('INSERT INTO fin_alloc (payment_txn_id, doc_txn_id, amount, created_at) VALUES (?,?,?,?)', [paymentTxnId, docId, amt, now()]); await finRecalcPaid(docId) }
  return Object.fromEntries(result)
}

// ------------------------------------------------------------------ services
export async function finCreateSale(d, user = null) {
  const date = finParseDate(d.date ?? '')
  const [items, sub] = finItems(d.items ?? [], d.amount !== undefined && d.amount !== '' && d.amount !== null ? finAmount(d.amount) : null)
  const [discount, tax, total] = finTotals(sub, d.discount ?? 0, d.tax_rate ?? 0, d.tax ?? null)
  if (total <= 0) fail('مبلغ فروش باید بیشتر از صفر باشد')
  const paidNow = d.paid_now !== undefined && d.paid_now !== '' && d.paid_now !== null ? finAmount(d.paid_now, 'مبلغ دریافتی', true) : 0
  if (paidNow > total) fail('مبلغ دریافتی از مبلغ فروش بیشتر است')
  const partyId = d.party_id ? Number((await finParty(d.party_id)).id) : null
  if (partyId === null && paidNow < total) fail('برای فروش نسیه یا قسطی، مشتری را انتخاب کنید')
  const due = d.due_date ? finParseDate(d.due_date) : null
  const rev = await finAccountOrFail(d.revenue_account ?? 'revenue_sales', ['revenue'])
  const direct = partyId === null
  const directAcc = direct ? await finMoneyAccount(d.money_account ?? 'cash') : null
  const txnId = await finTxnInsert({ type: 'sale', txn_date: date, party_id: partyId, category_account_id: rev.id, subtotal: sub, discount, tax, total, due_date: due, payment_method: d.payment_method ?? null, memo: d.memo ?? null,
    meta: JSON.stringify({ items, channel: d.channel ?? null }), created_by: user })
  if (direct) await qRun('UPDATE fin_txn SET paid = ?, money_account_id = ? WHERE id = ?', [total, directAcc.id, txnId])
  const lines = [direct ? { account: directAcc.id, debit: total, memo: 'فروش نقدی' } : { account: 'ar', debit: total, party_id: partyId, memo: 'فروش' }, { account: rev.id, credit: sub - discount, memo: 'فروش' }]
  if (tax > 0) lines.push({ account: 'tax_payable', credit: tax, memo: 'مالیات فروش' })
  const je = await finPostEntry({ date, memo: 'فروش ' + (d.memo ?? ''), lines, source_type: 'sale', source_id: txnId, txn_id: txnId, user })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'sale', txnId, { total })
  let receipt = null
  if (paidNow > 0 && !direct) receipt = await finReceivePayment({ date, party_id: partyId, amount: paidNow, money_account: d.money_account ?? 'cash', payment_method: d.payment_method ?? null, allocations: { [txnId]: paidNow }, memo: 'دریافت همزمان با فروش' }, user)
  return { id: txnId, ref: 'SALE-' + txnId, total, receipt_id: receipt ? receipt.id : null }
}

export async function finReceivePayment(d, user = null) {
  const amount = finAmount(d.amount ?? 0)
  const party = await finParty(d.party_id ?? 0)
  const acc = await finMoneyAccount(d.money_account ?? 'cash')
  const date = finParseDate(d.date ?? '')
  // the allocation is checked before anything is written
  const allocPlan = await planAllocation('sale', Number(party.id), amount, d.allocations ?? {}, true)
  const txnId = await finTxnInsert({ type: 'receipt', txn_date: date, party_id: party.id, money_account_id: acc.id, total: amount, paid: amount, payment_method: d.payment_method ?? null, memo: d.memo ?? null, created_by: user })
  const allocs = await finAllocate(txnId, 'sale', Number(party.id), amount, allocPlan, false)
  const je = await finPostEntry({ date, memo: 'دریافت از ' + party.name, source_type: 'receipt', source_id: txnId, txn_id: txnId, user, lines: [{ account: acc.id, debit: amount, party_id: party.id }, { account: 'ar', credit: amount, party_id: party.id }] })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'receipt', txnId, { amount, allocations: allocs })
  return { id: txnId, ref: 'RCPT-' + txnId, allocations: allocs }
}

/** the same checks as finAllocate, without writing: returns {docId: amount} to apply */
export async function planAllocation(docType, partyId, amount, allocs, auto) {
  const result = {}
  let sum = 0
  const entries = Object.entries(allocs || {})
  if (entries.length) {
    for (const [docId, amt0] of entries) {
      const amt = finAmount(amt0, 'مبلغ تخصیص')
      const doc = await finTxn(parseInt(docId))
      if (doc.type !== docType || Number(doc.party_id) !== partyId || doc.status !== 'posted') fail('سند انتخاب‌شده برای این طرف حساب معتبر نیست')
      if (amt > finOutstanding(doc)) fail('مبلغ از مانده‌ی ' + doc.ref + ' بیشتر است (مانده: ' + numberFormat(finOutstanding(doc)) + ' تومان)')
      result[parseInt(docId)] = amt; sum += amt
    }
  } else if (auto) {
    let left = amount
    for (const doc of await qAll("SELECT * FROM fin_txn WHERE type = ? AND party_id = ? AND status = 'posted' AND total - paid - (returned - refunded) > 0 ORDER BY COALESCE(due_date, txn_date), id", [docType, partyId])) {
      if (left <= 0) break
      const take = Math.min(left, finOutstanding(doc))
      result[Number(doc.id)] = take; left -= take; sum += take
    }
  }
  if (sum !== amount) {
    const open = Number(await qVal("SELECT COALESCE(SUM(total - paid - (returned - refunded)),0) FROM fin_txn WHERE type = ? AND party_id = ? AND status = 'posted'", [docType, partyId]))
    fail(sum > amount ? 'جمع تخصیص‌ها از مبلغ پرداخت بیشتر است' : 'مبلغ از مانده‌ی بدهی/طلب بیشتر است (مانده‌ی کل: ' + numberFormat(open) + ' تومان)')
  }
  return result
}

export async function finCreatePurchase(d, user = null) {
  const date = finParseDate(d.date ?? '')
  const [items, sub] = finItems(d.items ?? [], d.amount !== undefined && d.amount !== '' && d.amount !== null ? finAmount(d.amount) : null)
  const [discount, tax, total] = finTotals(sub, d.discount ?? 0, d.tax_rate ?? 0, d.tax ?? null)
  const paidNow = d.paid_now !== undefined && d.paid_now !== '' && d.paid_now !== null ? finAmount(d.paid_now, 'مبلغ پرداختی', true) : 0
  if (paidNow > total) fail('مبلغ پرداختی از مبلغ خرید بیشتر است')
  const partyId = d.party_id ? Number((await finParty(d.party_id)).id) : null
  if (partyId === null && paidNow < total) fail('برای خرید نسیه، تأمین‌کننده را انتخاب کنید')
  const cat = await finAccountOrFail(d.category_account ?? 'cogs', ['expense', 'asset'])
  if (finIsMoney(cat) || ['ar', 'ap'].includes(cat.system_key)) fail('دسته‌ی خرید نامعتبر است')
  const due = d.due_date ? finParseDate(d.due_date) : null
  const txnId = await finTxnInsert({ type: 'purchase', txn_date: date, party_id: partyId, category_account_id: cat.id, subtotal: sub, discount, tax, total, due_date: due, payment_method: d.payment_method ?? null, memo: d.memo ?? null, meta: JSON.stringify({ items }), created_by: user })
  const lines = [{ account: cat.id, debit: sub - discount, memo: 'خرید' }, { account: 'ap', credit: total, party_id: partyId, memo: 'خرید' }]
  if (tax > 0) lines.push({ account: 'tax_receivable', debit: tax, memo: 'مالیات خرید' })
  const je = await finPostEntry({ date, memo: 'خرید ' + (d.memo ?? ''), lines, source_type: 'purchase', source_id: txnId, txn_id: txnId, user })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'purchase', txnId, { total })
  let pay = null
  if (paidNow > 0) pay = await finMakePayment({ date, party_id: partyId, amount: paidNow, money_account: d.money_account ?? 'cash', payment_method: d.payment_method ?? null, allocations: { [txnId]: paidNow }, memo: 'پرداخت همزمان با خرید' }, user)
  return { id: txnId, ref: 'BILL-' + txnId, total, payment_id: pay ? pay.id : null }
}

export async function finMakePayment(d, user = null) {
  const amount = finAmount(d.amount ?? 0)
  const party = await finParty(d.party_id ?? 0)
  const acc = await finMoneyAccount(d.money_account ?? 'cash')
  const date = finParseDate(d.date ?? '')
  await finEnsureFunds(acc.id, amount, date)
  const plan = await planAllocation('purchase', Number(party.id), amount, d.allocations ?? {}, true)
  const txnId = await finTxnInsert({ type: 'payment', txn_date: date, party_id: party.id, money_account_id: acc.id, total: amount, paid: amount, payment_method: d.payment_method ?? null, memo: d.memo ?? null, created_by: user })
  const allocs = await finAllocate(txnId, 'purchase', Number(party.id), amount, plan, false)
  const je = await finPostEntry({ date, memo: 'پرداخت به ' + party.name, source_type: 'payment', source_id: txnId, txn_id: txnId, user, lines: [{ account: 'ap', debit: amount, party_id: party.id }, { account: acc.id, credit: amount, party_id: party.id }] })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'payment', txnId, { amount, allocations: allocs })
  return { id: txnId, ref: 'PAY-' + txnId, allocations: allocs }
}

export async function finCreateExpense(d, user = null) {
  const date = finParseDate(d.date ?? '')
  const net = finAmount(d.amount ?? 0)
  const [, tax, total] = finTotals(net, 0, d.tax_rate ?? 0, d.tax ?? null)
  const cat = await finAccountOrFail(d.category_account ?? 'exp_general', ['expense'])
  const onCredit = !!d.on_credit
  const partyId = d.party_id ? Number((await finParty(d.party_id)).id) : null
  const memo = d.memo ?? null
  let txnId, lines, ref
  if (onCredit) {
    if (partyId === null) fail('برای هزینه‌ی نسیه، تأمین‌کننده را انتخاب کنید')
    txnId = await finTxnInsert({ type: 'purchase', txn_date: date, party_id: partyId, category_account_id: cat.id, subtotal: net, tax, total, due_date: d.due_date ? finParseDate(d.due_date) : null, memo, meta: JSON.stringify({ expense: true }), created_by: user })
    lines = [{ account: cat.id, debit: net }, { account: 'ap', credit: total, party_id: partyId }]
    ref = 'BILL-' + txnId
  } else {
    const acc = await finMoneyAccount(d.money_account ?? 'cash')
    await finEnsureFunds(acc.id, total, date)
    txnId = await finTxnInsert({ type: 'expense', txn_date: date, party_id: partyId, money_account_id: acc.id, category_account_id: cat.id, subtotal: net, tax, total, paid: total, payment_method: d.payment_method ?? null, memo, created_by: user })
    lines = [{ account: cat.id, debit: net, party_id: partyId }, { account: acc.id, credit: total, party_id: partyId }]
    ref = 'EXP-' + txnId
  }
  if (tax > 0) lines.push({ account: 'tax_receivable', debit: tax })
  const je = await finPostEntry({ date, memo: cat.name + (memo ? ' — ' + memo : ''), lines, source_type: onCredit ? 'purchase' : 'expense', source_id: txnId, txn_id: txnId, user })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'expense', txnId, { total, category: cat.name })
  return { id: txnId, ref, total }
}

export async function finCreateIncome(d, user = null) {
  const date = finParseDate(d.date ?? '')
  const amount = finAmount(d.amount ?? 0)
  const inc = await finAccountOrFail(d.income_account ?? 'revenue_other', ['revenue'])
  const acc = await finMoneyAccount(d.money_account ?? 'cash')
  const partyId = d.party_id ? Number((await finParty(d.party_id)).id) : null
  const txnId = await finTxnInsert({ type: 'income', txn_date: date, party_id: partyId, money_account_id: acc.id, category_account_id: inc.id, subtotal: amount, total: amount, paid: amount, payment_method: d.payment_method ?? null, memo: d.memo ?? null, created_by: user })
  const je = await finPostEntry({ date, memo: inc.name + (d.memo ? ' — ' + d.memo : ''), source_type: 'income', source_id: txnId, txn_id: txnId, user, lines: [{ account: acc.id, debit: amount, party_id: partyId }, { account: inc.id, credit: amount, party_id: partyId }] })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'income', txnId, { amount })
  return { id: txnId, ref: 'INC-' + txnId, total: amount }
}

export async function finTransfer(d, user = null) {
  const date = finParseDate(d.date ?? '')
  const amount = finAmount(d.amount ?? 0)
  const from = await finMoneyAccount(d.from_account ?? 0)
  const to = await finMoneyAccount(d.to_account ?? 0)
  if (Number(from.id) === Number(to.id)) fail('حساب مبدأ و مقصد نباید یکی باشد')
  await finEnsureFunds(from.id, amount, date)
  const txnId = await finTxnInsert({ type: 'transfer', txn_date: date, money_account_id: from.id, to_account_id: to.id, total: amount, paid: amount, memo: str(d.reference) !== '' ? (d.reference + ' ' + str(d.memo)).trim() : d.memo ?? null, created_by: user })
  const je = await finPostEntry({ date, memo: 'انتقال ' + from.name + ' ← ' + to.name, source_type: 'transfer', source_id: txnId, txn_id: txnId, user, lines: [{ account: to.id, debit: amount }, { account: from.id, credit: amount }] })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'transfer', txnId, { from: from.name, to: to.name, amount })
  return { id: txnId, ref: 'TRF-' + txnId, total: amount }
}

export async function finCapital(d, direction, user = null) {
  const date = finParseDate(d.date ?? '')
  const amount = finAmount(d.amount ?? 0)
  const acc = await finMoneyAccount(d.money_account ?? 'cash')
  const partyId = d.party_id ? Number((await finParty(d.party_id)).id) : null
  const inn = direction === 'in'
  if (!inn) await finEnsureFunds(acc.id, amount, date)
  const txnId = await finTxnInsert({ type: inn ? 'capital_in' : 'capital_out', txn_date: date, party_id: partyId, money_account_id: acc.id, total: amount, paid: amount, memo: d.memo ?? null, created_by: user })
  const lines = inn ? [{ account: acc.id, debit: amount, party_id: partyId }, { account: 'capital', credit: amount, party_id: partyId }] : [{ account: 'drawings', debit: amount, party_id: partyId }, { account: acc.id, credit: amount, party_id: partyId }]
  const je = await finPostEntry({ date, memo: inn ? 'ورود سرمایه' : 'برداشت از سرمایه', lines, source_type: inn ? 'capital_in' : 'capital_out', source_id: txnId, txn_id: txnId, user })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', inn ? 'capital_in' : 'capital_out', txnId, { amount })
  return { id: txnId, ref: (inn ? 'CAP-' : 'DRAW-') + txnId, total: amount }
}

/** ownership percentages in force at asOf: {partyId: percent} */
export async function finOwnershipAt(asOf = null) {
  asOf = asOf ?? now()
  const rows = await qAll(`SELECT o.party_id, o.percent FROM fin_ownership o JOIN (SELECT party_id, MAX(effective_from) mf FROM fin_ownership WHERE effective_from <= ? GROUP BY party_id) m ON m.party_id = o.party_id AND m.mf = o.effective_from WHERE o.percent > 0 ORDER BY o.id`, [asOf])
  const out = {}
  for (const r of rows) out[Number(r.party_id)] = parseFloat(r.percent)
  return out
}

export async function finSetOwnership(shares, effectiveFrom, note, user = null) {
  let total = 0
  for (const [pid, pct0] of Object.entries(shares)) {
    await finParty(pid)
    const pct = parseFloat(pct0) || 0
    if (pct < 0 || pct > 100) fail('درصد مالکیت نامعتبر است')
    total += pct
  }
  if (Math.abs(total - 100) > 0.0001) fail('جمع درصد مالکیت باید ۱۰۰ باشد (الان ' + String(+total.toFixed(4)) + ')')
  const before = await finOwnershipAt(effectiveFrom - 1)
  for (const pid of Object.keys(before)) if (!(pid in shares)) shares[pid] = 0
  for (const [pid, pct] of Object.entries(shares)) await qRun('INSERT INTO fin_ownership (party_id, percent, effective_from, note, created_by, created_at) VALUES (?,?,?,?,?,?)', [parseInt(pid), parseFloat(pct), effectiveFrom, note, user, now()])
  await finAudit(user, 'ownership', 'partners', effectiveFrom, { shares })
}

export async function finDistribute(d, user = null) {
  const date = finParseDate(d.date ?? '')
  const amount = finAmount(d.amount ?? 0)
  const acc = await finMoneyAccount(d.money_account ?? 'cash')
  const own = await finOwnershipAt(date)
  const ids = Object.keys(own).map(Number)
  if (!ids.length) fail('ابتدا درصد مالکیت شرکا را ثبت کنید')
  await finEnsureFunds(acc.id, amount, date)
  const txnId = await finTxnInsert({ type: 'distribution', txn_date: date, money_account_id: acc.id, total: amount, paid: amount, memo: d.memo ?? null, meta: JSON.stringify({ ownership: own }), created_by: user })
  const lines = []
  let given = 0
  ids.forEach((pid, i) => {
    const part = i === ids.length - 1 ? amount - given : Math.floor((amount * own[pid]) / 100)
    given += part
    if (part > 0) lines.push({ account: 'dividends', debit: part, party_id: pid, memo: 'سهم ' + own[pid] + '٪' })
  })
  lines.push({ account: acc.id, credit: amount })
  const je = await finPostEntry({ date, memo: 'تقسیم سود', lines, source_type: 'distribution', source_id: txnId, txn_id: txnId, user })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'distribution', txnId, { amount, ownership: own })
  return { id: txnId, ref: 'DIST-' + txnId, total: amount }
}

export async function finRefundSale(d, user = null) {
  const sale = await finTxn(d.sale_id ?? 0)
  if (sale.type !== 'sale' || sale.status !== 'posted') fail('فاکتور فروش معتبر نیست')
  const date = finParseDate(d.date ?? '')
  const amount = finAmount(d.amount ?? sale.total)
  const refundable = (parseInt(sale.total) || 0) - (parseInt(sale.returned) || 0)
  if (amount > refundable) fail('مبلغ برگشتی از مبلغ قابل برگشت بیشتر است (حداکثر: ' + numberFormat(refundable) + ' تومان)')
  const tax = r2((amount * (parseInt(sale.tax) || 0)) / Math.max(1, parseInt(sale.total) || 0))
  const net = amount - tax
  const reduceAr = Math.min(amount, finOutstanding(sale))
  const cashBack = amount - reduceAr
  const lines = [{ account: 'sales_returns', debit: net, memo: 'برگشت از فروش' }]
  if (tax > 0) lines.push({ account: 'tax_payable', debit: tax })
  if (reduceAr > 0) lines.push({ account: 'ar', credit: reduceAr, party_id: sale.party_id })
  let acc = null
  if (cashBack > 0) {
    acc = await finMoneyAccount(d.money_account ?? 'cash')
    await finEnsureFunds(acc.id, cashBack, date)
    lines.push({ account: acc.id, credit: cashBack, party_id: sale.party_id })
  }
  const txnId = await finTxnInsert({ type: 'refund_sale', txn_date: date, party_id: sale.party_id, money_account_id: acc ? acc.id : null, total: amount, paid: cashBack, parent_txn_id: sale.id, memo: d.memo ?? null, reason: d.reason ?? null, created_by: user })
  const je = await finPostEntry({ date, memo: 'برگشت از فروش ' + sale.ref, lines, source_type: 'refund_sale', source_id: txnId, txn_id: txnId, user, reason: d.reason ?? null })
  await finLinkJournal(txnId, je)
  await qRun('UPDATE fin_txn SET returned = returned + ?, refunded = refunded + ? WHERE id = ?', [amount, cashBack, sale.id])
  await finAudit(user, 'create', 'refund_sale', txnId, { sale: sale.ref, amount, cash_back: cashBack })
  return { id: txnId, ref: 'RET-' + txnId, total: amount, cash_back: cashBack }
}

export async function finCancelTxn(id, reason, user = null) {
  if (str(reason).trim() === '') fail('دلیل ابطال را بنویسید')
  const t = await finTxn(id)
  if (t.status !== 'posted') fail('این تراکنش قبلاً ابطال شده است')
  if (['receipt', 'payment'].includes(t.type)) {
    if (Number(await qVal('SELECT COUNT(*) FROM fin_alloc a JOIN fin_txn d ON d.id = a.doc_txn_id WHERE a.payment_txn_id = ? AND d.returned > 0', [id])) > 0) fail('این پرداخت به فاکتوری مربوط است که برگشت خورده؛ ابتدا برگشتی را ابطال کنید')
  }
  if (['sale', 'purchase'].includes(t.type)) {
    if ((parseInt(t.paid) || 0) > 0 && t.party_id !== null) fail('این سند پرداخت دارد؛ ابتدا پرداخت‌ها را ابطال کنید')
    if ((parseInt(t.returned) || 0) > 0) fail('این سند برگشتی دارد؛ ابتدا برگشتی‌ها را ابطال کنید')
  }
  if (t.type === 'refund_sale') await qRun('UPDATE fin_txn SET returned = MAX(0, returned - ?), refunded = MAX(0, refunded - ?) WHERE id = ?', [parseInt(t.total) || 0, parseInt(t.paid) || 0, parseInt(t.parent_txn_id)])
  if (t.journal_id) await finReverseEntry(parseInt(t.journal_id), reason, user)
  await qRun("UPDATE fin_txn SET status = 'reversed', reason = ?, updated_by = ?, updated_at = ? WHERE id = ?", [reason, user, now(), id])
  if (['receipt', 'payment'].includes(t.type)) for (const r of await qAll('SELECT doc_txn_id FROM fin_alloc WHERE payment_txn_id = ?', [id])) await finRecalcPaid(Number(r.doc_txn_id))
  await finAudit(user, 'cancel', t.type, id, { reason })
}

// ------------------------------------------------------------------ loans & assets
export async function finCreateLoan(d, user = null) {
  const date = finParseDate(d.date ?? '')
  const amount = finAmount(d.principal ?? d.amount ?? 0, 'اصل وام')
  const dir = (d.direction ?? 'borrowed') === 'lent' ? 'lent' : 'borrowed'
  const party = await finParty(d.party_id ?? 0)
  const acc = await finMoneyAccount(d.money_account ?? 'cash')
  const rate = parseFloat(d.interest_rate ?? 0) || 0
  if (dir === 'lent') await finEnsureFunds(acc.id, amount, date)
  const r = await qRun('INSERT INTO fin_loans (party_id, direction, principal, interest_rate, start_date, installments, note, created_at) VALUES (?,?,?,?,?,?,?,?)', [party.id, dir, amount, rate, date, Math.max(1, parseInt(d.installments ?? 1) || 1), d.memo ?? null, now()])
  const loanId = Number(r.lastInsertRowid)
  const txnId = await finTxnInsert({ type: dir === 'borrowed' ? 'loan_in' : 'loan_out', txn_date: date, party_id: party.id, money_account_id: acc.id, total: amount, paid: amount, loan_id: loanId, memo: d.memo ?? null, created_by: user })
  const lines = dir === 'borrowed' ? [{ account: acc.id, debit: amount, party_id: party.id }, { account: 'loan_payable', credit: amount, party_id: party.id }] : [{ account: 'loan_receivable', debit: amount, party_id: party.id }, { account: acc.id, credit: amount, party_id: party.id }]
  const je = await finPostEntry({ date, memo: dir === 'borrowed' ? 'دریافت وام از ' + party.name : 'پرداخت وام به ' + party.name, lines, source_type: 'loan', source_id: txnId, txn_id: txnId, user })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'loan', loanId, { direction: dir, principal: amount })
  return { id: loanId, txn_id: txnId, ref: (dir === 'borrowed' ? 'LOAN-' : 'LEND-') + txnId }
}

export async function finLoanRemaining(loanId) {
  const principal = parseInt(await qVal('SELECT principal FROM fin_loans WHERE id = ?', [loanId])) || 0
  let paid = 0
  for (const r of await qAll("SELECT meta FROM fin_txn WHERE loan_id = ? AND type = 'loan_payment' AND status = 'posted'", [loanId])) { try { paid += parseInt(JSON.parse(r.meta).principal) || 0 } catch { /* no meta */ } }
  return principal - paid
}

export async function finLoanPayment(d, user = null) {
  const loan = await qOne('SELECT * FROM fin_loans WHERE id = ?', [parseInt(d.loan_id ?? 0) || 0])
  if (!loan) fail('وام پیدا نشد', 404)
  const date = finParseDate(d.date ?? '')
  const principal = finAmount(d.principal ?? 0, 'اصل قسط', true)
  const interest = finAmount(d.interest ?? 0, 'سود قسط', true)
  if (principal + interest <= 0) fail('مبلغ قسط باید بیشتر از صفر باشد')
  const remaining = await finLoanRemaining(Number(loan.id))
  if (principal > remaining) fail('اصل قسط از مانده‌ی وام بیشتر است (مانده: ' + numberFormat(remaining) + ' تومان)')
  const acc = await finMoneyAccount(d.money_account ?? 'cash')
  const borrowed = loan.direction === 'borrowed'
  if (borrowed) await finEnsureFunds(acc.id, principal + interest, date)
  const txnId = await finTxnInsert({ type: 'loan_payment', txn_date: date, party_id: loan.party_id, money_account_id: acc.id, total: principal + interest, paid: principal + interest, loan_id: loan.id, memo: d.memo ?? null, meta: JSON.stringify({ principal, interest }), created_by: user })
  const lines = []
  if (borrowed) {
    if (principal > 0) lines.push({ account: 'loan_payable', debit: principal, party_id: loan.party_id })
    if (interest > 0) lines.push({ account: 'exp_interest', debit: interest, party_id: loan.party_id })
    lines.push({ account: acc.id, credit: principal + interest, party_id: loan.party_id })
  } else {
    lines.push({ account: acc.id, debit: principal + interest, party_id: loan.party_id })
    if (principal > 0) lines.push({ account: 'loan_receivable', credit: principal, party_id: loan.party_id })
    if (interest > 0) lines.push({ account: 'revenue_interest', credit: interest, party_id: loan.party_id })
  }
  const je = await finPostEntry({ date, memo: 'قسط وام', lines, source_type: 'loan_payment', source_id: txnId, txn_id: txnId, user })
  await finLinkJournal(txnId, je)
  if ((await finLoanRemaining(Number(loan.id))) <= 0) await qRun("UPDATE fin_loans SET status = 'closed' WHERE id = ?", [loan.id])
  await finAudit(user, 'create', 'loan_payment', txnId, { principal, interest })
  return { id: txnId, ref: 'LPAY-' + txnId }
}

export async function finBuyAsset(d, user = null) {
  const date = finParseDate(d.date ?? '')
  const cost = finAmount(d.cost ?? 0, 'بهای خرید')
  const name = str(d.name).trim()
  if (name === '') fail('نام دارایی لازم است')
  const acct = await finAccountOrFail(d.asset_account ?? 'fixed_equipment', ['asset'])
  if (finIsMoney(acct) || acct.system_key === 'accum_dep' || !String(acct.code).startsWith('15')) fail('حساب دارایی ثابت نامعتبر است')
  const life = Math.max(1, parseInt(d.useful_life_months ?? 36) || 36)
  const salvage = finAmount(d.salvage ?? 0, 'ارزش اسقاط', true)
  if (salvage >= cost) fail('ارزش اسقاط باید کمتر از بهای خرید باشد')
  const partyId = d.party_id ? Number((await finParty(d.party_id)).id) : null
  const onCredit = !!d.on_credit
  if (onCredit && partyId === null) fail('برای خرید نسیه، تأمین‌کننده را انتخاب کنید')
  const acc = onCredit ? null : await finMoneyAccount(d.money_account ?? 'cash')
  if (acc) await finEnsureFunds(acc.id, cost, date)
  const r = await qRun('INSERT INTO fin_assets (name, class, asset_account_id, cost, salvage, purchase_date, useful_life_months, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [name, d.class ?? 'equipment', acct.id, cost, salvage, date, life, d.memo ?? null, now()])
  const assetId = Number(r.lastInsertRowid)
  let txnId, lines
  if (onCredit) {
    txnId = await finTxnInsert({ type: 'purchase', txn_date: date, party_id: partyId, category_account_id: acct.id, subtotal: cost, total: cost, asset_id: assetId, due_date: d.due_date ? finParseDate(d.due_date) : null, memo: name, meta: JSON.stringify({ asset: true }), created_by: user })
    lines = [{ account: acct.id, debit: cost }, { account: 'ap', credit: cost, party_id: partyId }]
  } else {
    txnId = await finTxnInsert({ type: 'asset_purchase', txn_date: date, party_id: partyId, money_account_id: acc.id, category_account_id: acct.id, subtotal: cost, total: cost, paid: cost, asset_id: assetId, memo: name, created_by: user })
    lines = [{ account: acct.id, debit: cost }, { account: acc.id, credit: cost }]
  }
  const je = await finPostEntry({ date, memo: 'خرید دارایی ' + name, lines, source_type: 'asset_purchase', source_id: txnId, txn_id: txnId, user })
  await finLinkJournal(txnId, je)
  await finAudit(user, 'create', 'asset', assetId, { name, cost })
  return { id: assetId, txn_id: txnId }
}

/** Tehran wall-clock month arithmetic: [Y, M(1-12)] of a unix time, and the unix time of the 1st of a month 00:00 */
const ymOf = (ts) => { const d = new Date((ts + 12600) * 1000); return [d.getUTCFullYear(), d.getUTCMonth() + 1] }
const monthStart = (y, m) => Date.UTC(y, m - 1, 1) / 1000 - 12600

/** straight-line monthly depreciation up to asOf; idempotent per asset+month (source_key). Returns the number of entries posted. */
export async function finDepreciate(asOf = null, user = null) {
  asOf = asOf ?? now()
  let n = 0
  for (const a of await qAll("SELECT * FROM fin_assets WHERE status = 'active'", [])) {
    const monthly = Math.floor(((parseInt(a.cost) || 0) - (parseInt(a.salvage) || 0)) / Math.max(1, parseInt(a.useful_life_months) || 1))
    if (monthly <= 0) continue
    let [y, mo] = ymOf(parseInt(a.purchase_date))
    let depreciated = 0
    const life = parseInt(a.useful_life_months) || 1
    for (let m = 1; m <= life; m++) {
      mo += 1; if (mo > 12) { mo = 1; y += 1 } // the 1st of the next month
      const when = monthStart(y, mo) - 1 // the end of the month that just finished
      if (when > asOf) break
      const amount = Math.min(monthly, (parseInt(a.cost) || 0) - (parseInt(a.salvage) || 0) - depreciated)
      if (amount <= 0) break
      const [wy, wm] = ymOf(when)
      const key = 'dep:' + a.id + ':' + wy + String(wm).padStart(2, '0')
      if (Number(await qVal('SELECT COUNT(*) FROM fin_journal WHERE source_key = ?', [key])) === 0) {
        await finPostEntry({ date: when, memo: 'استهلاک ' + a.name + ' ' + wy + '-' + String(wm).padStart(2, '0'), source_type: 'depreciation', source_id: a.id, source_key: key, user, lines: [{ account: 'exp_depreciation', debit: amount }, { account: 'accum_dep', credit: amount }] })
        n++
      }
      depreciated += amount
    }
  }
  return n
}

// ------------------------------------------------------------------ chart of accounts
export async function finSaveAccount(d, user = null) {
  const name = str(d.name).trim()
  const code = str(d.code).trim()
  if (name === '' || !/^\d{3,10}$/.test(code)) fail('نام و کد حساب (۳ تا ۱۰ رقم) لازم است')
  const type = str(d.type)
  if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(type)) fail('نوع حساب نامعتبر است')
  const moneyKind = str(d.money_kind) !== '' ? str(d.money_kind) : null
  if (moneyKind !== null && (type !== 'asset' || !['cash', 'bank', 'gateway', 'wallet', 'crypto', 'other'].includes(moneyKind))) fail('فقط حساب‌های دارایی می‌توانند صندوق/بانک باشند')
  if (await qVal('SELECT id FROM fin_accounts WHERE code = ? AND id != ?', [code, parseInt(d.id ?? 0) || 0])) fail('این کد حساب قبلاً استفاده شده است')
  let id
  if (d.id) {
    const cur = await finAccount(parseInt(d.id))
    if (!cur) fail('حساب پیدا نشد', 404)
    if (cur.type !== type && Number(await qVal('SELECT COUNT(*) FROM fin_journal_lines WHERE account_id = ?', [Number(cur.id)])) > 0) fail('نوع حسابی که سند دارد قابل تغییر نیست')
    if (d.archived && finIsMoney(cur) && (await finAccountBalance(cur.id)) !== 0) fail('حساب دارای موجودی را نمی‌شود بایگانی کرد؛ اول موجودی را منتقل کنید')
    await qRun('UPDATE fin_accounts SET code=?, name=?, type=?, parent_code=?, money_kind=?, is_postable=?, allow_negative=?, archived=?, sort_order=? WHERE id=?',
      [code, name, type, d.parent_code ?? cur.parent_code, moneyKind, d.is_postable !== undefined ? (d.is_postable ? 1 : 0) : cur.is_postable, d.allow_negative !== undefined ? (d.allow_negative ? 1 : 0) : cur.allow_negative, d.archived ? 1 : 0, parseInt(d.sort_order ?? cur.sort_order) || 0, parseInt(d.id)])
    id = parseInt(d.id)
    await finAudit(user, 'update', 'account', id, { code, name })
  } else {
    const r = await qRun('INSERT INTO fin_accounts (code, name, type, parent_code, money_kind, is_postable, allow_negative, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [code, name, type, d.parent_code ?? null, moneyKind, d.is_postable !== undefined ? (d.is_postable ? 1 : 0) : 1, d.allow_negative ? 1 : 0, parseInt(d.sort_order ?? 500) || 0, now()])
    id = Number(r.lastInsertRowid)
    await finAudit(user, 'create', 'account', id, { code, name })
  }
  finAccountsReset()
  return id
}

// ------------------------------------------------------------------ permissions
export const finPermissionCatalog = () => ({
  view: 'مشاهده مالی', 'sale.create': 'ثبت فروش', 'sale.cancel': 'ابطال/برگشت فروش', 'purchase.create': 'ثبت خرید', 'expense.create': 'ثبت هزینه', 'payment.manage': 'مدیریت پرداخت‌ها',
  'accounts.manage': 'مدیریت صندوق و بانک', 'capital.manage': 'سرمایه و شرکا', 'reports.view': 'مشاهده گزارش‌ها', 'reports.export': 'خروجی گزارش‌ها', 'chart.manage': 'مدیریت سرفصل حساب‌ها', approve: 'تأیید تراکنش‌ها', sensitive: 'اطلاعات حساس مالی',
})
/** administrator = everything; other roles get what fin_settings «perm:<role>» stores (JSON list), nothing by default */
export async function finCan(role, perm) {
  if (role === 'administrator') return true
  if (!role) return false
  let list = []
  try { list = JSON.parse((await finSetting('perm:' + role, '[]')) || '[]') } catch { list = [] }
  return Array.isArray(list) && (list.includes('*') || list.includes(perm))
}
