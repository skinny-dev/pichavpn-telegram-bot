// Events: a campaign the system applies and ends BY ITSELF (docs/EVENTS.md). One object: what (type + parameters), for whom, from when to when.
// Lifecycle: draft → approved (by an administrator) → running (applied at `startsAt`) → ended (reverted at `endsAt`). Nothing starts without approval.
// SIMULATION IS THE DEFAULT: while kv `events:mode` is not 'live' an approved event only LOGS what it would have changed — no price, code or setting is touched.
// Types reuse the tested mechanisms: the price promotion (panelapi/promo.js), the discount-code table (DiscountSell), the test-account settings of the panels.
import { all, one, run, sql, kvGet, kvSet } from './db.js'
import { promoBuild, promoStart, promoEnd } from './panelapi/promo.js'
import { promoState } from './catalog.js'
import { postsGet, postsSet } from './studio.js'
import { jdate } from './fmt.js'

const now = () => Math.floor(Date.now() / 1000)
const DAY = 86400
const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d } catch { return d } }
export const MAX_PERCENT = 20 // a deeper discount is refused (the net margin does not carry it)
export const MIN_GAP_DAYS = 30 // between two OFFERS (customers learn to wait for a discount otherwise)
export const MIN_NOTICE_DAYS = 7 // a price increase is announced at least this long before
export const TYPES = {
  price_discount: { label: 'تخفیف قیمتی (همه می‌بینند)', offer: true, promo: true },
  bonus_gb: { label: 'هدیهٔ حجم روی پلن‌ها', offer: true, promo: true },
  code: { label: 'کد تخفیف (مخاطب هدف)', offer: true },
  test_extension: { label: 'تمدید تست رایگان' },
  price_increase: { label: 'افزایش قیمت زمان‌بندی‌شده' },
  price_freeze: { label: 'ثبات قیمت (اعلام)' },
}
export const STATUS_LABEL = { draft: 'پیش‌نویس', approved: 'تأییدشده', running: 'در حال اجرا', simulated: 'شبیه‌سازی‌شده', ended: 'تمام شد', cancelled: 'لغو', failed: 'ناموفق' }

export const eventsGet = async () => parse(await kvGet('events:list'), [])
export const eventsSet = (l) => kvSet('events:list', JSON.stringify(l))
export const modeGet = async () => ((await kvGet('events:mode')) === 'live' ? 'live' : 'sim')
export const costPerGb = async () => Number(await kvGet('events:cost_gb')) || 1877 // infrastructure cost per GB (toman), see FINANCE.md

const int = (v, d = 0) => { const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : d }
const num = (v, d = 0) => { const n = parseFloat(String(v ?? '').replace(/[٫]/g, '.')); return Number.isFinite(n) ? n : d }

export function normalize(e, old = {}) {
  const type = TYPES[e.type] ? e.type : old.type || 'price_discount'
  const p = { ...(old.params || {}), ...(e.params || {}) }
  const params = {}
  if (['price_discount', 'price_increase'].includes(type)) Object.assign(params, { percent: num(p.percent), ids: (p.ids || []).map((x) => int(x)).filter(Boolean), round: [1, 1000, 5000, 10000, 50000].includes(int(p.round, 1000)) ? int(p.round, 1000) : 1000 })
  if (type === 'bonus_gb') Object.assign(params, { gb: num(p.gb), ids: (p.ids || []).map((x) => int(x)).filter(Boolean) })
  if (type === 'code') Object.assign(params, { code: String(p.code ?? '').trim(), percent: num(p.percent), limit: int(p.limit), first: !!p.first, agent: p.agent === 'allusers' ? 'allusers' : 'f' })
  if (type === 'test_extension') Object.assign(params, { hours: num(p.hours), mb: num(p.mb) })
  return {
    id: String(e.id || old.id || 'e' + now().toString(36) + Math.floor(Math.random() * 1296).toString(36)), name: String(e.name ?? old.name ?? '').slice(0, 80), type,
    startsAt: int(e.startsAt ?? old.startsAt), endsAt: int(e.endsAt ?? old.endsAt), group: String(e.group ?? old.group ?? '').slice(0, 40), occasion: String(e.occasion ?? old.occasion ?? ''),
    params, status: old.status || 'draft', created: old.created || now(), log: old.log || [], snapshot: old.snapshot || null,
  }
}
const logTo = (e, msg) => { e.log = [...(e.log || []), { t: now(), msg }].slice(-30) }

