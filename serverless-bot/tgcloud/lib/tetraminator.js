// Tetraminator payment gateway (tetraminator.com, API v1) — port of tetraminator.php. Read that file's header for the API.
// The callback to our server is only a hint (no signature): money is credited after an inquiry with our key for the pay_id
// WE stored, status=true, payment_status=paid and amount >= the bill; one atomic claim of «paid» means a delivery happens once.
import { fetch } from 'sdk'
import { one, run, sql, kvGet } from './db.js'
import { telegram, sendmessage } from './tg.js'
import { sprintf, numberFormat, intval } from './php.js'

const pay = async (name) => (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${name}`))?.ValuePay ?? null

export async function tetraBase() {
  const o = String((await pay('tetraminator_base_url')) ?? '').trim()
  return (o !== '' && o !== '0' ? o : 'https://api.tetraminator.com/v1').replace(/\/+$/, '')
}
export async function tetraKey() {
  const k = String((await pay('tetraminator_api_key')) ?? '').trim()
  return k === '0' ? '' : k
}

/** one HTTP call that never throws and never waits longer than timeoutMs: {http, data, error} */
export async function tetraCall(method, path, json = null, timeoutMs = 25000) {
  const key = await tetraKey()
  if (key === '') return { http: 0, data: null, error: 'tetraminator_api_key not set' }
  const headers = { Accept: 'application/json', 'X-API-KEY': key }
  const opts = { method, headers }
  if (json !== null) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json) }
  let timer
  try {
    const res = await Promise.race([
      fetch((await tetraBase()) + path, opts),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs) }),
    ])
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch { data = null }
    return { http: res.status, data: data && typeof data === 'object' ? data : null, error: data && typeof data === 'object' ? '' : 'invalid json' }
  } catch (e) {
    return { http: 0, data: null, error: 'fetch: ' + String((e && e.message) || e) }
  } finally { clearTimeout(timer) }
}

const LINK_ORDER = {
  gateway: ['gateway_link', 'url', 'mini_app_link', 'payment_link'],
  url: ['url', 'gateway_link', 'mini_app_link', 'payment_link'],
  miniapp: ['mini_app_link', 'url', 'gateway_link', 'payment_link'],
  bot: ['payment_link', 'url', 'mini_app_link', 'gateway_link'],
}
/** the link to give the customer from a create-invoice answer, by preference; '' when none is a https link */
export function tetraPickLink(d, mode = 'gateway') {
  for (const k of LINK_ORDER[mode] ?? LINK_ORDER.gateway) if (typeof d?.[k] === 'string' && d[k].startsWith('https://')) return d[k]
  return ''
}

/** where Tetraminator calls us back: the payment relay when one is set up (a Serverless bot has no public address), else the PHP server */
async function callbackUrl(c, orderId) {
  const relay = String((await kvGet('config:pay_relay_url')) || '').replace(/\/+$/, '')
  return relay ? `${relay}/tetraminator?order_id=${encodeURIComponent(orderId)}` : `https://${c.domain}/payment/tetraminator_webhook.php?order_id=${encodeURIComponent(orderId)}`
}

/** new invoice: {pay_id, pay_url, links} or {error, http_code, message}; two tries of at most 12 s (a customer is waiting) */
export async function createPayTetraminator(c, price, orderId) {
  const callback = await callbackUrl(c, orderId)
  const mode = String((await pay('tetraminator_link_mode')) ?? 'gateway').trim()
  const waitMs = intval((await pay('tetraminator_timeout_ms')) ?? 0) || 12000 // (the setting exists for tests)
  let res = {}
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await tetraCall('POST', '/invoice/create', { price: intval(price), callback_url: callback }, waitMs)
    const d = r.data || {}
    const link = tetraPickLink(d, mode)
    if (r.http >= 200 && r.http < 300 && d.status && d.pay_id && link !== '') {
      const links = {}
      for (const k of ['url', 'payment_link', 'mini_app_link', 'gateway_link']) if (d[k] !== undefined) links[k] = d[k]
      return { pay_id: String(d.pay_id), pay_url: link, links }
    }
    res = { error: r.error !== '' ? r.error : 'http ' + r.http, http_code: r.http, message: String(d.message ?? '') }
    if ([400, 401, 403].includes(r.http) || r.error === 'tetraminator_api_key not set') break
    if (attempt < 2) { console.error('createPayTetraminator try', attempt, res.error); await new Promise((ok) => setTimeout(ok, 1000)) }
  }
  return res
}

