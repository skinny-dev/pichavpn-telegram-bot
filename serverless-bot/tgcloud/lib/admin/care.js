// /care — the administrator's switch and numbers for the customer-care follow-ups (care.js)
import { kvGet, kvSet } from '../db.js'
import { loadSchedule, describeSchedule, loadBands, DAY_NAMES } from '../schedule.js'
import { sendmessage } from '../tg.js'
import { careStats, carePreview, C6_TEXT, C6_KB, C10_TEXT, C10_KB, TEST_INV, CASE_IDS } from '../care.js'

const num = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= 24 ? x : null }

export const adminCareRoutes = [
  async (c) => {
    if (c.adminRow?.rule !== 'administrator') return false
    const t = String(c.text ?? '').trim()
    // /care schedule
    if (/^\/care schedule$/.test(t)) { await sendmessage(c.from_id, '🗓 <b>زمان‌بندی پیام‌های مراقبتی</b> (به وقت تهران)\n\n' + describeSchedule(await loadSchedule(), await loadBands()) + '\n\nتغییر: /care window thu 9-14 · /care window fri off · /care window all 9-20 · /care offday add 1405/09/05 · /care offday del 1405/09/05 · /care band C6|C10 10-12,18.5-20.5 · /care avoid 13-15 (یا off) · /care hours', null, 'HTML'); return true }
    // /care band C6|C10 10-12,18.5-20.5   ·   /care avoid 13-15|off
    const ranges = (str) => { const out = []; for (const part of str.split(',')) { const mm = /^(\d{1,2}(?:\.\d)?)-(\d{1,2}(?:\.\d)?)$/.exec(part.trim()); if (!mm) return null; const a = num(mm[1]), b = num(mm[2]); if (a === null || b === null || a >= b) return null; out.push([a, b]) } return out }
    let bm = /^\/care band (C6|C10) (\S+)$/.exec(t)
    if (bm) {
      const r = ranges(bm[2])
      if (!r) { await sendmessage(c.from_id, 'ساعت‌ها نامعتبر است (مثال: 10-12,18.5-20.5).', null, 'HTML'); return true }
      let cur = {}; try { cur = JSON.parse((await kvGet('care:bands')) || '{}') } catch { cur = {} }
      cur[bm[1]] = r; await kvSet('care:bands', JSON.stringify(cur))
      await sendmessage(c.from_id, '✅ ثبت شد.\n\n' + describeSchedule(await loadSchedule(), await loadBands()), null, 'HTML'); return true
    }
    bm = /^\/care avoid (\S+)$/.exec(t)
    if (bm) {
      const r = bm[1] === 'off' ? [] : ranges(bm[1])
      if (!r) { await sendmessage(c.from_id, 'ساعت‌ها نامعتبر است (مثال: 13-15 یا off).', null, 'HTML'); return true }
      await kvSet('care:avoid', JSON.stringify(r))
      await sendmessage(c.from_id, '✅ ثبت شد.\n\n' + describeSchedule(await loadSchedule(), await loadBands()), null, 'HTML'); return true
    }
    const tm = /^\/care test(?: (C6|C10))?$/.exec(t)
    if (tm) {
      const id = tm[1] || 'C6'
      await sendmessage(c.from_id, `🧪 نمونهٔ پیام ${id} (فقط برای شما؛ پاسخ‌ها ثبت نمی‌شوند):`, null, 'HTML')
      await sendmessage(c.from_id, id === 'C10' ? C10_TEXT(c.first_name ?? '') : C6_TEXT(c.first_name ?? ''), id === 'C10' ? C10_KB() : C6_KB(TEST_INV), 'HTML')
      return true
    }
    const pm = /^\/care preview(?: (C6|C10))?$/.exec(t)
    if (pm) {
      const p = await carePreview(c, pm[1] || 'C6')
      const skip = Object.entries(p.skip).map(([k, v]) => `${k}: ${v}`).join('، ') || '—'
      await sendmessage(c.from_id, [`👀 <b>پیش‌نمایش ${p.id} (چیزی ارسال یا ثبت نمی‌شود)</b>`, `منتظر بررسی: ${p.waiting} · مجاز برای پیام: <b>${p.eligible}</b>`, `ردشده‌ها: ${skip}`, `الان: ${p.now}`, `سقف روزانه: ${p.max_day}`].join('\n'), null, 'HTML')
      return true
    }
    const hm = /^\/care hours(?: (C6|C10))?$/.exec(t)
    if (hm) {
      const st = await careStats(c, hm[1] || 'C6')
      const rowsTxt = Object.entries(st.byHour).sort((x, y) => Number(x[0]) - Number(y[0])).map(([h, v]) => `${String(h).padStart(2, '0')}:00 — ارسال ${v.sent} · پاسخ ${v.answered} (${Math.round((100 * v.answered) / v.sent)}٪) · خرید ۴۸ساعته ${v.bought}`).join('\n') || 'هنوز دادهٔ کافی نیست.'
      await sendmessage(c.from_id, `⏰ <b>نتیجهٔ ساعت ارسال ${st.id}</b>\n(ساعت‌های با پاسخ و تبدیل بیشتر را در /care band و /care avoid تقویت کنید؛ با ۳۰ ارسال به بالا در هر ساعت معنی دارد)\n\n` + rowsTxt, null, 'HTML'); return true
    }
    // /care window <sat|…|fri|all|weekdays> <from>-<to>|off
    let m = /^\/care window (all|weekdays|sat|sun|mon|tue|wed|thu|fri) (?:(\d{1,2}(?:\.\d)?)-(\d{1,2}(?:\.\d)?)|(off))$/.exec(t)
    if (m) {
      const days = m[1] === 'all' ? DAY_NAMES : m[1] === 'weekdays' ? ['sat', 'sun', 'mon', 'tue', 'wed'] : [m[1]]
      const win = m[4] ? null : [num(m[2]), num(m[3])]
      if (win && (win[0] === null || win[1] === null || win[0] >= win[1])) { await sendmessage(c.from_id, 'ساعت‌ها نامعتبر است (مثال: 9-21).', null, 'HTML'); return true }
      let cur = {}; try { cur = JSON.parse((await kvGet('care:windows')) || '{}') } catch { cur = {} }
      for (const d of days) cur[d] = win
      await kvSet('care:windows', JSON.stringify(cur))
      await sendmessage(c.from_id, '✅ ثبت شد.\n\n' + describeSchedule(await loadSchedule()), null, 'HTML')
      return true
    }
    // /care offday add|del <YYYY/MM/DD | MM/DD>
    m = /^\/care offday (add|del) (\d{4}\/\d{2}\/\d{2}|\d{2}\/\d{2})$/.exec(t)
    if (m) {
      const cur = String((await kvGet('care:offdays')) ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      const next = m[1] === 'add' ? [...new Set([...cur, m[2]])] : cur.filter((x) => x !== m[2])
      await kvSet('care:offdays', next.join(','))
      await sendmessage(c.from_id, '✅ ثبت شد.\n\n' + describeSchedule(await loadSchedule()), null, 'HTML')
      return true
    }
    m = /^\/care(?:\s+(on|off)\s+(C6|C10))?\s*$/.exec(t)
    if (!m) return false
    if (m[1]) {
      await kvSet('care:on:' + m[2], m[1] === 'on' ? '1' : '0')
      await sendmessage(c.from_id, `پیگیری ${m[2]} (${m[2] === 'C6' ? 'تست‌گیرندهٔ بی‌خرید' : 'عضو بدون تست'}) ${m[1] === 'on' ? '🟢 روشن شد' : '⚫️ خاموش شد'}.`, null, 'HTML')
      return true
    }
    const NAMES = { C6: 'تست‌گیرندهٔ بی‌خرید (C6)', C10: 'عضو بدون تست (C10)' }
    const blocks = []
    for (const id of CASE_IDS) {
      const s = await careStats(c, id)
      const skipped = Object.entries(s.skipped).map(([k, v]) => `${k}: ${v}`).join('، ') || '—'
      const reasons = id === 'C6' ? `پاسخ‌ها: 👍 ${s.reasons.good} · 🐢 کند ${s.reasons.slow} · ❌ وصل نشد ${s.reasons.fail} · 📶 اینترنت ${s.reasons.net}` : `«فعلاً نیاز ندارم»: ${s.reasons.no}`
      blocks.push([`🤝 <b>${NAMES[id]}</b>  ${s.on ? '🟢 روشن' : '⚫️ خاموش'}`, `ارسال‌شده: ${s.sent} · پاسخ داده‌اند: ${s.answered} · ${id === 'C6' ? 'خرید' : 'تست یا خرید'} تا ۴۸ ساعت بعد: ${s.converted48}`, reasons, `«دیگر پیام نده»: ${s.optouts} · ردشده‌ها: ${skipped}`].join('\n'))
    }
    await sendmessage(c.from_id, blocks.join('\n\n') + '\n\n/care on C6|C10 · /care off C6|C10 · /care schedule · /care test [C10] · /care preview [C10] · /care hours [C10]', null, 'HTML')
    return true
  },
]
