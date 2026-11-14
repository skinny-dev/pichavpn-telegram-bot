// /care — the administrator's switch and numbers for the customer-care follow-ups (care.js)
import { kvSet } from '../db.js'
import { sendmessage } from '../tg.js'
import { careStats } from '../care.js'

export const adminCareRoutes = [
  async (c) => {
    const m = /^\/care(?:\s+(on|off)\s+(C6))?\s*$/.exec(c.text ?? '')
    if (!m || c.adminRow?.rule !== 'administrator') return false
    if (m[1]) {
      await kvSet('care:on:' + m[2], m[1] === 'on' ? '1' : '0')
      await sendmessage(c.from_id, `پیگیری ${m[2]} (تست‌گیرندهٔ بی‌خرید) ${m[1] === 'on' ? '🟢 روشن شد' : '⚫️ خاموش شد'}.`, null, 'HTML')
      return true
    }
    const s = await careStats(c)
    const skipped = Object.entries(s.skipped).map(([k, v]) => `${k}: ${v}`).join('، ') || '—'
    await sendmessage(c.from_id, [
      '🤝 <b>مراقبت از مشتری — تست‌گیرندهٔ بی‌خرید (C6)</b>',
      `وضعیت: ${s.on ? '🟢 روشن' : '⚫️ خاموش'}  (/care on C6 · /care off C6)`,
      `ارسال‌شده: ${s.sent} · پاسخ داده‌اند: ${s.answered} · خرید تا ۴۸ ساعت بعد: ${s.bought48}`,
      `پاسخ‌ها: 👍 ${s.reasons.good} · 🐢 کند ${s.reasons.slow} · ❌ وصل نشد ${s.reasons.fail} · 📶 اینترنت ${s.reasons.net}`,
      `«دیگر پیام نده»: ${s.optouts}`,
      `ردشده‌ها: ${skipped}`,
    ].join('\n'), null, 'HTML')
    return true
  },
]
