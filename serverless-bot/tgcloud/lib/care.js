// Customer-care follow-ups (docs/GROWTH_SYSTEM.md §14) — problem first, never pushy. A small engine; each case = a detector + one message + answers.
// Implemented here: C6 «test finished, not converted». State lives in kv (care:*), nothing else is added to the database.
//   care:on:C6            '1' = the case is switched on (OFF until an administrator sends /care on C6)
//   care:C6:<uid>:<inv>   {state: sent|answered|skipped, at, reason}   one message per case, ever
//   care:last:<uid>       unix time of the last follow-up to that person (weekly cap)
//   care:optout:<uid>     unix time until which nothing is sent (60 days after «دیگر پیام نده»)
//   care:n:C6:<reason>    counters for the reasons ranking
import { one, all, run, sql, kvGet, kvSet } from './db.js'
import { sendmessage, Editmessagetext, answerCallback } from './tg.js'
import { J, intval } from './php.js'
import { loadSchedule, careTime, loadBands, sendMode, tehranParts } from './schedule.js'

const DAY = 86400
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
export const careOn = async (id) => (await kvGet('care:on:' + id)) === '1'
const bump = async (key) => kvSet(key, String(intval(await kvGet(key)) + 1))

export const C6_TEXT = (name) => `درود${name ? ' ' + esc(name) : ''} 🌿\n\nتست پیچا برای شما تمام شد؛ سپاسگزاریم که امتحان کردید.\nاتصال و سرعتش چطور بود؟ اگر چیزی راضی‌تان نکرد بفرمایید تا درستش کنیم.`
export const C6_KB = (inv) => J({ inline_keyboard: [
  [{ text: '👍 خوب بود', callback_data: 'care6_good_' + inv }, { text: '🐢 کند بود', callback_data: 'care6_slow_' + inv }],
  [{ text: '❌ وصل نمی‌شد', callback_data: 'care6_fail_' + inv }, { text: '📶 روی اینترنت من خوب نبود', callback_data: 'care6_net_' + inv }],
  [{ text: '🔕 دیگر پیام نده', callback_data: 'care6_stop_' + inv }],
] })

const nm = (u) => (u && u.namecustom && u.namecustom !== 'none' ? u.namecustom : '')

export const C10_TEXT = (name) => `درود${name ? ' ' + esc(name) : ''} 🌿\n\nدیدیم هنوز اتصال آزمایشی نگرفته‌اید. اگر مطمئن نیستید پیچا برای کار یا شبکه‌های اجتماعی‌تان مناسب است، می‌توانید رایگان امتحانش کنید؛ چند دقیقه بیشتر طول نمی‌کشد.\nاگر سؤالی هم دارید همین‌جا بپرسید.`
export const C10_KB = () => J({ inline_keyboard: [
  [{ text: '🎁 گرفتن تست رایگان', callback_data: 'usertestbtn' }],
  [{ text: '❓ سؤال دارم', callback_data: 'supportbtns' }],
  [{ text: '✅ فعلاً نیاز ندارم', callback_data: 'care10_no_0' }, { text: '🔕 دیگر پیام نده', callback_data: 'care10_stop_0' }],
] })

/** rules shared by every case: inactive | optout | (case rule) | ticket | cap — null = may be written to */
async function commonSkip(r, u, at, caseRule, noCap = false) {
  if (!u || u.User_Status !== 'Active') return 'inactive'
  if (intval(await kvGet('care:optout:' + r.id_user)) > at) return 'optout'
  const own = await caseRule()
  if (own) return own
  // an open conversation with support: leave it alone
  if (await one(sql`SELECT 1 AS x FROM support_message WHERE iduser = ${String(r.id_user)} AND status != 'close' LIMIT 1`)) return 'ticket'
  // one care message per person per week
  if (!noCap && at - intval(await kvGet('care:last:' + r.id_user)) < 7 * DAY) return 'cap'
  return null
}
const paidBefore = (r) => one(sql`SELECT 1 AS x FROM Payment_report WHERE id_user = ${String(r.id_user)} AND payment_Status = 'paid' LIMIT 1`)

