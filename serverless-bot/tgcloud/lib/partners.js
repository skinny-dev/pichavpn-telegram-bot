// Partners (نمایندگان / همکاران تجاری): the tiered price system of docs/PARTNER_PROGRAM.md.
// A partner is a user with agent = 'n' (or 'n2' = credit level). The tier is a percentage in `user.pricediscount`, which the bot already applies on buying,
// renewing and bulk creating. This module computes the tier from the last 30 days of volume, applies it (upgrade at once; downgrade only after TWO months below,
// with a notice), and gives the panel the numbers. SIMULATION IS THE DEFAULT: until `partners:mode` is 'live' nothing is written and nobody is messaged.
// Never touched automatically: credit partners (n2), partners an administrator has LOCKED (a manual price), and partners whose agent expiry has passed.
import { all, one, run, sql, kvGet, kvSet } from './db.js'
import { sendmessage } from './tg.js'

const now = () => Math.floor(Date.now() / 1000)
const DAY = 86400
const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d } catch { return d } }
export const DEFAULT_TIERS = [
  { id: 'start', name: 'شروع', gb: 0, pct: 10 },
  { id: 'bronze', name: 'برنز', gb: 100, pct: 15 },
  { id: 'silver', name: 'نقره', gb: 500, pct: 20 },
  { id: 'gold', name: 'طلا', gb: 2048, pct: 25 },
  { id: 'platinum', name: 'پلاتین', gb: 5120, pct: 30 },
]
export const MAX_PCT = 40 // a deeper partner price is refused (PARTNER_PROGRAM.md: the lowest margin is about 41%)
export const DOWNGRADE_AFTER_MONTHS = 2

export async function tiersGet() {
  const t = parse(await kvGet('partner:tiers'), null)
  return Array.isArray(t) && t.length ? t : DEFAULT_TIERS
}
export function tiersValidate(list) {
  if (!Array.isArray(list) || list.length < 2 || list.length > 8) return 'بین ۲ تا ۸ پله لازم است'
  let prevGb = -1, prevPct = -1
  for (const t of list) {
    if (!t.name || !(t.gb >= 0) || !(t.pct >= 1 && t.pct <= MAX_PCT)) return `درصد هر پله باید بین ۱ و ${MAX_PCT} باشد`
    if (t.gb <= prevGb || t.pct <= prevPct) return 'حجم و درصد باید از پله‌ای به پلهٔ بعد بیشتر شود'
    prevGb = t.gb; prevPct = t.pct
  }
  return list[0].gb !== 0 ? 'پلهٔ اول باید از حجم ۰ شروع شود' : ''
}
export async function tiersSet(list) {
  const clean = list.map((t, i) => ({ id: String(t.id || 't' + i), name: String(t.name).slice(0, 20), gb: Number(t.gb), pct: Number(t.pct) }))
  const err = tiersValidate(clean)
  if (err) throw new Error(err)
  await kvSet('partner:tiers', JSON.stringify(clean))
  return clean
}
export const modeGet = async () => ((await kvGet('partners:mode')) === 'live' ? 'live' : 'sim')

/** the tier a volume earns: the highest step whose threshold is reached */
export const tierFor = (tiers, gb) => [...tiers].reverse().find((t) => gb >= t.gb) || tiers[0]
export const tierByPct = (tiers, pct) => [...tiers].reverse().find((t) => Number(pct) >= t.pct) || null

