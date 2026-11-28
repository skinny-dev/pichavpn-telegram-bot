// Partners (نمایندگان / همکاران تجاری): the tiered price system of docs/PARTNER_PROGRAM.md.
// A partner is a user with agent = 'n' (or 'n2' = credit level). The tier is a percentage in `user.pricediscount`, which the bot already applies on buying,
// renewing and bulk creating. This module computes the tier from the last 30 days of volume, applies it (upgrade at once; downgrade only after TWO months below,
// with a notice), and gives the panel the numbers. SIMULATION IS THE DEFAULT: until `partners:mode` is 'live' nothing is written and nobody is messaged.
// Never touched automatically: credit partners (n2), partners an administrator has LOCKED (a manual price), and partners whose agent expiry has passed.
import { all, one, run, sql, kvGet, kvSet } from './db.js'
import { sendmessage } from './tg.js'
import { welcomeGive } from './partnerhub.js'
import { J, numberFormat } from './php.js'

const now = () => Math.floor(Date.now() / 1000)
const DAY = 86400
const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d } catch { return d } }
export const DEFAULT_TIERS = [
  { id: 'start', name: 'شروع', gb: 0, pct: 10 },
  { id: 'bronze', name: 'برنز', gb: 100, pct: 12 },
  { id: 'silver', name: 'نقره', gb: 500, pct: 15 },
  { id: 'gold', name: 'طلا', gb: 2048, pct: 18 },
  { id: 'platinum', name: 'پلاتین', gb: 5120, pct: 20 },
]
export const MAX_PCT = 20 // the ceiling of every partner price (decided 1405/09: at 20% the margin of the biggest plan is ~45%, ~32% after fees and the marketer's 5%); a deeper price is refused
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

