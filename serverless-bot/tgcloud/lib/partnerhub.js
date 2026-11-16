// The partner's own corner (پنل همکار): report of what they bought, their customers (services) with the ones that need a renewal first,
// and early notices (outages, events, price changes) sent to partners BEFORE the public announcement.
// Reads only; the money paths (buy / renew / wallet) stay in their existing routes.
import { all, one, sql, kvGet, kvSet } from './db.js'
import { sendmessage } from './tg.js'
import { jdate } from './fmt.js'
import { numberFormat } from './php.js'
import { tiersGet, tierFor, tierByPct, volume30 } from './partners.js'

const now = () => Math.floor(Date.now() / 1000)
const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d } catch { return d } }
export const isPartner = (u) => !!u && (u.agent === 'n' || u.agent === 'n2')
const NEED = ['sendedwarn', 'end_of_time', 'end_of_volume']
const ICON = { active: '🟢', sendedwarn: '🟡', end_of_time: '🔴', end_of_volume: '🔴', send_on_hold: '⏳' }
const GOOD = sql`LOWER(Status) NOT IN ('unpaid','expire','unsuccessful','reject','removeservice') AND CAST(price_product AS INTEGER) > 0 AND name_product NOT LIKE '%تست%'`
const esc = (s) => String(s ?? '').replace(/[<>&]/g, '')
const fa = (v) => numberFormat(Math.round(Number(v) || 0))

/** the numbers of a partner: tier, 30-day volume, customers, totals, last orders */
export async function reportData(user) {
  const id = String(user.id), tiers = await tiersGet(), v = await volume30(id)
  const pct = Number(user.pricediscount) || 0
  const cur = tierByPct(tiers, pct), next = tiers.find((t) => t.gb > v.gb), earned = tierFor(tiers, v.gb)
  const tot = (await one(sql`SELECT COUNT(*) AS n, COALESCE(SUM(CAST(price_product AS INTEGER)), 0) AS s FROM invoice WHERE id_user = ${id} AND ${GOOD}`)) || {}
  const live = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${id} AND Status IN ('active','sendedwarn','send_on_hold')`))?.n ?? 0)
  const need = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${id} AND Status IN ('sendedwarn','end_of_time','end_of_volume')`))?.n ?? 0)
  const recent = await all(sql`SELECT username, name_product, price_product, time_sell, Volume, Service_time FROM invoice WHERE id_user = ${id} AND ${GOOD} ORDER BY CAST(time_sell AS INTEGER) DESC LIMIT 8`)
  return { pct, tierName: cur?.name ?? (pct ? 'دستی' : '—'), earnedName: earned.name, gb30: Math.round(v.gb * 10) / 10, orders30: v.orders, spent30: v.spent,
    toNext: next ? Math.max(0, Math.ceil(next.gb - v.gb)) : 0, nextName: next?.name ?? '', total: Number(tot.n ?? 0), totalSpent: Number(tot.s ?? 0), live, need, balance: Number(user.Balance) || 0, recent }
}

export async function reportText(user) {
  const r = await reportData(user)
  const lines = ['📊 <b>گزارش همکاری شما</b>', '',
    `🏅 سطح: <b>${esc(r.tierName)}</b> · تخفیف شما: <b>${r.pct}٪</b>`,
    `📅 ۳۰ روز اخیر: ${fa(r.orders30)} سفارش · ${r.gb30} گیگ · ${fa(r.spent30)} تومان`,
    r.nextName ? `⬆️ تا سطح «${esc(r.nextName)}»: ${fa(r.toNext)} گیگ دیگر` : '🏆 در بالاترین سطح هستید',
    '',
    `👥 سرویس‌های فعال: ${fa(r.live)}${r.need ? ` · نیازمند تمدید: <b>${fa(r.need)}</b>` : ''}`,
    `🧾 کل خرید تا امروز: ${fa(r.total)} سفارش · ${fa(r.totalSpent)} تومان`,
    `💳 موجودی کیف پول: ${fa(r.balance)} تومان`]
  if (r.recent.length) {
    lines.push('', '🗂 آخرین سفارش‌ها:')
    for (const o of r.recent) lines.push(`• ${jdate('m/d', Number(o.time_sell))} · <code>${esc(o.username)}</code> · ${esc(o.Volume)}GB/${esc(o.Service_time)}روز · ${fa(o.price_product)}`)
  }
  return lines.join('\n')
}