/** GB bought in the last 30 days: new services (invoice) + renewals (service_other.value.volumebuy). Tests, unpaid and refused orders do not count. */
export async function volume30(userId, at = now()) {
  const since = at - 30 * DAY
  const a = await one(sql`SELECT COALESCE(SUM(CAST(Volume AS REAL)), 0) AS v, COUNT(*) AS n, COALESCE(SUM(CAST(price_product AS INTEGER)), 0) AS s FROM invoice
    WHERE id_user = ${String(userId)} AND CAST(time_sell AS INTEGER) >= ${since} AND LOWER(Status) NOT IN ('unpaid','expire','unsuccessful','reject') AND CAST(price_product AS INTEGER) > 0 AND name_product NOT LIKE '%تست%'`)
  const sinceStr = new Date((since + 12600) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/')
  let ren = { v: 0, n: 0, s: 0 }
  try {
    ren = (await one(sql`SELECT COALESCE(SUM(CAST(json_extract(value, '$.volumebuy') AS REAL)), 0) AS v, COUNT(*) AS n, COALESCE(SUM(CAST(price AS INTEGER)), 0) AS s FROM service_other
      WHERE id_user = ${String(userId)} AND type = 'extend_user' AND LOWER(status) = 'paid' AND time >= ${sinceStr}`)) || ren
  } catch { /* a malformed value never stops the report */ }
  return { gb: Number(a?.v ?? 0) + Number(ren.v ?? 0), orders: Number(a?.n ?? 0) + Number(ren.n ?? 0), spent: Number(a?.s ?? 0) + Number(ren.s ?? 0) }
}

export const locksGet = async () => parse(await kvGet('partner:locks'), {})
export const logGet = async () => parse(await kvGet('partner:log'), [])
const logAdd = async (e) => kvSet('partner:log', JSON.stringify([{ t: now(), ...e }, ...(await logGet())].slice(0, 200)))

/** every partner with the numbers the panel and the automation need */
export async function partnersList(at = now()) {
  const tiers = await tiersGet(), locks = await locksGet(), below = parse(await kvGet('partner:below'), {})
  const rows = await all(sql`SELECT id, username, agent, pricediscount, Balance, expire, register FROM user WHERE agent IN ('n', 'n2') ORDER BY CAST(register AS INTEGER) DESC`)
  const out = []
  for (const u of rows) {
    const v = await volume30(u.id, at)
    const pct = Number(u.pricediscount) || 0
    const earned = tierFor(tiers, v.gb), cur = tierByPct(tiers, pct)
    const next = tiers.find((t) => t.gb > v.gb)
    const expired = u.expire && Number(u.expire) > 0 && Number(u.expire) < at
    out.push({
      id: String(u.id), username: String(u.username ?? ''), level: u.agent, pct, tier: cur?.id ?? null, tierName: cur?.name ?? (pct ? 'دستی' : '—'), earned: earned.id, earnedName: earned.name, earnedPct: earned.pct,
      gb30: Math.round(v.gb * 10) / 10, orders30: v.orders, spent30: v.spent, balance: Number(u.Balance) || 0, locked: !!locks[u.id], below: below[u.id] || 0,
      toNext: next ? Math.max(0, Math.ceil(next.gb - v.gb)) : 0, nextName: next?.name ?? '', expired: !!expired, expire: Number(u.expire) || 0,
    })
  }
  return out
}

/** what the automation would do for one partner: {action: 'none'|'up'|'down'|'warn', to: pct} */
export function decide(p, tiers) {
  if (p.level !== 'n' || p.locked || p.expired) return { action: 'none', why: p.level !== 'n' ? 'سطح اعتباری' : p.locked ? 'قفل دستی' : 'نمایندگی منقضی' }
  const earned = tierFor(tiers, p.gb30)
  if (earned.pct > p.pct) return { action: 'up', to: earned.pct, name: earned.name }
  if (earned.pct < p.pct) return p.below + 1 >= DOWNGRADE_AFTER_MONTHS ? { action: 'down', to: earned.pct, name: earned.name } : { action: 'warn', to: earned.pct, name: earned.name }
  return { action: 'none', why: 'هم‌سطح' }
}

const msgUp = (name, pct, next) => `درود 🌿\nسطح همکاری شما به <b>${name}</b> ارتقا یافت؛ از این پس قیمت خرید شما ${pct}٪ زیر لیست است.${next ? `\nتا سطح ${next.name} ${next.gb} گیگ مانده است.` : ''}\nسپاسگزاریم از همراهی‌تان.`
const msgWarn = (name, pct, gb) => `درود 🌿\nحجم خرید ۳۰ روز اخیر شما برای سطح فعلی کافی نیست. اگر تا پایان این ماه به ${gb} گیگ برسید، سطح شما می‌ماند؛ وگرنه ماه بعد به سطح ${name} (${pct}٪) می‌آید.`
const msgDown = (name, pct) => `درود. به دلیل حجم خرید دو ماه اخیر، سطح همکاری شما به ${name} (${pct}٪) تغییر کرد. با بالا رفتن خرید، سطح شما دوباره بالا می‌رود.`

/** the monthly/daily job: one pass over all partners. `dry` = only report. Downgrade needs two month-end passes below the threshold:
 *  the `below` counter grows once per calendar month (never twice in a month) and resets when the volume is back. */
export async function partnersRun({ dry = false, at = now(), mode } = {}) {
  const live = !dry && (mode || (await modeGet())) === 'live'
  const tiers = await tiersGet(), list = await partnersList(at)
  const below = parse(await kvGet('partner:below'), {})
  const month = new Date((at + 12600) * 1000).toISOString().slice(0, 7)
  const seen = parse(await kvGet('partner:below_month'), {})
  const report = []
  for (const p of list) {
    const stored = below[p.id] || 0, counted = seen[p.id] === month
    const prior = counted ? stored - 1 : stored // the months below BEFORE this one (this month counts once, however often the job runs)
    const d = decide({ ...p, below: prior }, tiers)
    if (d.action === 'down' || d.action === 'warn') { if (live && !counted) { below[p.id] = stored + 1; seen[p.id] = month } }
    else if (live && stored) { delete below[p.id]; delete seen[p.id] } // back above the threshold: the count starts over
    if (d.action === 'up' || d.action === 'down') {
      report.push({ id: p.id, username: p.username, action: d.action, from: p.pct, to: d.to, name: d.name })
      if (live) {
        await run(sql`UPDATE user SET pricediscount = ${String(d.to)} WHERE id = ${p.id} AND agent = 'n'`)
        delete below[p.id]; delete seen[p.id]
        await logAdd({ id: p.id, username: p.username, action: d.action, from: p.pct, to: d.to, gb30: p.gb30 })
        const next = tiers.find((t) => t.pct > d.to)
        await sendmessage(p.id, d.action === 'up' ? msgUp(d.name, d.to, next) : msgDown(d.name, d.to), null, 'HTML')
      }
    } else if (d.action === 'warn') {
      report.push({ id: p.id, username: p.username, action: 'warn', from: p.pct, to: d.to, name: d.name })
      if (live && !counted) await sendmessage(p.id, msgWarn(d.name, d.to, tierByPct(tiers, p.pct)?.gb ?? 0), null, 'HTML')
    }
  }
  if (live) { await kvSet('partner:below', JSON.stringify(below)); await kvSet('partner:below_month', JSON.stringify(seen)) }
  return { live, partners: list.length, changes: report }
}

/** cron: once a day (at the first run after 03:00 Tehran) */
export async function partnersTick() {
  const at = now(), d = new Date((at + 12600) * 1000), day = d.toISOString().slice(0, 10)
  if (d.getUTCHours() < 3 || (await kvGet('partner:last_run')) === day) return { skipped: true }
  await kvSet('partner:last_run', day)
  return partnersRun({ at })
}

/** an administrator sets a partner's price by hand: locks it against the automation until released */
export async function partnerSet(id, { pct, lock, level }) {
  const u = await one(sql`SELECT id, agent FROM user WHERE id = ${String(id)} AND agent IN ('n', 'n2')`)
  if (!u) throw new Error('این کاربر همکار نیست')
  if (pct !== undefined) {
    const p = Number(pct)
    if (!(p >= 0 && p <= MAX_PCT)) throw new Error(`درصد باید بین ۰ و ${MAX_PCT} باشد`)
    await run(sql`UPDATE user SET pricediscount = ${String(p)} WHERE id = ${String(id)}`)
    await logAdd({ id: String(id), action: 'manual', to: p })
  }
  if (level !== undefined) {
    if (!['n', 'n2'].includes(level)) throw new Error('سطح نامعتبر')
    await run(sql`UPDATE user SET agent = ${level} WHERE id = ${String(id)}`)
    await logAdd({ id: String(id), action: 'level', to: level })
  }
  if (pct !== undefined && lock === undefined) lock = true // a hand-set price is not overwritten by the automation
  if (lock !== undefined) { const l = await locksGet(); if (lock) l[id] = now(); else delete l[id]; await kvSet('partner:locks', JSON.stringify(l)) }
}

// ---------- partner requests (the «درخواست نمایندگی» of the bot): the list, and a decision that works from the panel as well as from the bot's buttons.
// Accepting makes the user a partner (n) AND gives the first tier (10% by default) — otherwise a partner's price would equal a customer's.
// The claim is atomic: a second tap or a second administrator changes nothing and refunds nothing twice.
export async function requestsList() {
  const rows = await all(sql`SELECT r.id, r.username, r.time, r.Description AS note, r.status, u.Balance AS balance, u.agent AS agent FROM Requestagent r LEFT JOIN user u ON u.id = r.id WHERE r.status = 'waiting' ORDER BY CAST(r.time AS INTEGER) DESC LIMIT 100`)
  return rows.map((r) => ({ id: String(r.id), username: String(r.username ?? ''), at: Number(r.time) || 0, note: String(r.note ?? '').slice(0, 300), balance: Number(r.balance) || 0 }))
}
export async function welcomePct() { return (await tiersGet())[0].pct }

/** decision: 'accept' | 'reject' → {ok, already?, refunded?, pct?}; sends the partner a short respectful message */
export async function requestDecide(id, decision, { type = 'n' } = {}) {
  id = String(id)
  const req = await one(sql`SELECT * FROM Requestagent WHERE id = ${id}`)
  if (!req) return { ok: false, error: 'درخواست پیدا نشد' }
  if (req.status !== 'waiting') return { ok: true, already: true }
  if (decision === 'accept') {
    const claim = await run(sql`UPDATE Requestagent SET status = 'accept', type = ${type} WHERE id = ${id} AND status = 'waiting'`)
    if (Number(claim?.rowsAffected ?? 0) === 0) return { ok: true, already: true }
    const pct = await welcomePct()
    await run(sql`UPDATE user SET agent = ${type}, expire = NULL, pricediscount = CASE WHEN CAST(COALESCE(NULLIF(pricediscount, ''), '0') AS REAL) = 0 THEN ${String(pct)} ELSE pricediscount END WHERE id = ${id}`)
    await sendmessage(id, `درود 🌿\nدرخواست همکاری شما تأیید شد. از این پس قیمت همکار برای شما فعال است (${pct}٪ زیر لیست، و با حجم خرید بیشتر کمتر هم می‌شود).\nبرای شروع، ربات را باز کنید و از منوی خرید استفاده کنید. اگر سؤالی داشتید همین‌جا بنویسید. سپاسگزارم.`, null, 'HTML')
    return { ok: true, pct }
  }
  const claim = await run(sql`UPDATE Requestagent SET status = 'reject' WHERE id = ${id} AND status = 'waiting'`)
  if (Number(claim?.rowsAffected ?? 0) === 0) return { ok: true, already: true }
  const fee = Number((await one(sql`SELECT agentreqprice AS f FROM setting LIMIT 1`))?.f) || 0
  const u = await one(sql`SELECT Balance FROM user WHERE id = ${id}`)
  if (u && fee > 0) await run(sql`UPDATE user SET Balance = ${Math.trunc(Number(u.Balance) || 0) + fee} WHERE id = ${id}`)
  await sendmessage(id, `درود. درخواست همکاری شما در حال حاضر تأیید نشد.${fee > 0 ? ' هزینهٔ درخواست به کیف پول شما برگشت.' : ''}\nاگر می‌خواهید دوباره بررسی شود، با پشتیبانی در ارتباط باشید. سپاسگزارم.`, null, 'HTML')
  return { ok: true, refunded: fee }
}
