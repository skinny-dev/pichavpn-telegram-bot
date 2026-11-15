// Why is a payment not confirmed / no receipt reaching the administrators? (CLI only)   npx tgcloud run endpoints/admin_payments '{}'
// Read-only. Shows the last payments with their status and age, the relay (last pull, what is waiting in its queue), the cron jobs,
// the gateway health, the settings that decide who gets a receipt. No names, no user ids, no card numbers; order ids are cut to 4 characters.
import { EndpointError, fetch } from 'sdk'
import { all, one, sql, kvGet } from '../lib/db.js'
import { healthGet } from '../lib/gatehealth.js'
import { withTimeout, abortAfter } from '../lib/timer.js'

const now = () => Math.floor(Date.now() / 1000)
// Payment_report.time is 'YYYY/MM/DD HH:MM:SS' in Tehran (or unix seconds)
const tsOf = (s) => { s = String(s ?? ''); if (/^\d{9,}$/.test(s)) return Number(s); const m = /^(\d{4})[/-](\d{2})[/-](\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - 12600 : 0 }
const pay = async (k) => String((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay ?? '')

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const t = now(), out = { now_unix: t, mode: await kvGet('config:mode') }
  const rows = await all(sql`SELECT id_order, time, price, Payment_Method AS m, payment_Status AS s, id_invoice FROM Payment_report ORDER BY id DESC LIMIT 15`)
  out.last_payments = rows.map((r) => ({ order: String(r.id_order ?? '').slice(0, 4) + '…', age_min: Math.round((t - tsOf(r.time)) / 60), method: r.m, status: r.s, toman_k: Math.round(Number(r.price) / 1000), kind: String(r.id_invoice ?? '').split('|')[0].slice(0, 22) }))
  const since = new Date((t - 86400 + 12600) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/')
  out.last_24h = (await all(sql`SELECT Payment_Method AS m, payment_Status AS s, COUNT(*) AS n FROM Payment_report WHERE time >= ${since} GROUP BY 1, 2 ORDER BY 1, 2`)).map((r) => `${r.m}/${r.s}=${r.n}`)
  out.waiting_rows = (await all(sql`SELECT id_order, time, Payment_Method AS m, id_invoice FROM Payment_report WHERE payment_Status = 'waiting' ORDER BY id DESC LIMIT 12`)).map((r) => ({ order: String(r.id_order ?? '').slice(0, 4) + '…', age_min: Math.round((t - tsOf(r.time)) / 60), method: r.m, kind: String(r.id_invoice ?? '').split('|')[0].slice(0, 22) }))
  out.stuck_waiting = Number((await one(sql`SELECT COUNT(*) AS n FROM Payment_report WHERE payment_Status = 'waiting'`)).n)
  out.stuck_unpaid_last_6h = (await all(sql`SELECT Payment_Method AS m, time FROM Payment_report WHERE payment_Status = 'Unpaid' ORDER BY id DESC LIMIT 60`)).filter((r) => t - tsOf(r.time) < 6 * 3600).length

  const url = String((await kvGet('config:pay_relay_url')) || '').replace(/\/+$/, ''), key = String((await kvGet('config:pay_relay_key')) || '')
  const after = Number(await kvGet('relay:after')) || 0, lastPull = Number(await kvGet('relay:last_pull')) || 0
  out.relay = { url_set: !!url, key_set: !!key, last_pull_age_s: lastPull ? t - lastPull : null, after, epoch: (await kvGet('relay:epoch')) ?? null, peek_all: !!input?.peek_all }
  if (url && key) {
    try {
      const res = await withTimeout(fetch(`${url}/pull?after=${input?.peek_all ? 0 : after}`, { headers: { 'X-Relay-Key': key, Accept: 'application/json' }, ...abortAfter(10000) }), 10000)
      const d = JSON.parse(await res.text())
      out.relay.peek = { http: res.status, waiting: (d.events || []).filter((e) => input?.peek_all || Number(e.seq) > after).map((e) => ({ seq: e.seq, type: e.type, age_s: e.ts ? t - Number(e.ts) : null })).slice(0, 15) }
    } catch (e) { out.relay.peek = { error: String((e && e.message) || e).slice(0, 80) } }
  }
  const JOBS = ['broadcast', 'tetraminator', 'paychi', 'care', 'pulse', 'servers', 'studio', 'events', 'gatehealth', 'partners', 'notifications', 'configtest', 'payment_expire', 'alert_balance', 'on_hold', 'statusday', 'optimize_order', 'expireagent']
  out.cron = { lock_age_s: Number(await kvGet('cron:lock')) ? t - Number(await kvGet('cron:lock')) : 0, off: (await kvGet('cron:off')) === '1' }
  for (const j of JOBS) { const v = Number(await kvGet('cron:' + j)); out.cron[j] = v ? t - v : null } // seconds since the last run
  out.gate_health = await healthGet()
  out.settings = {
    Cartstatus: await pay('Cartstatus'), smsautoconfirm: await pay('smsautoconfirm'), variza: await pay('variza_status'), paychi: await pay('paychi_status'), tetraminator: await pay('tetraminator_status'),
    cards: Number((await one(sql`SELECT COUNT(*) AS n FROM card_number`)).n), admins: (await all(sql`SELECT rule, COUNT(*) AS n FROM admin GROUP BY rule`)).map((r) => `${r.rule}=${r.n}`),
    report_channel_set: String((await one(sql`SELECT Channel_Report AS v FROM setting LIMIT 1`))?.v ?? '').length > 0,
  }
  return out
}
