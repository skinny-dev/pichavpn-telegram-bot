// Daily pulse (docs/DAILY_PULSE.md): one useful, silent message a day in the customer's own slot (morning / noon / night), more only for people who engage.
// Silent = chat moves to the top of the list without sound. The customer controls it (daily / weekly / off); blocks are watched and the engine brakes itself.
//   kv pulse:on '1'                       switched on (OFF by default)       pulse:mode admins | sample | all      pulse:pct sample percent
//   kv pulse:s:<day>:<slot>:<uid>         sent that slot today               pulse:seen:<uid>   last 30 item ids   pulse:eng:<uid>  last click (unix)
//   kv pulse:freq:<uid> daily|weekly|off  pulse:today:<day> {status,best,update}   pulse:n:<day>:sent|blocked   pulse:paused  (circuit breaker)
import { one, all, run, sql, kvGet, kvSet } from './db.js'
import { telegram, sendmessage, Editmessagetext, answerCallback } from './tg.js'
import { J, intval } from './php.js'
import { tehranParts, loadSchedule, isOffDay } from './schedule.js'
import { memAllow, memSent, memClick, memTired, memStats } from './memory.js'

const DAY = 86400
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const dayKey = (at) => Math.floor((at + 12600) / DAY)
export const SLOT_WINDOWS = { morning: [9, 10.5], noon: [12, 13], night: [19.5, 21] }

