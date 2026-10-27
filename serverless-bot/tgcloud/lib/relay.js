// The payment relay (pasarguard/pay_relay on the PasarGuard server) keeps what Variza and the SMS forwarder push.
// The bot pulls it: at most every RELAY_EVERY seconds on any update, and at once when a customer presses «I paid».
// Every event is checked here with the bot's own secrets (Variza signature, forwarder token) before anything is paid.
import { fetch } from 'sdk'
import { one, run, sql, kvGet, kvSet } from './db.js'
import { telegram, sendmessage } from './tg.js'
import { buildKeyboards } from './keyboards.js'
import { directPayment } from './directpay.js'
import { smsProcessText } from './sms.js'
import { sprintf, numberFormat, intval } from './php.js'

const RELAY_EVERY = 20
const pay = async (name) => (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${name}`))?.ValuePay ?? null
const now = () => Math.floor(Date.now() / 1000)

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

/** a context for payments confirmed outside any admin action: no admin message to edit, the customer's keyboard */
function neutral(c) {
  return { ...c, from_id: '', message_id: 0, keyboard: buildKeyboards({ T: c.T, setting: c.setting, users: null, adminRow: null }).keyboard }
}
async function report(c, text) {
  if (String(c.setting.Channel_Report ?? '').length === 0) return
  const topic = c.topicsAll?.paymentreport ?? null
  await telegram('sendmessage', { chat_id: c.setting.Channel_Report, text, parse_mode: 'HTML', ...(topic ? { message_thread_id: topic } : {}) })
}

/** payment/variza_webhook.php */
async function onVariza(c, ev) {
  const secret = String((await pay('variza_webhook_secret')) ?? '').trim()
  if (secret === '' || secret === '0') return 'not configured'
  let sig = String(ev.headers?.['x-webhook-signature'] ?? '')
  if (sig.startsWith('sha256=')) sig = sig.slice(7)
  if (!same(await hmacHex(secret, String(ev.body ?? '')), sig)) return 'invalid signature'
  let d = null
  try { d = JSON.parse(ev.body) } catch { d = null }
  if (!d || typeof d !== 'object') return 'invalid json'
  if ((d.event ?? '') !== 'payment.paid') return 'ignored'
  const slug = String(d.slug ?? '')
  if (slug === '') return 'missing slug'
  const o = (await one(sql`SELECT * FROM Payment_report WHERE dec_not_confirmed = ${slug}`)) || (await one(sql`SELECT * FROM Payment_report WHERE id_invoice = ${slug}`))
  if (!o) return 'order not found'
  if (o.payment_Status === 'paid') return 'already paid'
  const billed = intval(o.price)
  if (intval(d.amount) < billed) return 'amount mismatch'
  const claim = await run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ${o.id_order} AND payment_Status <> 'paid'`)
  if (Number(claim?.rowsAffected ?? 0) === 0) return 'already claimed'
  const cc = neutral(c)
  await directPayment(cc, o.id_order)
  const cash = intval((await pay('chashbackvariza')) ?? '0')
  if (cash > 0) {
    const u = await one(sql`SELECT * FROM user WHERE id = ${String(o.id_user)}`)
    const reward = Math.trunc((billed * cash) / 100)
    if (u && reward > 0) {
      await run(sql`UPDATE user SET Balance = ${intval(u.Balance) + reward} WHERE id = ${u.id}`)
      await sendmessage(u.id, sprintf(c.T.paymentGateway.giftReport, reward), null, 'HTML')
    }
  }
  if (c.topicsAll?.paymentreport) {
    const u = (await one(sql`SELECT username FROM user WHERE id = ${String(o.id_user)}`)) || {}
    await report(c, sprintf(c.T.paymentGateway.reportVariza, u.username ?? '-', o.id_user, numberFormat(billed), o.id_order, slug))
  }
  return 'paid'
}