// ---------- the plans an event may touch (customers' plans only; agents have their own prices)
export const productsGet = async () => (await all(sql`SELECT id, name_product, Volume_constraint, Service_time, price_product, agent FROM product WHERE agent = 'f' OR agent = '' OR agent IS NULL ORDER BY CAST(Volume_constraint AS REAL), id`))
  .map((p) => ({ id: Number(p.id), name: String(p.name_product ?? ''), gb: parseFloat(p.Volume_constraint) || 0, days: parseInt(p.Service_time) || 0, price: parseInt(p.price_product) || 0 }))
const pickIds = async (ids) => (ids && ids.length ? ids : (await productsGet()).filter((p) => p.price > 0 && p.gb > 0).map((p) => p.id))
const roundUp = (x, step) => Math.max(step, Math.ceil(x / step) * step)

/** the effect of an event on prices, with the margin against the infrastructure cost: [{name, gb, old, now, margin}] */
export async function impact(e) {
  const cost = await costPerGb(), out = []
  const prods = await productsGet()
  const row = (p, newPrice, newGb) => ({ name: p.name, gb: newGb ?? p.gb, old: p.price, now: newPrice, margin: newPrice > 0 ? Math.round(((newPrice - (newGb ?? p.gb) * cost) / newPrice) * 100) : 0 })
  const ids = await pickIds(e.params.ids)
  const sel = prods.filter((p) => ids.includes(p.id))
  if (e.type === 'price_discount') for (const it of await promoBuild(ids, 'percent', e.params.percent, e.params.round, 'down')) out.push(row(prods.find((p) => p.id === it.id) || { name: it.name, gb: it.old_gb, price: it.old_price }, it.new_price))
  else if (e.type === 'bonus_gb') for (const it of await promoBuild(ids, 'bonus_gb', e.params.gb)) out.push(row(prods.find((p) => p.id === it.id) || { name: it.name, gb: it.old_gb, price: it.old_price }, it.new_price, it.new_gb))
  else if (e.type === 'price_increase') for (const p of sel) out.push(row(p, roundUp(p.price * (1 + e.params.percent / 100), e.params.round)))
  else if (e.type === 'code') for (const p of prods.filter((x) => x.price > 0 && x.gb > 0)) out.push(row(p, Math.round(p.price * (1 - e.params.percent / 100))))
  return out
}