/** GB bought since a moment: new services (invoice) + renewals (service_other.value.volumebuy). Tests, unpaid and refused orders do not count. */
export async function volumeSince(userId, since) {
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
/** GB bought in the last 30 days (the tier basis) */
export const volume30 = (userId, at = now()) => volumeSince(userId, at - 30 * DAY)

/** the end of a partnership (expiry): back to an ordinary customer at the ordinary prices. The old system left `pricediscount` behind, so an ex-partner kept the discount forever. */
export async function partnerEnd(id) {
  await run(sql`UPDATE user SET agent = 'f', expire = NULL, pricediscount = '0' WHERE id = ${String(id)}`)
  const locks = parse(await kvGet('partner:locks'), {})
  if (locks[id]) { delete locks[id]; await kvSet('partner:locks', JSON.stringify(locks)) }
}
export const locksGet = async () => parse(await kvGet('partner:locks'), {})
export const logGet = async () => parse(await kvGet('partner:log'), [])
const logAdd = async (e) => kvSet('partner:log', JSON.stringify([{ t: now(), ...e }, ...(await logGet())].slice(0, 200)))

// ---------- how a partner starts: someone who came through a marketer or from us gets the first tier (10%) at once; a walk-in applicant gets the partner list
// at once but the tier percent only after a first wallet charge of a reasonable size (kv partner:min_charge, default 300,000 toman) — he may take the free test meanwhile.
export const DEFAULT_MIN_CHARGE = 300000
export const minChargeGet = async () => { const raw = await kvGet('partner:min_charge'); if (raw === null || raw === undefined || raw === '') return DEFAULT_MIN_CHARGE; const v = Number(raw); return Number.isFinite(v) && v >= 0 ? Math.trunc(v) : DEFAULT_MIN_CHARGE }
export const minChargeSet = async (v) => kvSet('partner:min_charge', String(Math.max(0, Math.trunc(Number(v) || 0))))
/** came through a marketer's campaign link (referral_signups) */
export const partnerReferred = async (id) => !!(await one(sql`SELECT 1 AS x FROM referral_signups WHERE user_id = ${String(id)} LIMIT 1`))
const needKey = (id) => 'partner:need:' + id
const payTs = (s) => { s = String(s ?? ''); if (/^\d{9,}$/.test(s)) return Number(s); const m = /^(\d{4})[/-](\d{2})[/-](\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - 12600 : 0 }
/** money the person put into the wallet since `since` (paid top-ups only: not purchases, not deductions) */
async function topupsSince(id, since) {
  const rows = await all(sql`SELECT price, time, id_invoice, Payment_Method AS m FROM Payment_report WHERE id_user = ${String(id)} AND payment_Status = 'paid'`)
  return rows.filter((r) => payTs(r.time) >= since && !/^(getconfigafterpay|getextenduser|getextravolumeuser|getextratimeuser|refunded)\|/.test(String(r.id_invoice ?? '')) && !['low balance by admin', 'cost', 'capital_injection', 'cost_migrated', 'capital_migrated', 'wallet'].includes(String(r.m)))
    .reduce((a, r) => a + (Number(String(r.price ?? '').replace(/[^0-9]/g, '')) || 0), 0)
}
export const partnerPending = async (id) => parse(await kvGet(needKey(id)), null)
/** a partner waiting for his first charge: when the charge is there the first tier is switched on (+ the welcome package) and he is told. Returns the percent given, or null. */
export async function partnerChargeCheck(u) {
  const need = await partnerPending(u.id)
  if (!need) return null
  const enough = (await topupsSince(u.id, Number(need.since) || 0)) >= need.min || (Number(u.Balance) || 0) >= need.min
  if (!enough) return null
  await kvSet(needKey(u.id), '')
  const pct = await welcomePct()
  await run(sql`UPDATE user SET pricediscount = CASE WHEN CAST(COALESCE(NULLIF(pricediscount, ''), '0') AS REAL) = 0 THEN ${String(pct)} ELSE pricediscount END WHERE id = ${String(u.id)}`)
  await sendmessage(String(u.id), `درود 🌿\nسپاسگزارم از شارژ کیف پول؛ قیمت همکار شما فعال شد (${pct}٪ زیر لیست، و با حجم خرید بیشتر کمتر هم می‌شود).\nاز منوی «خرید اشتراک» می‌توانید شروع کنید.`, null, 'HTML')
  await welcomeGive(String(u.id))
  await logAdd({ id: String(u.id), username: String(u.username ?? ''), action: 'activate', to: `${pct}٪` })
  return pct
}

// ---------- rules that keep the partner price honest: a minimum of sales per 30 days (after a grace period, with a warning first), and a few extra free tests at approval
export const RULES_DEFAULT = { minGb: 20, graceDays: 30, warnDays: 7, tests: 3 }
export const rulesGet = async () => ({ ...RULES_DEFAULT, ...parse(await kvGet('partner:rules'), {}) })
export async function rulesSet(patch) {
  const next = await rulesGet()
  for (const k of ['minGb', 'graceDays', 'warnDays', 'tests']) if (k in patch) { const v = Number(patch[k]); if (!(v >= 0 && v <= 100000)) throw new Error(k + ' must be between 0 and 100000'); next[k] = Math.trunc(v) }
  await kvSet('partner:rules', JSON.stringify(next))
  return next
}
const toFaDigits = (v) => String(v).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])
/** the day a partner started (approval / invitation): the minimum-sales rule counts from it. Partners without a start day (the ones we already had) are never touched by the rule. */
export const partnerSinceSet = async (id) => kvSet('partner:since:' + id, String(now()))
/** a few extra free tests to show to his customers, once per partner */
export async function grantTests(id) {
  const r = await rulesGet()
  if (!(r.tests > 0) || (await kvGet('partner:tests_given:' + id))) return 0
  await run(sql`UPDATE user SET limit_usertest = COALESCE(CAST(limit_usertest AS INTEGER), 0) + ${r.tests} WHERE id = ${String(id)}`)
  await kvSet('partner:tests_given:' + id, String(now()))
  return r.tests
}
export const testsLine = (n) => (n > 0 ? `\n\n🎁 ${toFaDigits(n)} تست اضافه هم برای نشان دادن به مشتری‌هات فعال شد (از «اکانت تست»).` : '')
export async function rulesLine() {
  const r = await rulesGet()
  return r.minGb > 0 ? `\n\nیک نکته: برای ماندن قیمت همکار، بعد از ماه اول حداقل ${toFaDigits(r.minGb)} گیگ خرید در ۳۰ روز لازم است (قبلش هم خبرتان می‌کنیم).` : ''
}
/** what the minimum-sales rule says about one partner (p = a row of partnersList): none | minwarn | clear | minend */
export function minSalesCheck(p, r, at = now()) {
  if (!(r.minGb > 0) || p.level !== 'n' || p.locked || p.expired || p.expire > 0 || p.pending || !p.since) return { action: 'none' } // a trial partner (expire set) ends by itself
  if ((at - p.since) / DAY < r.graceDays) return { action: 'none' }
  if (p.gb30 >= r.minGb) return { action: p.minWarn ? 'clear' : 'none' }
  if (!p.minWarn) return { action: 'minwarn' }
  return (at - p.minWarn) / DAY >= r.warnDays ? { action: 'minend' } : { action: 'none' }
}