export const PAGE = 8
/** the customers (services) of a partner: filter 'need' = renewal first, 'all' = every live one */
export async function customersPage(user, filter = 'need', page = 1) {
  const id = String(user.id)
  const where = filter === 'need' ? sql`Status IN ('sendedwarn','end_of_time','end_of_volume')` : sql`Status IN ('active','sendedwarn','end_of_time','end_of_volume','send_on_hold')`
  const total = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${id} AND ${where}`))?.n ?? 0)
  const pages = Math.max(1, Math.ceil(total / PAGE)), p = Math.min(Math.max(1, page), pages)
  const rows = await all(sql`SELECT id_invoice, username, note, Status FROM invoice WHERE id_user = ${id} AND ${where}
    ORDER BY CASE Status WHEN 'end_of_time' THEN 0 WHEN 'end_of_volume' THEN 0 WHEN 'sendedwarn' THEN 1 ELSE 2 END, CAST(time_sell AS INTEGER) ASC LIMIT ${PAGE} OFFSET ${(p - 1) * PAGE}`)
  const kb = rows.map((r) => [{ text: `${ICON[r.Status] ?? '•'} ${r.username}${r.note ? ' | ' + String(r.note).slice(0, 18) : ''}`, callback_data: 'product_' + r.id_invoice }])
  const nav = []
  if (p > 1) nav.push({ text: '◀️ قبلی', callback_data: `pcust_${filter}_${p - 1}` })
  if (p < pages) nav.push({ text: 'بعدی ▶️', callback_data: `pcust_${filter}_${p + 1}` })
  if (nav.length) kb.push(nav)
  kb.push([{ text: filter === 'need' ? '📋 همهٔ مشتری‌ها' : '⚠️ فقط نیازمند تمدید', callback_data: `pcust_${filter === 'need' ? 'all' : 'need'}_1` }])
  kb.push([{ text: '🔎 جستجو', callback_data: 'searchservice' }, { text: '↩️ بازگشت', callback_data: 'agentpanel' }])
  const head = filter === 'need' ? '⚠️ <b>مشتری‌هایی که نزدیک پایان‌اند یا تمام شده‌اند</b>' : '👥 <b>همهٔ مشتری‌های شما</b>'
  const text = total === 0 ? (filter === 'need' ? '✅ فعلاً مشتری‌ای برای تمدید ندارید.' : 'هنوز سرویسی نساخته‌اید.')
    : `${head}\n${total} مورد · صفحهٔ ${p} از ${pages}\n🟢 فعال  🟡 نزدیک پایان  🔴 تمام شده\nروی هر مورد بزنید: مصرف، لینک و تمدید.`
  return { text, kb: { inline_keyboard: kb }, total }
}

// ---------- notices to partners (before the public announcement)
export const noticesGet = async () => parse(await kvGet('partner:notices'), [])
export async function partnerIds() {
  return (await all(sql`SELECT id FROM user WHERE agent IN ('n','n2') AND User_Status != 'block'`)).map((u) => String(u.id)).filter((i) => /^\d+$/.test(i))
}
/** send a notice to every partner. dry → only counts. A copy is kept (last 30) so the panel shows what was told, when. */
export async function notifyPartners(text, { dry = false, source = 'manual', send = sendmessage } = {}) {
  const ids = await partnerIds()
  if (dry) return { ok: true, count: ids.length, sent: 0, failed: 0 }
  let sent = 0, failed = 0
  for (const id of ids) {
    try { const r = await send(id, text, null, 'HTML'); if (r && r.ok === false) failed++; else sent++ } catch { failed++ }
  }
  const list = [{ t: now(), source, text: String(text).slice(0, 600), sent, failed }, ...(await noticesGet())].slice(0, 30)
  await kvSet('partner:notices', JSON.stringify(list))
  return { ok: true, count: ids.length, sent, failed }
}
export const PRIORITY_TAG = '⭐ <b>همکار (اولویت پشتیبانی)</b>\n'
