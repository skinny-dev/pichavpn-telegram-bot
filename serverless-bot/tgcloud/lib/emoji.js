// Premium (custom) emoji layer — port of premium_emoji.php + the custom-emoji parts of botapi.php / function.php.
// Config: kv 'storage:premium_emoji.json' (same JSON as storage/premium_emoji.json on the PHP bot).
import { kvGet, kvSet } from './db.js'

const MAX_PER_TEXT = 90
const DEFAULT_ALIASES = {
  '✅': '✔', '☑': '✔', '❎': '❌', '✖': '❌', '⭕': '🔴', '💰': '💵', '⏳': '⌛', '⏱': '⌛', '🕐': '⌛',
  '🛒': '🛍', '📦': '🛍', '✍': '✏', '🎁': '🎉', '💀': '🚨', '🔋': '⚡', '🚀': '⚡', '♻': '🔄', '🔁': '🔄',
  '🔃': '🔄', '📩': '✉', '📨': '✉', '🔐': '🔒', '🔓': '🔒', '📅': '🗓', '📆': '🗓', '📢': '📣', '🔊': '🔈',
  '📡': '🌐', '🌍': '🌐', '💻': '🖥', '⏰': '🔔', '⚜': '✨', '🏆': '🥇',
}
const norm = (e) => String(e).replace(/️/g, '')
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

let cfgCache = null
export async function emojiConfig() {
  if (cfgCache) return cfgCache
  let cfg = { enabled: false, map: {}, regex: null, catalog: false, catalog_override: {}, buttons: false, reply_buttons: false }
  let raw = null
  try { raw = JSON.parse((await kvGet('storage:premium_emoji.json')) || 'null') } catch { raw = null }
  if (raw && raw.enabled && raw.map && typeof raw.map === 'object') {
    const map = {}
    for (const [emoji, id] of Object.entries(raw.map)) {
      const key = norm(emoji)
      if (key === '' || /^[\x00-\x7F]+$/.test(key) || !/^\d{5,25}$/.test(String(id))) continue
      map[key] = String(id)
    }
    if (Object.keys(map).length) {
      const aliases = { ...(raw.use_default_aliases ?? true ? DEFAULT_ALIASES : {}), ...(raw.alias && typeof raw.alias === 'object' ? raw.alias : {}) }
      for (const [f, t] of Object.entries(aliases)) {
        const from = norm(f), to = norm(t)
        if (from !== '' && !(from in map) && to in map) map[from] = map[to]
      }
      const keys = Object.keys(map).sort((a, b) => b.length - a.length) // longest first: sequences win over their parts
      cfg = {
        enabled: true, map, regex: new RegExp('(?:' + keys.map(escRe).join('|') + ')\\uFE0F?', 'gu'),
        catalog: !!raw.catalog, buttons: !!raw.buttons, reply_buttons: !!raw.reply_buttons,
        catalog_override: raw.catalog_override && typeof raw.catalog_override === 'object' ? raw.catalog_override : {},
      }
    }
  }
  cfgCache = cfg
  return cfg
}
export function resetEmojiCache() { cfgCache = null }

/** wrap mapped emoji in <tg-emoji>; skips tags, <code>, <pre>, <a>, existing <tg-emoji> */
export function wrapHtml(cfg, html) {
  if (!cfg.enabled || typeof html !== 'string' || html === '') return html
  const tokens = html.split(/(<[^>]*>)/u)
  let skip = 0, count = 0
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok === '') continue
    if (tok[0] === '<' && tok.endsWith('>')) {
      if (/^<\s*(code|pre|a|tg-emoji)\b/i.test(tok)) skip++
      else if (/^<\s*\/\s*(code|pre|a|tg-emoji)\s*>/i.test(tok)) skip = Math.max(0, skip - 1)
      continue
    }
    if (skip > 0) continue
    tokens[i] = tok.replace(cfg.regex, (m) => {
      if (count >= MAX_PER_TEXT) return m
      const id = cfg.map[norm(m)]
      if (id === undefined) return m
      count++
      return `<tg-emoji emoji-id="${id}">${m}</tg-emoji>`
    })
  }
  return tokens.join('')
}

const htmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const htmlUnesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const isHtml = (d) => typeof d.parse_mode === 'string' && d.parse_mode.toLowerCase() === 'html'