/** every partner with the numbers the panel and the automation need */
export async function partnersList(at = now()) {
  const tiers = await tiersGet(), locks = await locksGet(), below = parse(await kvGet('partner:below'), {})
  const rows = await all(sql`SELECT id, username, agent, pricediscount, Balance, expire, register, namecustom FROM user WHERE agent IN ('n', 'n2') ORDER BY CAST(register AS INTEGER) DESC`)
  const brandAllow = await brandAllowed()
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
      brand: String(u.namecustom ?? ''), brandOk: (await brandEligibility(u)).ok, brandAllowed: brandAllow.includes(String(u.id)),
      pending: !!(await kvGet(needKey(u.id))), since: Number(await kvGet('partner:since:' + u.id)) || 0, minWarn: Number(await kvGet('partner:minwarn:' + u.id)) || 0, toNext: next ? Math.max(0, Math.ceil(next.gb - v.gb)) : 0, nextName: next?.name ?? '', expired: !!expired, expire: Number(u.expire) || 0,
    })
  }
  return out
}

/** what the automation would do for one partner: {action: 'none'|'up'|'down'|'warn', to: pct} */
export function decide(p, tiers) {
  if (p.pending) return { action: 'none', why: 'منتظر شارژ اول' }
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
  // the minimum-sales rule: a warning first, then (after the warning period) the partner price goes back to the ordinary one
  const rules = await rulesGet()
  for (const p of list) {
    const m = minSalesCheck(p, rules, at)
    if (m.action === 'none') continue
    report.push({ id: p.id, username: p.username, action: m.action, gb30: p.gb30, min: rules.minGb })
    if (!live) continue
    if (m.action === 'clear') { await kvSet('partner:minwarn:' + p.id, ''); continue }
    if (m.action === 'minwarn') {
      await kvSet('partner:minwarn:' + p.id, String(at))
      await sendmessage(p.id, `درود 🌿\nحجم خرید ۳۰ روز اخیر شما ${toFaDigits(p.gb30)} گیگ است. برای ماندن قیمت همکار حداقل ${toFaDigits(rules.minGb)} گیگ در ۳۰ روز لازم است؛ تا ${toFaDigits(rules.warnDays)} روز دیگر فرصت دارید.\nاگر مشکلی هست یا کمکی لازم دارید همین‌جا بنویسید. سپاسگزارم.`, J({ inline_keyboard: [[{ text: '🛒 خرید اشتراک', callback_data: 'buy' }, { text: '💬 پشتیبانی', callback_data: 'supportbtns' }]] }), 'HTML')
      await logAdd({ id: p.id, username: p.username, action: 'minwarn', gb30: p.gb30 })
    } else if (m.action === 'minend') {
      await partnerEnd(p.id)
      await run(sql`DELETE FROM Requestagent WHERE id = ${p.id} AND status = 'accept'`) // he may apply again whenever he wants
      await kvSet('partner:minwarn:' + p.id, '')
      await sendmessage(p.id, `درود 🌿\nچون حجم خرید ۳۰ روز اخیر به ${toFaDigits(rules.minGb)} گیگ نرسید، قیمت همکار فعلاً به قیمت عادی برگشت. سرویس‌های فعال شما همان‌طور که هست ادامه دارد.\nهر وقت خواستید، دوباره از «درخواست نمایندگی» شروع کنید. سپاسگزارم.`, null, 'HTML')
      await logAdd({ id: p.id, username: p.username, action: 'minend', gb30: p.gb30 })
    }
  }
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
    const pct = await welcomePct(), referred = await partnerReferred(id)
    await partnerSinceSet(id)
    const tests = await grantTests(id), extra = testsLine(tests) + (await rulesLine())
    if (referred) {
      await run(sql`UPDATE user SET agent = ${type}, expire = NULL, pricediscount = CASE WHEN CAST(COALESCE(NULLIF(pricediscount, ''), '0') AS REAL) = 0 THEN ${String(pct)} ELSE pricediscount END WHERE id = ${id}`)
      await sendmessage(id, `درود 🌿\nخوش اومدید؛ درخواست همکاری‌تون تأیید شد.\n\nاز همین الان قیمت همکار برای شما فعال است (${pct}٪ زیر لیست؛ هر چه بیشتر بخرید، تخفیف بیشتر می‌شود).\n\n<b>شروع در ۳ قدم:</b>\n۱) کیف پول را کمی شارژ کنید\n۲) از «خرید اشتراک» اولین سرویس را بسازید (یا اول یک تست رایگان بگیرید)\n۳) از «پنل نمایندگی» مشتری‌ها و گزارش خرید را ببینید\n\nاگر سؤالی بود همین‌جا بنویسید؛ پیام همکارها با اولویت بررسی می‌شود. سپاسگزارم.${extra}`, J({ inline_keyboard: [[{ text: '🏠 منوی همکار', callback_data: 'backuser' }], [{ text: '💳 شارژ کیف پول', callback_data: 'account' }, { text: '🎁 تست رایگان', callback_data: 'usertestbtn' }], [{ text: '💬 پشتیبانی ویژه', callback_data: 'supportbtns' }]] }), 'HTML')
      const gift = await welcomeGive(id)
      return { ok: true, pct, gift, tests }
    }
    // a walk-in applicant: partner list now, the tier percent after the first charge (he may take the free test first)
    const min = await minChargeGet()
    await run(sql`UPDATE user SET agent = ${type}, expire = NULL WHERE id = ${id}`)
    if (min > 0) await kvSet(needKey(id), JSON.stringify({ min, since: Math.max(0, Number(req.time) || 0) - 3600, t: now() }))
    const u0 = await one(sql`SELECT id, username, Balance FROM user WHERE id = ${id}`)
    const early = min > 0 && u0 ? await partnerChargeCheck(u0) : null // he may already have charged enough
    if (min === 0) { await run(sql`UPDATE user SET pricediscount = CASE WHEN CAST(COALESCE(NULLIF(pricediscount, ''), '0') AS REAL) = 0 THEN ${String(pct)} ELSE pricediscount END WHERE id = ${id}`); await welcomeGive(id) }
    if (early === null && min > 0) {
      await sendmessage(id, `درود 🌿\nخوش اومدید؛ درخواست همکاری‌تون تأیید شد.\n\nبرای فعال شدن قیمت همکار (${pct}٪ زیر لیست) کافیه کیف پول را یک بار حداقل <b>${numberFormat(min)} تومان</b> شارژ کنید؛ بعدش خودکار فعال می‌شود.\nقبلش هم می‌تونید با «اکانت تست» کیفیت سرویس را خودتان امتحان کنید.\n\nاگر سؤالی بود همین‌جا بنویسید. سپاسگزارم.${extra}`, J({ inline_keyboard: [[{ text: '💳 شارژ کیف پول', callback_data: 'account' }, { text: '🎁 تست رایگان', callback_data: 'usertestbtn' }], [{ text: '💬 پشتیبانی', callback_data: 'supportbtns' }]] }), 'HTML')
    }
    return { ok: true, pct: early ?? (min === 0 ? pct : 0), needCharge: early === null && min > 0, min }
  }
  const claim = await run(sql`UPDATE Requestagent SET status = 'reject' WHERE id = ${id} AND status = 'waiting'`)
  if (Number(claim?.rowsAffected ?? 0) === 0) return { ok: true, already: true }
  const fee = Number((await one(sql`SELECT agentreqprice AS f FROM setting LIMIT 1`))?.f) || 0
  const u = await one(sql`SELECT Balance FROM user WHERE id = ${id}`)
  if (u && fee > 0) await run(sql`UPDATE user SET Balance = ${Math.trunc(Number(u.Balance) || 0) + fee} WHERE id = ${id}`)
  await sendmessage(id, `درود. درخواست همکاری شما در حال حاضر تأیید نشد.${fee > 0 ? ' هزینهٔ درخواست به کیف پول شما برگشت.' : ''}\nاگر می‌خواهید دوباره بررسی شود، با پشتیبانی در ارتباط باشید. سپاسگزارم.`, null, 'HTML')
  return { ok: true, refunded: fee }
}