/** {errors, warnings}: errors block approval */
export async function check(e, list, { approving = false } = {}) {
  const errors = [], warnings = []
  const t = TYPES[e.type], p = e.params
  if (!e.name.trim()) errors.push('نام رویداد را بنویسید')
  if (e.type !== 'price_increase' && (!e.endsAt || e.endsAt <= e.startsAt)) errors.push('پایان باید بعد از شروع باشد')
  if (!e.startsAt) errors.push('زمان شروع را مشخص کنید')
  if (approving && e.startsAt <= now()) errors.push('زمان شروع باید در آینده باشد')
  if (t.promo && e.endsAt - e.startsAt > 31 * DAY) errors.push('حداکثر مدت ۳۱ روز')
  if (['price_discount', 'code'].includes(e.type) && !(p.percent >= 1 && p.percent <= MAX_PERCENT)) errors.push(`درصد باید بین ۱ و ${MAX_PERCENT} باشد`)
  if (e.type === 'bonus_gb' && !(p.gb > 0)) errors.push('مقدار گیگ هدیه را بنویسید')
  if (e.type === 'price_increase') {
    if (!(p.percent >= 1 && p.percent <= 30)) errors.push('افزایش بین ۱ تا ۳۰ درصد')
    if (approving && e.startsAt - now() < MIN_NOTICE_DAYS * DAY) errors.push(`افزایش قیمت باید حداقل ${MIN_NOTICE_DAYS} روز قبل اعلام شود`)
    for (const o of list) if (o.id !== e.id && o.type === 'price_freeze' && ['approved', 'running', 'simulated'].includes(o.status) && e.startsAt < o.endsAt && e.startsAt >= o.startsAt) errors.push(`در بازهٔ «ثبات قیمت» (${o.name}) افزایش قیمت ممکن نیست`)
  }
  if (e.type === 'code') {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(p.code)) errors.push('کد: ۳ تا ۲۰ حرف لاتین، رقم یا _')
    else if (await one(sql`SELECT 1 AS x FROM DiscountSell WHERE codeDiscount = ${p.code} COLLATE NOCASE LIMIT 1`)) errors.push('این کد قبلاً وجود دارد')
    if (!(p.limit >= 1)) errors.push('سقف تعداد استفاده را بنویسید')
  }
  if (e.type === 'test_extension' && !(p.hours >= 1 && p.mb >= 1)) errors.push('ساعت و حجم تست را بنویسید')
  // offers: a gap between them, and one price promotion at a time
  const active = list.filter((o) => o.id !== e.id && ['approved', 'running', 'simulated'].includes(o.status))
  if (t.offer) for (const o of active) {
    if (!TYPES[o.type].offer || (e.group && e.group === o.group)) continue
    if (e.startsAt < o.endsAt + MIN_GAP_DAYS * DAY && o.startsAt < e.endsAt + MIN_GAP_DAYS * DAY) errors.push(`فاصلهٔ ${MIN_GAP_DAYS} روز با «${o.name}» رعایت نشده (برای همین بسته، گروه یکسان بگذارید)`)
  }
  if (t.promo) for (const o of active) if (TYPES[o.type].promo && e.startsAt < o.endsAt && o.startsAt < e.endsAt) errors.push(`هم‌زمان با «${o.name}»؛ فقط یک تخفیف قیمتی در هر زمان`)
  // margin
  if (['price_discount', 'bonus_gb', 'code'].includes(e.type) && !errors.length) {
    const rows = await impact(e)
    if (!rows.length) errors.push('پلنی برای اعمال پیدا نشد')
    const worst = rows.reduce((m, r) => Math.min(m, r.margin), 100)
    if (worst < 10) errors.push(`حاشیهٔ سود یک پلن به ${worst}٪ می‌رسد؛ کمتر از ۱۰٪ مجاز نیست`)
    else if (worst < 30) warnings.push(`حاشیهٔ سود یک پلن ${worst}٪ است`)
  }
  return { errors, warnings }
}

// ---------- applying and reverting
async function apply(e) {
  const p = e.params
  if (e.type === 'price_discount' || e.type === 'bonus_gb') {
    const ids = await pickIds(p.ids)
    const items = await promoBuild(ids, e.type === 'bonus_gb' ? 'bonus_gb' : 'percent', e.type === 'bonus_gb' ? p.gb : p.percent, p.round || 1000, 'down')
    await promoStart(items, e.type === 'bonus_gb' ? 'bonus_gb' : 'percent', e.type === 'bonus_gb' ? p.gb : p.percent, e.endsAt, e.name)
    return `قیمت ${items.length} پلن عوض شد`
  }
  if (e.type === 'code') {
    await run(sql`INSERT INTO DiscountSell (codeDiscount, price, limitDiscount, agent, usefirst, useuser, code_product, code_panel, time, type, usedDiscount)
      VALUES (${p.code}, ${String(p.percent)}, ${String(p.limit)}, ${p.agent}, ${p.first ? '1' : '0'}, '1', 'all', '/all', ${String(e.endsAt)}, ${p.first ? 'buy' : 'all'}, '0')`)
    return `کد ${p.code} ساخته شد`
  }
  if (e.type === 'test_extension') {
    const panels = await all(sql`SELECT name_panel, time_usertest, val_usertest FROM marzban_panel WHERE TestAccount = 'ONTestAccount'`)
    e.snapshot = panels.map((x) => ({ name: x.name_panel, h: x.time_usertest, mb: x.val_usertest }))
    for (const x of panels) await run(sql`UPDATE marzban_panel SET time_usertest = ${String(p.hours)}, val_usertest = ${String(p.mb)} WHERE name_panel = ${x.name_panel}`)
    return `تست ${panels.length} پنل: ${p.hours} ساعت و ${p.mb} مگابایت`
  }
  if (e.type === 'price_increase') {
    const prods = await productsGet(), ids = await pickIds(p.ids), snap = []
    for (const x of prods.filter((q) => ids.includes(q.id))) {
      const np = roundUp(x.price * (1 + p.percent / 100), p.round || 1000)
      await run(sql`UPDATE product SET price_product = ${String(np)} WHERE id = ${x.id} AND CAST(price_product AS INTEGER) = ${x.price}`)
      snap.push({ id: x.id, old: x.price, now: np })
    }
    e.snapshot = snap
    return `قیمت ${snap.length} پلن بالا رفت (دائمی؛ برای برگشت به لاگ نگاه کنید)`
  }
  return 'ثبات قیمت اعلام شد (تغییری در سیستم لازم نیست)'
}
async function revert(e) {
  if (e.type === 'price_discount' || e.type === 'bonus_gb') { const [n, skipped] = await promoEnd(); return `قیمت ${n} پلن برگشت` + (skipped.length ? ` (${skipped.length} پلن را دستی عوض کرده بودید و دست نخورد)` : '') }
  if (e.type === 'code') { await run(sql`UPDATE DiscountSell SET time = ${String(now() - 1)} WHERE codeDiscount = ${e.params.code} COLLATE NOCASE`); return 'کد منقضی شد' }
  if (e.type === 'test_extension') {
    let n = 0
    for (const s of e.snapshot || []) { const r = await run(sql`UPDATE marzban_panel SET time_usertest = ${String(s.h ?? '')}, val_usertest = ${String(s.mb ?? '')} WHERE name_panel = ${s.name} AND CAST(time_usertest AS REAL) = ${e.params.hours} AND CAST(val_usertest AS REAL) = ${e.params.mb}`); if (Number(r?.rowsAffected ?? 1)) n++ }
    return `تست ${n} پنل به مقدار قبل برگشت`
  }
  return 'پایان'
}