export function stripTags(v) {
  if (typeof v !== 'string' || !/<tg-emoji/i.test(v)) return v
  return v.replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/giu, '$1')
}

/** a label with <tg-emoji>: first one becomes the icon, the rest plain */
export function splitLabel(value) {
  const text = typeof value === 'string' ? value : ''
  if (text === '' || !/<tg-emoji/i.test(text)) return { text, icon: '' }
  let icon = ''
  let stripped = text.replace(/<tg-emoji\b[^>]*\bemoji-id\s*=\s*"(\d+)"[^>]*>([\s\S]*?)<\/tg-emoji>/giu, (m, id, inner) => {
    if (icon === '') { icon = id; return '' }
    return inner
  })
  const fallback = stripTags(text)
  stripped = stripTags(stripped).replace(/[ \t]+/gu, ' ').trim()
  if (stripped === '') return { text: fallback, icon: '' }
  return { text: stripped, icon }
}

function walkButtons(markup, fn) {
  if (typeof markup !== 'string' || !/<tg-emoji/i.test(markup)) return markup
  let m
  try { m = JSON.parse(markup) } catch { return markup }
  let changed = false
  for (const k of ['keyboard', 'inline_keyboard']) {
    if (!Array.isArray(m[k])) continue
    for (const row of m[k]) {
      if (!Array.isArray(row)) continue
      row.forEach((b, i) => {
        if (b && typeof b.text === 'string') {
          const u = fn({ ...b })
          if (JSON.stringify(u) !== JSON.stringify(b)) { row[i] = u; changed = true }
        }
      })
    }
  }
  return changed ? JSON.stringify(m) : markup
}

export function hasCustomEmoji(d) {
  return ['text', 'caption', 'reply_markup'].some((k) => typeof d[k] === 'string' && /<tg-emoji/i.test(d[k]))
}
export function applyCustom(d) {
  d = { ...d }
  if (!isHtml(d)) for (const k of ['text', 'caption']) if (typeof d[k] === 'string') d[k] = stripTags(d[k])
  if (d.reply_markup !== undefined) d.reply_markup = walkButtons(d.reply_markup, (b) => {
    const l = splitLabel(b.text)
    b.text = l.text
    if (l.icon !== '') b.icon_custom_emoji_id = l.icon
    return b
  })
  return d
}
export function stripCustom(d) {
  d = { ...d }
  for (const k of ['text', 'caption']) if (typeof d[k] === 'string') d[k] = stripTags(d[k])
  if (d.reply_markup !== undefined) d.reply_markup = walkButtons(d.reply_markup, (b) => {
    b.text = stripTags(b.text)
    delete b.icon_custom_emoji_id
    return b
  })
  return d
}

/** premiumEmojiPrepareButtons: tagged labels stay plain where icons are off */
export function prepareButtons(cfg, d) {
  if (typeof d.reply_markup !== 'string' || !/<tg-emoji/i.test(d.reply_markup)) return d
  let m
  try { m = JSON.parse(d.reply_markup) } catch { return d }
  const iconsOn = cfg.enabled && cfg.buttons, replyOn = cfg.enabled && cfg.reply_buttons
  let changed = false
  for (const k of ['keyboard', 'inline_keyboard']) {
    if ((k === 'inline_keyboard' && iconsOn) || (k === 'keyboard' && replyOn) || !Array.isArray(m[k])) continue
    for (const row of m[k]) for (const b of row || []) {
      if (b && typeof b.text === 'string' && /<tg-emoji/i.test(b.text)) { b.text = stripTags(b.text); changed = true }
    }
  }
  return changed ? { ...d, reply_markup: JSON.stringify(m) } : d
}