// ---------- an invitation: the administrator makes someone a partner directly (the shops we call). The user must have started the bot once.
/** who = numeric Telegram id or @username. trialDays > 0 → the partnership expires by itself (the old expiry mechanism: back to an ordinary customer at ordinary prices). */
export async function partnerInvite(who, { type = 'n', trialDays = 0 } = {}) {
  const key = String(who ?? '').trim().replace(/^@/, '')
  if (!key) return { ok: false, error: 'شناسه یا نام کاربری را بنویسید' }
  const u = /^\d+$/.test(key) ? await one(sql`SELECT id, username, agent, pricediscount FROM user WHERE id = ${key}`) : await one(sql`SELECT id, username, agent, pricediscount FROM user WHERE LOWER(username) = ${key.toLowerCase()}`)
  if (!u) return { ok: false, error: 'این کاربر هنوز ربات را شروع نکرده؛ از او بخواهید یک بار /start بزند' }
  if (u.agent === 'n' || u.agent === 'n2') return { ok: false, error: 'این کاربر همین حالا همکار است' }
  const days = Math.max(0, Math.min(365, Math.trunc(Number(trialDays) || 0))), pct = await welcomePct(), id = String(u.id)
  const expire = days > 0 ? now() + days * DAY : null
  await run(sql`UPDATE user SET agent = ${type === 'n2' ? 'n2' : 'n'}, expire = ${expire}, pricediscount = CASE WHEN CAST(COALESCE(NULLIF(pricediscount, ''), '0') AS REAL) = 0 THEN ${String(pct)} ELSE pricediscount END WHERE id = ${id}`)
  await partnerSinceSet(id)
  const inviteTests = await grantTests(id)
  await sendmessage(id, `درود 🌿\nبه همکاری با پیچا دعوت شدید. از این پس قیمت همکار برای شما فعال است (${pct}٪ زیر لیست، و با حجم خرید بیشتر کمتر هم می‌شود).${days ? `\nدورهٔ آشنایی شما ${days} روز است؛ در این مدت با ربات کار کنید و هر سؤالی داشتید همین‌جا بنویسید.` : ''}\nبرای شروع، ربات را باز کنید و از «پنل همکار» استفاده کنید. سپاسگزارم.${testsLine(inviteTests)}${days ? '' : await rulesLine()}`, null, 'HTML')
  const gift = await welcomeGive(id)
  await logAdd({ id, username: String(u.username ?? ''), action: 'invite', to: `${pct}٪` + (days ? ` · ${days} روز` : '') })
  return { ok: true, id, username: String(u.username ?? ''), pct, expire, gift }
}

