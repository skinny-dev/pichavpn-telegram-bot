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

/** why a person must not get the C6 message now (null = may be written to): inactive | optout | bought | paid | ticket | cap */
async function whySkip(T, r, u, at) {
  if (!u || u.User_Status !== 'Active') return 'inactive'
  if (intval(await kvGet('care:optout:' + r.id_user)) > at) return 'optout'
  // somebody who already bought (or paid lately) is not asked why they did not
  if (await one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${String(r.id_user)} AND name_product != ${T.common.labels.testServiceName} AND Status != 'Unpaid' LIMIT 1`)) return 'bought'
  if (await one(sql`SELECT 1 AS x FROM Payment_report WHERE id_user = ${String(r.id_user)} AND payment_Status = 'paid' LIMIT 1`)) return 'paid'
  // an open conversation with support: leave it alone
  if (await one(sql`SELECT 1 AS x FROM support_message WHERE iduser = ${String(r.id_user)} AND status != 'close' LIMIT 1`)) return 'ticket'
  // one care message per person per week
  if (at - intval(await kvGet('care:last:' + r.id_user)) < 7 * DAY) return 'cap'
  return null
}

/** one run (lazy cron, every ~10 min): at most BATCH messages, only inside the working-week windows (schedule.js), never twice for the same case */
export async function careRun(c, { at = Math.floor(Date.now() / 1000), BATCH = 4 } = {}) {
  if (!(await careOn('C6'))) return { sent: 0, reason: 'off' }
  const slot = careTime(at, await loadSchedule())
  if (!slot.ok) return { sent: 0, reason: 'quiet', why: slot.why }
  const mode = sendMode('C6', at, await loadBands())
  if (mode === 'none') return { sent: 0, reason: 'quiet', why: 'avoid_hours' }
  const T = c.T
  const hourNow = tehranParts(at).hour
  const dayKey = 'care:day:' + Math.floor((at + 12600) / DAY)
  const maxDay = intval(await kvGet('care:max_day')) || 60
  let today = intval(await kvGet(dayKey))
  if (today >= maxDay) return { sent: 0, reason: 'daycap' }
  // test accounts 23 h – 6 days old that nobody has handled yet
  const lo = mode === 'personal' ? hourNow - 0.75 : -1, hi = mode === 'personal' ? hourNow + 0.75 : 25 // personal: only people whose own hour (the hour they took the test) is now
  const rows = await all(sql`SELECT i.id_invoice, i.id_user, i.time_sell FROM invoice i
    WHERE i.name_product = ${T.common.labels.testServiceName} AND CAST(i.time_sell AS INTEGER) BETWEEN ${at - 6 * DAY} AND ${at - 23 * 3600}
      AND NOT EXISTS (SELECT 1 FROM kv k WHERE k.key = 'care:C6:' || i.id_user || ':' || i.id_invoice)
      AND ((CAST(i.time_sell AS INTEGER) + 12600) % 86400) / 3600.0 BETWEEN ${lo} + 0 AND ${hi} + 0
    ORDER BY CAST(i.time_sell AS INTEGER) ASC LIMIT 25`)
  let sent = 0
  for (const r of rows) {
    if (sent >= BATCH || today >= maxDay) break
    const key = `care:C6:${r.id_user}:${r.id_invoice}`
    const skip = (why) => kvSet(key, JSON.stringify({ state: 'skipped', reason: why, at }))
    const u = await one(sql`SELECT * FROM user WHERE id = ${String(r.id_user)}`)
    const why = await whySkip(T, r, u, at)
    if (why) { await skip(why); continue }
    // writing to the bot right now: not the moment
    if (at - intval(u.last_message_time) < 1800) continue
    try {
      const res = await sendmessage(r.id_user, C6_TEXT(u.namecustom && u.namecustom !== 'none' ? u.namecustom : ''), C6_KB(r.id_invoice), 'HTML')
      if (res && res.ok === false) { await skip('blocked'); continue }
    } catch { await skip('blocked'); continue }
    await kvSet(key, JSON.stringify({ state: 'sent', at, mode }))
    await kvSet('care:last:' + r.id_user, String(at))
    await kvSet(dayKey, String(++today))
    await bump('care:n:C6:sent')
    sent++
  }
  return { sent }
}

const GUIDE = {
  slow: '🐢 متأسفیم که سرعت خوب نبود. چند چیز را امتحان کنید:\n\n• برنامهٔ **Happ** یا **v2rayTun** را استفاده کنید (از پیشنهادی‌ترین‌هاست).\n• داخل برنامه روی هر سرور «تست پینگ» بزنید و به سروری وصل شوید که عدد می‌دهد.\n• اگر مستقیم خوب نبود، به سرور «تانل» وصل شوید.\n\nاگر باز هم خوب نشد بفرمایید تا بررسی کنیم.',
  fail: '❌ متأسفیم که وصل نشد. این‌ها معمولاً مشکل را حل می‌کند:\n\n• مطمئن شوید به **اشتراک خودتان** وصل می‌شوید، نه کانفیگ دیگری.\n• داخل برنامه اشتراک را **به‌روزرسانی** کنید.\n• برنامه را عوض کنید: **Happ** یا **v2rayTun**.\n• روی سرورها «تست پینگ» بزنید و به سروری وصل شوید که پینگ دارد.\n\nاگر باز هم وصل نشد، برای بررسی با پشتیبانی صحبت کنید.',
  net: '📶 ممنون که گفتید؛ کیفیت روی هر اپراتور و شبکه فرق می‌کند. پیشنهاد می‌کنیم:\n\n• چند سرور و تانل مختلف را با «تست پینگ» امتحان کنید؛ معمولاً یکی روی اینترنت شما بهتر کار می‌کند.\n• برنامه را عوض کنید: **Happ** یا **v2rayTun**.\n\nاگر خواستید، با پشتیبانی صحبت کنید تا بهترین سرور را برای اپراتورتان پیشنهاد بدهند.',
}
const HELP_KB = J({ inline_keyboard: [[{ text: '💬 صحبت با پشتیبانی', callback_data: 'supportbtns' }], [{ text: '🔕 دیگر پیام نده', callback_data: 'care6_stop_0' }]] })

export const careRoutes = [
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

/** numbers for the admin: sent / answered by reason / opt-outs / bought within 48 h of a message */
export async function careStats(c) {
  const rows = await all(sql`SELECT key, value FROM kv WHERE key LIKE 'care:C6:%:%'`)
  let sent = 0, answered = 0, bought48 = 0
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
    const b = await one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${uid} AND name_product != ${c.T.common.labels.testServiceName} AND Status != 'Unpaid' AND CAST(time_sell AS INTEGER) BETWEEN ${intval(v.at)} AND ${intval(v.at) + 2 * DAY} LIMIT 1`)
    if (b) { bought48++; bk.bought++ }
  }
  const n = async (k) => intval(await kvGet('care:n:C6:' + k))
  return { on: await careOn('C6'), sent, answered, bought48, skipped, byHour, reasons: { good: await n('good'), slow: await n('slow'), fail: await n('fail'), net: await n('net') }, optouts: await n('optout') }
}

