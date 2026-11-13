// Paychi payment gateway (the owner's own card-to-card service, github skinny-dev/paychi-variz), native API v1.
//   POST {base}/api/v1/transactions  { amount (RIAL, integer), order_id, description, callback_url, ttl }  → 201 { id, status, amount (the exact unique amount to pay),
//                                                                                                        requested_amount, order_id, card{…}, payment_url, expires_at }
//   GET  {base}/api/v1/transactions/{id}                                                               → the same object; status pending | paid | expired | cancelled
//   POST {callback_url}   X-Paychi-Signature: t=<unix>,v1=HMAC-SHA256(secret, t + "." + body)          → only a HINT here (see relay.js)
// The money is credited only after an inquiry with OUR key says status=paid for the transaction WE stored, with OUR order id, for at least what
// was billed; one atomic claim of «paid» means a delivery happens once. Amounts: the bot works in toman, Paychi in rial (toman × 10).
import { fetch } from 'sdk'
import { one, run, sql, kvGet } from './db.js'
import { telegram, sendmessage } from './tg.js'
import { sprintf, numberFormat, intval } from './php.js'
import { sleep, withTimeout, abortAfter } from './timer.js'

const pay = async (name) => (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${name}`))?.ValuePay ?? null

export async function paychiBase() {
  const b = String((await pay('paychi_base_url')) ?? '').trim()
  return b === '0' ? '' : b.replace(/\/+$/, '')
}
export async function paychiKey() {
  const k = String((await pay('paychi_api_key')) ?? '').trim()
  return k === '0' ? '' : k
}

/** one HTTP call that never throws and never waits longer than timeoutMs: {http, data, error} */
export async function paychiCall(method, path, json = null, timeoutMs = 20000) {
  const key = await paychiKey(), base = await paychiBase()
  if (key === '') return { http: 0, data: null, error: 'paychi_api_key not set' }
  if (base === '') return { http: 0, data: null, error: 'paychi_base_url not set' }
  const headers = { Accept: 'application/json', Authorization: 'Bearer ' + key }
  const opts = { method, headers }
  if (json !== null) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json) }
  try {
    const res = await withTimeout(fetch(base + path, { ...opts, ...abortAfter(timeoutMs) }), timeoutMs)
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch { data = null }
    return { http: res.status, data: data && typeof data === 'object' ? data : null, error: data && typeof data === 'object' ? '' : 'invalid json' }
  } catch (e) {
    return { http: 0, data: null, error: 'fetch: ' + String((e && e.message) || e) }
  }
}

/** new transaction for a bill of `toman` toman: {pay_id, pay_url, amount_rial, expires_at} or {error, http_code, code, message}; two tries (a customer is waiting) */
export async function createPayPaychi(c, toman, orderId) {
  const relay = String((await kvGet('config:pay_relay_url')) || '').replace(/\/+$/, '')
  const payload = { amount: intval(toman) * 10, order_id: orderId, description: 'Mirza order ' + orderId, ttl: 1800 }
  if (relay) payload.callback_url = `${relay}/paychi?order_id=${encodeURIComponent(orderId)}`
  const waitMs = intval((await pay('paychi_timeout_ms')) ?? 0) || 12000 // (the setting exists for tests)
  let res = {}
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await paychiCall('POST', '/api/v1/transactions', payload, waitMs)
    const d = r.data || {}
    if (r.http >= 200 && r.http < 300 && typeof d.id === 'string' && typeof d.payment_url === 'string' && d.payment_url.startsWith('http')) {
      return { pay_id: d.id, pay_url: d.payment_url, amount_rial: intval(d.amount), expires_at: d.expires_at ?? null, card: d.card ?? null }
    }
    res = { error: r.error !== '' ? r.error : 'http ' + r.http, http_code: r.http, code: String(d.error?.code ?? ''), message: String(d.error?.message ?? '') }
    // an answer that will not change on a second try: bad key, bad request, a business refusal (limit, no card, subscription)
    if ([400, 401, 402, 403, 409, 422].includes(r.http) || /not set$/.test(r.error)) break
    if (attempt < 2) { console.error('createPayPaychi try', attempt, res.error); await sleep(1000) }
  }
  return res
}

/** how long to hide the button after a failed create (seconds; 0 = do not hide: the customer just sees the error) */
export function paychiPauseSeconds(p) {
  const code = String(p?.code ?? '')
  if (['card_limit_reached', 'no_active_card', 'plan_limit_reached', 'merchant_inactive', 'subscription_required', 'no_unique_amount'].includes(code)) return 900
  const h = intval(p?.http_code ?? 0)
  if (h === 0 || h >= 500) return 600
  if (h === 401 || h === 403) return 1800
  return 0
}

/** {ok, paid, status, amount_rial, requested_rial, order_id, error} */
export async function paychiInquiry(id) {
  const r = await paychiCall('GET', '/api/v1/transactions/' + encodeURIComponent(id))
  const d = r.data
  if (r.http !== 200 || !d) return { ok: false, paid: false, status: '', amount_rial: 0, requested_rial: 0, order_id: '', error: r.error !== '' ? r.error : 'http ' + r.http, http_code: r.http }
  const sameId = String(d.id ?? '') === id // an answer about another transaction is never accepted
  return { ok: sameId, paid: sameId && String(d.status) === 'paid', status: String(d.status ?? ''), amount_rial: intval(d.amount ?? 0), requested_rial: intval(d.requested_amount ?? 0), order_id: String(d.order_id ?? ''), error: sameId ? '' : 'answer about another transaction' }
}

/** credit one Paychi order if (and only if) the service confirms it. deliver(orderId) hands over the product (directPayment).
 *  result: paid | already | unpaid | amount_mismatch | error | delivery_failed */
export async function paychiSettle(order, deliver) {
  if (order?.Payment_Method !== 'paychi') return { result: 'error', error: 'not a paychi order' }
  const orderId = String(order.id_order)
  if (order.payment_Status === 'paid') return { result: 'already' }
  const payId = String(order.dec_not_confirmed ?? '').trim()
  if (payId === '') return { result: 'error', error: 'order has no transaction id' }
  const inq = await paychiInquiry(payId)
  if (!inq.ok) return { result: 'error', error: inq.error }
  if (inq.order_id !== orderId) return { result: 'error', error: 'transaction belongs to another order' } // never pay one order with another's money
  if (!inq.paid) return { result: 'unpaid', payment_status: inq.status }
  const billed = intval(order.price)
  if (inq.requested_rial < billed * 10 || inq.amount_rial < inq.requested_rial) return { result: 'amount_mismatch', amount: Math.floor(inq.amount_rial / 10), billed }
  const before = String(order.payment_Status ?? '')
  const claim = await run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ${orderId} AND payment_Status <> 'paid'`)
  if (Number(claim?.rowsAffected ?? 0) < 1) return { result: 'already' }
  const info = { before, billed, pay_id: payId, order_id: orderId }
  try { await deliver(orderId) } catch (e) {
    console.error('paychi: delivery failed for', orderId, e)
    return { result: 'delivery_failed', error: String((e && e.message) || e), ...info }
  }
  return { result: 'paid', ...info }
}