// ---------- the partner's own brand in the service names: «acme_a1b2» instead of «pichavpn_a1b2»
// Off by default (kv `partner:brand_on`). A partner qualifies when his tier reaches `partner:brand_min` (default: the second tier, bronze), or an
// administrator allows him by hand, or he is a credit partner (n2). The name is Latin letters/digits, unique, never a name of ours.
const BRAND_BLOCKED = /picha|pichavpn|pichanet|admin|support|official|system|root|null|none|test|vpn|bot|telegram/
export function brandNameCheck(raw) {
  const name = String(raw ?? '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(name) || /__|_$/.test(name)) return { ok: false, error: 'نام باید ۳ تا ۲۰ حرف لاتین یا عدد باشد، با حرف شروع شود و فقط یک زیرخط (_) بین کلمه‌ها داشته باشد؛ بدون فاصله (مثل mobile_aria).' }
  if (BRAND_BLOCKED.test(name)) return { ok: false, error: 'این نام مجاز نیست (نام یا نشانی از پیچا، ادمین و پشتیبانی، یا واژهٔ عمومی).' }
  return { ok: true, name }
}
export async function brandSettings() {
  const tiers = await tiersGet()
  const minId = (await kvGet('partner:brand_min')) || tiers[1]?.id || tiers[0].id
  const min = tiers.find((t) => t.id === minId) || tiers[1] || tiers[0]
  return { on: (await kvGet('partner:brand_on')) === '1', minTier: min.id, minName: min.name, minPct: min.pct, minGb: min.gb }
}
export const brandAllowed = async () => parse(await kvGet('partner:brand_ok'), [])
/** {ok, why}: may this user (a row of `user`) use a brand name? */
export async function brandEligibility(u) {
  const st = await brandSettings()
  if (!st.on) return { ok: false, why: 'off' }
  if (!u || !['n', 'n2'].includes(u.agent)) return { ok: false, why: 'not_partner' }
  if (u.agent === 'n2') return { ok: true }
  if ((await brandAllowed()).includes(String(u.id))) return { ok: true }
  if ((Number(u.pricediscount) || 0) >= st.minPct) return { ok: true }
  return { ok: false, why: 'tier', need: st }
}
/** the prefix to use for this user's services, or '' (then the shop's prefix is used) */
export async function brandFor(u) {
  const name = String(u?.namecustom ?? '').trim().toLowerCase()
  if (!name || !brandNameCheck(name).ok) return ''
  return (await brandEligibility(u)).ok ? name : ''
}
/** the partner sets (or an administrator sets for him) a brand name: unique among users and never a prefix of ours */
export async function brandSet(userId, raw) {
  const c = brandNameCheck(raw)
  if (!c.ok) return c
  const taken = await one(sql`SELECT id FROM user WHERE LOWER(namecustom) = ${c.name} AND id != ${String(userId)} LIMIT 1`)
  if (taken) return { ok: false, error: 'این نام قبلاً توسط همکار دیگری گرفته شده است؛ نام دیگری انتخاب کنید.' }
  const shop = await all(sql`SELECT namecustom FROM marzban_panel`)
  if (shop.some((r) => String(r.namecustom ?? '').trim().toLowerCase() === c.name)) return { ok: false, error: 'این نام مجاز نیست.' }
  await run(sql`UPDATE user SET namecustom = ${c.name} WHERE id = ${String(userId)}`)
  return { ok: true, name: c.name }
}
