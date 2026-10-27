// update builders for scenarios
let uid = 900000
export const msg = (from, text, extra = {}) => ({ update_id: ++uid, message: { message_id: uid, from: { id: Number(from), first_name: extra.first_name ?? 'Ali', username: extra.username ?? 'ali', is_bot: false }, chat: { id: Number(from), type: 'private' }, date: 1, text, ...extra.message } })
export const cb = (from, data, msgId = 777, extra = {}) => ({ update_id: ++uid, callback_query: { id: 'cq' + uid, from: { id: Number(from), first_name: extra.first_name ?? 'Ali', username: extra.username ?? 'ali' }, chat_instance: '1', data, message: { message_id: msgId, chat: { id: Number(from), type: 'private' }, date: 1, text: extra.text ?? 'x' } } })