/** {ok, paid, amount, payment_status, error} */
export async function tetraInquiry(payId) {
  const r = await tetraCall('GET', '/payment/inquiry/' + encodeURIComponent(payId))
  const d = r.data
  if (r.http !== 200 || !d) return { ok: false, paid: false, amount: 0, payment_status: '', error: r.error !== '' ? r.error : 'http ' + r.http, http_code: r.http }
  const sameId = d.pay_id === undefined || String(d.pay_id) === payId // an answer about another payment is never accepted
  const status = String(d.payment_status ?? '')
  return { ok: true, paid: sameId && Boolean(d.status) && status === 'paid', amount: intval(d.amount ?? 0), payment_status: status, error: '' }
}

/** credit one Tetraminator order if (and only if) the gateway confirms it. deliver(orderId) hands over the product (directPayment).
 *  result: paid | already | unpaid | amount_mismatch | error | delivery_failed */
export async function tetraSettle(order, deliver) {
  if (order?.Payment_Method !== 'tetraminator') return { result: 'error', error: 'not a tetraminator order' }
  const orderId = String(order.id_order)
  if (order.payment_Status === 'paid') return { result: 'already' }
  const payId = String(order.dec_not_confirmed ?? '').trim()
  if (payId === '') return { result: 'error', error: 'order has no pay_id' }
  const inq = await tetraInquiry(payId)
  if (!inq.ok) return { result: 'error', error: inq.error }
  if (!inq.paid) return { result: 'unpaid', payment_status: inq.payment_status }
  const billed = intval(order.price)
  if (inq.amount < billed) return { result: 'amount_mismatch', amount: inq.amount, billed }
  const before = String(order.payment_Status ?? '')
  const claim = await run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ${orderId} AND payment_Status <> 'paid'`)
  if (Number(claim?.rowsAffected ?? 0) < 1) return { result: 'already' }
  const info = { before, billed, pay_id: payId, order_id: orderId }
  try { await deliver(orderId) } catch (e) {
    console.error('tetraminator: delivery failed for', orderId, e)
    return { result: 'delivery_failed', error: String((e && e.message) || e), ...info }
  }
  return { result: 'paid', ...info }
}

/** cashback and the report-group notice after a successful settle */
export async function tetraAfterPaid(c, order, res) {
  const billed = intval(res.billed)
  const cash = intval((await pay('chashbacktetraminator')) ?? '0')
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
  const tpl = c.T.paymentGateway.reportTetraminator || '💵 پرداخت جدید\n- 👤 نام کاربری کاربر : @%s\n- 🆔 آیدی عددی کاربر : %s\n- 💸 مبلغ تراکنش %s\n- 🧾 شماره سفارش : %s\n- 🔗 شناسه پرداخت : %s\n- 💳 روش پرداخت : تترامینیتور'
  await send(sprintf(tpl, buyer?.username ?? '-', order.id_user, numberFormat(billed), res.order_id, res.pay_id))
  if (res.before === 'waiting') await send(`✅ تترامینیتور خودکار تأیید کرد؛ رسید دستی سفارش <code>${res.order_id}</code> دیگر نیاز به بررسی ندارد (سرویس فعال شد).`)
  else if (res.before === 'reject') await send(`⚠️ تترامینیتور پرداختی را تأیید کرد که قبلاً رد شده بود؛ مبلغ ${numberFormat(billed)} تومان برای کاربر <code>${order.id_user}</code> اعمال شد.\n🧾 سفارش: <code>${res.order_id}</code>`)
}
