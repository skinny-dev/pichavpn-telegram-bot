// The approve/reject message an administrator gets for a receipt must not stay alive after the order is settled some other way
// (Variza's webhook arrives after the customer sent the receipt; another administrator approves first). The messages are remembered per order
// and, when the order is settled, edited to say so and stripped of their buttons — so nobody approves the same payment twice.
import { kvGet, kvSet, kvDel } from './db.js'
import { telegram } from './tg.js'
import { richOrPlain } from './tgfmt.js'

const key = (orderId) => 'receipt:' + orderId
const parse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }

/** remember an administrator's receipt message (the result of the send) */
export async function receiptRemember(orderId, chatId, result, text) {
  const mid = result && result.ok !== false ? result.result?.message_id : null
  if (!mid) return
  const list = parse(await kvGet(key(orderId)))
  list.push({ c: String(chatId), m: Number(mid), t: String(text).slice(0, 3800) })
  await kvSet(key(orderId), JSON.stringify(list.slice(-10)))
}

/** edit every remembered message of this order: the note under the text, the buttons gone. `except` = the message the caller is editing itself. Never throws. */
export async function receiptsClose(orderId, note, except = {}) {
  try {
    const list = parse(await kvGet(key(orderId)))
    if (!list.length) return 0
    await kvDel(key(orderId))
    let n = 0
    for (const r of list) {
      if (String(except.chat ?? '') === r.c && Number(except.message ?? 0) === r.m) continue
      const res = await richOrPlain((d) => telegram('editmessagetext', d), { chat_id: r.c, message_id: r.m, text: `${r.t}\n\n${note}`, reply_markup: JSON.stringify({ inline_keyboard: [] }) })
      if (res && res.ok !== false) n++
    }
    return n
  } catch (e) { console.error('receiptsClose', e); return 0 }
}
