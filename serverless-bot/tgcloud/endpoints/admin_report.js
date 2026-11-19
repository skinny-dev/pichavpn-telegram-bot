// ONE CLI-only diagnostics endpoint (the platform allows at most 100 modules per app, so the seven small admin_* endpoints live here as «tools»).
//   npx tgcloud run endpoints/admin_report '{"tool":"diag"}'   tools: diag, servers, channel_stats, support_export, activity, payments, tetra
// Each tool is the unchanged endpoint it replaces (admin_diag, admin_servers, admin_channel_stats, admin_support_export, admin_activity, admin_payments, admin_tetra); the Mini App can never call it.
import { EndpointError, fetch } from 'sdk'
import { systemContext } from '../lib/bot.js' // first: bot.js and the routes import each other and only load in this order
import { broadcastTick } from '../lib/broadcast.js'
import { dataUser } from '../lib/panel.js'
import { all, kvGet, kvSet, one, run, sql } from '../lib/db.js'
import { productName, hasNameTokens } from '../lib/php.js'
import { healthGet } from '../lib/gatehealth.js'
import { paychiBase, paychiCall, paychiKey } from '../lib/paychi.js'
import { USE_SERVICES, catalogGet, rankFor, syncHosts } from '../lib/servers.js'
import { tetraBase, tetraCall, tetraKey, tetraPickLink } from '../lib/tetraminator.js'
import { telegram, emojiUnblock } from '../lib/tg.js'
import { emojiConfig, resetEmojiCache, emojiImport, emojiProbe } from '../lib/emoji.js'
import { loadTexts } from '../lib/texts.js'
import { route as studioRoute } from '../lib/panelapi/studio.js'
import { postsGet, settingsGet, wantsChannel, wantsBot } from '../lib/studio.js'
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