/** the job: one transition per run (cron every 60 s). Starts approved events, ends running ones. */
export async function eventsTick() {
  const list = await eventsGet()
  const mode = await modeGet()
  const t = now()
  const ending = list.find((e) => ['running', 'simulated'].includes(e.status) && e.endsAt && e.endsAt <= t && e.type !== 'price_increase')
  const starting = list.find((e) => e.status === 'approved' && e.startsAt <= t)
  const e = ending || starting
  if (!e) { const inc = list.find((x) => ['running', 'simulated'].includes(x.status) && x.type === 'price_increase'); if (inc) { inc.status = 'ended'; await eventsSet(list) } return { changed: 0 } }
  if (e === ending) {
    try { if (e.status === 'running') logTo(e, await revert(e)); else logTo(e, 'پایان شبیه‌سازی') } catch (err) { logTo(e, 'خطا در پایان: ' + String(err?.message ?? err).slice(0, 120)); e.status = 'failed'; await eventsSet(list); return { changed: 1, failed: e.id } }
    e.status = 'ended'
  } else if (mode === 'live') {
    try { logTo(e, await apply(e)); e.status = e.type === 'price_increase' ? 'running' : 'running' } catch (err) { logTo(e, 'شروع نشد: ' + String(err?.message ?? err).slice(0, 120)); e.status = 'failed' }
  } else { // simulation: say what would happen, change nothing
    const rows = ['price_discount', 'bonus_gb', 'price_increase'].includes(e.type) ? await impact(e) : []
    logTo(e, 'شبیه‌سازی: ' + (rows.length ? `${rows.length} پلن عوض می‌شد` : TYPES[e.type].label) + ' — چیزی تغییر نکرد')
    e.status = 'simulated'
  }
  await eventsSet(list)
  return { changed: 1, id: e.id, status: e.status }
}

/** stop a running event now (the kill switch) */
export async function stopNow(e) {
  if (e.status === 'running') logTo(e, await revert(e))
  e.status = 'ended'; e.endsAt = Math.min(e.endsAt || now(), now())
}

