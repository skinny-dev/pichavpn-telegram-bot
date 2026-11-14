// Studio: the content calendar + post composer of the admin Mini App (docs/STUDIO.md).
// A post = text + image + CTA buttons + audience + time. Drafts come from the occasions calendar (rules and templates, no AI cost), or
// are written by hand, or are imported by a Claude session (studio_import). SIMULATION IS THE DEFAULT: while kv `studio:live` is not '1'
// nothing is ever sent to the channel or to customers — every send (test or scheduled) goes only to the administrators, marked as a preview.
import { all, one, sql, kvGet, kvSet } from './db.js'
import { telegram } from './tg.js'
import { esc, tags, richOrPlain, stripHtml } from './tgfmt.js'
import { tehranParts, DAY_NAMES } from './schedule.js'
import { OCCASIONS } from './studio_calendar.js'

const now = () => Math.floor(Date.now() / 1000)
const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d } catch { return d } }
export const KINDS = { greeting: 'تبریک مناسبت', tip: 'آموزش / حل مشکل', status: 'وضعیت و قطعی', offer: 'پیشنهاد واقعی', product: 'محصول / مقایسه', news: 'خبر + راه‌حل', trust: 'اعتماد / تجربه', engage: 'تعامل', cat: 'گربه‌ای' }

// ---------- CTA catalog (docs/CTA_BUTTONS.md). `start` = deep-link parameter; `ready` = the bot already understands it (else the button is flagged).
export const CTA = {
  buy: { label: '🛒 خرید اشتراک', group: 'تبدیل', start: 'buy', ready: true },
  test: { label: '🎁 تست رایگان', group: 'تبدیل', start: 'usertest', ready: true },
  tariff: { label: '💰 لیست قیمت‌ها', group: 'تبدیل', start: 'tariff', ready: false },
  plan: { label: '⭐ پلن پرفروش', group: 'تبدیل', start: 'plan_top', ready: false },
  code: { label: '📋 کپی کد تخفیف', group: 'تبدیل', copy: true, ready: true },
  wallet: { label: '💳 شارژ کیف پول', group: 'تبدیل', start: 'wallet', ready: false },
  support: { label: '💬 تماس با پشتیبانی', group: 'اعتماد و کمک', start: 'support', ready: false },
  help: { label: '📚 آموزش اتصال', group: 'اعتماد و کمک', start: 'help', ready: true },
  fit: { label: '🎯 بهترین سرور برای کارم', group: 'اعتماد و کمک', start: 'fit', ready: true },
  status: { label: '🟢 وضعیت سرورها', group: 'اعتماد و کمک', start: 'status', ready: false },
  extend: { label: '🔄 تمدید سرویس', group: 'نگهداشت', start: 'extend', ready: false },
  services: { label: '📦 سرویس‌های من', group: 'نگهداشت', start: 'services', ready: false },
  wheel: { label: '🎡 گردونهٔ شانس', group: 'نگهداشت', start: 'wheel', ready: false },
  ref: { label: '🎁 دعوت دوستان', group: 'ویروسی', start: 'ref', ready: false },
  share: { label: '📤 به دوستت بفرست', group: 'ویروسی', share: true, ready: true },
  link: { label: '🔗 لینک دلخواه', group: 'دستی', custom: true, ready: true },
}
/** the combination per post kind (CTA_BUTTONS.md §ج): the first button is the main action */
export const DEFAULT_CTA = {
  greeting: ['test', 'buy'], cat: ['test', 'buy'], tip: ['test', 'help', 'support'], status: ['status', 'support'], offer: ['buy', 'test', 'code'],
  product: ['plan', 'tariff', 'test'], news: ['test', 'buy', 'share'], trust: ['buy', 'share'], engage: ['test'],
}