/** cashback and the report-group notice after a successful settle */
export async function paychiAfterPaid(c, order, res) {
  const billed = intval(res.billed)
  const cash = intval((await pay('chashbackpaychi')) ?? '0')
  const buyer = await one(sql`SELECT * FROM user WHERE id = ${String(order.id_user)}`)
  if (cash > 0 && buyer) {
    const reward = Math.trunc((billed * cash) / 100)
    if (reward > 0) {
      await run(sql`UPDATE user SET Balance = ${intval(buyer.Balance) + reward} WHERE id = ${buyer.id}`)
      await sendmessage(buyer.id, sprintf(c.T.paymentGateway.giftReport, reward), null, 'HTML')
    }
  }
  if (String(c.setting.Channel_Report ?? '').length === 0 || !c.topicsAll?.paymentreport) return
  const send = (text) => telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topicsAll.paymentreport, text, parse_mode: 'HTML' })
  await send(`💵 پرداخت جدید (پیچی، کارت به کارت خودکار)\n- 👤 نام کاربری کاربر : @${buyer?.username ?? '-'}\n- 🆔 آیدی عددی کاربر : ${order.id_user}\n- 💸 مبلغ : ${numberFormat(billed)} تومان\n- 🛒 کد سفارش : <code>${res.order_id}</code>\n- 🧾 تراکنش : <code>${res.pay_id}</code>`)
  if (res.before === 'waiting') await send(`✅ پیچی خودکار تأیید کرد؛ رسید دستی سفارش <code>${res.order_id}</code> دیگر نیاز به بررسی ندارد.`)
  else if (res.before === 'reject') await send(`⚠️ پیچی پرداختی را تأیید کرد که قبلاً رد شده بود؛ مبلغ ${numberFormat(billed)} تومان برای کاربر <code>${order.id_user}</code> ثبت شد.`)
}
