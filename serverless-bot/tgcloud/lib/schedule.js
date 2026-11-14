// When a customer-care message may go out: Iranian working week (Sat–Wed full days, Thursday half day, Friday off), working hours, holidays.
// The windows are the hours somebody can actually answer a reply — a message that invites an answer at night would wait unanswered.
// Everything is in Tehran time. Defaults below; an administrator changes them with /care window … and /care offday … (kv, no code change).
import { kvGet } from './db.js'
import { jdate } from './fmt.js'

export const DAY_NAMES = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']
export const DAY_FA = { sat: 'شنبه', sun: 'یکشنبه', mon: 'دوشنبه', tue: 'سه‌شنبه', wed: 'چهارشنبه', thu: 'پنج‌شنبه', fri: 'جمعه' }
export const DEFAULT_WINDOWS = { sat: [9, 21], sun: [9, 21], mon: [9, 21], tue: [9, 21], wed: [9, 21], thu: [9, 14], fri: null }
// fixed Jalali dates that are public holidays every year (the lunar ones move: add them with /care offday)
export const FIXED_OFFDAYS = ['01/01', '01/02', '01/03', '01/04', '01/12', '01/13', '03/14', '03/15', '11/22', '12/29']

// Best sending times per case (inside the working window). Reasons (hypotheses, measured by /care hours and adjusted):
//  C6 test follow-up: the customer used the test the day before; they think about connection quality when they next use it — late morning (work
//     starts, VPN needed for work/email) or early evening (social media peak, after work). Never over lunch (13–15), when attention is lowest.
//  A message goes in the person's own hour too (±45 min of the hour they started their test) — that is when they use the internet.
export const DEFAULT_BANDS = { C6: [[10, 12], [18.5, 20.5]], C10: [[18.5, 20.5]] }
export const DEFAULT_AVOID = [[13, 15]]
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

/** {dow: 'sat'…'fri', hour: 13.5, jmd: 'MM/DD', jymd: 'YYYY/MM/DD'} for a unix time, in Tehran */
export function tehranParts(t) {
  const l = t + 12600
  const days = Math.floor(l / 86400)
  const dow = DAY_NAMES[(days + 5) % 7] // 1970-01-01 was a Thursday
  const sec = l - days * 86400
  const jymd = jdate('Y/m/d', t, true)
  return { dow, hour: sec / 3600, jymd, jmd: jymd.slice(5) }
}

export async function loadSchedule() {
  const w = parse(await kvGet('care:windows')) || {}
  const windows = { ...DEFAULT_WINDOWS }
  for (const d of DAY_NAMES) if (d in w) windows[d] = w[d]
  const extra = String((await kvGet('care:offdays')) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return { windows, offdays: extra }
}

/** a public holiday or an administrator's day off (Tehran date of `at`) */
export function isOffDay(at, offdays = []) {
  const p = tehranParts(at)
  return FIXED_OFFDAYS.includes(p.jmd) || offdays.includes(p.jmd) || offdays.includes(p.jymd)
}

/** {ok:true} or {ok:false, why:'holiday'|'closed_day'|'outside_hours'} */
export function careTime(at, { windows, offdays }) {
  const p = tehranParts(at)
  if (FIXED_OFFDAYS.includes(p.jmd) || offdays.includes(p.jmd) || offdays.includes(p.jymd)) return { ok: false, why: 'holiday' }
  const w = windows[p.dow]
  if (!w) return { ok: false, why: 'closed_day' }
  if (p.hour < w[0] || p.hour >= w[1]) return { ok: false, why: 'outside_hours' }
  return { ok: true }
}

/** the configured bands/avoid ranges (kv `care:bands` {C6:[[a,b],…]}, `care:avoid` [[a,b],…]) */
export async function loadBands() {
  const b = parse(await kvGet('care:bands')) || {}
  const a = parse(await kvGet('care:avoid'))
  return { bands: { ...DEFAULT_BANDS, ...b }, avoid: Array.isArray(a) ? a : DEFAULT_AVOID }
}
const inAny = (h, ranges) => (ranges || []).some(([a, b]) => h >= a && h < b)
/** 'band' = everyone due may be sent to now · 'personal' = only people whose own hour is now · 'none' = wait */
export function sendMode(caseId, at, { bands, avoid }) {
  const h = tehranParts(at).hour
  if (inAny(h, avoid)) return 'none'
  return inAny(h, bands[caseId]) ? 'band' : 'personal'
}

export const describeSchedule = ({ windows, offdays }, bandsCfg = null) =>
  DAY_NAMES.map((d) => `${DAY_FA[d]}: ${windows[d] ? `${windows[d][0]}–${windows[d][1]}` : 'تعطیل'}`).join('\n') + `\nتعطیلی ثابت: نوروز، ۱۲ و ۱۳ فروردین، ۱۴ و ۱۵ خرداد، ۲۲ بهمن، ۲۹ اسفند` + (offdays.length ? `\nتعطیلی‌های اضافه: ${offdays.join('، ')}` : '') + (bandsCfg ? `\n\nساعت‌های بهتر: ${Object.entries(bandsCfg.bands).map(([id, r]) => `${id}: ${r.map(([a, b]) => `${a}–${b}`).join('، ')}`).join(' · ')} · ساعت شخصی هر نفر (±۴۵ دقیقه) · پرهیز: ${bandsCfg.avoid.map(([a, b]) => `${a}–${b}`).join('، ') || '—'}` : '')