export const TEST_INV = '999999999' // a sample message to the administrator: answers are shown but nothing is recorded

/** what a run would do right now, without sending or recording anything */
export async function carePreview(c, at = Math.floor(Date.now() / 1000)) {
  const T = c.T
  const rows = await all(sql`SELECT i.id_invoice, i.id_user, i.time_sell FROM invoice i
    WHERE i.name_product = ${T.common.labels.testServiceName} AND CAST(i.time_sell AS INTEGER) BETWEEN ${at - 6 * DAY} AND ${at - 23 * 3600}
      AND NOT EXISTS (SELECT 1 FROM kv k WHERE k.key = 'care:C6:' || i.id_user || ':' || i.id_invoice)
    ORDER BY CAST(i.time_sell AS INTEGER) ASC LIMIT 400`)
  const out = { waiting: rows.length, eligible: 0, skip: {} }
  for (const r of rows) {
    const why = await whySkip(T, r, await one(sql`SELECT * FROM user WHERE id = ${String(r.id_user)}`), at)
    if (why) out.skip[why] = (out.skip[why] || 0) + 1
    else out.eligible++
  }
  const slot = careTime(at, await loadSchedule())
  const mode = sendMode('C6', at, await loadBands())
  out.now = slot.ok ? (mode === 'none' ? 'پنجرهٔ بسته (ساعت پرهیز)' : mode === 'band' ? 'ساعت بهتر: همه' : 'فقط ساعت شخصی') : 'بسته (' + slot.why + ')'
  out.max_day = intval(await kvGet('care:max_day')) || 60
  return out
}
