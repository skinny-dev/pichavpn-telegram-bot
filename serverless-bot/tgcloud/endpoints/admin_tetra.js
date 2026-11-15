// Evidence for Tetraminator's support (CLI only):   npx tgcloud run endpoints/admin_tetra '{}'          the recent orders and what Tetraminator itself says about each
//                                                    npx tgcloud run endpoints/admin_tetra '{"create":true}'   also ONE test invoice (50,000 toman, nobody pays it): shows creation errors
// Read-only apart from that test invoice. No API key, no user ids, no names: only order ids (ours, cut), Tetraminator's own pay_id, amounts, statuses, ages.
import { EndpointError } from 'sdk'
import { all, one, sql, kvGet } from '../lib/db.js'
import { tetraCall, tetraBase, tetraKey, tetraPickLink } from '../lib/tetraminator.js'

const now = () => Math.floor(Date.now() / 1000)
const tsOf = (s) => { s = String(s ?? ''); if (/^\d{9,}$/.test(s)) return Number(s); const m = /^(\d{4})[/-](\d{2})[/-](\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - 12600 : 0 }
const pay = async (k) => String((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay ?? '')
const host = (u) => (/^[a-z]+:\/\/([^/\s]+)/i.exec(String(u)) || [])[1] ?? ''
const cut = (v, n = 160) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n)

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const t = now(), out = { now_unix: t }
  const relay = String((await kvGet('config:pay_relay_url')) || '').replace(/\/+$/, '')
  out.config = { base: await tetraBase(), key_set: (await tetraKey()) !== '', enabled: (await pay('tetraminator_status')) === 'ontetraminator', link_mode: (await pay('tetraminator_link_mode')) || 'gateway', callback_host: host(relay), callback_path: '/tetraminator?order_id=<our order id>' }

  const rows = await all(sql`SELECT id_order, time, price, payment_Status AS s, dec_not_confirmed AS pay_id FROM Payment_report WHERE Payment_Method = 'tetraminator' ORDER BY id DESC LIMIT ${Math.min(Number(input?.limit) || 15, 30)}`)
  out.orders = []
  const tally = {}
  for (const r of rows) {
    const o = { order: String(r.id_order).slice(0, 6), pay_id: String(r.pay_id ?? ''), age_min: Math.round((t - tsOf(r.time)) / 60), ours: r.s, toman: Number(r.price) }
    if (o.pay_id) {
      const q = await tetraCall('GET', '/payment/inquiry/' + encodeURIComponent(o.pay_id), null, 10000)
      const d = q.data || {}
      o.remote = { http: q.http, status: d.status ?? null, payment_status: d.payment_status ?? null, amount: d.amount ?? null, message: cut(d.message, 120) || undefined, error: q.error || undefined }
      const key = `${r.s} → remote ${o.remote.http === 200 ? d.payment_status ?? '?' : 'http ' + o.remote.http}`
      tally[key] = (tally[key] || 0) + 1
      if (o.remote.http === 200 && d.payment_status === 'paid' && r.s !== 'paid') o.NEEDS_CONFIRMATION = true // Tetraminator says paid, we did not credit it
      if (o.remote.http === 200 && d.payment_status === 'paid' && Number(d.amount) !== Number(r.price)) o.amount_differs = { ours: Number(r.price), remote: Number(d.amount) }
    } else o.remote = 'no pay_id (the invoice was never created at Tetraminator)'
    out.orders.push(o)
  }
  out.summary = tally
  out.needs_confirmation = out.orders.filter((o) => o.NEEDS_CONFIRMATION).map((o) => ({ order: o.order, pay_id: o.pay_id, toman: o.toman, age_min: o.age_min }))

  if (input?.create) { // one real invoice, never paid; its callback hits the relay with an order id nobody knows (ignored)
    const id = 'diag' + t.toString(36)
    const cb = relay ? `${relay}/tetraminator?order_id=${id}` : ''
    const r = await tetraCall('POST', '/invoice/create', { price: 50000, callback_url: cb }, 20000)
    const d = r.data || {}
    out.create_test = { http: r.http, status: d.status ?? null, message: cut(d.message), pay_id: d.pay_id ?? null, link_host: host(tetraPickLink(d, 'gateway')), keys_in_answer: Object.keys(d).slice(0, 12), error: r.error || undefined, sent_callback_host: host(cb) }
  }
  out.how_to_read = 'ours/remote: «Unpaid → remote paid» = the customer paid at Tetraminator and we never credited it (NEEDS_CONFIRMATION: confirm by hand, then send these pay_ids to support). «Unpaid → remote pending/expired» = the customer did not pay. «no pay_id» = the invoice could not be created.'
  return out
}
