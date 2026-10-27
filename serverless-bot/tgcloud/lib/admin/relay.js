// /setrelay <url> <key> — connect the payment relay (pasarguard/pay_relay/install.sh prints this command)
import { kvSet } from '../db.js'
import { sendmessage, deletemessage } from '../tg.js'
import { pullRelay } from '../relay.js'

export const adminRelayRoutes = [
  async (c) => {
    const m = /^\/setrelay\s+(https:\/\/[^\s]+)\s+([A-Za-z0-9]{24,128})\s*$/.exec(c.text)
    if (!m || c.adminRow?.rule !== 'administrator') return false
    await deletemessage(c.from_id, c.message_id) // the key stays out of the chat history
    await kvSet('config:pay_relay_url', m[1].replace(/\/+$/, ''))
    await kvSet('config:pay_relay_key', m[2])
    await kvSet('relay:last_pull', '0')
    let ok
    try { ok = (await pullRelay(c, true)) === true } catch { ok = false }
    await sendmessage(c.from_id, ok ? '✅ رله پرداخت وصل شد. پرداخت‌های واریزا و پیامک بانک از این به بعد خودکار تأیید می‌شوند.' : '⚠️ ذخیره شد ولی اتصال به رله برقرار نشد؛ آدرس را بررسی کنید.', null, 'HTML')
    return true
  },
]