// button actions: tracked as engagement (pu_<action>_<item>), then handled by the ordinary route of the bot
const ACTIONS = {
  learn: ['📚 آموزش', 'helpbtns'], support: ['💬 پشتیبانی', 'supportbtns'], services: ['📦 سرویس‌های من', 'backorder'],
  renew: ['🔄 تمدید', 'extendbtn'], wallet: ['💳 کیف پول', 'Add_Balance'], buy: ['🛒 خرید اشتراک', 'buy'], test: ['🎁 تست رایگان', 'usertestbtn'],
  fit: ['🎯 بهترین سرور برای کارم', 'fit_menu'], report: ['💬 گزارش', 'supportbtns'], official: ['🛡 ربات رسمی', 'helpbtns'],
  good: ['👍 خوب', 'pulse_vote_good'], ok: ['🙂 معمولی', 'pulse_vote_ok'], bad: ['👎 بد', 'pulse_vote_bad'],
}
export const PULSE_LIBRARY = [
  { id: 'm1', topic: 'ping_test', kind: 'tip', slot: 'morning', text: 'درود، صبح بخیر ☀️\nنکتهٔ امروز: اگر برای کار از VPN استفاده می‌کنید، قبل از شروع روی سرورها «تست پینگ» بزنید و به سروری وصل شوید که پینگ پایین‌تر دارد.', btns: ['learn', 'support'] },
  { id: 'm2', topic: 'update_sub', kind: 'tip', slot: 'morning', text: 'درود 🌿\nیک یادآوری کوتاه: اگر اتصال‌تان کند شد، اول اشتراک را داخل برنامه «به‌روزرسانی» کنید؛ بیشتر وقت‌ها مشکل همین است.', btns: ['learn', 'support'] },
  { id: 'm3', topic: 'checkin', kind: 'action', slot: 'morning', text: 'درود، صبح‌تان بخیر ☀️\nاگر جایی مشکل دارید همین‌جا بنویسید تا بررسی کنیم.', btns: ['support', 'services'] },
  { id: 'm4', topic: 'services_view', kind: 'tip', slot: 'morning', text: 'درود ☀️\nمی‌دانستید تاریخ انقضا و حجم باقی‌ماندهٔ سرویس‌تان را از «سرویس‌های من» می‌بینید؟ یک نگاه بیندازید.', btns: ['services'] },
  { id: 'm5', topic: 'security', kind: 'tip', slot: 'morning', text: 'درود، یک نکتهٔ امنیتی:\nما هرگز رمز یا کد تأیید از شما نمی‌خواهیم. فقط از همین ربات رسمی خرید کنید.', btns: ['official', 'support'] },
  { id: 'm6', topic: 'server_switch', kind: 'tip', slot: 'morning', text: 'درود 🌿\nاگر امروز سرور اصلی خوب کار نکرد، به «تانل» وصل شوید؛ روی بعضی اپراتورها بهتر است.', btns: ['learn', 'support'] },
  { id: 'n1', topic: 'app_choice', kind: 'tip', slot: 'noon', text: 'یک دقیقه یاد بگیرید 💡\nبرنامهٔ Happ و v2rayTun از پیشنهادی‌ترین‌هاست؛ اگر با یکی مشکل داشتید، دیگری را امتحان کنید.', btns: ['learn'] },
  { id: 'n2', topic: 'server_switch', kind: 'tip', slot: 'noon', text: 'درود 💡\nترفند: اگر وصل هستید ولی صفحه‌ای باز نمی‌شود، سرور دیگری را امتحان کنید؛ گاهی مشکل از مسیر یک سرور است نه اینترنت شما.', btns: ['learn', 'support'] },
  { id: 'n3', topic: 'fit', kind: 'action', slot: 'noon', text: 'یک دقیقه یاد بگیرید 💡\nبرای بهترین سرور برای کارتان (هوش مصنوعی، یوتیوب، اینستاگرام …) از دکمهٔ زیر استفاده کنید.', btns: ['fit', 'support'] },
  { id: 'n4', topic: 'ask_support', kind: 'action', slot: 'noon', text: 'درود 🌿\nسؤالی دربارهٔ اتصال دارید؟ همین‌جا بپرسید؛ معمولاً مشکل با یک توضیح کوتاه حل می‌شود.', btns: ['support'] },
  { id: 'n5', topic: 'ping_test', kind: 'tip', slot: 'noon', text: 'نکتهٔ شبکه 📶\nکیفیت روی هر اپراتور فرق می‌کند. اگر روی اینترنت خانه خوب بود ولی موبایل نه، سرورها را با تست پینگ مقایسه کنید.', btns: ['learn'] },
  { id: 'n6', topic: 'renew_prep', kind: 'action', slot: 'noon', text: 'درود 💡\nقبل از تمدید هم می‌توانید سرویس را از «سرویس‌های من» ببینید و بدون وقفه ادامه دهید.', btns: ['renew', 'services'], seg: 'hasservice' },
  { id: 'e1', topic: 'checkin', kind: 'action', slot: 'night', text: 'درود، شب بخیر 🌙\nاگر امشب برای شبکه‌های اجتماعی یا تماشا وصل می‌شوید و کند بود، سرور دیگری را امتحان کنید؛ ما کنارتان هستیم.', btns: ['support', 'learn'] },
  { id: 'e2', topic: 'vote', kind: 'action', slot: 'night', text: 'درود 🌿\nنظر شما برای ما مهم است: اتصال‌تان این هفته چطور بود؟', btns: ['good', 'ok', 'bad'] },
  { id: 'e3', topic: 'fit', kind: 'action', slot: 'night', text: 'شب بخیر 🌙\nبرای بهترین سرور برای یوتیوب، اینستاگرام یا هوش مصنوعی، از دکمهٔ زیر انتخاب کنید.', btns: ['fit', 'support'] },
  { id: 'e4', topic: 'security', kind: 'tip', slot: 'night', text: 'شب بخیر 🌙\nربات رسمی پیچا فقط یک آدرس دارد. اگر کسی از طرف ما رمز یا کد خواست، گزارش دهید.', btns: ['official', 'report'] },
  { id: 'e5', topic: 'renew_prep', kind: 'action', slot: 'night', text: 'درود 🌿\nموجودی کیف پول‌تان برای تمدید آماده است؛ اگر لازم شد با یک دکمه تمدید کنید.', btns: ['renew', 'wallet'], seg: 'wallet' },
  { id: 'e6', topic: 'test_invite', kind: 'offer', slot: 'night', type: 'offer', text: 'درود، شب بخیر 🌙\nاگر هنوز اتصال را امتحان نکرده‌اید، تست رایگان همین‌جاست؛ چند دقیقه بیشتر طول نمی‌کشد.', btns: ['test', 'support'], seg: 'untested' },
]
const byId = Object.fromEntries(PULSE_LIBRARY.map((i) => [i.id, i]))

const kb = (item, uid) => {
  const rows = [item.btns.filter((a) => ACTIONS[a]).map((a) => ({ text: ACTIONS[a][0], callback_data: `pu_${a}_${item.id}` }))]
  rows.push([{ text: '🔔 تعداد پیام', callback_data: 'pu_freq_menu' }])
  return J({ inline_keyboard: rows })
}

/** which slot may be sent now (Tehran): null = none. Thursday has no night slot, Friday one light morning message, holidays nothing. */
export async function pulseSlotNow(at) {
  const { offdays } = await loadSchedule()
  if (isOffDay(at, offdays)) return null
  const p = tehranParts(at)
  if (p.dow === 'fri') return p.hour >= 11 && p.hour < 12 ? 'morning' : null
  for (const [slot, [a, b]] of Object.entries(SLOT_WINDOWS)) {
    if (slot === 'night' && p.dow === 'thu') continue
    if (p.hour >= a && p.hour < b) return slot
  }
  return null
}

