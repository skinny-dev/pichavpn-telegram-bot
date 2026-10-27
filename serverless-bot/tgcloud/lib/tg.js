// Telegram calls — port of telegram() and the send helpers in botapi.php.
// Payloads look like the PHP ones (reply_markup as a JSON string); results look like the Bot API's ({ok, result} or {ok:false,…}).
import { api, BotApiError } from 'sdk'
import { kvGet, kvSet } from './db.js'
import { emojiConfig, prepareButtons, applyPayload, hasCustomEmoji, applyCustom, stripCustom } from './emoji.js'

let blocked = null // Telegram refused custom emoji lately (6 h)
async function emojiBlocked() {
  if (blocked === null) blocked = Number((await kvGet('custom_emoji_blocked_until')) || 0) > Date.now() / 1000
  return blocked
}
async function blockEmoji() {
  blocked = true
  await kvSet('custom_emoji_blocked_until', String(Math.floor(Date.now() / 1000) + 21600))
}

const emptyChat = (c) => c === null || c === undefined || c === false || typeof c === 'object' || String(c).trim() === '' || (/^-?\d+$/.test(String(c).trim()) && Number(c) === 0)

/** the Bot API wants objects where PHP sent JSON strings */
function wire(d) {
  const out = {}
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === '') continue
    if (['reply_markup', 'results', 'entities', 'caption_entities', 'media', 'link_preview_options'].includes(k) && typeof v === 'string') {
      try { out[k] = JSON.parse(v) } catch { out[k] = v }
    } else out[k] = v
  }
  return out
}

/** telegram($method, $datas): never throws; returns {ok:true,result} | {ok:false,error_code,description} */
export async function telegram(method, datas = {}, allowFallback = true) {
  for (const k of ['chat_id', 'from_chat_id']) {
    if (k in datas && emptyChat(datas[k])) return { ok: false, error_code: 400, description: 'Bad Request: chat_id is empty' }
  }
  datas = { ...datas }
  if ('message_thread_id' in datas && !(parseInt(datas.message_thread_id) > 0)) delete datas.message_thread_id
  const cfg = await emojiConfig()
  datas = prepareButtons(cfg, datas)
  datas = await applyPayload(cfg, datas, method)
  let premium = null
  if (hasCustomEmoji(datas)) {
    premium = datas
    datas = (await emojiBlocked()) ? stripCustom(datas) : applyCustom(datas)
  }
  try {
    const result = await api[method](wire(datas))
    return { ok: true, result }
  } catch (e) {
    if (!(e instanceof BotApiError)) {
      console.error('telegram', method, e)
      return { ok: false, description: String(e && e.message) }
    }
    const code = e.code, desc = String(e.description || '')
    const silent = code === 403 || (code === 400 && /message is not modified|message can't be deleted|message to delete not found|chat not found/.test(desc))
    if (allowFallback && code === 400 && !silent && premium) {
      const retry = await telegram(method, stripCustom(premium), false)
      if (/emoji|entit/i.test(desc) && retry.ok !== false) await blockEmoji()
      return retry
    }
    if (!silent) console.warn('telegram', method, code, desc)
    return { ok: false, error_code: code, description: desc, parameters: e.parameters }
  }
}

/** split at 4096 UTF-16 units on line breaks (splitTelegramText) */
export function splitText(text, limit = 4096) {
  text = String(text ?? '')
  if (text.length <= limit) return [text]
  const chunks = []
  let cur = ''
  for (let line of text.split('\n')) {
    while (line.length > limit) {
      if (cur !== '') { chunks.push(cur); cur = '' }
      chunks.push(line.slice(0, limit))
      line = line.slice(limit)
    }
    const cand = cur === '' ? line : cur + '\n' + line
    if (cand.length > limit) { chunks.push(cur); cur = line } else cur = cand
  }
  if (cur !== '') chunks.push(cur)
  return chunks
}

export async function sendmessage(chat_id, text, keyboard, parse_mode) {
  if (emptyChat(chat_id)) return { ok: false }
  const chunks = splitText(text)
  let r = { ok: false }
  for (let i = 0; i < chunks.length; i++) {
    r = await telegram('sendmessage', { chat_id, text: chunks[i], reply_markup: i === chunks.length - 1 ? keyboard : null, parse_mode })
  }
  return r
}
export const Editmessagetext = (chat_id, message_id, text, keyboard, parse_mode = 'HTML') =>
  telegram('editmessagetext', { chat_id, message_id, text, reply_markup: keyboard, parse_mode })
export const deletemessage = (chat_id, message_id) => telegram('deletemessage', { chat_id, message_id })
export const sendphoto = (chat_id, photo, caption) => telegram('sendphoto', { chat_id, photo, caption })
export const sendvideo = (chat_id, video, caption) => telegram('sendvideo', { chat_id, video, caption })
export const forwardMessage = (from_chat_id, message_id, chat_id) => telegram('forwardMessage', { from_chat_id, message_id, chat_id })
export const pinmessage = (chat_id, message_id) => telegram('pinChatMessage', { chat_id, message_id })
export const answerCallback = (callback_query_id, text, show_alert = false) => telegram('answerCallbackQuery', { callback_query_id, text, show_alert })