TOOLS.renewals = (() => {
  // How was this customer's time changed? (their last renewals: the end date before it, the days of the plan, the days they had left)
  const tsOf = (s) => { s = String(s ?? ''); if (/^\d{9,}$/.test(s)) return Number(s); const m = /^(\d{4})[/-](\d{2})[/-](\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - 12600 : 0 }
  async function main(input, ctx) {
    if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
    const user = String(input?.user ?? '').replace(/\D/g, '')
    if (!user) return { usage: `npx tgcloud run endpoints/admin_report '{"tool":"renewals","user":"<numeric telegram id>"}'` }
    const rows = await all(sql`SELECT username, value, time, price, status FROM service_other WHERE id_user = ${user} AND type = 'extend_user' ORDER BY id DESC LIMIT 6`)
    const method = (await one(sql`SELECT Methodextend FROM marzban_panel WHERE status = 'active' LIMIT 1`))?.Methodextend ?? null
    const t = Math.floor(Date.now() / 1000)
    const out = []
    for (const r of rows) {
      let v = {}; try { v = JSON.parse(r.value) || {} } catch { v = {} }
      const at = tsOf(r.time), old = Number(v.oldtime) || 0
      const row = { when_tehran: String(r.time), service: String(r.username), status: r.status, plan_days: Number(v.Service_time), plan_gb: Number(v.volumebuy), days_left_before: old ? Math.round((old - at) / 86400 * 10) / 10 : null, end_before: old ? new Date((old + 12600) * 1000).toISOString().slice(0, 16).replace('T', ' ') : null, toman_k: Math.round(Number(r.price) / 1000) }
      if (out.length < 3 && old > at) { // what the panel says NOW, and how many days are missing against the end date before the renewal (read-only)
        try {
          const inv = await one(sql`SELECT Service_location FROM invoice WHERE username = ${r.username}`)
          const du = inv ? await dataUser(inv.Service_location, r.username) : null
          const now = Number(du?.expire || 0)
          if (du && du.status !== 'Unsuccessful') { row.end_now = now ? new Date((now + 12600) * 1000).toISOString().slice(0, 16).replace('T', ' ') : 'unlimited'; row.days_left_now = now ? Math.round((now - t) / 86400 * 10) / 10 : null; row.missing_days = now && old > now ? Math.ceil((old - now) / 86400) : 0 }
          else row.end_now = 'panel unreachable: ' + String(du?.msg ?? 'no invoice').slice(0, 60)
        } catch (e) { row.end_now = 'error: ' + String(e?.message ?? e).slice(0, 60) }
      }
      out.push(row)
    }
    return { user_renewals: out, fix: 'if missing_days > 0: Mini App → سفارشات → this service → «زمان اضافه» → days = missing_days (tick «اطلاع به کاربر» if you want him told)', panel_renewal_method: method, how_to_read: 'days_left_before = how many days the customer had left when they renewed; plan_days = what the plan gave. With the reset method the end date becomes now + plan_days (the old days are dropped).' }
  }
  return main
})()

TOOLS.customer = (() => {
  // Everything about one customer's services, in one place (read-only): his services and what they were bought as, every change of time/volume, his recent payments,
  // and what the VPN panel says about his services right now.
  const tsOf = (s) => { s = String(s ?? ''); if (/^\d{9,}$/.test(s)) return Number(s); const m = /^(\d{4})[/-](\d{2})[/-](\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - 12600 : 0 }
  const fmt = (t) => (t ? new Date((t + 12600) * 1000).toISOString().slice(0, 16).replace('T', ' ') : null)
  async function main(input, ctx) {
    if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
    const user = String(input?.user ?? '').replace(/\D/g, '')
    if (!user) return { usage: `npx tgcloud run endpoints/admin_report '{"tool":"customer","user":"<numeric telegram id>"}'` }
    const t = Math.floor(Date.now() / 1000)
    const u = await one(sql`SELECT id, username, agent, Balance, register, limit_usertest FROM user WHERE id = ${user}`)
    const invs = await all(sql`SELECT username, name_product, Service_time, Volume, price_product, time_sell, Status, Service_location, note FROM invoice WHERE id_user = ${user} ORDER BY CAST(time_sell AS INTEGER) DESC LIMIT 8`)
    const other = await all(sql`SELECT username, type, value, time, price, status FROM service_other WHERE id_user = ${user} ORDER BY id DESC LIMIT 10`)
    const pays = await all(sql`SELECT time, price, Payment_Method AS m, payment_Status AS s, id_invoice FROM Payment_report WHERE id_user = ${user} ORDER BY id DESC LIMIT 8`)
    const out = { found: !!u, user: u ? { agent: u.agent, balance: Number(u.Balance), registered: fmt(Number(u.register)), tests_used: u.limit_usertest } : null }
    out.services = []
    for (const i of invs) {
      const row = { service: i.username, product: i.name_product, plan_days: Number(i.Service_time), plan_gb: Number(i.Volume), bought: fmt(Number(i.time_sell)), toman_k: Math.round(Number(i.price_product) / 1000), status: i.Status, panel: i.Service_location }
      if (out.services.length < 3 && !/تست/.test(String(i.name_product))) {
        try {
          const du = await dataUser(i.Service_location, i.username)
          if (du && du.status !== 'Unsuccessful') { const ex = Number(du.expire || 0); row.panel_now = { end: ex ? fmt(ex) : 'unlimited', days_left: ex ? Math.round((ex - t) / 86400 * 10) / 10 : null, status: du.status, used_gb: Math.round(Number(du.used_traffic || 0) / 1073741824 * 10) / 10, limit_gb: Math.round(Number(du.data_limit || 0) / 1073741824 * 10) / 10 } }
          else row.panel_now = 'unreachable: ' + String(du?.msg ?? '').slice(0, 60)
        } catch (e) { row.panel_now = 'error: ' + String(e?.message ?? e).slice(0, 60) }
      }
      out.services.push(row)
    }
    out.changes = other.map((r) => { let v = {}; try { v = JSON.parse(r.value) || {} } catch { v = {} } return { when: String(r.time), type: r.type, service: r.username, status: r.status, toman_k: Math.round(Number(r.price) / 1000), days: v.Service_time ?? v.time_value ?? v.time ?? undefined, gb: v.volumebuy ?? v.volume ?? undefined, end_before: v.oldtime ? fmt(Number(v.oldtime)) : v.expire_old ? fmt(Number(v.expire_old)) : undefined } })
    out.payments = pays.map((r) => ({ when: String(r.time), method: r.m, status: r.s, toman_k: Math.round(Number(r.price) / 1000), kind: String(r.id_invoice ?? '').split('|')[0].slice(0, 22) }))
    out.how_to_read = 'services = what he bought (plan_days is what the PRODUCT gave); panel_now = the real end date at the VPN panel; changes = renewals / extra time / extra volume; payments = what he paid.'
    return out
  }
  return main
})()

TOOLS.partner_ready = (() => {
  // Can a new partner (agent) really work today? Read-only checklist: the partner price list, the request button, bulk buying, the number of partners, the tiers.
  async function main(input, ctx) {
    if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
    const out = { checks: [] }
    const add = (name, ok, detail) => out.checks.push({ ok: ok === null ? 'check' : ok ? 'OK' : 'MISSING', name, detail })
    const byAgent = await all(sql`SELECT agent, COUNT(*) AS n FROM product GROUP BY agent`)
    const count = (a) => Number(byAgent.find((r) => String(r.agent) === a)?.n ?? 0)
    out.products_by_agent = Object.fromEntries(byAgent.map((r) => [String(r.agent) || '(empty)', Number(r.n)]))
    add('a PARTNER price list exists (products with agent «n»)', count('n') > 0, `${count('n')} plans for partners, ${count('f')} for customers` + (count('n') === 0 ? ' — a partner would see NO plans to buy' : ''))
    add('an ADVANCED partner (n2, credit) price list exists, or n2 is not offered', count('n2') > 0 ? true : null, `${count('n2')} plans for n2`)
    const set = (await one(sql`SELECT bulkbuy, agentreqprice, keyboardmain FROM setting LIMIT 1`)) || {}
    let btn = false; try { const k = JSON.parse(set.keyboardmain).keyboard; for (const row of Array.isArray(k) ? k : Object.values(k || {})) for (const b of Array.isArray(row) ? row : Object.values(row || {})) if (b && b.text === 'text_requestagent') btn = true } catch { /* keep false */ }
    add('the «درخواست نمایندگی» button is on the customer keyboard', btn, btn ? 'visible' : 'key text_requestagent not found in keyboardmain')
    add('bulk purchase is enabled', set.bulkbuy !== 'offbulk', String(set.bulkbuy ?? ''))
    add('the request fee is set (0 = free request)', true, String(set.agentreqprice ?? '0') + ' toman (refunded on reject)')
    const partners = await all(sql`SELECT agent, COUNT(*) AS n, SUM(CASE WHEN expire IS NOT NULL AND expire != '' AND expire != '0' THEN 1 ELSE 0 END) AS with_expiry FROM user WHERE agent IN ('n', 'n2') GROUP BY agent`)
    out.partners = Object.fromEntries(partners.map((r) => [r.agent, { count: Number(r.n), with_expiry: Number(r.with_expiry) }]))
    const reqs = await all(sql`SELECT status, COUNT(*) AS n FROM Requestagent GROUP BY status`)
    out.requests = Object.fromEntries(reqs.map((r) => [r.status, Number(r.n)]))
    add('there is no request stuck waiting', Number(out.requests.waiting ?? 0) === 0, `${out.requests.waiting ?? 0} waiting`)
    // the partner price against the customer price of the same plan (margin check against the infrastructure cost)
    const cost = Number(await kvGet('events:cost_gb')) || 1877
    const rows = await all(sql`SELECT p.name_product AS name, CAST(p.Volume_constraint AS REAL) AS gb, CAST(p.price_product AS INTEGER) AS partner, CAST(f.price_product AS INTEGER) AS retail FROM product p LEFT JOIN product f ON f.code_product = p.code_product AND f.agent = 'f' AND f.Location = p.Location WHERE p.agent = 'n' ORDER BY gb LIMIT 14`)
    out.partner_prices = rows.map((r) => ({ plan: String(r.name).split(/\s*[—|-]\s*/)[0], gb: r.gb, partner_toman: r.partner, retail_toman: r.retail || null, off_pct: r.retail ? Math.round((1 - r.partner / r.retail) * 100) : null, margin_pct: r.partner > 0 ? Math.round(((r.partner - r.gb * cost) / r.partner) * 100) : null }))
    const low = out.partner_prices.filter((r) => r.margin_pct !== null && r.margin_pct < 25)
    add('no partner plan is sold below a 25% margin', low.length === 0, low.length ? low.map((r) => `${r.plan}: ${r.margin_pct}%`).join(', ') : 'ok')
    const discounted = await one(sql`SELECT COUNT(*) AS n FROM user WHERE agent = 'n' AND CAST(COALESCE(NULLIF(pricediscount, ''), '0') AS REAL) > 0`)
    const advantage = Number(discounted?.n ?? 0) > 0 || out.partner_prices.some((r) => r.off_pct > 0 && r.off_pct >= 8)
    add('a partner pays LESS than a customer (a list below retail, or a tier discount on the partner)', advantage, advantage ? `${discounted?.n ?? 0} partners have a tier discount` : 'partners pay the retail price today: accept requests through the panel (first tier 10%) or set a discount on the Partners page')
    out.tiers_mode = (await kvGet('partners:mode')) === 'live' ? 'live' : 'simulation'
    out.verdict = out.checks.every((c) => c.ok !== 'MISSING') ? 'ready for a first partner' : 'NOT ready: fix the MISSING items first'
    return out
  }
  return main
})()


// product_names: turn the product NAMES into dynamic ones ({volume} / {days} / {price}) so a partner, a discount or a price change shows right everywhere.
//   npx tgcloud run endpoints/admin_report '{"tool":"product_names"}'                 → preview only (nothing written)
//   npx tgcloud run endpoints/admin_report '{"tool":"product_names","apply":true}'    → writes (a backup of every old name is kept)
//   npx tgcloud run endpoints/admin_report '{"tool":"product_names","restore":true}'  → puts the old names back
//   add "trust_price":[ids] to treat the DATABASE price as the truth for names that disagree with it (those ids only)
// A number in a name is replaced ONLY when it equals the product's own data (volume, days, price); a number that disagrees is reported and left alone.
const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩'
const toLatin = (t) => String(t).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => AR.indexOf(d))
function dynamicNamePlan(p, trustPrice = false) {
  const name = String(p.name_product ?? '')
  if (hasNameTokens(name)) return { new: name, changed: false, note: 'already dynamic', warnings: [] }
  const vol = Number(p.Volume_constraint), days = Number(p.Service_time), price = Number(p.price_product)
  const warnings = [], used = []
  const re = /([0-9۰-۹٠-٩][0-9۰-۹٠-٩,٬]*(?:[.٫][0-9۰-۹٠-٩]+)?)(\s*)(گیگابایت|گیگ|GB|gb|روزه|روز|هزار\s*تومان|تومان|تومن)/gu
  const out = name.replace(re, (m, num, gap, unit) => {
    const fa = /[۰-۹]/.test(num) ? '_fa' : ''
    const v = Number(toLatin(num).replace(/[,٬]/g, '').replace('٫', '.'))
    if (/گیگ|GB|gb/.test(unit)) { if (v === vol && vol > 0) { used.push('volume'); return `{volume${fa}}${gap}${unit}` } warnings.push(`${m.trim()} ≠ حجم محصول (${p.Volume_constraint})`); return m }
    if (/روز/.test(unit)) { if (v === days && days > 0) { used.push('days'); return `{days${fa}}${gap}${unit}` } warnings.push(`${m.trim()} ≠ مدت محصول (${p.Service_time})`); return m }
    const toman = /هزار/.test(unit) ? v * 1000 : v
    if (toman === price || trustPrice) { used.push('price'); return /هزار/.test(unit) ? `{price_k${fa}}${gap}هزار تومان` : `{price${fa}}${gap}${unit}` }
    warnings.push(`${m.trim()} ≠ قیمت محصول (${p.price_product}) — قیمت همکار/تخفیف‌دار نیست`); return m
  })
  return { new: out, changed: out !== name, used, warnings, note: used.length ? '' : 'no number to make dynamic' }
}
TOOLS.product_names = (() => {
  async function main(input, ctx) {
    if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
    const backup = JSON.parse((await kvGet('product:names_backup')) || '{}') || {}
    const rows = await all(sql`SELECT id, name_product, Volume_constraint, Service_time, price_product, agent, Location, category FROM product ORDER BY agent, CAST(Volume_constraint AS REAL), CAST(Service_time AS REAL)`)
    if (input?.restore) {
      let n = 0
      for (const r of rows) if (backup[r.id] !== undefined && backup[r.id] !== r.name_product) { await run(sql`UPDATE product SET name_product = ${backup[r.id]} WHERE id = ${r.id}`); n++ }
      return { restored: n }
    }
    const trust = input?.trust_price === 'all' ? null : new Set((Array.isArray(input?.trust_price) ? input.trust_price : []).map(String)) // ids whose DATABASE price is the truth when the name disagrees
    const list = rows.map((r) => ({ r, plan: dynamicNamePlan(r, trust === null || trust.has(String(r.id))) }))
    const seen = {}
    for (const { r, plan } of list) { const k = `${r.agent}|${r.Location}|${plan.new}`; seen[k] = (seen[k] || 0) + 1 }
    const show = (name, r, off) => productName(name, r, Math.round(Number(r.price_product) * (1 - off / 100)))
    const items = list.map(({ r, plan }) => ({
      id: r.id, agent: r.agent, panel: r.Location, category: r.category, old: r.name_product, new: plan.new, changed: plan.changed, warnings: plan.warnings, note: plan.note,
      customer_sees: show(plan.new, r, 0), partner_15pct_sees: show(plan.new, r, 15),
      duplicate_template: seen[`${r.agent}|${r.Location}|${plan.new}`] > 1 && !plan.changed ? 'same name as another product (ok: the bot tells them apart by code)' : undefined,
    }))
    const todo = items.filter((i) => i.changed && i.warnings.length === 0)
    const out = { products: items.length, will_change: todo.length, already_dynamic: items.filter((i) => i.note === 'already dynamic').length, with_warnings: items.filter((i) => i.warnings.length).length, no_number: items.filter((i) => i.note === 'no number to make dynamic').length }
    if (input?.apply) {
      let n = 0
      for (const i of todo) {
        if (backup[i.id] === undefined) backup[i.id] = i.old
        const w = await run(sql`UPDATE product SET name_product = ${i.new} WHERE id = ${i.id} AND name_product = ${i.old}`)
        n += Number(w?.rowsAffected ?? 0)
      }
      await kvSet('product:names_backup', JSON.stringify(backup))
      return { ...out, applied: n, note: 'the old names are kept; undo with {"tool":"product_names","restore":true}' }
    }
    return { ...out, preview_only: true, items: items.map((i) => ({ id: i.id, agent: i.agent, old: i.old, new: i.new, customer_sees: i.customer_sees, partner_15pct_sees: i.partner_15pct_sees, warnings: i.warnings.length ? i.warnings : undefined, note: i.note || undefined })) }
  }
  return main
})()

// emoji: is premium (custom) emoji working everywhere? Config state, the 6-hour block Telegram can leave behind, which emoji used in the bot's texts and catalog have NO premium id yet,
// and (probe) a real test message to the first administrator.
//   npx tgcloud run endpoints/admin_report '{"tool":"emoji"}'                   → the audit
//   npx tgcloud run endpoints/admin_report '{"tool":"emoji","unblock":true}'    → lifts the block (do this once Premium is on)
//   npx tgcloud run endpoints/admin_report '{"tool":"emoji","probe":true}'      → sends a test message with premium emoji to the first administrator
//   npx tgcloud run endpoints/admin_report '{"tool":"emoji","import":"NewsEmoji","buttons":true,"reply":true,"catalog":true}'
//        → reads the pack from Telegram, adds its emoji to the map, turns premium ON (and the button icons / bottom-menu icons / catalog labels you name). More packs: "import":["A","B"]. "on":false turns it off.
TOOLS.emoji = (() => {
  const EMO = /\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu
  const norm = (e) => String(e).replace(/\uFE0F/g, '')
  async function main(input, ctx) {
    if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
    const out0 = {}
    if (input?.import !== undefined || input?.on !== undefined || input?.buttons !== undefined || input?.reply !== undefined || input?.catalog !== undefined) {
      const r = await emojiImport(telegram, { packs: [].concat(input.import ?? []), on: input.on, buttons: input.buttons, reply: input.reply, catalog: input.catalog })
      await emojiUnblock()
      out0.import = r.import
      out0.saved = r.saved
    }
    if (input?.unblock) { await emojiUnblock(); resetEmojiCache() }
    resetEmojiCache()
    const cfg = await emojiConfig()
    const until = Number((await kvGet('custom_emoji_blocked_until')) || 0)
    const out = {
      ...out0,
      config: { enabled: cfg.enabled, mapped_emoji: Object.keys(cfg.map).length, inline_button_icons: cfg.buttons, reply_button_icons: cfg.reply_buttons, catalog_labels: cfg.catalog },
      blocked_by_telegram: until > Date.now() / 1000 ? `YES, for ${Math.round((until - Date.now() / 1000) / 60)} more minutes (Telegram refused custom emoji earlier) — run with "unblock":true` : 'no',
    }
    if (input?.unblock) out.unblocked = true
    if (!cfg.enabled) out.problem = 'premium emoji is OFF in the config (storage:premium_emoji.json: enabled / map)'
    // every text the customer can see: the bot's texts + the catalog
    const seen = new Map(), add = (text, where) => { for (const m of String(text ?? '').match(EMO) ?? []) { const k = norm(m), r = seen.get(k) ?? { n: 0, where }; r.n++; seen.set(k, r) } }
    let strings = 0
    const walk = (v, path) => { if (typeof v === 'string') { strings++; add(v, path) } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k) }
    walk(await loadTexts(), '')
    for (const [table, cols] of [['product', ['name_product', 'note']], ['category', ['remark']], ['help', ['category', 'Description_os']], ['departman', ['name_departman']], ['affiliates', ['description']]]) {
      try { for (const r of await all(sql.raw(`SELECT ${cols.join(', ')} FROM ${table}`))) for (const c of cols) { strings++; add(r[c], table + '.' + c) } } catch { /* a table that is not there */ }
    }
    const covered = [...seen].filter(([e]) => cfg.map[e] !== undefined), missing = [...seen].filter(([e]) => cfg.map[e] === undefined).sort((a, b) => b[1].n - a[1].n)
    out.texts = { strings_scanned: strings, distinct_emoji: seen.size, with_premium_id: covered.length, without_premium_id: missing.length }
    out.add_these_to_the_map = missing.slice(0, 40).map(([e, r]) => ({ emoji: e, uses: r.n, example: r.where }))
    if (input?.probe) {
      const admin = await one(sql`SELECT id_admin FROM admin WHERE rule = 'administrator' LIMIT 1`)
      out.probe = await emojiProbe(telegram, input.probe_chat ?? admin?.id_admin)
    }
    return out
  }
  return main
})()

