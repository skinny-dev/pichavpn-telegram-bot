// ONE CLI-only diagnostics endpoint (the platform allows at most 100 modules per app, so the seven small admin_* endpoints live here as «tools»).
//   npx tgcloud run endpoints/admin_report '{"tool":"diag"}'   tools: diag, servers, channel_stats, support_export, activity, payments, tetra
// Each tool is the unchanged endpoint it replaces (admin_diag, admin_servers, admin_channel_stats, admin_support_export, admin_activity, admin_payments, admin_tetra); the Mini App can never call it.
import { EndpointError, fetch } from 'sdk'
import { all, kvGet, one, sql } from '../lib/db.js'
import { healthGet } from '../lib/gatehealth.js'
import { paychiBase, paychiCall, paychiKey } from '../lib/paychi.js'
import { USE_SERVICES, catalogGet, rankFor, syncHosts } from '../lib/servers.js'
import { tetraBase, tetraCall, tetraKey, tetraPickLink } from '../lib/tetraminator.js'
import { telegram } from '../lib/tg.js'
import { abortAfter, withTimeout } from '../lib/timer.js'

const TOOLS = {}

TOOLS.diag = (() => {
// Diagnostics from the CLI only (`npx tgcloud run endpoints/admin_diag '{}'`): how fast is the database from here, can this cloud reach
// the VPN panels, what is the cron state. Prints panel HOSTS only (never usernames, passwords or tokens).

async function main(input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const t0 = Date.now()
  const out = { runtime: { URL: typeof URL, URLSearchParams: typeof URLSearchParams, AbortSignal: typeof AbortSignal, setTimeout: typeof setTimeout, TextEncoder: typeof TextEncoder, atob: typeof atob, btoa: typeof btoa, TextDecoder: typeof TextDecoder, crypto: typeof crypto, subtle: typeof crypto === 'object' && crypto ? typeof crypto.subtle : 'n/a', getRandomValues: typeof crypto === 'object' && crypto ? typeof crypto.getRandomValues : 'n/a' }, db_ms: {}, panels: [], cron: {} }
  const q = async (label, f) => { const s = Date.now(); try { await f() ; out.db_ms[label] = Date.now() - s } catch (e) { out.db_ms[label] = 'ERR ' + String(e?.message ?? e).slice(0, 80) } }
  await q('one_query', () => one(sql`SELECT 1 AS x`))
  await q('ten_queries_in_a_row', async () => { for (let i = 0; i < 10; i++) await one(sql`SELECT 1 AS x`) })
  await q('count_user', () => one(sql`SELECT COUNT(*) AS n FROM user`))
  await q('all_products', () => all(sql`SELECT * FROM product`))
  await q('all_texts', () => all(sql`SELECT * FROM texts`))
  let panels = []
  try { panels = await all(sql`SELECT name_panel, status, url_panel, TestAccount, time_usertest, val_usertest FROM marzban_panel`) } catch (e) { out.panels_error = String(e?.message ?? e).slice(0, 80) }
  for (const p of panels) {
    const host = (/^[a-z]+:\/\/([^/\s]+)/i.exec(String(p.url_panel)) || [])[1] ?? '?' // the isolate has no URL class
    const s = Date.now()
    let result
    try {
      const opt = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(8000) } : {}
      const res = await fetch(String(p.url_panel).replace(/\/+$/, '') + '/api/system', { method: 'GET', ...opt })
      result = 'reachable: HTTP ' + res.status // any HTTP answer (even 401/404) means the network path works
    } catch (e) { result = 'NOT reachable: ' + String(e?.message ?? e).slice(0, 80) }
    out.panels.push({ name: p.name_panel, status: p.status, host, result, ms: Date.now() - s, test: { on: p.TestAccount === 'ONTestAccount', hours: Number(p.time_usertest) || 0, mb: Number(p.val_usertest) || 0 } })
  }
  for (const k of ['lock', 'payment_expire', 'tetraminator', 'relay', 'notifications', 'statusday', 'on_hold', 'alert_balance']) {
    try { out.cron[k] = (await kvGet('cron:' + k)) ?? null } catch { out.cron[k] = 'ERR' }
  }
  // payment gateways, as seen from this cloud (no invoice is created; an unknown id only tells whether the call gets through)
  out.gateways = {}
  try {
    const s = Date.now()
    const r = await tetraCall('GET', '/payment/inquiry/diagprobe', null, 12000)
    out.gateways.tetraminator = { key_set: (await tetraKey()) !== '', base: await tetraBase(), http: r.http, error: r.error, ms: Date.now() - s }
  } catch (e) { out.gateways.tetraminator = { threw: String(e?.message ?? e).slice(0, 100) } }
  try {
    // a real (tiny) create: the answer tells exactly why the customer sees «method unavailable» (code/message), if it does. It expires by itself.
    const s = Date.now()
    const r = await paychiCall('POST', '/api/v1/transactions', { amount: 200000, order_id: 'diag' + Date.now().toString(36), description: 'diag', ttl: 300 }, 12000)
    const until = Number((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = 'paychi_pause_until'`))?.ValuePay ?? 0)
    out.gateways.paychi = { key_set: (await paychiKey()) !== '', base: await paychiBase(), http: r.http, ok: r.http === 201, code: r.data?.error?.code ?? null, message: String(r.data?.error?.message ?? '').slice(0, 160) || null, error: r.error || null, paused_for_s: Math.max(0, until - Math.floor(Date.now() / 1000)), ms: Date.now() - s }
  } catch (e) { out.gateways.paychi = { threw: String(e?.message ?? e).slice(0, 100) } }
  try {
    const relay = String((await kvGet('config:pay_relay_url')) || '').replace(/\/+$/, '')
    out.gateways.relay = { set: relay !== '', host: (/^[a-z]+:\/\/([^/\s]+)/i.exec(relay) || [])[1] ?? null }
    if (relay) {
      const s = Date.now()
      try { const res = await fetch(relay + '/pull', { method: 'GET' }); out.gateways.relay.http = res.status } catch (e) { out.gateways.relay.error = String(e?.message ?? e).slice(0, 80) }
      out.gateways.relay.ms = Date.now() - s
    }
  } catch (e) { out.gateways.relay = { threw: String(e?.message ?? e).slice(0, 100) } }
  try { out.mode = await kvGet('config:mode') } catch { out.mode = 'ERR' }
  out.total_ms = Date.now() - t0
  return out
}
  return main
})()

TOOLS.servers = (() => {
// The server catalog from the panels (CLI only):  npx tgcloud run endpoints/admin_servers '{"sync":true}'
// Prints names / country / kind only — never addresses, ports' hosts, keys or user ids.

async function main(input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const synced = input?.sync ? await syncHosts() : null
  const cat = await catalogGet()
  const best = {}
  for (const u of Object.keys(USE_SERVICES)) best[u] = (await rankFor(u)).slice(0, 3).map((x) => `${x.name} ${x.score}`)
  return { synced, servers: cat.map((s) => ({ name: s.name, country: s.country, kind: s.kind, security: s.security })), best }
}
  return main
})()

TOOLS.channel_stats = (() => {
// Channel health numbers from the CLI only (`npx tgcloud run endpoints/admin_channel_stats '{}'`): members of the forced channel(s) against bot users,
// how many bot users came in per period. Counts only — no user ids, names or channel links.

const num = async (q) => Number((await one(q))?.n ?? 0)

async function main(input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const now = Math.floor(Date.now() / 1000)
  const since = (d) => now - d * 86400
  const users = await num(sql`SELECT COUNT(*) AS n FROM user`)
  const joined = await num(sql`SELECT COUNT(*) AS n FROM user WHERE joinchannel = 'active'`)
  const reg = async (d) => num(sql`SELECT COUNT(*) AS n FROM user WHERE CAST(register AS INTEGER) >= ${since(d)}`)
  const buyers = await num(sql`SELECT COUNT(DISTINCT id_user) AS n FROM Payment_report WHERE payment_Status = 'paid'`)
  const chans = (await all(sql`SELECT link FROM channels`)).map((r) => r.link).filter((l) => l && String(l).trim() !== '' && String(l).trim() !== '0')
  const channels = []
  for (const link of chans) {
    const r = await telegram('getChatMemberCount', { chat_id: link }).catch(() => null)
    channels.push({ members: r && r.ok ? r.result : null })
  }
  const members = channels.reduce((a, c) => a + (c.members ?? 0), 0)
  return {
    bot_users: users, joined_forced_channel: joined, ever_paid: buyers,
    new_users: { d7: await reg(7), d30: await reg(30), d90: await reg(90) },
    forced_channels: channels,
    reading: channels.length === 1 && channels[0].members ? { channel_members: channels[0].members, bot_users_in_channel_est: joined, others_est: Math.max(0, channels[0].members - joined) } : null,
  }
}
  return main
})()

TOOLS.support_export = (() => {
// Anonymised support conversations for designing the AI support agent (CLI only):
//   npx tgcloud run endpoints/admin_support_export '{"limit":60}'
// Shows customer text → the answer a human gave, with numbers / links / @names / ids blanked. Nothing identifies a customer.

const clean = (v) => String(v ?? '')
  .replace(/https?:\/\/\S+/gi, '<لینک>')
  .replace(/(vless|vmess|trojan|ss):\/\/\S+/gi, '<کانفیگ>')
  .replace(/@[A-Za-z0-9_]{3,}/g, '@<نام>')
  .replace(/\b09\d{9}\b/g, '<تلفن>')
  .replace(/\b\d{16}\b/g, '<کارت>')
  .replace(/[0-9۰-۹٠-٩]{6,}/g, '<عدد>')
  .replace(/\s+/g, ' ').trim().slice(0, 400)

async function main(input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const limit = Math.min(Math.max(parseInt(input?.limit) || 40, 1), 150)
  const rows = await all(sql`SELECT name_departman AS dept, text, result, status FROM support_message WHERE text IS NOT NULL AND text <> '' ORDER BY id DESC LIMIT ${limit * 3}`)
  const answered = rows.filter((r) => String(r.result ?? '').trim() !== '' && r.result !== '0').slice(0, limit)
  const depts = {}
  for (const r of rows) depts[r.dept] = (depts[r.dept] ?? 0) + 1
  return { scanned: rows.length, answered: answered.length, by_department: depts, samples: answered.map((r) => ({ dept: r.dept, q: clean(r.text), a: clean(r.result) })) }
}
  return main
})()

TOOLS.activity = (() => {
// Is the bot recording? (CLI only)  npx tgcloud run endpoints/admin_activity '{}'
// Counts only — per day for the last 8 days (Tehran): new users, invoices, payment reports by status. No names, ids or amounts of people.

const p2 = (n) => String(n).padStart(2, '0')
const tehranDay = (t) => { const d = new Date((t + 12600) * 1000); return `${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}` }
const tehranStamp = (t) => { const d = new Date((t + 12600) * 1000); return `${tehranDay(t)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` }

async function main(input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const now = Math.floor(Date.now() / 1000)
  const days = Array.from({ length: 8 }, (_, i) => tehranDay(now - i * 86400))
  const out = { now_tehran: tehranStamp(now), mode: await kvGet('config:mode'), days: {} }
  for (const d of days) out.days[d] = { users: 0, invoices: 0, payments: {} }
  const since = now - 9 * 86400
  for (const r of await all(sql`SELECT CAST(register AS INTEGER) AS t FROM user WHERE CAST(register AS INTEGER) > ${since}`)) { const k = tehranDay(r.t); if (out.days[k]) out.days[k].users++ }
  for (const r of await all(sql`SELECT CAST(time_sell AS INTEGER) AS t FROM invoice WHERE CAST(time_sell AS INTEGER) > ${since}`)) { const k = tehranDay(r.t); if (out.days[k]) out.days[k].invoices++ }
  for (const r of await all(sql`SELECT substr(time, 1, 10) AS d, payment_Status AS s, COUNT(*) AS n FROM Payment_report WHERE substr(time, 1, 10) >= ${days[days.length - 1]} GROUP BY 1, 2`)) { if (out.days[r.d]) out.days[r.d].payments[r.s || '?'] = r.n }
  const last = async (q) => { const t = Number((await one(q))?.t ?? 0); return t ? tehranStamp(t) : null }
  out.last = {
    user: await last(sql`SELECT MAX(CAST(register AS INTEGER)) AS t FROM user`),
    invoice: await last(sql`SELECT MAX(CAST(time_sell AS INTEGER)) AS t FROM invoice`),
    last_message_from_any_user: await last(sql`SELECT MAX(CAST(last_message_time AS INTEGER)) AS t FROM user`),
  }
  out.cron = {}
  for (const k of ['relay', 'notifications', 'care', 'pulse', 'studio']) { const v = Number(await kvGet('cron:' + k)); out.cron[k] = v ? tehranStamp(v) : null }
  return out
}
  return main
})()

TOOLS.payments = (() => {
// Why is a payment not confirmed / no receipt reaching the administrators? (CLI only)   npx tgcloud run endpoints/admin_payments '{}'
// Read-only. Shows the last payments with their status and age, the relay (last pull, what is waiting in its queue), the cron jobs,
// the gateway health, the settings that decide who gets a receipt. No names, no user ids, no card numbers; order ids are cut to 4 characters.

const now = () => Math.floor(Date.now() / 1000)
// Payment_report.time is 'YYYY/MM/DD HH:MM:SS' in Tehran (or unix seconds)
const tsOf = (s) => { s = String(s ?? ''); if (/^\d{9,}$/.test(s)) return Number(s); const m = /^(\d{4})[/-](\d{2})[/-](\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - 12600 : 0 }
const pay = async (k) => String((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay ?? '')

async function main(input, ctx) {
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
  return main
})()

TOOLS.tetra = (() => {
// Evidence for Tetraminator's support (CLI only):   npx tgcloud run endpoints/admin_tetra '{}'          the recent orders and what Tetraminator itself says about each
//                                                    npx tgcloud run endpoints/admin_tetra '{"create":true}'   also ONE test invoice (50,000 toman, nobody pays it): shows creation errors
// Read-only apart from that test invoice. No API key, no user ids, no names: only order ids (ours, cut), Tetraminator's own pay_id, amounts, statuses, ages.

const now = () => Math.floor(Date.now() / 1000)
const tsOf = (s) => { s = String(s ?? ''); if (/^\d{9,}$/.test(s)) return Number(s); const m = /^(\d{4})[/-](\d{2})[/-](\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - 12600 : 0 }
const pay = async (k) => String((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay ?? '')
const host = (u) => (/^[a-z]+:\/\/([^/\s]+)/i.exec(String(u)) || [])[1] ?? ''
const cut = (v, n = 160) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n)

async function main(input, ctx) {
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
  return main
})()

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const fn = TOOLS[String(input?.tool ?? '')]
  if (!fn) return { tools: Object.keys(TOOLS), usage: `npx tgcloud run endpoints/admin_report '{"tool":"<one of tools>"}'` }
  return fn(input, ctx)
}
