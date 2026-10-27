// Card-to-card auto approval from bank SMS (sms_pay.php): parse, match an open order by its unique amount, approve.
// On Serverless the SMS reaches the bot through the payment relay (lib/relay.js); everything else is here.
import { one, all, run, sql } from './db.js'
import { sendmessage, telegram } from './tg.js'
import { directPayment } from './directpay.js'
import { numberFormat, intval } from './php.js'

const OPEN = ['Unpaid', 'waiting']
export function smsNormalizeDigits(s) {
  const map = { '٬': ',', '،': ',' }
  return String(s).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[٬،]/g, (ch) => map[ch])
}
export function smsParse(text) {
  const t = smsNormalizeDigits(text)
  let kind = null
  if (/به\s*حساب\s*شما\s*نشست|واریز\s*پول/u.test(t)) kind = 'deposit'
  if (/از\s*حساب\s*شما\s*پرید|برداشت\s*پول/u.test(t)) kind = kind === 'deposit' ? null : 'withdraw'
  if (kind === null) return null
  const body = t.replace(/موجودی[\s\S]*$/u, '')
  const m = /(\d[\d,]*)\s*ریال/u.exec(body)
  if (!m) return null
  const amount = intval(m[1].replace(/,/g, ''))
  if (amount <= 0) return null
  const b = /موجودی\s*:?\s*(\d[\d,]*)/u.exec(t)
  const balance = b ? intval(b[1].replace(/,/g, '')) : null
  let time = null
  const tm = /(\d{1,2}):(\d{2})/.exec(t)
  if (tm) {
    time = `${String(intval(tm[1])).padStart(2, '0')}:${tm[2]}`
    const d = /(\d{4})[./-](\d{2})[./-](\d{2})/.exec(t)
    if (d) time = `${d[1]}/${d[2]}/${d[3]} ${time}`
  }
  return { kind, amount_rial: amount, balance_rial: balance, sms_time: time }
}
export function jalaliToGregorian(jy, jm, jd) {
  jy += 1595
  let days = -355668 + 365 * jy + Math.trunc(jy / 33) * 8 + Math.trunc(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186)
  let gy = 400 * Math.trunc(days / 146097)
  days %= 146097
  if (days > 36524) { gy += 100 * Math.trunc(--days / 36524); days %= 36524; if (days >= 365) days++ }
  gy += 4 * Math.trunc(days / 1461)
  days %= 1461
  if (days > 365) { gy += Math.trunc((days - 1) / 365); days = (days - 1) % 365 }
  let gd = days + 1
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  let gm = 0
  for (; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm]
  return [gy, gm, gd]
}
/** "1405/07/13 20:44" (Jalali, Tehran) → unix time */
export function smsTimeToUnix(s) {
  const m = s == null ? null : /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const [gy, gm, gd] = jalaliToGregorian(+m[1], +m[2], +m[3])
  return Math.floor(Date.UTC(gy, gm - 1, gd, +m[4], +m[5]) / 1000) - 12600
}
async function sha1(s) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const fingerprint = (p, bank) => sha1([p.kind, p.amount_rial, p.balance_rial ?? '', p.sms_time ?? '', String(bank).toLowerCase()].join('|'))
export function smsSplitMessages(text) {
  const out = []
  for (const part of String(text).split(/^\s*بلو\s*$/mu)) {
    const p = part.trim()
    if (p !== '' && smsParse('بلو\n' + p) !== null) out.push('بلو\n' + p)
  }
  return out.length ? out : [text]
}
async function windowSeconds() {
  const r = await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = 'sms_match_window'`)
  return Math.max(10, intval(r ? r.ValuePay : 180)) * 60
}
/** Payment_report.time ('Y/m/d H:i:s', Tehran) → unix time */
export function reportTs(row) {
  const t = String(row.time ?? '')
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(t)
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 12600 : 0
}
export async function smsOpenReports(toman = null, now = Math.floor(Date.now() / 1000)) {
  const win = await windowSeconds()
  const rows = await all(sql`SELECT * FROM Payment_report WHERE Payment_Method = 'cart to cart' AND payment_Status IN ('Unpaid','waiting')`)
  return rows.filter((r) => { const ts = reportTs(r); return ts > 0 && now - ts <= win && (toman === null || intval(r.price) === toman) })
}
/** a 1..999 toman offset no other open order uses */
export async function smsUniqueAmount(base) {
  const used = new Set((await smsOpenReports()).map((r) => intval(r.price)))
  const free = []
  for (let o = 1; o <= 999; o++) if (!used.has(base + o)) free.push(o)
  if (!free.length) return base + 1000 + Math.floor(Math.random() * 9000)
  return base + free[Math.floor(Math.random() * free.length)]
}

/** smsProcess(): store one SMS and approve the single open order it matches */
export async function smsProcess(c, text, bank, now = Math.floor(Date.now() / 1000), maxAge = 21600) {
  const p = smsParse(text)
  const out = (o) => ({ ...o, amount_rial: p?.amount_rial ?? 0 })
  const fp = p ? await fingerprint(p, bank) : await sha1(smsNormalizeDigits(String(text).trim()) + '|' + String(bank).toLowerCase())
  const kind = p?.kind ?? 'unknown'
  const status = p === null ? 'ignored' : kind === 'deposit' ? 'unmatched' : 'ignored'
  const ins = await run(sql`INSERT OR IGNORE INTO sms_inbox (fingerprint, received_at, bank, kind, amount_rial, balance_rial, sms_time, status, note)
    VALUES (${fp}, ${now}, ${bank}, ${kind}, ${p?.amount_rial ?? 0}, ${p?.balance_rial ?? null}, ${p?.sms_time ?? null}, ${status}, NULL)`)
  if (Number(ins?.rowsAffected ?? 0) === 0) return out({ status: 'duplicate', order: null })
  const id = (await one(sql`SELECT id FROM sms_inbox WHERE fingerprint = ${fp}`))?.id
  const set = (st, order = null, note = null) => run(sql`UPDATE sms_inbox SET status = ${st}, id_order = ${order}, note = ${note} WHERE id = ${id}`)
  if (p === null || kind !== 'deposit') return out({ status: 'ignored', order: null })
  const sentAt = smsTimeToUnix(p.sms_time)
  if (maxAge > 0 && sentAt !== null && now - sentAt > maxAge) { await set('stale', null, `bank timestamp older than ${Math.floor(maxAge / 3600)}h`); return out({ status: 'stale', order: null }) }
  if (p.amount_rial % 10 !== 0) { await set('review', null, 'amount not a whole toman'); return out({ status: 'review', order: null }) }
  const cands = await smsOpenReports(Math.floor(p.amount_rial / 10), now)
  if (cands.length === 0) { await set('unmatched'); return out({ status: 'unmatched', order: null }) }
  if (cands.length > 1) { await set('ambiguous', null, `${cands.length} open orders with this amount`); return out({ status: 'ambiguous', order: null }) }
  const order = cands[0]
  const claim = await run(sql`UPDATE Payment_report SET payment_Status = 'paid', dec_not_confirmed = 'تأیید خودکار با پیامک بانک' WHERE id_order = ${order.id_order} AND payment_Status IN ('Unpaid','waiting')`)
  if (Number(claim?.rowsAffected ?? 0) === 0) { await set('review', order.id_order, 'order changed concurrently'); return out({ status: 'review', order }) }
  await set('matched', order.id_order)
  await smsApproveOrder(c, order)
  return out({ status: 'matched', order })
}
export async function smsProcessText(c, text, bank, now, maxAge) {
  const res = []
  for (const m of smsSplitMessages(text)) res.push(await smsProcess(c, m, bank, now, maxAge))
  return res
}
/** «I paid»: a matching deposit SMS that arrived before the order (unclaimed) approves it */
export async function smsReconcileOrder(c, order, now = Math.floor(Date.now() / 1000)) {
  if (order.Payment_Method !== 'cart to cart' || !OPEN.includes(order.payment_Status)) return false
  const ots = reportTs(order)
  if (ots <= 0) return false
  const rial = intval(order.price) * 10
  const ids = (await all(sql`SELECT id FROM sms_inbox WHERE kind = 'deposit' AND status = 'unmatched' AND amount_rial = ${rial} AND received_at >= ${ots - 900} AND received_at >= ${now - 86400} ORDER BY id DESC`)).map((r) => r.id)
  if (ids.length !== 1) return false
  if ((await smsOpenReports(intval(order.price), now)).length !== 1) return false
  const c1 = await run(sql`UPDATE sms_inbox SET status = 'matched', id_order = ${order.id_order}, note = 'catch-up' WHERE id = ${ids[0]} AND status = 'unmatched'`)
  if (Number(c1?.rowsAffected ?? 0) === 0) return false
  const c2 = await run(sql`UPDATE Payment_report SET payment_Status = 'paid', dec_not_confirmed = 'تأیید خودکار با پیامک بانک (دریافت قبل از ثبت درخواست)' WHERE id_order = ${order.id_order} AND payment_Status IN ('Unpaid','waiting')`)
  if (Number(c2?.rowsAffected ?? 0) === 0) { await run(sql`UPDATE sms_inbox SET status = 'unmatched', id_order = NULL, note = NULL WHERE id = ${ids[0]}`); return false }
  await smsApproveOrder(c, order)
  return true
}
export async function smsApproveOrder(c, order) {
  await directPayment(c, order.id_order)
  const cash = (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = 'chashbackcart'`))?.ValuePay ?? '0'
  const u = await one(sql`SELECT * FROM user WHERE id = ${String(order.id_user)}`)
  if (String(cash) !== '0' && u) {
    const bonus = (Number(order.price) * Number(cash)) / 100
    await run(sql`UPDATE user SET Balance = ${intval(u.Balance) + bonus} WHERE id = ${u.id}`)
    await sendmessage(u.id, (await import('./php.js')).sprintf(c.T.users.Balance.giftDeposit, bonus), null, 'HTML')
  }
  const S = (await one(sql`SELECT Channel_Report FROM setting LIMIT 1`)) || {}
  if (String(S.Channel_Report ?? '').length > 0) {
    const topic = (await one(sql`SELECT idreport FROM topicid WHERE report = 'paymentreport'`))?.idreport ?? null
    const args = { chat_id: S.Channel_Report, parse_mode: 'HTML', text: `✅ پرداخت کارت‌به‌کارت با پیامک بانک تأیید شد\n👤 کاربر: <code>${order.id_user}</code>\n💰 مبلغ: ${numberFormat(intval(order.price))} تومان\n🧾 سفارش: <code>${order.id_order}</code>` }
    if (topic) args.message_thread_id = topic
    await telegram('sendmessage', args)
  }
}
