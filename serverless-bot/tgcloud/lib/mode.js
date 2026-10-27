// Who answers: the PHP bot on the server («relay»), this JavaScript bot («native»), or nobody for a moment («maint», used while the
// data is copied over). The mode is kv 'config:mode'; without it a deployment that knows the PHP server starts in relay mode.
// /mode (admins listed in config.js only): /mode · /mode maint · /mode relay · /mode native
import { fetch, api, BotApiError } from 'sdk'
import { one, sql, kvGet, kvSet } from './db.js'
import config from './config.js'
import { handleUpdate } from './bot.js'

export const BUSY = '⏳ ربات در حال به‌روزرسانی است؛ چند دقیقه دیگر دوباره امتحان کنید.'

export async function currentMode() {
  let m = null
  try { m = await kvGet('config:mode') } catch { m = null }
  return ['relay', 'native', 'maint'].includes(m) ? m : config.api_url ? 'relay' : 'native'
}

async function say(chat_id, text, extra = {}) {
  try { await api.sendMessage({ chat_id, text, parse_mode: 'HTML', ...extra }) } catch (e) { if (!(e instanceof BotApiError)) throw e }
}

async function relay(update) {
  const url = config.api_url.replace(/serverless_api\.php$/, 'serverless_relay.php')
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Picha-Key': config.api_key }, body: JSON.stringify(update) })
  if (!res.ok) throw new Error('relay: HTTP ' + res.status)
}

async function ready() {
  const n = async (t) => Number((await one(sql`SELECT COUNT(*) AS n FROM ${sql.raw(t)}`))?.n ?? 0)
  return (await n('user')) > 0 && (await n('texts')) > 0 && (await n('setting')) > 0 && (await n('product')) > 0
}

async function modeCommand(update) {
  const chat = update.message.chat.id
  const want = (update.message.text || '').trim().split(/\s+/)[1]
  const now = await currentMode()
  if (!want) return say(chat, `⚙️ حالت ربات: <b>${now}</b>\n\n<code>/mode maint</code> — توقف کوتاه (موقع انتقال داده)\n<code>/mode relay</code> — ربات PHP روی سرور جواب می‌دهد\n<code>/mode native</code> — این ربات (Serverless) جواب می‌دهد`)
  if (!['maint', 'relay', 'native'].includes(want)) return say(chat, '❌ فقط maint، relay یا native.')
  if (want === 'relay' && !config.api_url) return say(chat, '❌ آدرس سرور PHP در این پروژه تنظیم نشده (serverless_setup.php project --main --full).')
  if (want === 'native' && !(await ready())) return say(chat, '❌ دیتابیس Serverless هنوز پر نشده (کاربران، متن‌ها، تنظیمات یا محصولات خالی است). اول داده را منتقل کنید.')
  await kvSet('config:mode', want)
  return say(chat, `✅ حالت ربات: <b>${want}</b>`)
}

/** one update: route it by the mode */
export async function dispatch(update) {
  const msg = update.message
  if (msg && msg.text && /^\/mode(\s|$)/.test(msg.text) && msg.chat?.type === 'private' && (config.admin_ids || []).map(String).includes(String(msg.from?.id))) return modeCommand(update)
  const mode = await currentMode()
  if (mode === 'native') return handleUpdate(update)
  const chat = msg?.chat ?? update.callback_query?.message?.chat
  const priv = chat && chat.type === 'private'
  if (mode === 'maint') {
    if (update.callback_query) { try { await api.answerCallbackQuery({ callback_query_id: update.callback_query.id, text: BUSY, show_alert: true }) } catch (e) { if (!(e instanceof BotApiError)) throw e } }
    else if (msg && priv) await say(chat.id, BUSY)
    return
  }
  try { await relay(update) } catch (e) {
    console.error(e)
    if (msg && priv) await say(chat.id, BUSY)
  }
}