export const T1_TEXT = (name, ref, giftGb) => {
  const d1 = /-d1$/.test(ref)
  const gift = giftGb > 0 ? `\nبرای اولین خرید ${giftGb} گیگ هدیه هم داریم 🎁` : ''
  return d1
    ? `درود${name ? ' ' + esc(name) : ''} 🌿\n\nتست شما حدود یک روز دیگر تمام می‌شود. اگر اتصال برایتان خوب بوده، می‌توانید همین حالا سرویس را ادامه بدهید تا وقفه‌ای پیش نیاید.${gift}\nاگر مشکلی دارید همین‌جا بفرمایید.`
    : `درود${name ? ' ' + esc(name) : ''} 🌿\n\nتست شما کمی دیگر تمام می‌شود. اگر اتصال خوب بود، برای ادامهٔ بدون وقفه سرویس بگیرید.${gift}`
}
export const T1_KB = () => J({ inline_keyboard: [
  [{ text: '🛒 ادامه با خرید', callback_data: 'buy' }],
  [{ text: '💬 مشکل دارم', callback_data: 'supportbtns' }, { text: '🔕 دیگر پیام نده', callback_data: 'caret1_stop_0' }],
] })

/** the cases: id, who is due (rows {id_user, ref}), the message, the person-level rule */
const CASES = [
  {
    id: 'T1', live: true, noCap: true, // the test is still running: 1 day before the end and again shortly before (an hour; 20 min for a short test) — the person is mid-test, so no working-week window
    rows: (c, at, lo, hi, limit) => all(sql`SELECT x.id_user AS id_user, x.ref AS ref FROM (
        SELECT i.id_user AS id_user, i.id_invoice || '-d1' AS ref,
               CAST(i.time_sell AS INTEGER) + CAST(i.Service_time AS REAL) * 3600 AS expiry, CAST(i.Service_time AS REAL) AS dh, 24 * 3600 AS lead, 6 * 3600 AS stop
        FROM invoice i WHERE i.name_product = ${c.T.common.labels.testServiceName}
        UNION ALL
        SELECT i.id_user, i.id_invoice || '-h1', CAST(i.time_sell AS INTEGER) + CAST(i.Service_time AS REAL) * 3600, CAST(i.Service_time AS REAL),
               CASE WHEN CAST(i.Service_time AS REAL) < 3 THEN 1200 ELSE 3600 END + 1500, 300
        FROM invoice i WHERE i.name_product = ${c.T.common.labels.testServiceName}) x
      WHERE x.dh > 0 AND (x.ref NOT LIKE '%-d1' OR x.dh >= 36)
        AND x.expiry - x.lead <= ${at} + 0 AND ${at} + 0 <= x.expiry - x.stop
        AND NOT EXISTS (SELECT 1 FROM kv k WHERE k.key = 'care:T1:' || x.id_user || ':' || x.ref)
      ORDER BY x.expiry ASC LIMIT ${limit}`),
    text: async (u, r) => T1_TEXT(nm(u), r.ref, intval(await kvGet('care:firstgift_gb'))), kb: () => T1_KB(),
    rule: (c, r) => async () => {
      if (await one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${String(r.id_user)} AND name_product != ${c.T.common.labels.testServiceName} AND Status != 'Unpaid' LIMIT 1`)) return 'bought'
      if (await paidBefore(r)) return 'paid'
      return null
    },
    converted: (c, uid, from) => one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${uid} AND name_product != ${c.T.common.labels.testServiceName} AND Status != 'Unpaid' AND CAST(time_sell AS INTEGER) BETWEEN ${from} AND ${from + 2 * DAY} LIMIT 1`),
  },
  {
    id: 'C6', // test finished, not converted: test accounts 23 h – 6 days old
    rows: (c, at, lo, hi, limit) => all(sql`SELECT i.id_user AS id_user, i.id_invoice AS ref FROM invoice i
      WHERE i.name_product = ${c.T.common.labels.testServiceName} AND CAST(i.time_sell AS INTEGER) BETWEEN ${at - 6 * DAY} AND ${at - 23 * 3600}
        AND CAST(i.time_sell AS INTEGER) + CAST(i.Service_time AS REAL) * 3600 <= ${at} + 0 -- «test finished» is only true when the test has really ended
        AND NOT EXISTS (SELECT 1 FROM kv k WHERE k.key = 'care:C6:' || i.id_user || ':' || i.id_invoice)
        AND ((CAST(i.time_sell AS INTEGER) + 12600) % 86400) / 3600.0 BETWEEN ${lo} + 0 AND ${hi} + 0
      ORDER BY CAST(i.time_sell AS INTEGER) ASC LIMIT ${limit}`),
    text: (u) => C6_TEXT(nm(u)), kb: (r) => C6_KB(r.ref),
    rule: (c, r) => async () => {
      // somebody who already bought (or paid lately) is not asked why they did not
      if (await one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${String(r.id_user)} AND name_product != ${c.T.common.labels.testServiceName} AND Status != 'Unpaid' LIMIT 1`)) return 'bought'
      if (await paidBefore(r)) return 'paid'
      return null
    },
    converted: (c, uid, from) => one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${uid} AND name_product != ${c.T.common.labels.testServiceName} AND Status != 'Unpaid' AND CAST(time_sell AS INTEGER) BETWEEN ${from} AND ${from + 2 * DAY} LIMIT 1`),
  },
  {
    id: 'C10', // never took a test: registered 24 – 72 h ago, no invoice of any kind
    rows: (c, at, lo, hi, limit) => all(sql`SELECT u.id AS id_user, '0' AS ref FROM user u
      WHERE CAST(u.register AS INTEGER) BETWEEN ${at - 3 * DAY} AND ${at - DAY} AND u.User_Status = 'Active'
        AND NOT EXISTS (SELECT 1 FROM invoice i WHERE i.id_user = u.id)
        AND NOT EXISTS (SELECT 1 FROM kv k WHERE k.key = 'care:C10:' || u.id || ':0')
        AND ((CAST(u.register AS INTEGER) + 12600) % 86400) / 3600.0 BETWEEN ${lo} + 0 AND ${hi} + 0
      ORDER BY CAST(u.register AS INTEGER) ASC LIMIT ${limit}`),
    text: (u) => C10_TEXT(nm(u)), kb: () => C10_KB(),
    rule: (c, r) => async () => {
      if (await one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${String(r.id_user)} LIMIT 1`)) return 'tested'
      if (await paidBefore(r)) return 'paid'
      return null
    },
    converted: (c, uid, from) => one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${uid} AND CAST(time_sell AS INTEGER) BETWEEN ${from} AND ${from + 2 * DAY} LIMIT 1`), // took a test (or bought) within 48 h
  },
]
//T1PLACE
export const CASE_IDS = CASES.map((d) => d.id)
const caseDef = (id) => CASES.find((d) => d.id === id)

/** common gate: switched on, working week, sales-psychology hour, daily cap → {mode, hourNow, dayKey, maxDay, today} or {stop} */
async function gate(id, at, live = false) {
  if (!(await careOn(id))) return { stop: { sent: 0, reason: 'off' } }
  let mode = 'band'
  if (live) {
    const h = tehranParts(at).hour // a running test: any day, but not in the night
    if (h < 8 || h >= 23) return { stop: { sent: 0, reason: 'quiet', why: 'night' } }
  } else {
    const slot = careTime(at, await loadSchedule())
    if (!slot.ok) return { stop: { sent: 0, reason: 'quiet', why: slot.why } }
    mode = sendMode(id, at, await loadBands())
    if (mode === 'none') return { stop: { sent: 0, reason: 'quiet', why: 'avoid_hours' } }
  }
  const dayKey = 'care:day:' + Math.floor((at + 12600) / DAY)
  const maxDay = intval(await kvGet('care:max_day')) || 60
  const today = intval(await kvGet(dayKey))
  if (today >= maxDay) return { stop: { sent: 0, reason: 'daycap' } }
  return { mode, hourNow: tehranParts(at).hour, dayKey, maxDay, today }
}

async function runCase(c, def, at, BATCH) {
  const g = await gate(def.id, at, !!def.live)
  if (g.stop) return g.stop
  let today = g.today
  // personal: only people whose own hour (the hour they took the test / registered) is now
  const lo = g.mode === 'personal' ? g.hourNow - 0.75 : -1, hi = g.mode === 'personal' ? g.hourNow + 0.75 : 25
  const rows = await def.rows(c, at, lo, hi, 25)
  let sent = 0
  for (const r of rows) {
    if (sent >= BATCH || today >= g.maxDay) break
    const key = `care:${def.id}:${r.id_user}:${r.ref}`
    const skip = (why) => kvSet(key, JSON.stringify({ state: 'skipped', reason: why, at }))
    const u = await one(sql`SELECT * FROM user WHERE id = ${String(r.id_user)}`)
    const why = await commonSkip(r, u, at, def.rule(c, r), !!def.noCap)
    if (why) { await skip(why); continue }
    // writing to the bot right now: not the moment (a running test is exactly when they are here, so that case does not wait)
    if (!def.live && at - intval(u.last_message_time) < 1800) continue
    try {
      const res = await sendmessage(r.id_user, await def.text(u, r), def.kb(r), 'HTML')
      if (res && res.ok === false) { await skip('blocked'); continue }
    } catch { await skip('blocked'); continue }
    await kvSet(key, JSON.stringify({ state: 'sent', at, mode: g.mode }))
    await kvSet(`care:sentto:${Math.floor((at + 12600) / DAY)}:${r.id_user}`, '1') // the daily pulse yields to a care message the same day
    if (!def.noCap) await kvSet('care:last:' + r.id_user, String(at))
    await kvSet(g.dayKey, String(++today))
    await bump(`care:n:${def.id}:sent`)
    sent++
  }
  return { sent }
}

/** one run (lazy cron, every ~10 min): at most BATCH messages over all cases, inside the working-week windows and the case's hours, never twice for the same case */
export async function careRun(c, { at = Math.floor(Date.now() / 1000), BATCH = 4 } = {}) {
  let sent = 0
  const stops = []
  for (const def of CASES) {
    const r = await runCase(c, def, at, BATCH - sent)
    sent += r.sent
    if (r.reason) stops.push(r)
    if (sent >= BATCH) break
  }
  if (sent > 0) return { sent }
  return stops.find((x) => x.reason !== 'off') || stops[0] || { sent: 0 } // the most informative reason (a case that is simply switched off says the least)
}

export const GUIDE = {
  slow: '🐢 متأسفیم که سرعت خوب نبود. چند چیز را امتحان کنید:\n\n• برنامهٔ **Happ** یا **v2rayTun** را استفاده کنید (از پیشنهادی‌ترین‌هاست).\n• داخل برنامه روی هر سرور «تست پینگ» بزنید و به سروری وصل شوید که عدد می‌دهد.\n• اگر مستقیم خوب نبود، به سرور «تانل» وصل شوید.\n\nاگر باز هم خوب نشد بفرمایید تا بررسی کنیم.',
  fail: '❌ متأسفیم که وصل نشد. این‌ها معمولاً مشکل را حل می‌کند:\n\n• مطمئن شوید به **اشتراک خودتان** وصل می‌شوید، نه کانفیگ دیگری.\n• داخل برنامه اشتراک را **به‌روزرسانی** کنید.\n• برنامه را عوض کنید: **Happ** یا **v2rayTun**.\n• روی سرورها «تست پینگ» بزنید و به سروری وصل شوید که پینگ دارد.\n\nاگر باز هم وصل نشد، برای بررسی با پشتیبانی صحبت کنید.',
  net: '📶 ممنون که گفتید؛ کیفیت روی هر اپراتور و شبکه فرق می‌کند. پیشنهاد می‌کنیم:\n\n• چند سرور و تانل مختلف را با «تست پینگ» امتحان کنید؛ معمولاً یکی روی اینترنت شما بهتر کار می‌کند.\n• برنامه را عوض کنید: **Happ** یا **v2rayTun**.\n\nاگر خواستید، با پشتیبانی صحبت کنید تا بهترین سرور را برای اپراتورتان پیشنهاد بدهند.',
}
const HELP_KB = J({ inline_keyboard: [[{ text: '💬 صحبت با پشتیبانی', callback_data: 'supportbtns' }], [{ text: '🔕 دیگر پیام نده', callback_data: 'care6_stop_0' }]] })

export const careRoutes = [
  async (c) => {
    if (!/^caret1_stop_\d+$/.test(c.datain ?? '')) return false
    await kvSet('care:optout:' + c.from_id, String(Math.floor(Date.now() / 1000) + 60 * DAY)); await bump('care:n:T1:optout')
    await answerCallback(c.callback_query_id, 'باشه')
    await Editmessagetext(c.from_id, c.message_id, 'باشه، دیگر پیامی ارسال نمی‌کنیم. اگر نیاز داشتید همین‌جا هستیم 🙏', null, 'HTML')
    return true
  },
  async (c) => {
    const m = /^care10_(no|stop)_(\d+)$/.exec(c.datain ?? '')
    if (!m) return false
    const at = Math.floor(Date.now() / 1000)
    const key = `care:C10:${c.from_id}:0`
    const cur = parse(await kvGet(key))
    if (m[1] === 'stop') {
      await kvSet('care:optout:' + c.from_id, String(at + 60 * DAY)); await bump('care:n:C10:optout')
      await answerCallback(c.callback_query_id, 'باشه')
      await Editmessagetext(c.from_id, c.message_id, 'باشه، دیگر پیامی ارسال نمی‌کنیم. اگر نیاز داشتید همین‌جا هستیم 🙏', null, 'HTML')
      return true
    }
    await kvSet('care:optout:' + c.from_id, String(at + 30 * DAY)) // «not now»: nothing more for 30 days
    await kvSet(key, JSON.stringify({ ...(cur || {}), state: 'answered', reason: 'no', answered_at: at })); await bump('care:n:C10:no')
    await answerCallback(c.callback_query_id, 'سپاسگزاریم')
    await Editmessagetext(c.from_id, c.message_id, 'باشه 🌱 هر وقت نیاز داشتید، همین‌جا هستیم.', null, 'HTML')
    return true
  },
  async (c) => {
    const m = /^care6_(good|slow|fail|net|stop)_(\d+)$/.exec(c.datain ?? '')
    if (!m) return false
    const [, reason, inv] = m
    const sample = inv === TEST_INV
    const at = Math.floor(Date.now() / 1000)
    const key = `care:C6:${c.from_id}:${inv}`
    const cur = parse(await kvGet(key))
    if (reason === 'stop' && sample) { await answerCallback(c.callback_query_id, 'نمونه: چیزی ثبت نشد'); return true }
    if (reason === 'stop') {
      await kvSet('care:optout:' + c.from_id, String(at + 60 * DAY))
      await bump('care:n:C6:optout')
      await answerCallback(c.callback_query_id, 'باشه')
      await Editmessagetext(c.from_id, c.message_id, 'باشه، دیگر پیامی ارسال نمی‌کنیم. اگر نیاز داشتید همین‌جا هستیم 🙏', null, 'HTML')
      return true
    }
    if (!sample && cur && cur.state === 'answered') { await answerCallback(c.callback_query_id, 'سپاسگزاریم، پاسخ شما ثبت شده است'); return true }
    if (!sample) { await kvSet(key, JSON.stringify({ ...(cur || {}), state: 'answered', reason, answered_at: at })); await bump('care:n:C6:' + reason) }
    await answerCallback(c.callback_query_id, 'سپاسگزاریم')
    if (reason === 'good') {
      await Editmessagetext(c.from_id, c.message_id, 'خوشحالیم 🌿 اگر دوست دارید همین سرویس را ادامه بدهید، پلن‌ها همین‌جاست:', J({ inline_keyboard: [[{ text: '🛒 خرید سرویس', callback_data: 'buy' }], [{ text: '🔕 دیگر پیام نده', callback_data: 'care6_stop_0' }]] }), 'HTML')
    } else {
      await Editmessagetext(c.from_id, c.message_id, GUIDE[reason].replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'), HELP_KB, 'HTML')
    }
    return true
  },
]

/** numbers for the admin: sent / answered / opt-outs / converted within 48 h of a message (C6: bought · C10: took a test or bought) */
export async function careStats(c, id = 'C6') {
  const def = caseDef(id)
  const rows = await all(sql`SELECT key, value FROM kv WHERE key LIKE ${'care:' + id + ':%:%'}`)
  let sent = 0, answered = 0, converted48 = 0
  const skipped = {}, byHour = {}
  for (const r of rows) {
    const v = parse(r.value) || {}
    const uid = r.key.split(':')[2]
    if (v.state === 'skipped') { skipped[v.reason] = (skipped[v.reason] || 0) + 1; continue }
    sent++
    const hh = Math.floor(tehranParts(intval(v.at)).hour)
    const bk = (byHour[hh] ||= { sent: 0, answered: 0, bought: 0 })
    bk.sent++
    if (v.state === 'answered') { answered++; bk.answered++ }
    if (await def.converted(c, uid, intval(v.at))) { converted48++; bk.bought++ }
  }
  const n = async (k) => intval(await kvGet(`care:n:${id}:${k}`))
  const reasons = id === 'T1' ? {} : id === 'C6' ? { good: await n('good'), slow: await n('slow'), fail: await n('fail'), net: await n('net') } : { no: await n('no') }
  return { id, on: await careOn(id), sent, answered, bought48: converted48, converted48, skipped, byHour, reasons, optouts: await n('optout') }
}

export const TEST_INV = '999999999' // a sample message to the administrator: answers are shown but nothing is recorded

/** what a run would do right now, without sending or recording anything */
export async function carePreview(c, id = 'C6', at = Math.floor(Date.now() / 1000)) {
  const def = caseDef(id)
  const rows = await def.rows(c, at, -1, 25, 400)
  const out = { id, waiting: rows.length, eligible: 0, skip: {} }
  for (const r of rows) {
    const why = await commonSkip(r, await one(sql`SELECT * FROM user WHERE id = ${String(r.id_user)}`), at, def.rule(c, r))
    if (why) out.skip[why] = (out.skip[why] || 0) + 1
    else out.eligible++
  }
  const slot = def.live ? { ok: tehranParts(at).hour >= 8 && tehranParts(at).hour < 23, why: 'night' } : careTime(at, await loadSchedule())
  const mode = def.live ? 'band' : sendMode(id, at, await loadBands())
  out.now = slot.ok ? (mode === 'none' ? 'پنجرهٔ بسته (ساعت پرهیز)' : mode === 'band' ? 'ساعت بهتر: همه' : 'فقط ساعت شخصی') : 'بسته (' + slot.why + ')'
  out.max_day = intval(await kvGet('care:max_day')) || 60
  return out
}