/** premiumEmojiApplyPayload */
export async function applyPayload(cfg, d, method = '') {
  if (!cfg.enabled) return d
  method = String(method).toLowerCase()
  if (['answercallbackquery', 'answerinlinequery', 'answerprecheckoutquery', 'answershippingquery', 'setmycommands', 'setchatmenubutton'].includes(method)) return d
  d = { ...d }
  if (isHtml(d)) for (const k of ['text', 'caption']) if (typeof d[k] === 'string') d[k] = wrapHtml(cfg, d[k])
  if ((cfg.buttons || cfg.reply_buttons) && typeof d.reply_markup === 'string' && d.reply_markup !== '') {
    let m
    try { m = JSON.parse(d.reply_markup) } catch { m = null }
    if (m && typeof m === 'object') {
      let changed = false
      const learned = {}
      const keys = [...(cfg.buttons ? ['inline_keyboard'] : []), ...(cfg.reply_buttons ? ['keyboard'] : [])]
      for (const key of keys) {
        if (!Array.isArray(m[key])) continue
        for (const row of m[key]) for (const b of row || []) {
          if (b && typeof b.text === 'string' && b.icon_custom_emoji_id === undefined && !/<tg-emoji/i.test(b.text)) {
            const esc = htmlEsc(b.text)
            const wrapped = wrapHtml(cfg, esc)
            if (wrapped !== esc) {
              const orig = b.text
              b.text = htmlUnesc(wrapped)
              changed = true
              if (key === 'keyboard') learned[splitLabel(b.text).text.trim()] = orig
            }
          }
        }
      }
      if (Object.keys(learned).length) await learnLabels(learned)
      if (changed) d.reply_markup = JSON.stringify(m)
    }
  }
  return d
}

// reply-keyboard taps come back without the emoji that became the icon: stripped text → original label
let labelIndex = null
async function labels() {
  if (labelIndex) return labelIndex
  try { labelIndex = JSON.parse((await kvGet('storage:premium_reply_labels.json')) || '{}') || {} } catch { labelIndex = {} }
  return labelIndex
}
async function learnLabels(add) {
  const idx = await labels()
  let changed = false
  for (const [s, o] of Object.entries(add)) if (s !== '' && s !== o && idx[s] !== o) { idx[s] = o; changed = true }
  if (changed && Object.keys(idx).length < 5000) await kvSet('storage:premium_reply_labels.json', JSON.stringify(idx))
}
export async function restoreLabel(text) {
  if (typeof text !== 'string' || text === '' || /<tg-emoji/i.test(text)) return text
  return (await labels())[text] ?? text
}

/** custom_emoji entities of an incoming message → <tg-emoji> tags (offsets are UTF-16, like JS strings) */
export function entitiesToTags(text, entities) {
  if (typeof text !== 'string' || text === '' || !Array.isArray(entities)) return text
  const es = entities.filter((e) => e && e.type === 'custom_emoji' && /^\d{5,25}$/.test(String(e.custom_emoji_id))).sort((a, b) => a.offset - b.offset)
  if (!es.length) return text
  let out = '', cur = 0
  for (const e of es) {
    const s = e.offset | 0, l = e.length | 0
    if (s < cur || l <= 0 || s + l > text.length) continue
    out += text.slice(cur, s) + `<tg-emoji emoji-id="${e.custom_emoji_id}">` + text.slice(s, s + l) + '</tg-emoji>'
    cur = s + l
  }
  return cur === 0 ? text : out + text.slice(cur)
}

// ---- catalog labels (premiumCatalogLabel)
function catalogEmoji(cfg, kind, row) {
  const name = String(kind === 'category' ? row.remark ?? '' : row.name_product ?? '')
  const ov = cfg.catalog_override?.[kind]?.[String(row.id ?? '')]
  if (typeof ov === 'string' && ov !== '') return ov
  if (kind === 'category') {
    if (name.includes('اضطراری')) return '🚨'
    if (name.includes('نامحدود')) return '🔥'
    if (name.includes('ماهه')) return '🗓'
    return ''
  }
  const gb = parseFloat(row.Volume_constraint ?? 0) || 0, days = parseInt(row.Service_time ?? 0) || 0, cat = String(row.category ?? '')
  if (days === 0 || cat.includes('اضطراری')) return '🚨'
  if (gb <= 0) return '🔥'
  if (gb <= 25) return '⚡'
  if (gb <= 100) return '⭐'
  if (gb <= 250) return '💎'
  return '👑'
}
const startsWithEmoji = (l) => /^\s*(?:<tg-emoji\b|\p{Extended_Pictographic})/u.test(String(l))
export async function catalogLabel(kind, row, label) {
  const cfg = await emojiConfig()
  if (!cfg.catalog || typeof label !== 'string' || label === '' || startsWithEmoji(label)) return label
  const e = catalogEmoji(cfg, kind, row)
  return e === '' ? label : e + ' ' + label
}