const userSlotSql = (slot) => slot === 'morning' ? 'AND (h < 11.5 OR lm = 0)' : slot === 'noon' ? 'AND h >= 11.5 AND h < 16' : 'AND h >= 16'

async function segmentOk(item, u) {
  if (!item.seg) return true
  if (item.seg === 'wallet') return intval(u.Balance) >= 20000
  if (item.seg === 'hasservice') return !!(await one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${String(u.id)} AND name_product != '' AND Status IN ('active','end_of_time','end_of_volume','sendedwarn','send_on_hold') LIMIT 1`))
  if (item.seg === 'untested') return !(await one(sql`SELECT 1 AS x FROM invoice WHERE id_user = ${String(u.id)} LIMIT 1`))
  return true
}

/** the message for this user and slot: the administrator's «today» inputs first (morning), then the next unseen library item */
async function chooseItem(slot, u, today, at) {
  if (slot === 'morning' && today) {
    if (today.update) return { id: 'x_update', topic: 'update_sub', kind: 'action', slot, text: 'درود 🌿\nبرای اتصال بهتر، لطفاً اشتراک‌تان را داخل برنامه «به‌روزرسانی» کنید؛ تنظیمات سرورها تازه شده است.', btns: ['learn', 'support'] }
    if (today.best) return { id: 'x_best', topic: 'best_today', kind: 'action', slot, text: `درود ☀️\nپیشنهاد امروز: ${String(today.best).slice(0, 200)}\nاگر روی اینترنت شما خوب نبود، از پشتیبانی کمک بگیرید.`, btns: ['fit', 'support'] }
    if (today.status) return { id: 'x_status', topic: 'status_today', kind: 'action', slot, text: `درود، صبح‌تان بخیر ☀️\nوضعیت امروز: ${String(today.status).slice(0, 300)}`, btns: ['support', 'services'] }
  }
  const seen = parse(await kvGet('pulse:seen:' + u.id)) || []
  const pool = []
  for (const i of PULSE_LIBRARY) if (i.slot === slot && (await memAllow(u.id, i, at)).ok) pool.push(i) // what we already told this person (or what they ignored) is not told again
  const lastOffer = seen.slice(-4).some((id) => byId[id]?.type === 'offer')
  const fresh = []
  for (const i of pool) {
    if (seen.includes(i.id)) continue
    if (i.type === 'offer' && lastOffer) continue
    if (!(await segmentOk(i, u))) continue
    fresh.push(i)
  }
  if (fresh.length) return fresh[(dayKey(at) + intval(u.id)) % fresh.length]
  // everything seen: start the cycle again (still respecting segments)
  const again = []
  for (const i of pool) if (!(i.type === 'offer' && lastOffer) && (await segmentOk(i, u))) again.push(i)
  return again.length ? again[(dayKey(at) + intval(u.id)) % again.length] : null
}

async function audienceSql(mode, pct) {
  if (mode === 'admins') return { sqlAnd: "AND CAST(u.id AS INTEGER) IN (SELECT CAST(id_admin AS INTEGER) FROM admin)", pct: null }
  if (mode === 'sample') return { sqlAnd: '', pct }
  return { sqlAnd: '', pct: null }
}

/** one tick: pick up to BATCH people due in the current slot and send silently. Called by the lazy cron (small) and by the endpoint pulse_tick (cron, large). */
export async function pulseTick(c, { at = Math.floor(Date.now() / 1000), BATCH = 6 } = {}) {
  if ((await kvGet('pulse:on')) !== '1') return { sent: 0, reason: 'off' }
  if (await kvGet('pulse:paused')) return { sent: 0, reason: 'paused' }
  const slot = await pulseSlotNow(at)
  if (!slot) return { sent: 0, reason: 'no_slot' }
  const day = dayKey(at)
  const mode = (await kvGet('pulse:mode')) || 'admins'
  const pct = Math.min(Math.max(intval(await kvGet('pulse:pct')) || 5, 1), 100)
  const aud = await audienceSql(mode, pct)
  const today = parse(await kvGet('pulse:today:' + day))
  const lo = 14 * DAY
  // own slot: the hour they usually use the bot; extra slots: people who clicked something in the last 14 days (max 3 a day)
  const rows = await all(sql`SELECT u.* FROM (
      SELECT *, ((CAST(last_message_time AS INTEGER) + 12600) % 86400) / 3600.0 AS h, CAST(last_message_time AS INTEGER) AS lm FROM user) u
    WHERE u.User_Status = 'Active' AND u.joinchannel = 'active' ${sql.raw(aud.sqlAnd)}
      ${sql.raw(aud.pct ? `AND (CAST(u.id AS INTEGER) % 100) < ${Number(aud.pct)}` : '')}
      AND NOT EXISTS (SELECT 1 FROM kv k WHERE k.key = 'pulse:s:' || ${String(day)} || ':' || ${slot} || ':' || u.id)
      AND NOT EXISTS (SELECT 1 FROM kv k WHERE k.key = 'pulse:freq:' || u.id AND k.value = 'off')
      AND ((1 = 1 ${sql.raw(userSlotSql(slot))}) OR EXISTS (SELECT 1 FROM kv e WHERE e.key = 'pulse:eng:' || u.id AND CAST(e.value AS INTEGER) >= ${at - lo} + 0))
    ORDER BY u.id LIMIT 300`)
  let sent = 0, blocked = 0
  for (const u of rows) {
    if (sent + blocked >= BATCH) break
    const own = (() => { const h = u.h, lm = intval(u.lm); return slot === 'morning' ? (h < 11.5 || lm === 0) : slot === 'noon' ? (h >= 11.5 && h < 16) : h >= 16 })()
    let freq = await kvGet('pulse:freq:' + u.id)
    if (!freq && (await memTired(u.id, at))) { await kvSet('pulse:freq:' + u.id, 'weekly'); freq = 'weekly' } // five ignored in a row: quieter, without asking
    if (freq === 'weekly' && !(tehranParts(at).dow === 'sat' && slot === 'morning')) { await kvSet(`pulse:s:${day}:${slot}:${u.id}`, 's'); continue }
    // at most 3 a day; a person's non-own slot only when engaged (already in the query) and they have had fewer than 3 today
    let todays = 0
    for (const sl of Object.keys(SLOT_WINDOWS)) if (await kvGet(`pulse:s:${day}:${sl}:${u.id}`)) todays++
    if (todays >= 3 || (!own && todays >= 1 && false)) { await kvSet(`pulse:s:${day}:${slot}:${u.id}`, 's'); continue }
    if (await kvGet(`care:sentto:${day}:${u.id}`)) { await kvSet(`pulse:s:${day}:${slot}:${u.id}`, 's'); continue } // a care message today replaces the pulse
    if (at - intval(u.last_message_time) < 900) continue // they are in the bot right now: not at this moment
    const item = await chooseItem(slot, u, today, at)
    if (!item) { await kvSet(`pulse:s:${day}:${slot}:${u.id}`, 's'); continue }
    let res
    try { res = await telegram('sendmessage', { chat_id: u.id, text: item.text, parse_mode: 'HTML', disable_notification: true, reply_markup: kb(item, u.id) }) } catch { res = { ok: false } }
    await kvSet(`pulse:s:${day}:${slot}:${u.id}`, 's')
    if (res && res.ok === false) {
      blocked++
      if (Number(res.error_code) === 403) await kvSet('pulse:freq:' + u.id, 'off') // blocked the bot: never again
      continue
    }
    sent++
    await memSent(u.id, item, at)
    const seen = parse(await kvGet('pulse:seen:' + u.id)) || []
    seen.push(item.id)
    await kvSet('pulse:seen:' + u.id, JSON.stringify(seen.slice(-30)))
    await kvSet(`pulse:n:${day}:sent`, String(intval(await kvGet(`pulse:n:${day}:sent`)) + 1))
    await kvSet(`pulse:n:sent:${item.id}`, String(intval(await kvGet(`pulse:n:sent:${item.id}`)) + 1))
  }
  if (blocked) await kvSet(`pulse:n:${day}:blocked`, String(intval(await kvGet(`pulse:n:${day}:blocked`)) + blocked))
  await pulseBrake(day)
  return { sent, blocked, slot }
}

/** circuit breaker: > 2 % blocked over the last 7 days (and at least 200 sent) → pause and tell the administrators */
async function pulseBrake(day) {
  let s = 0, b = 0
  for (let d = day - 6; d <= day; d++) { s += intval(await kvGet(`pulse:n:${d}:sent`)); b += intval(await kvGet(`pulse:n:${d}:blocked`)) }
  if (s >= 200 && b / (s + b) > 0.02) await kvSet('pulse:paused', `blocked ${b} of ${s + b} in 7 days`)
}

export const pulseRoutes = [
  async (c) => {
    const d = c.datain ?? ''
    let m = /^pu_([a-z]+)_([a-z]\d+)$/.exec(d)
    if (m && ACTIONS[m[1]] && !['good', 'ok', 'bad'].includes(m[1])) {
      // engagement counts, then the ordinary route of the bot handles the real action
      await kvSet('pulse:eng:' + c.from_id, String(Math.floor(Date.now() / 1000)))
      await kvSet(`pulse:n:click:${m[2]}`, String(intval(await kvGet(`pulse:n:click:${m[2]}`)) + 1))
      const it = byId[m[2]]
      if (it) await memClick(c.from_id, it.topic)
      c.datain = ACTIONS[m[1]][1]
      return false
    }
    if (m && ['good', 'ok', 'bad'].includes(m[1])) {
      await kvSet('pulse:eng:' + c.from_id, String(Math.floor(Date.now() / 1000)))
      if (byId.e2) await memClick(c.from_id, 'vote')
      await kvSet(`pulse:n:vote:${m[1]}`, String(intval(await kvGet(`pulse:n:vote:${m[1]}`)) + 1))
      await answerCallback(c.callback_query_id, 'سپاسگزاریم 🌿')
      await Editmessagetext(c.from_id, c.message_id, 'سپاسگزاریم که نظرتان را گفتید 🌿', null, 'HTML')
      return true
    }
    if (d === 'pu_freq_menu') {
      await answerCallback(c.callback_query_id, '')
      await Editmessagetext(c.from_id, c.message_id, '🔔 چند وقت یک‌بار برایتان نکتهٔ مفید بفرستیم؟', J({ inline_keyboard: [[{ text: 'روزانه', callback_data: 'pu_freq_daily' }, { text: 'هفتگی', callback_data: 'pu_freq_weekly' }], [{ text: 'خاموش', callback_data: 'pu_freq_off' }]] }), 'HTML')
      return true
    }
    m = /^pu_freq_(daily|weekly|off)$/.exec(d)
    if (m) {
      await kvSet('pulse:freq:' + c.from_id, m[1])
      await answerCallback(c.callback_query_id, 'ثبت شد')
      await Editmessagetext(c.from_id, c.message_id, m[1] === 'off' ? 'باشه، دیگر نکتهٔ روزانه نمی‌فرستیم 🙏 هر وقت خواستید از «راهنما» استفاده کنید.' : m[1] === 'weekly' ? 'باشه، هفته‌ای یک‌بار (شنبه‌ها) برایتان می‌فرستیم 🌿' : 'باشه، روزانه برایتان نکتهٔ کوتاه می‌فرستیم 🌿', null, 'HTML')
      return true
    }
    return false
  },
]

/** numbers for the administrator */
export async function pulseStats(at = Math.floor(Date.now() / 1000)) {
  const day = dayKey(at)
  let s7 = 0, b7 = 0
  for (let d = day - 6; d <= day; d++) { s7 += intval(await kvGet(`pulse:n:${d}:sent`)); b7 += intval(await kvGet(`pulse:n:${d}:blocked`)) }
  const items = []
  for (const i of PULSE_LIBRARY) { const sn = intval(await kvGet(`pulse:n:sent:${i.id}`)); if (sn) items.push({ id: i.id, sent: sn, clicks: intval(await kvGet(`pulse:n:click:${i.id}`)) }) }
  const freq = await all(sql`SELECT value, COUNT(*) AS n FROM kv WHERE key LIKE 'pulse:freq:%' GROUP BY value`)
  return {
    on: (await kvGet('pulse:on')) === '1', mode: (await kvGet('pulse:mode')) || 'admins', pct: intval(await kvGet('pulse:pct')) || 5, paused: await kvGet('pulse:paused'),
    today: { sent: intval(await kvGet(`pulse:n:${day}:sent`)), blocked: intval(await kvGet(`pulse:n:${day}:blocked`)) }, week: { sent: s7, blocked: b7 },
    items, freq: Object.fromEntries(freq.map((r) => [r.value, Number(r.n)])), votes: { good: intval(await kvGet('pulse:n:vote:good')), ok: intval(await kvGet('pulse:n:vote:ok')), bad: intval(await kvGet('pulse:n:vote:bad')) },
    todayInputs: parse(await kvGet('pulse:today:' + day)),
  }
}

export async function pulseTest(c, slot) {
  const items = PULSE_LIBRARY.filter((i) => i.slot === slot)
  const item = items[(dayKey(Math.floor(Date.now() / 1000))) % items.length]
  await telegram('sendmessage', { chat_id: c.from_id, text: item.text, parse_mode: 'HTML', disable_notification: true, reply_markup: kb(item, c.from_id) })
}