// ---------- rules every post passes before it can be scheduled
const RELIGIOUS = /محرم|عاشورا|تاسوعا|اربعین|رمضان|فطر|قربان|غدیر|شعبان|مبعث|ولادت|شهادت|رحلت|امام|قمری|صفر|ربیع|جمادی|رجب|شوال|ذی‌القعده|ذی‌الحجه/
const FAKE_URGENCY = /فقط تا امشب|آخرین فرصت|فرصت محدود|تعداد محدود|عجله کنید|از دست ندهید|فقط امروز|ظرفیت.{0,6}تکمیل/
const CRINGE = /نیاو|دلش خوش/
/** → {errors:[…], warnings:[…]}: errors block scheduling, warnings are shown */
export function lint(p) {
  const errors = [], warnings = []
  const text = String(p.text || '')
  if (!text.trim()) errors.push('متن خالی است')
  if (/^\s*(<[^>]+>)*\s*سلام/.test(text)) errors.push('با «درود» شروع کنید، نه «سلام»')
  if (RELIGIOUS.test(text)) errors.push('مناسبت مذهبی/قمری نباید باشد')
  if (FAKE_URGENCY.test(text)) errors.push('فوریت ساختگی؛ فقط مهلت واقعی را بنویسید')
  if (CRINGE.test(text)) errors.push('لحن بچگانه؛ لحن دوستانه ولی محترمانه')
  if (p.kind !== 'offer' && /[\d۰-۹]+\s*(٪|%|درصد)\s*تخفیف|تخفیف\s*[\d۰-۹]+/.test(text)) errors.push('عدد تخفیف فقط در پست «پیشنهاد واقعی» با کمپین واقعی')
  if (p.kind === 'offer' && !p.offerEnds) warnings.push('پیشنهاد باید مهلت واقعی (offerEnds) داشته باشد')
  const cta = p.cta || []
  if (!cta.length) errors.push('حداقل یک دکمهٔ CTA لازم است')
  if (cta.length > 4) errors.push('حداکثر ۴ دکمه')
  for (const b of cta) {
    if (!CTA[b.key]) errors.push(`دکمهٔ ناشناخته: ${b.key}`)
    else if (CTA[b.key].custom && !/^(https?:\/\/|tg:\/\/)/.test(String(b.url || ''))) errors.push('لینک دکمهٔ دستی نامعتبر است')
    else if (!CTA[b.key].ready) warnings.push(`«${CTA[b.key].label}» هنوز لینک عمیق در ربات ندارد`)
  }
  const cap = p.image ? 1024 : 4096
  if (stripHtml(text).length > cap) errors.push(`متن بلندتر از ${cap} نویسه است${p.image ? ' (زیر عکس)' : ''}`)
  if (p.audience === 'channel' && !p.image && p.kind === 'greeting') warnings.push('پست مناسبتی بدون تصویر')
  return { errors, warnings }
}

// ---------- time: Tehran clock → unix (Tehran has no daylight saving since 2022)
const tehranToUnix = (iso, hour) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), Math.floor(hour), Math.round((hour % 1) * 60)) / 1000) - 12600
/** the planned time of an occasion post, from the master schedule (docs/MASTER_SCHEDULE.md): morning for culture / profession, evening for the rest */
export function slotFor(occ) {
  const hour = { celebration: 18.5, culture: 10.5, profession: 10.5, tech: 19.5, cat: 19.5 }[occ.kind] || 19.5
  const t = tehranToUnix(occ.date, hour)
  const p = tehranParts(t)
  return p.dow === 'fri' ? tehranToUnix(occ.date, 11) : p.dow === 'thu' && hour > 14 ? tehranToUnix(occ.date, 12) : t
}

