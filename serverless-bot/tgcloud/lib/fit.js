// «بهترین سرور برای کارم»: the customer says what they use the VPN for (an AI assistant, YouTube, Instagram …) and gets the administrator's current
// recommendation for it, or is handed to support when none is set. Recommendations are written by hand with /fit (kv fit:<key>), later by probes.
// Counters (care:n:fit:<key>) show which uses people ask about — that is content demand for the radar.
import { kvGet, kvSet, kvDel } from './db.js'
import { sendmessage, Editmessagetext, answerCallback } from './tg.js'
import { J, intval } from './php.js'
import { memClick } from './memory.js'
import { recommendText, rankFor, recordFeedback, catalogGet, USE_SERVICES, syncHosts } from './servers.js'

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
    const f = /^fitfb_(ai|yt|ig|msg|work|game|stream|other)_(ok|bad)$/.exec(c.datain ?? '')
    if (!f) return false
    const rawLast = await kvGet('fit:last:' + c.from_id)
    let l = null; try { l = JSON.parse(rawLast) } catch { l = null }
    if (l && l.use === f[1]) await recordFeedback(l.use, l.country, l.kind, f[2] === 'ok')
    await answerCallback(c.callback_query_id, 'سپاسگزاریم 🌿')
    if (f[2] === 'ok') { await Editmessagetext(c.from_id, c.message_id, 'خوشحالیم 🌿 نظر شما به بهتر شدن پیشنهادها کمک می‌کند.', J({ inline_keyboard: [[{ text: '↩️ کار دیگر', callback_data: 'fit_menu' }]] }), 'HTML'); return true }
    const next = (await rankFor(f[1])).filter((x) => x.score > 0 && !(l && x.country === l.country && x.kind === l.kind))[0]
    const text = next ? `باشه، این را امتحان کنید: «${esc(next.name)}».\nاگر آن هم جواب نداد، با پشتیبانی صحبت کنید.` : 'سپاسگزاریم که گفتید. برای پیدا کردن بهترین سرور، با پشتیبانی صحبت کنید؛ بگویید از کدام اپراتور و برنامه استفاده می‌کنید.'
    await Editmessagetext(c.from_id, c.message_id, text, J({ inline_keyboard: [[{ text: '💬 صحبت با پشتیبانی', callback_data: 'supportbtns' }], [{ text: '↩️ کار دیگر', callback_data: 'fit_menu' }]] }), 'HTML')
    return true
  },
  async (c) => {
    if (c.datain === 'fit_menu') { await answerCallback(c.callback_query_id, ''); await showFitMenu(c, true); return true }
    const m = /^fit_(ai|yt|ig|msg|work|game|stream|other)$/.exec(c.datain ?? '')
    if (!m) return false
    const key = m[1]
    await kvSet('care:n:fit:' + key, String(intval(await kvGet('care:n:fit:' + key)) + 1))
    await memClick(c.from_id, 'fit') // they used it: a tap, not an ignored message
    await answerCallback(c.callback_query_id, '')
    const manual = String((await kvGet('fit:' + key)) ?? '').trim()
    const auto = manual ? null : await recommendText(key) // the system's own choice (probes + customers' feedback), when the administrator wrote nothing
    const rec = manual || auto || ''
    if (auto) { const top = (await rankFor(key)).find((x) => x.score > 0); if (top) await kvSet('fit:last:' + c.from_id, JSON.stringify({ use: key, country: top.country, kind: top.kind })) }
    const rows = [[{ text: '💬 صحبت با پشتیبانی', callback_data: 'supportbtns' }], [{ text: '↩️ کار دیگر', callback_data: 'fit_menu' }]]
    if (auto) rows.unshift([{ text: '✅ جواب داد', callback_data: 'fitfb_' + key + '_ok' }, { text: '❌ جواب نداد', callback_data: 'fitfb_' + key + '_bad' }])
    const kb = J({ inline_keyboard: rows })
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
    if (t === '/servers sync') { const n = await syncHosts(); await sendmessage(c.from_id, n ? `✅ ${n} سرور از پنل خوانده شد.` : '⚠️ فهرست سرور از پنل خوانده نشد (پنل پاسخ نداد یا آدرس hosts موجود نیست).', null, 'HTML'); return true }
    if (t !== '/servers') return false
    const cat = await catalogGet()
    const lines = []
    for (const s of cat) lines.push(`${s.kind === 'tunnel' ? '🛤' : '☁️'} ${esc(s.name)} (${s.country})${s.security === 'none' ? ' ⚠️ بدون رمزگذاری' : ''}`)
    const probes = []
    for (const cc of [...new Set(cat.map((s) => s.country))]) {
      let p = null; try { p = JSON.parse(await kvGet('servers:probe:' + cc)) } catch { p = null }
      probes.push(`${cc}: ${p ? Object.entries(p.results || {}).map(([k, v]) => `${k} ${v === 'ok' ? '✅' : v === 'blocked' ? '⛔️' : '❌'}`).join(' ') + ` · ${Math.round((Date.now() / 1000 - p.at) / 3600)} ساعت پیش` : 'بدون آزمون'}`)
    }
    const best = []
    for (const u of Object.keys(USE_SERVICES)) { const r = (await rankFor(u)).filter((x) => x.score > 0)[0]; if (r) best.push(`${u}: ${esc(r.name)} (${r.score})`) }
    await sendmessage(c.from_id, ['🖧 <b>فهرست سرورها</b> (از پنل)', lines.join('\n') || '— (هنوز همگام‌سازی نشده: /servers sync)', '', '<b>آزمون خودکار هر کشور</b>', probes.join('\n') || '—', '', '<b>انتخاب سیستم برای هر کار</b>', best.join('\n') || 'هنوز دادهٔ کافی نیست (آزمون یا نظر کاربران لازم است)'].join('\n'), null, 'HTML')
    return true
  },
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