/** the early notice to partners when an event is approved (they hear before the public) */
export function partnerHeadsUp(e) {
  const p = e.params || {}
  const what = e.type === 'price_discount' ? `${p.percent}٪ تخفیف روی پلن‌های منتخب` : e.type === 'bonus_gb' ? `${p.gb} گیگ هدیه روی پلن‌های منتخب` : e.type === 'code' ? `${p.percent}٪ تخفیف با کد ${p.code}` : e.type === 'test_extension' ? `تست رایگان ${p.hours} ساعته` : e.type === 'price_increase' ? `افزایش ${p.percent}٪ قیمت‌ها (قیمت همکاران هم متناسب تغییر می‌کند)` : 'ثبات قیمت‌ها'
  const d = (t) => jdate('Y/m/d H:i', t, true)
  return `درود 🌿\nاطلاع زودهنگام برای همکاران: «${e.name}» — ${what}.\nشروع: ${d(e.startsAt)}${e.endsAt ? `\nپایان: ${d(e.endsAt)} (به وقت تهران)` : ''}\nاعلام عمومی بعداً انجام می‌شود؛ شما زودتر می‌دانید تا برنامه‌ریزی کنید. سپاسگزارم.`
}
// ---------- posts: the event's announcements become Studio drafts (never auto-scheduled)
const when = (t) => jdate('Y/m/d H:i', t, true)
export async function makePosts(e) {
  const p = e.params, list = await postsGet(), have = new Set(list.map((x) => x.id)), out = []
  const what = e.type === 'price_discount' ? `${p.percent}٪ تخفیف روی پلن‌های منتخب` : e.type === 'bonus_gb' ? `${p.gb} گیگ هدیه روی پلن‌های منتخب` : e.type === 'code' ? `${p.percent}٪ تخفیف با کد ${p.code}` : e.type === 'test_extension' ? `تست رایگان ${p.hours} ساعته` : e.type === 'price_increase' ? `افزایش ${p.percent}٪ قیمت‌ها` : 'ثبات قیمت‌ها'
  const base = { audience: 'channel', status: 'draft', auto: true, created: now(), occasion: e.occasion || '', offerEnds: e.endsAt || 0 }
  const cta = e.type === 'code' ? [{ key: 'buy' }, { key: 'test' }, { key: 'code', code: p.code }] : e.type === 'price_increase' || e.type === 'price_freeze' ? [{ key: 'tariff' }, { key: 'test' }] : [{ key: 'buy' }, { key: 'test' }]
  const add = (suffix, post) => { const id = `ev-${e.id}-${suffix}`; if (!have.has(id)) { list.push({ ...base, id, ...post }); out.push(id) } }
  if (e.type === 'price_increase') {
    add('notice', { title: e.name + ' · اطلاعیه', kind: 'trust', text: `درود 🌿\nاز ${when(e.startsAt)} قیمت‌ها حدود ${p.percent}٪ بالا می‌رود. دلیل: افزایش هزینهٔ زیرساخت.\nتا آن زمان با قیمت فعلی می‌توانید خرید یا تمدید کنید.`, cta, when: e.startsAt - 7 * DAY })
    add('day', { title: e.name + ' · روز اجرا', kind: 'trust', text: `درود 🌿\nقیمت‌های جدید از امروز اعمال شد. از همراهی‌تان سپاسگزاریم.`, cta: [{ key: 'tariff' }, { key: 'support' }], when: e.startsAt })
  } else if (e.type === 'price_freeze') {
    add('start', { title: e.name, kind: 'trust', text: `درود 🌿\nتا ${when(e.endsAt)} قیمت‌های پیچا ثابت می‌ماند.`, cta, when: e.startsAt })
  } else {
    add('teaser', { title: e.name + ' · تیزر', kind: 'trust', text: `درود 🌿\n${e.name} نزدیک است. چیزی که می‌گوییم همان است که انجام می‌دهیم؛ جزئیات را به‌زودی اعلام می‌کنیم.`, cta: [{ key: 'test' }], when: e.startsAt - 3 * DAY })
    add('start', { title: e.name + ' · شروع', kind: 'offer', text: `درود 🌿\n${e.name}: ${what}.\nپایان: ${when(e.endsAt)} (به وقت تهران)${e.type === 'code' ? `، برای ${p.limit} خرید اول` : ''}.`, cta, when: e.startsAt })
    if (e.endsAt - e.startsAt >= 6 * 3600) add('last', { title: e.name + ' · ساعات پایانی', kind: 'offer', text: `درود، چند ساعت تا پایان ${e.name} مانده است (${when(e.endsAt)}). اگر مردد هستید، ابتدا تست رایگان بگیرید.`, cta: [{ key: 'test' }, { key: 'buy' }], when: e.endsAt - 3 * 3600 })
    add('thanks', { title: e.name + ' · تشکر', kind: 'trust', text: `سپاسگزاریم از همراهی‌تان. ${e.name} تمام شد. اگر دربارهٔ خرید سؤالی دارید همین‌جا بپرسید.`, cta: [{ key: 'support' }], when: e.endsAt + 12 * 3600 })
  }
  await postsSet(list)
  return out
}

export { promoState }
