// Inline buttons: go to the main bot's code (relay); when the relay is off, the read-only screens replace the message.
import { api, BotApiError } from 'sdk'
import * as screens from '../lib/screens.js'
import { NotConfigured, relay, isMain, BUSY_TEXT } from '../lib/picha.js'
import { touchVisitor } from '../lib/store.js'

async function screenFor(data, user) {
  if (data === 'c') return screens.categories()
  if (data.startsWith('c:')) return screens.category(data.slice(2))
  if (data === 's') return screens.services(user)
  if (data.startsWith('s:')) return screens.service(user, data.slice(2))
  if (data === 'w') return screens.wallet(user)
  if (data === 'h') return screens.support()
  return screens.menu(user)
}

export default async function (q, ctx) {
  const user = q.from
  const msg = q.message
  let toast = undefined
  try {
    await touchVisitor(user)
    if (await relay(ctx.update)) return // the main bot's code answers (and answers the callback)
    if (isMain) throw new Error('relay off')
    const s = await screenFor(String(q.data || 'm'), user)
    if (msg) {
      try {
        await api.editMessageText({ chat_id: msg.chat.id, message_id: msg.message_id, text: s.text, parse_mode: 'HTML', reply_markup: s.reply_markup, link_preview_options: { is_disabled: true } })
      } catch (e) {
        if (!(e instanceof BotApiError) || !/not modified/i.test(e.description || '')) throw e
        toast = 'به‌روز است ✅'
      }
    }
  } catch (e) {
    if (e instanceof NotConfigured) toast = '⚙️ ربات هنوز به سرور وصل نشده (/setup)'
    else {
      console.error(e)
      toast = isMain ? BUSY_TEXT : '⚠️ الان به سرور پیچا دسترسی نیست'
    }
  }
  try {
    await api.answerCallbackQuery({ callback_query_id: q.id, text: toast })
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e
  }
}