// ---------- drafts from the calendar (friendly but respectful, «درود», one idea, no fake offer)
const LINE = {
  celebration: (o) => `${o.title} را به شما و همراهان‌تان تبریک می‌گوییم.`,
  culture: (o) => `${o.title}. یادی کوتاه و محترمانه.`,
  profession: (o) => `${o.title} بر همهٔ همکاران این حرفه مبارک.`,
  tech: (o) => `${o.title}.`,
  cat: (o) => o.cat || `${o.title}.`,
}
const TIP = {
  profession: 'یک نکته: برای کار روزانه، سرویسی را نگه دارید که هنگام قطعی هم یک مسیر جایگزین داشته باشد. در ربات «بهترین سرور برای کارم» را بزنید.',
  tech: 'نکتهٔ امروز: پیش از اتصال، برنامهٔ خود را به‌روز کنید و فقط از لینک رسمی اشتراک استفاده کنید.',
  cat: 'پیچا در گویش گیلکی یعنی گربه؛ شما را همراهی می‌کنیم.',
}
const OCC_KIND = { celebration: 'greeting', culture: 'greeting', profession: 'greeting', tech: 'tip', cat: 'cat' }
const SPECIAL = {
  yalda: { text: 'بلندترین شب سال، با اینترنتی که قطع نمی‌شود.', image: 'yalda-wide', needsCampaign: true },
  blackfriday: { text: 'این‌جا تخفیف ساختگی نداریم. اگر پیشنهادی باشد، واقعی است و پایانش را همان‌جا می‌نویسیم.', needsCampaign: true },
}
const idOf = (occ) => `${occ.id}-${occ.jy}`
/** a draft post for an occasion (status 'draft', never 'scheduled': an administrator approves it) */
export function draftFor(occ) {
  const sp = SPECIAL[occ.id] || {}
  const kind = OCC_KIND[occ.kind] || 'greeting'
  const lines = ['درود 🌿', '', sp.text ? `${occ.title}. ${sp.text}` : LINE[occ.kind](occ)]
  if (TIP[occ.kind] && !sp.text) lines.push('', TIP[occ.kind])
  const body = lines.join('\n')
  const text = body + '\n\n' + tags([occ.title.replace(/\s+/g, '_'), 'پیچا'], 2)
  return {
    id: 'o-' + idOf(occ), title: occ.title, kind, occasion: occ.id, text: esc(text), image: sp.image || '', cta: DEFAULT_CTA[kind].map((key) => ({ key })).slice(0, 2),
    audience: 'channel', when: slotFor(occ), status: 'draft', auto: true, note: sp.needsCampaign ? 'نیازمند تصمیم شما: کمپین واقعی (درصد، سقف، مهلت)' : '', created: now(),
  }
}
export const occasionsBetween = (fromIso, toIso) => OCCASIONS.filter((o) => o.date >= fromIso && o.date <= toIso)

// ---------- storage (kv: a few hundred posts at most)
export const postsGet = async () => parse(await kvGet('studio:posts'), [])
export const postsSet = (list) => kvSet('studio:posts', JSON.stringify(list))
export const libGet = async () => parse(await kvGet('studio:lib'), {})
export const MODES = ['sim', 'test', 'live'] // sim: only the administrators · test: the TEST channel · live: the real channel
export async function settingsGet() {
  let mode = String((await kvGet('studio:mode')) ?? '')
  if (!MODES.includes(mode)) mode = (await kvGet('studio:live')) === '1' ? 'live' : 'sim' // the first version had a live switch
  return { mode, live: mode === 'live', channel: String((await kvGet('studio:channel')) ?? ''), testChannel: String((await kvGet('studio:test_channel')) ?? ''), bot: String((await kvGet('config:usernamebot')) ?? '').replace(/^@+/, '') }
}

export function normalize(p, old = {}) {
  const cta = (Array.isArray(p.cta) ? p.cta : []).map((b) => ({ key: String(b.key), ...(b.url ? { url: String(b.url) } : {}), ...(b.label ? { label: String(b.label).slice(0, 40) } : {}), ...(b.code ? { code: String(b.code).slice(0, 40) } : {}) }))
  return {
    id: String(p.id || old.id || 'p' + now().toString(36) + Math.floor(Math.random() * 1296).toString(36)),
    title: String(p.title ?? old.title ?? '').slice(0, 80), kind: KINDS[p.kind] ? p.kind : old.kind || 'tip', occasion: String(p.occasion ?? old.occasion ?? ''),
    text: String(p.text ?? old.text ?? ''), image: String(p.image ?? old.image ?? ''), cta,
    audience: p.audience === 'admins' ? 'admins' : 'channel', when: parseInt(p.when ?? old.when) || 0,
    status: ['draft', 'scheduled', 'sent', 'tested', 'simulated', 'cancelled'].includes(p.status) ? p.status : old.status || 'draft',
    auto: !!(p.auto ?? old.auto), note: String(p.note ?? old.note ?? '').slice(0, 200), offerEnds: parseInt(p.offerEnds ?? old.offerEnds) || 0, created: old.created || now(),
  }
}

