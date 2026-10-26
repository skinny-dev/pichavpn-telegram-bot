// Every message to the dev bot. Commands:
//   /start, /menu                 main menu
//   /setup <api_url> <key>        connect to the Picha server (the line `php scripts/serverless_setup.php key` prints).
//                                 The first one who sets it becomes the owner; after that only the owner can change it.
//   /stats                        (owner) how many people used the dev bot
//   /mainbot <username>           (owner) the main bot the buy buttons open (default pichanet_bot)
import { api, BotApiError } from 'sdk'
import { getSetting, setSetting, touchVisitor, visitorStats } from '../lib/store.js'
import { callWith } from '../lib/picha.js'
import { menu } from '../lib/screens.js'
import { fa } from '../lib/fmt.js'

const say = (chat_id, text, extra = {}) => api.sendMessage({ chat_id, text, parse_mode: 'HTML', ...extra })

async function forget(message) {
  try {
    await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id })
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e
  }
}

export default async function (message, ctx) {
  if (!message.chat || message.chat.type !== 'private' || !message.from) return
  const chat = message.chat.id
  const me = message.from
  const text = (message.text || '').trim()
  const owner = await getSetting('owner_id')
  const isOwner = owner && String(owner) === String(me.id)

  if (text.startsWith('/setup')) {
    await forget(message) // the key never stays in the chat
    if (owner && !isOwner) return say(chat, '⛔ این ربات قبلاً تنظیم شده.')
    const [, url, key] = text.split(/\s+/)
    if (!url || !/^https:\/\/[^\s]+\/serverless_api\.php$/.test(url) || !key || !/^[a-f0-9]{48}$/.test(key)) {
      return say(chat, 'شکل درست:\n<code>/setup https://دامنه/serverless_api.php کلید</code>\n(همان خطی که دستور serverless_setup.php key روی سرور می‌دهد)')
    }
    let r
    try {
      r = await callWith(url, key, 'ping')
    } catch (e) {
      console.warn('setup ping failed', String(e))
      return say(chat, '❌ به سرور وصل نشد. آدرس را چک کنید و مطمئن شوید آخرین نسخه روی سرور deploy شده.')
    }
    if (!r.ok) return say(chat, r.error === 'key' ? '❌ کلید درست نیست.' : '❌ سرور جواب داد: ' + (r.error || r.status))
    await setSetting('api_url', url)
    await setSetting('api_key', key)
    if (!owner) await setSetting('owner_id', me.id)
    await say(chat, '✅ به سرور پیچا وصل شد. پیام حاوی کلید پاک شد.')
    const m = await menu(me)
    return say(chat, m.text, { reply_markup: m.reply_markup })
  }

  if (text === '/stats' && isOwner) {
    const s = await visitorStats()
    return say(chat, `📈 کاربران ربات تست: ${fa(s.total)}\n۲۴ ساعت اخیر: ${fa(s.day)}`)
  }

  if (text.startsWith('/mainbot') && isOwner) {
    const name = (text.split(/\s+/)[1] || '').replace(/^@/, '')
    if (!/^[A-Za-z0-9_]{5,32}$/.test(name)) return say(chat, 'مثال: <code>/mainbot pichanet_bot</code>')
    await setSetting('main_bot', name)
    return say(chat, `✅ دکمه‌های خرید به @${name} می‌روند.`)
  }

  await touchVisitor(me)
  try {
    const m = await menu(me)
    await say(chat, m.text, { reply_markup: m.reply_markup })
  } catch (e) {
    console.error(e)
    await say(chat, '⚠️ الان به سرور پیچا دسترسی نیست؛ چند دقیقه بعد دوباره /start بزنید.')
  }
}
