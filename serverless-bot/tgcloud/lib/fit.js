// «بهترین سرور برای کارم»: the customer says what they use the VPN for (an AI assistant, YouTube, Instagram …) and gets the administrator's current
// recommendation for it, or is handed to support when none is set. Recommendations are written by hand with /fit (kv fit:<key>), later by probes.
// Counters (care:n:fit:<key>) show which uses people ask about — that is content demand for the radar.
import { kvGet, kvSet, kvDel } from './db.js'
import { sendmessage, Editmessagetext, answerCallback } from './tg.js'
import { J, intval } from './php.js'

export const FIT = {
  ai: '🤖 هوش مصنوعی (Claude، ChatGPT …)',
  yt: '▶️ یوتیوب',
  ig: '📸 اینستاگرام',
  msg: '💬 تلگرام و واتس‌اپ',
  work: '💼 کار، ایمیل و ابزارها',
  game: '🎮 بازی',
  stream: '🎬 تماشا و استریم',
  other: '➕ چیز دیگر',
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const fitMenu = () => J({ inline_keyboard: [
  ...Object.entries(FIT).reduce((rows, [k, label], i) => { if (i % 2 === 0) rows.push([]); rows[rows.length - 1].push({ text: label, callback_data: 'fit_' + k }); return rows }, []),
  [{ text: '↩️ بازگشت', callback_data: 'backuser' }],
] })
export const FIT_INTRO = 'درود 🌿\nبرای چه کاری می‌خواهید بهترین سرور را پیدا کنید؟ همان را انتخاب کنید تا راهنمایی کنیم.'

export async function showFitMenu(c, edit = false) {
  if (edit) await Editmessagetext(c.from_id, c.message_id, FIT_INTRO, fitMenu(), 'HTML')
  else await sendmessage(c.from_id, FIT_INTRO, fitMenu(), 'HTML')
}

export const fitRoutes = [
  async (c) => {
    if (c.datain === 'fit_menu') { await answerCallback(c.callback_query_id, ''); await showFitMenu(c, true); return true }
    const m = /^fit_(ai|yt|ig|msg|work|game|stream|other)$/.exec(c.datain ?? '')
    if (!m) return false
    const key = m[1]
    await kvSet('care:n:fit:' + key, String(intval(await kvGet('care:n:fit:' + key)) + 1))
    await answerCallback(c.callback_query_id, '')
    const rec = String((await kvGet('fit:' + key)) ?? '').trim()
    const kb = J({ inline_keyboard: [[{ text: '💬 صحبت با پشتیبانی', callback_data: 'supportbtns' }], [{ text: '↩️ کار دیگر', callback_data: 'fit_menu' }]] })
    const text = rec
      ? `${esc(FIT[key])}\n\n${esc(rec)}\n\nاگر روی اینترنت شما خوب نبود، پشتیبانی کمک می‌کند بهترین سرور را برای اپراتورتان پیدا کنید.`
      : `${esc(FIT[key])}\n\nبهترین سرور به اپراتور و شبکهٔ شما بستگی دارد. برای راهنمایی دقیق با پشتیبانی صحبت کنید؛ بگویید از کدام اپراتور و برنامه استفاده می‌کنید.`
    await Editmessagetext(c.from_id, c.message_id, text, kb, 'HTML')
    return true
  },
]

/** /fit — administrator: list, set, clear.   /fit            list
 *                                           /fit ai <text>   set the recommendation for «ai»
 *                                           /fit ai off      clear */
export const adminFitRoutes = [
  async (c) => {
    if (c.adminRow?.rule !== 'administrator') return false
    const t = String(c.text ?? '').trim()
    if (!/^\/fit(\s|$)/.test(t)) return false
    const m = /^\/fit\s+(ai|yt|ig|msg|work|game|stream|other)\s+([\s\S]+)$/.exec(t)
    if (m) {
      if (m[2].trim() === 'off') await kvDel('fit:' + m[1])
      else await kvSet('fit:' + m[1], m[2].trim().slice(0, 600))
      await kvSet('fit:updated', String(Math.floor(Date.now() / 1000)))
      await sendmessage(c.from_id, m[2].trim() === 'off' ? `✅ پیشنهاد ${m[1]} پاک شد.` : `✅ پیشنهاد ${m[1]} ثبت شد.`, null, 'HTML')
      return true
    }
    const lines = []
    for (const [k, label] of Object.entries(FIT)) lines.push(`${label}\n<code>${k}</code>: ${esc((await kvGet('fit:' + k)) || '— (پشتیبانی)')}   · درخواست: ${intval(await kvGet('care:n:fit:' + k))}`)
    await sendmessage(c.from_id, '🎯 <b>بهترین سرور برای هر کار</b>\n\n' + lines.join('\n\n') + '\n\nتنظیم: <code>/fit ai تانل فنلاند یا سرور هلند</code>\nپاک‌کردن: <code>/fit ai off</code>', null, 'HTML')
    return true
  },
]