// ---------- the message a post becomes
export const startLink = (bot, post, key) => `https://t.me/${bot}?start=${('ch_' + post.id.replace(/[^A-Za-z0-9]/g, '') + '_' + key).slice(0, 64)}`
export function buildMessage(post, bot, lib = {}) {
  const rows = []
  for (const b of post.cta || []) {
    const d = CTA[b.key]
    if (!d) continue
    const text = b.label || d.label
    if (d.copy) { if (b.code) rows.push([{ text, copy_text: { text: b.code } }]); continue }
    if (d.custom) { rows.push([{ text, url: b.url }]); continue }
    if (d.share) { rows.push([{ text, url: `https://t.me/share/url?url=${encodeURIComponent(startLink(bot, post, 'ref'))}` }]); continue }
    rows.push([{ text, url: startLink(bot, post, b.key) }])
  }
  const kb = []
  for (let i = 0; i < rows.length; i += 2) kb.push(rows.slice(i, i + 2).flat())
  const img = post.image ? lib[post.image] || (/^(https?:\/\/)/.test(post.image) ? post.image : '') : ''
  return { text: post.text, photo: img, reply_markup: { inline_keyboard: kb }, missingImage: !!post.image && !img }
}

const adminIds = async () => (await all(sql`SELECT id_admin FROM admin WHERE rule = 'administrator'`)).map((r) => r.id_admin)
/** send one post to the given chats; `preview` prefixes the simulation notice */
export async function deliver(post, chats, { preview = true } = {}) {
  const s = await settingsGet(), lib = await libGet()
  const m = buildMessage(post, s.bot, lib)
  const head = preview ? '🧪 <i>شبیه‌سازی؛ این پیام به مشتری یا کانال نرفته است</i>\n\n' : ''
  const sent = []
  for (const chat_id of chats) {
    const params = m.photo ? { chat_id, photo: m.photo, caption: head + m.text, parse_mode: 'HTML' } : { chat_id, text: head + m.text, parse_mode: 'HTML', link_preview_options: JSON.stringify({ is_disabled: true }) }
    if (m.reply_markup.inline_keyboard.length) params.reply_markup = JSON.stringify(m.reply_markup)
    const r = await richOrPlain((d) => telegram(m.photo ? 'sendphoto' : 'sendmessage', d), params)
    sent.push({ chat_id, ok: !!(r && r.ok !== false) })
  }
  return { sent, missingImage: m.missingImage }
}

/** a test send of the post to the administrator who is composing it (always allowed) */
export const sendTest = (post, tgId) => deliver(post, [String(tgId)], { preview: true })

/** the scheduled-post job: one due post per run. Not live → a simulated send to the administrators; live → the channel. */
export async function studioTick() {
  const list = await postsGet()
  const due = list.filter((p) => p.status === 'scheduled' && p.when && p.when <= now()).sort((a, b) => a.when - b.when)[0]
  if (!due) return { sent: 0 }
  const s = await settingsGet()
  if (lint(due).errors.length) { due.status = 'draft'; due.note = 'بازگشت به پیش‌نویس: ' + lint(due).errors[0]; await postsSet(list); return { sent: 0 } }
  const target = due.audience !== 'channel' ? '' : s.mode === 'live' ? s.channel : s.mode === 'test' ? s.testChannel : ''
  if (target) {
    const r = await deliver(due, [target], { preview: false })
    due.status = r.sent.every((x) => x.ok) ? (s.mode === 'live' ? 'sent' : 'tested') : 'draft'
    if (due.status === 'draft') due.note = 'ارسال به کانال ناموفق بود؛ ربات ادمین کانال است و اجازهٔ ارسال دارد؟'
  } else {
    await deliver(due, await adminIds(), { preview: true })
    due.status = 'simulated'
  }
  due.sentAt = now()
  await postsSet(list)
  return { sent: 1, id: due.id, mode: due.status }
}

/** the seed: a draft per occasion from `from` to `to` that has none yet; returns how many were created */
export async function seedDrafts(fromIso, toIso) {
  const list = await postsGet()
  const have = new Set(list.map((p) => p.id))
  let n = 0
  for (const occ of occasionsBetween(fromIso, toIso)) {
    const d = draftFor(occ)
    if (have.has(d.id)) continue
    list.push(d)
    n++
  }
  await postsSet(list)
  return n
}

export { tehranParts, DAY_NAMES, one }
