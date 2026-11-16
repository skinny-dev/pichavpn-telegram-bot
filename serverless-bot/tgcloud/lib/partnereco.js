// What partners cost and bring: every gift we give to attract or activate a partner (wallet credit, a free service, anything else) is an EXPENSE
// of kind «partner» in the books, and the partner's purchases are their revenue — so the panel's statistics and the P&L carry both sides.
// Wallet credit is booked at its face value (the careful view: it is spent on our own services, so the real cost is lower). A free service is booked at GB × cost per GB.
import { all, one, run, sql, kvGet, kvSet } from './db.js'
import { sendmessage } from './tg.js'
import { volumeSince } from './partners.js' // a cycle with partners.js (used only at call time); no dynamic import: the platform does not support it

const now = () => Math.floor(Date.now() / 1000)
const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d } catch { return d } }
export const LIMITS = { wallet: 2000000, gb: 200, days: 90, other: 2000000 }
export const giftsGet = async () => parse(await kvGet('partner:gifts'), [])
export const welcomeGet = async () => ({ on: false, wallet: 0, gb: 0, days: 0, ...parse(await kvGet('partner:welcome'), {}) })
const costPerGb = async () => Number(await kvGet('events:cost_gb')) || 1877

/** one gift: kind 'wallet' (toman) | 'service' (gb + days) | 'other' (toman). Books the expense; credits the wallet for 'wallet'. → {ok, entry} | {ok:false, error} */
export async function giftAdd(partnerId, { kind, amount = 0, gb = 0, days = 0, note = '', by = 'panel', source = 'manual' } = {}) {
  const id = String(partnerId)
  const u = await one(sql`SELECT id, username FROM user WHERE id = ${id}`)
  if (!u) return { ok: false, error: 'کاربر پیدا نشد' }
  if (!['wallet', 'service', 'other'].includes(kind)) return { ok: false, error: 'نوع هدیه نامعتبر است' }
  amount = Math.trunc(Number(amount) || 0); gb = Number(gb) || 0; days = Math.trunc(Number(days) || 0)
  let cost, what
  if (kind === 'service') {
    if (!(gb > 0) || gb > LIMITS.gb || days < 0 || days > LIMITS.days) return { ok: false, error: `حجم ۱ تا ${LIMITS.gb} گیگ و مدت حداکثر ${LIMITS.days} روز` }
    cost = Math.round(gb * (await costPerGb())); what = `سرویس رایگان ${gb} گیگ${days ? ` / ${days} روز` : ''}`
  } else {
    if (!(amount > 0) || amount > LIMITS[kind]) return { ok: false, error: `مبلغ ۱ تا ${LIMITS[kind].toLocaleString('en')} تومان` }
    cost = amount; what = kind === 'wallet' ? `شارژ کیف پول ${amount.toLocaleString('en')} تومان` : `هزینه‌ی دیگر ${amount.toLocaleString('en')} تومان`
  }
  const desc = `جذب همکار: ${what} — @${u.username || ''} (${id})${note ? ' — ' + String(note).slice(0, 80) : ''}`
  const e = await run(sql`INSERT INTO expenses (amount, description, created_at, admin_id, kind) VALUES (${cost}, ${desc}, ${now()}, ${String(by)}, 'partner')`)
  if (kind === 'wallet') await run(sql`UPDATE user SET Balance = Balance + ${amount} WHERE id = ${id}`)
  const entry = { t: now(), partner: id, username: String(u.username ?? ''), kind, what, cost, gb: kind === 'service' ? gb : 0, days, expense: Number(e?.lastInsertRowid ?? 0), by: String(by), source, note: String(note).slice(0, 80) }
  await kvSet('partner:gifts', JSON.stringify([entry, ...(await giftsGet())].slice(0, 1000)))
  return { ok: true, entry }
}

/** the welcome package given once when a request is accepted (if switched on) */
export async function welcomeGive(id) {
  const w = await welcomeGet()
  if (!w.on) return null
  if ((await giftsGet()).some((g) => g.partner === String(id) && g.source === 'welcome')) return null // once per partner
  const given = []
  if (w.wallet > 0) { const r = await giftAdd(id, { kind: 'wallet', amount: w.wallet, by: 'welcome', source: 'welcome' }); if (r.ok) given.push(r.entry.what) }
  if (w.gb > 0) { const r = await giftAdd(id, { kind: 'service', gb: w.gb, days: w.days, by: 'welcome', source: 'welcome' }); if (r.ok) given.push(r.entry.what + ' (هماهنگ می‌کنیم)') }
  if (given.length) await sendmessage(id, `🎁 هدیهٔ خوشامد برای آشنایی با ربات و روش‌های پرداخت:\n• ${given.join('\n• ')}\nسپاسگزارم.`, null, 'HTML')
  return given
}

/** per-partner economics: what they bought (revenue), what that goods cost us, what we gave them → net */
export async function economics() {
  const cost = await costPerGb(), gifts = await giftsGet()
  const ids = new Set(gifts.map((g) => g.partner))
  for (const u of await all(sql`SELECT id FROM user WHERE agent IN ('n','n2')`)) ids.add(String(u.id))
  const rows = []
  for (const id of ids) {
    const u = await one(sql`SELECT username, agent, pricediscount FROM user WHERE id = ${id}`)
    const v = await volumeSince(id, 0), v30 = await volumeSince(id, now() - 30 * 86400)
    const mine = gifts.filter((g) => g.partner === id), given = mine.reduce((a, g) => a + g.cost, 0), cogs = Math.round(v.gb * cost)
    rows.push({ id, username: String(u?.username ?? ''), level: u?.agent ?? 'f', revenue: v.spent, revenue30: v30.spent, gb: Math.round(v.gb * 10) / 10, orders: v.orders, cogs, gifts: given, giftCount: mine.length, net: v.spent - cogs - given })
  }
  rows.sort((a, b) => b.revenue - a.revenue)
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0)
  return { ok: true, costPerGb: cost, rows, totals: { revenue: sum('revenue'), revenue30: sum('revenue30'), cogs: sum('cogs'), gifts: sum('gifts'), net: sum('net'), partners: rows.length, withSales: rows.filter((r) => r.revenue > 0).length }, gifts: gifts.slice(0, 40) }
}
