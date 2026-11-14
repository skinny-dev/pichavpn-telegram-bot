// Telegram formatting helpers (HTML parse mode): bold, quote, expandable quote, spoiler, code, links, hashtags, links to posts.
// Every helper escapes its input. richOrPlain() is used for sending: if Telegram rejects the markup (an older Bot API, a bad entity) the same text is
// sent again as plain text, so formatting can never cost a message.
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const b = (s) => `<b>${esc(s)}</b>`
export const i = (s) => `<i>${esc(s)}</i>`
export const code = (s) => `<code>${esc(s)}</code>`
export const spoiler = (s) => `<tg-spoiler>${esc(s)}</tg-spoiler>`
export const quote = (s) => `<blockquote>${esc(s)}</blockquote>`
/** collapsed by default after 3 lines: details a reader may open (long steps, fine print) */
export const expandable = (s) => `<blockquote expandable>${esc(s)}</blockquote>`
export const link = (text, url) => (/^(https?:\/\/|tg:\/\/)/.test(String(url)) ? `<a href="${esc(url).replace(/"/g, '&quot;')}">${esc(text)}</a>` : esc(text))
/** a public channel post: https://t.me/<channel>/<id>  (channel without @) */
export const postLink = (channel, id) => (/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(String(channel).replace(/^@/, '')) && /^\d+$/.test(String(id)) ? `https://t.me/${String(channel).replace(/^@/, '')}/${id}` : '')
/** a hashtag for Persian/English words: spaces → underscores, no half-space, no punctuation:  «آموزش اتصال» → #آموزش_اتصال */
export const tag = (s) => '#' + String(s).trim().replace(/[\s‌‌]+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '').replace(/_+/g, '_').replace(/^_|_$/g, '')
/** at most `max` tags, de-duplicated, one line */
export const tags = (list, max = 3) => [...new Set(list.map(tag).filter((t) => t.length > 1))].slice(0, max).join(' ')
/** the plain-text twin of an HTML message (for the fallback) */
export const stripHtml = (h) => String(h).replace(/<\/?(b|i|u|s|code|pre|tg-spoiler|blockquote|a|tg-emoji)[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** send(params) → Telegram result;  tries the HTML text, falls back to the plain text on a formatting error (400) */
export async function richOrPlain(send, params) {
  const r = await send({ ...params, parse_mode: 'HTML' })
  if (r && r.ok === false && Number(r.error_code) === 400 && /parse|entit|tag/i.test(String(r.description ?? ''))) {
    const p = { ...params, text: stripHtml(params.text) }
    delete p.parse_mode
    return send(p)
  }
  return r
}

/** one channel/DM message in the house style:  bold title · body · «tip» quote · optional expandable details · hashtags (channel only)
 *  fmtMsg({title, body, tip, details, tags: ['آموزش', 'اتصال'], link: [text, url]}) → HTML */
export function fmtMsg({ title = '', body = '', tip = '', details = '', tags: tg = [], link: l = null } = {}) {
  const out = []
  if (title) out.push(b(title))
  if (body) out.push(esc(body))
  if (tip) out.push(quote(tip))
  if (details) out.push(expandable(details))
  if (l) out.push(link(l[0], l[1]))
  if (tg.length) out.push(tags(tg))
  return out.join('\n\n')
}