/** smsExtractPayload() + payment/sms_webhook.php */
async function onSms(c, ev) {
  const flat = {}
  let data = null
  try { data = JSON.parse(ev.body) } catch { data = null }
  const src = data && typeof data === 'object' ? data : ev.post && typeof ev.post === 'object' ? ev.post : {}
  const walk = (v, k = '') => { if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk.toLowerCase()); else if (k !== '') flat[k] = String(v ?? '') }
  walk(src)
  const pick = (keys) => { for (const k of keys) if (flat[k] !== undefined && flat[k] !== '') return flat[k]; return '' }
  let token = '', bank = '', text = ''
  for (const [k, v] of Object.entries(flat)) {
    const m = /^([a-z0-9]{16,})_([a-z0-9]{2,20})$/.exec(k)
    if (m && v !== '') { token = m[1]; bank = m[2]; text = v; break }
  }
  if (text === '') text = pick(['text', 'message', 'body', 'sms', 'content', 'msg', 'notification', 'big_text', 'title'])
  if (text === '' && !(data && typeof data === 'object') && !(ev.post && Object.keys(ev.post).length)) text = String(ev.body ?? '').trim()
  const title = flat.title ?? ''
  if (text !== '' && title !== '' && title !== text && !text.includes(title)) text = title + '\n' + text
  if (bank === '') bank = pick(['bank', 'bank_code', 'bankcode', 'code']).toLowerCase()
  if (token === '') {
    for (const h of ['authorization', 'x-admin-token', 'x-token', 'x-api-key']) if (ev.headers?.[h]) { token = String(ev.headers[h]).replace(/^Bearer\s+/i, '').trim(); break }
  }
  if (token === '') token = pick(['token', 'admin_token', 'admintoken']) || String(ev.query?.token ?? '')
  const expected = String((await pay('sms_webhook_token')) ?? '')
  if (expected === '' || token === '' || !same(expected, token)) return 'unauthorized'
  if (text === '') return 'no text'
  if ((await pay('smsautoconfirm')) !== 'onsms') return 'disabled'
  const res = await smsProcessText(neutral(c), text, bank)
  for (const r of res) {
    if (['unmatched', 'ambiguous', 'review'].includes(r.status)) {
      const amt = intval(r.amount_rial)
      if (amt > 0) {
        const why = { unmatched: 'سفارش بازی با این مبلغ پیدا نشد', ambiguous: 'چند سفارش هم‌مبلغ وجود دارد', review: 'نیاز به بررسی دستی' }[r.status]
        await report(c, `⚠️ واریز بانکی بدون تطبیق\n💰 ${numberFormat(Math.floor(amt / 10))} تومان\n❗️ ${why}`)
      }
    }
  }
  return res.map((r) => r.status).join(',')
}

/** pull and apply the relay's new events; force = right now (a customer pressed «I paid») */
export async function pullRelay(c, force = false) {
  const url = String((await kvGet('config:pay_relay_url')) || '').replace(/\/+$/, '')
  const key = String((await kvGet('config:pay_relay_key')) || '')
  if (!url || !key) return
  if (!force && now() - intval(await kvGet('relay:last_pull')) < RELAY_EVERY) return
  await kvSet('relay:last_pull', String(now()))
  let after = intval(await kvGet('relay:after'))
  let events = []
  try {
    const res = await fetch(`${url}/pull?after=${after}&ack=${after}`, { headers: { 'X-Relay-Key': key, Accept: 'application/json' } })
    const d = JSON.parse(await res.text())
    events = Array.isArray(d?.events) ? d.events : []
  } catch (e) {
    console.error('relay pull', e)
    return false
  }
  for (const ev of events.sort((a, b) => a.seq - b.seq)) {
    if (intval(ev.seq) <= after) continue
    // move the pointer first: an event that throws is not tried again for ever
    after = intval(ev.seq)
    await kvSet('relay:after', String(after))
    try {
      const r = ev.type === 'variza' ? await onVariza(c, ev) : ev.type === 'sms' ? await onSms(c, ev) : 'unknown'
      console.log('relay', ev.seq, ev.type, r)
    } catch (e) {
      console.error('relay event', ev.seq, e)
    }
  }
  return true
}
