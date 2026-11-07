// payments_admin.php + the payment_create route: payments that need a human, confirming them, manual payment records.
import { qAll, qOne, qRun, qVal } from './qb.js'
import { fail, str, now, latinDigits, randomHex12 } from './util.js'
import { tehranDate, systemContext } from '../bot.js'
import { directPayment } from '../directpay.js'

export const moneyInput = (v) => parseInt(latinDigits(str(v)).replace(/\D/g, ''), 10) || 0

/** Purpose of a Payment_report row from its id_invoice ("getconfigafterpay|user", "getextenduser|user%value", …) */
export function purpose(idInvoice) {
  const p = String(idInvoice ?? '').split('|')
  const rest0 = p.slice(1).join('|')
  const kind = { refunded: 'refunded', getconfigafterpay: 'new', getextenduser: 'renew', getextravolumeuser: 'volume', getextratimeuser: 'time' }[p[0]] ?? 'topup'
  let target = '', value = ''
  if (kind !== 'topup') { const i = rest0.indexOf('%'); target = i < 0 ? rest0 : rest0.slice(0, i); value = i < 0 ? '' : rest0.slice(i + 1) }
  return { kind, target, value }
}

async function delivered(row, pu) {
  if (pu.kind === 'new') {
    const st = await qVal('SELECT Status FROM invoice WHERE username = ? ORDER BY CAST(time_sell AS INTEGER) DESC LIMIT 1', [pu.target])
    return st === null ? false : ['active', 'sendedwarn', 'send_on_hold', 'end_of_time', 'end_of_volume', 'disabled', 'disablebyadmin'].includes(String(st).toLowerCase())
  }
  if (pu.kind === 'renew') {
    const st = await qVal("SELECT status FROM service_other WHERE username = ? AND id_user = ? AND value LIKE '%' || ? || '%' ORDER BY id DESC LIMIT 1", [pu.target, String(row.id_user), pu.value])
    return st === null ? null : String(st).toLowerCase() === 'paid'
  }
  return null
}

export async function pending(q) {
  const days = Math.max(1, Math.min(60, parseInt(q.days ?? 7) || 7))
  const d = new Date((now() + 12600 - days * 86400) * 1000)
  const since = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
  const rows = await qAll(`SELECT p.id, p.id_order, p.id_user, p.time, p.price, p.payment_Status, p.Payment_Method, p.id_invoice, p.dec_not_confirmed, u.username AS tg_username, u.namecustom
    FROM Payment_report p LEFT JOIN user u ON u.id = p.id_user
    WHERE p.time >= ? AND (p.payment_Status IN ('Unpaid','waiting','expire','reject') OR (p.payment_Status = 'paid' AND (p.id_invoice LIKE 'getconfigafterpay|%' OR p.id_invoice LIKE 'getextenduser|%' OR p.id_invoice LIKE 'getextravolumeuser|%' OR p.id_invoice LIKE 'getextratimeuser|%')))
    ORDER BY p.id DESC LIMIT 500`, [since])
  const out = [], counts = { not_delivered: 0, waiting: 0, unpaid: 0, expire: 0, reject: 0 }
  for (const r of rows) {
    const pu = purpose(r.id_invoice)
    const status = String(r.payment_Status)
    let problem
    if (status === 'paid') {
      if ((await delivered(r, pu)) !== false) continue
      problem = 'not_delivered'
    } else problem = { Unpaid: 'unpaid', waiting: 'waiting', expire: 'expire', reject: 'reject' }[status]
    counts[problem]++
    out.push({ id_order: str(r.id_order), time: str(r.time), id_user: str(r.id_user),
      user: str(r.namecustom) !== '' && r.namecustom !== '0' ? str(r.namecustom) : r.tg_username && r.tg_username !== 'none' ? '@' + r.tg_username : str(r.id_user),
      price: parseInt(r.price) || 0, method: str(r.Payment_Method), status, problem, kind: pu.kind, target: pu.target, ref: ['variza', 'tetraminator'].includes(r.Payment_Method) ? str(r.dec_not_confirmed) : '' })
  }
  return { ok: true, rows: out, counts, days }
}

export async function confirm(b) {
  const orderId = str(b.order).trim()
  const row = await qOne('SELECT * FROM Payment_report WHERE id_order = ?', [orderId])
  if (!row) fail('پرداخت پیدا نشد', 404)
  const pu = purpose(row.id_invoice)
  if (pu.kind === 'refunded') fail('این پرداخت قبلاً به کیف پول مشتری برگشت داده شده (سفارشش ساخته نشد یا حذف شده بود)', 409)
  if (row.payment_Status === 'paid') {
    if (pu.kind !== 'new') fail('این پرداخت قبلاً تأیید شده؛ تمدید/افزایش را دستی در پنل VPN انجام دهید (برای جلوگیری از دوبار تمدید، خودکار تکرار نمی‌شود)', 409)
    if (await delivered(row, pu)) fail('این سفارش قبلاً تحویل شده است', 409)
  } else {
    if (row.payment_Status === 'reject' && !b.allow_rejected) fail('این پرداخت قبلاً رد شده؛ اگر مطمئنید پول رسیده، دوباره با تأیید «رد شده» بزنید', 409)
    const claim = await qRun("UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ? AND payment_Status <> 'paid'", [orderId])
    if (Number(claim.rowsAffected ?? 0) === 0) fail('این پرداخت هم‌زمان توسط ادمین دیگری تأیید شد', 409)
  }
  try {
    await directPayment(await systemContext(), orderId)
  } catch (e) {
    console.error('panel pay_confirm', orderId, e)
    fail('پرداخت تأیید شد ولی تحویل سرویس خطا داد: ' + (e && e.message), 502)
  }
  const after = (await qOne('SELECT * FROM Payment_report WHERE id_order = ?', [orderId])) || row
  return { ok: true, kind: pu.kind, delivered: await delivered(after, pu) }
}

export async function create(b, admin) {
  const amount = moneyInput(b.price ?? 0)
  if (amount <= 0) fail('مبلغ نامعتبر است', 422)
  const uid = str(b.id_user).trim()
  const credit = !!b.add_balance
  if (uid !== '' && !/^\d{1,15}$/.test(uid)) fail('آیدی عددی تلگرام نامعتبر است (برای مشتری بدون تلگرام خالی بگذارید)', 422)
  if (credit && uid === '') fail('برای شارژ کیف پول، آیدی عددی کاربر لازم است', 422)
  let method = [...str(b.method).trim()].slice(0, 190).join('')
  method = method === '' ? 'ثبت دستی' : method
  if (uid !== '') {
    const bal = await qVal('SELECT Balance FROM user WHERE id = ?', [uid])
    if (bal === null) fail('این کاربر در ربات ثبت نشده است', 404)
    if (credit) await qRun('UPDATE user SET Balance = ? WHERE id = ?', [(parseInt(bal) || 0) + amount, uid])
  }
  const note = [...(str(b.note).trim() + ' | ثبت دستی توسط ' + admin.username)].slice(0, 1000).join('')
  await qRun('INSERT INTO Payment_report (id_user, id_order, time, price, dec_not_confirmed, Payment_Method, payment_Status, id_invoice) VALUES (?,?,?,?,?,?,?,?)',
    [uid === '' ? '0' : uid, randomHex12(), tehranDate(), amount, note, method, 'paid', 'none'])
  return { ok: true, credited: credit }
}
