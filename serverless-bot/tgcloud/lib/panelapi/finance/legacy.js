// finance/legacy.php: the bridge from the bot's own accounting data (expenses, capital, payments) into the ledger.
// Idempotent: every row has an entry keyed on its content hash; an edited row is reversed and posted again, a deleted one is reversed.
import { qAll, qOne, qVal } from '../qb.js'
import { str, now } from '../util.js'
import { accParseDateTime, accGuessKind } from '../stats.js'
import * as E from './engine.js'
import { md5 } from './md5.js'

const KIND_ACCOUNT = { purchase: 'cogs', salary: 'exp_salary', advertising: 'exp_advertising', server: 'exp_server', tools: 'exp_tools', fee: 'exp_fee', tax: 'exp_tax', general: 'exp_general', dividend: 'dividends' }
export const finLegacyKindAccount = (kind) => KIND_ACCOUNT[kind] ?? 'exp_general'

/** which money account a customer payment method lands in (system_key) */
export function finMethodAccount(method) {
  const m = String(method).toLowerCase()
  if (['manual invoice', 'add order by admin', 'extend by admin'].includes(m)) return 'cash'
  if (m.includes('cart') || m.includes('card')) return 'bank_main'
  if (/plisio|nowpay|arze|crypto|trx|ton|usdt/.test(m)) return 'crypto'
  if (/zarinpal|aqaye|tetra|iranpay|variza|star|after pay|nextpay|idpay|payping|gateway|digi/.test(m)) return 'gateway'
  return 'legacy_cash'
}

async function legacyEntry(type, id, hash, lines, ts, memo, stats) {
  const cur = await qOne("SELECT id, source_hash FROM fin_journal WHERE source_type = ? AND source_id = ? AND status = 'posted' ORDER BY id DESC LIMIT 1", [type, id])
  if (cur && cur.source_hash === hash) return
  try {
    if (cur) { await E.finReverseEntry(Number(cur.id), 'ویرایش در سیستم قدیمی', 'sync'); stats.reposted++ } else stats[type]++
    await E.finPostEntry({ date: ts, memo, lines, source_type: type, source_id: id, source_key: type + ':' + id + ':' + hash.slice(0, 10), source_hash: hash, user: 'sync' })
  } catch (e) { stats.issues.push(`${type} #${id}: ${e.message}`) }
}

export async function finSyncLegacy(limit = 20000) {
  const stats = { legacy_expense: 0, legacy_capital: 0, legacy_cost: 0, legacy_payment: 0, reposted: 0, reversed: 0, issues: [] }
  const seen = { legacy_expense: new Set(), legacy_capital: new Set() }
  for (const r of await qAll(`SELECT * FROM expenses ORDER BY id LIMIT ${limit}`, [])) {
    const amount = parseInt(r.amount) || 0
    seen.legacy_expense.add(String(r.id))
    if (amount <= 0) { stats.issues.push(`هزینه #${r.id} مبلغ صفر/منفی دارد و ثبت نشد`); continue }
    const kind = r.kind !== '' && r.kind !== null ? String(r.kind) : 'general'
    const acct = finLegacyKindAccount(kind)
    const hash = md5(amount + '|' + kind + '|' + r.created_at + '|' + str(r.description))
    const lines = kind === 'dividend' ? [{ account: 'dividends', debit: amount }, { account: 'legacy_cash', credit: amount }] : [{ account: acct, debit: amount, memo: r.description }, { account: 'legacy_cash', credit: amount }]
    await legacyEntry('legacy_expense', String(r.id), hash, lines, parseInt(r.created_at), str(r.description).trim() !== '' ? String(r.description) : 'هزینه', stats)
  }
  for (const r of await qAll(`SELECT * FROM capital_entries ORDER BY id LIMIT ${limit}`, [])) {
    const amount = parseInt(r.amount) || 0
    seen.legacy_capital.add(String(r.id))
    if (amount <= 0) { stats.issues.push(`ورود سرمایه #${r.id} مبلغ صفر/منفی دارد و ثبت نشد`); continue }
    const hash = md5(amount + '|' + r.created_at + '|' + str(r.description))
    await legacyEntry('legacy_capital', String(r.id), hash, [{ account: 'legacy_cash', debit: amount }, { account: 'capital', credit: amount }], parseInt(r.created_at), str(r.description).trim() !== '' ? String(r.description) : 'ورود سرمایه', stats)
  }
  // entries whose source row was deleted
  for (const [type, ids] of Object.entries(seen)) {
    for (const j of await qAll("SELECT id, source_id FROM fin_journal WHERE source_type = ? AND status = 'posted'", [type])) {
      if (!ids.has(String(j.source_id)) && !String(j.source_id).startsWith('p')) { await E.finReverseEntry(Number(j.id), 'حذف از سیستم قدیمی', 'sync'); stats.reversed++ }
    }
  }
  // payments: new rows only
  for (const r of await qAll(`SELECT p.* FROM Payment_report p WHERE (p.payment_Status = 'paid' OR p.Payment_Method IN ('cost','capital_injection'))
      AND p.Payment_Method NOT IN ('cost_migrated','capital_migrated','add balance by admin','wallet')
      AND NOT EXISTS (SELECT 1 FROM fin_journal j WHERE j.source_type IN ('legacy_payment','legacy_cost','legacy_capital') AND j.source_id = 'p' || p.id) ORDER BY p.id LIMIT ${limit}`, [])) {
    const price = parseInt(String(r.price ?? '').replace(/[^0-9]/g, '')) || 0
    const ts = accParseDateTime(String(r.time))
    if (ts === null) { stats.issues.push(`پرداخت #${r.id} تاریخ نامعتبر دارد (${r.time}) و ثبت نشد`); continue }
    if (price <= 0) continue
    const pid = 'p' + r.id
    const method = String(r.Payment_Method)
    if (method === 'cost') {
      const desc = str(r.dec_not_confirmed).trim()
      await legacyEntry('legacy_cost', pid, md5('c' + price + ts), [{ account: finLegacyKindAccount(accGuessKind(desc) ?? 'general'), debit: price }, { account: 'legacy_cash', credit: price }], ts, desc !== '' ? desc : 'هزینه', stats)
    } else if (method === 'capital_injection') await legacyEntry('legacy_capital', pid, md5('k' + price + ts), [{ account: 'legacy_cash', debit: price }, { account: 'capital', credit: price }], ts, 'ورود سرمایه', stats)
    else if (method === 'low balance by admin') await legacyEntry('legacy_payment', pid, md5('w' + price + ts), [{ account: 'sales_returns', debit: price }, { account: 'legacy_cash', credit: price }], ts, 'کسر موجودی کیف پول (بازپرداخت)', stats)
    else await legacyEntry('legacy_payment', pid, md5('r' + price + ts + method), [{ account: finMethodAccount(method), debit: price }, { account: 'revenue_sales', credit: price }], ts, 'پرداخت مشتری ' + r.id_user + ' · ' + method + ' · ' + r.id_order, stats)
  }
  await E.finSetSetting('legacy_last_sync', String(now()))
  await E.finSetSetting('legacy_last_stats', JSON.stringify(stats))
  return stats
}

/** at most once every `every` seconds (called from the panel API); small batches inside a request */
export async function finMaybeSync(every = 60) {
  if (now() - (parseInt(await E.finSetting('legacy_last_sync', 0)) || 0) < every) return null
  return finSyncLegacy(1500)
}