// studio: what the Content Studio really holds (posts, mode, channel, running broadcast), and — without the Mini App — import posts and approve them.
//   npx tgcloud run endpoints/admin_report '{"tool":"studio"}'                                   → the state
//   … '{"tool":"studio","import":[…posts…],"startDate":"2026-11-18","time":"09:00"}'           → imports as drafts, one a day (add "toBot":false to skip the bot's users)
//   … add "replace":["id1","id2"] to overwrite those posts when they are still DRAFTS (e.g. a new version of the text)
//   … '{"tool":"studio","import":[…],"startDate":"…","approve":true}'                            → and schedules them (needs a future time; only when live do they go out)
TOOLS.studio = (() => {
  async function main(input, ctx) {
    if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
    const admin = await one(sql`SELECT id_admin FROM admin WHERE rule = 'administrator' LIMIT 1`)
    const out = {}
    if (Array.isArray(input?.import) && input.import.length) {
      const body = { posts: input.import, ...(Array.isArray(input.replace) ? { replace: input.replace } : {}), ...(input.startDate ? { startDate: input.startDate, time: input.time ?? '09:00' } : {}), ...('toChannel' in input ? { toChannel: input.toChannel } : {}), ...('toBot' in input ? { toBot: input.toBot } : {}) }
      const r = await studioRoute('studio_import', {}, body, admin ?? {})
      out.imported = r.imported
      out.import_note = r.imported === 0 ? 'nothing new: these ids are already in the Studio (look at "posts" below)' : undefined
      if (input.approve && r.imported) out.approved = await studioRoute('studio_approve_all', {}, { ids: r.posts.map((p) => p.id), confirm: true }, admin ?? {})
    }
    const s = await settingsGet(), posts = await postsGet(), t = Math.floor(Date.now() / 1000)
    const when = (w) => (w ? new Date((w + 12600) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' Tehran' : 'no time')
    out.mode = s.mode + (s.mode === 'live' ? ' (posts go out for real)' : s.mode === 'test' ? ' (only the test channel)' : ' (SIMULATION: nothing reaches the channel or the bot users)')
    out.channel = s.channel || 'NOT SET'
    out.test_channel = s.testChannel || 'not set'
    out.bot_username = s.bot || 'not set'
    if (input?.pump_broadcast) { // send for up to ~25 seconds right now (run it again until broadcast_running is false)
      const c = { ...(await systemContext()), from_id: 0 }
      out.pumped = { more: await broadcastTick(c, true, 25000) }
    }
    if (input?.cancel_broadcast) { await kvSet('broadcast:job', ''); out.broadcast_cancelled = true }
    const rawJob = await kvGet('broadcast:job')
    let job = null
    try { job = rawJob ? JSON.parse(rawJob) : null } catch { job = null }
    out.broadcast_running = !!job
    if (job) out.broadcast = { type: job.type, preview: String(job.text ?? '').replace(/<[^>]+>/g, '').slice(0, 60), sent: job.sent, failed: job.failed, total: job.total, last_user_id: job.last_id, button: job.markup ? 'yes' : 'no', hint: 'advances ~25 users per cron run (each incoming update); cancel it with {"tool":"studio","cancel_broadcast":true}' }
    out.counts = posts.reduce((a, p) => { a[p.status] = (a[p.status] ?? 0) + 1; return a }, {})
    out.posts = posts.filter((p) => !p.occasion).sort((a, b) => (a.when || 9e12) - (b.when || 9e12)).map((p) => ({ id: p.id, title: p.title, status: p.status, when: when(p.when), in_the_past: !!p.when && p.when <= t && p.status === 'scheduled' ? 'due now: sent by the next cron run' : undefined, to: [wantsChannel(p) ? 'channel' : '', wantsBot(p) ? 'bot' : ''].filter(Boolean).join('+') || 'admins', note: p.note || undefined }))
    return out
  }
  return main
})()

// costs: what one GB costs us — the VPN servers (euro, monthly) + the Iranian server (toman, monthly renewal) + the traffic (upload + download) — and what that does to every price and partner tier.
//   npx tgcloud run endpoints/admin_report '{"tool":"costs","eur_rate":<toman per euro>}'                    → the model (nothing written)
//   … '{"tool":"costs","eur_rate":<rate>,"apply":true}'   → stores it as the cost per GB (kv events:cost_gb) used by events, partner gifts and the partner-ready check
//   options: active_users (900) · peak_online (300) · vpn_servers (5) · servers_eur (29.8) · iran_server_toman (980000, monthly renewal) · traffic_tb (30, up+down together) · traffic_toman_per_gb (450) · gb_per_tb (1000) · sold_gb (default = traffic_tb × gb_per_tb)
TOOLS.costs = (() => {
  async function main(input, ctx) {
    if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
    const rate = Number(input?.eur_rate)
    if (!(rate > 0)) return { error: 'eur_rate (toman per euro) is required', usage: `npx tgcloud run endpoints/admin_report '{"tool":"costs","eur_rate":150000}'` }
    const eur = Number(input.servers_eur ?? 29.8), tb = Number(input.traffic_tb ?? 30), perGb = Number(input.traffic_toman_per_gb ?? 450), gbTb = Number(input.gb_per_tb ?? 1000)
    const trafficGb = tb * gbTb, base = Number(input.sold_gb ?? trafficGb)
    const iran = Number(input.iran_server_toman ?? 980000)
    const servers = Math.round(eur * rate), traffic = Math.round(trafficGb * perGb), total = servers + iran + traffic
    const costGb = Math.round(total / base)
    const before = Number(await kvGet('events:cost_gb')) || 1877
    const plans = [[10, 60000], [25, 144000], [40, 200000], [80, 370000], [120, 540000], [200, 900000], [300, 1320000], [400, 1680000]]
    const tiers = [0, 10, 15, 20, 25, 30]
    const m = (gb, price, off) => Math.round((1 - (costGb * gb) / (price * (1 - off / 100))) * 100)
    const users = Number(input.active_users ?? 900), peak = Number(input.peak_online ?? 300), nServers = Number(input.vpn_servers ?? 5)
    const avgMbps = (trafficGb * 8000) / (30 * 86400) // GB per month → megabit per second, averaged over the month
    const out = {
      people_and_load: {
        active_users: users, peak_online: peak, gb_per_active_user: Math.round((trafficGb / users) * 10) / 10, cost_per_active_user_toman: Math.round(total / users),
        cost_per_peak_online_user_toman: Math.round(total / peak), users_online_per_vpn_server_at_peak: Math.round(peak / nServers),
        average_mbps_all_servers: Math.round(avgMbps), average_mbps_per_server: Math.round(avgMbps / nServers), peak_mbps_per_server_if_4x_average: Math.round((avgMbps * 4) / nServers),
      },
      inputs: { servers_eur: eur, eur_rate: rate, iran_server_toman: iran, traffic_gb_per_month: trafficGb, traffic_toman_per_gb: perGb, gb_basis: base },
      monthly_toman: { vpn_servers_eur: servers, iran_server: iran, traffic, total },
      cost_per_gb: { new: costGb, parts: { vpn_servers: Math.round(servers / base), iran_server: Math.round(iran / base), traffic: perGb }, before, change_pct: Math.round(((costGb - before) / before) * 100) },
      margin_pct_by_plan_and_tier: plans.map(([gb, price]) => ({ gb, retail: price, ...Object.fromEntries(tiers.map((t) => [t ? `partner_${t}pct` : 'customer', m(gb, price, t)])) })),
      note: 'VPN servers + Iranian server + traffic only: bot hosting, the payment relay server, domains, gateway fees and support are NOT in this number',
    }
    if (input.apply) { await kvSet('events:cost_gb', String(costGb)); await kvSet('costs:model', JSON.stringify({ ...out.inputs, total, costGb, at: Math.floor(Date.now() / 1000) })); out.applied = `events:cost_gb = ${costGb}` }
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
