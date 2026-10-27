// Message to every user (cronbot/sendmessage.php): the admin writes it with /sendall, it goes out in small batches — one batch
// per update that reaches the bot (the lazy cron), or at once when the admin presses «ادامه». State lives in kv 'broadcast:job'.
import { one, all, sql, kvGet, kvSet, kvDel } from './db.js'
import { sendmessage, telegram, Editmessagetext } from './tg.js'
import { J, intval } from './php.js'

const BATCH = 25
const BUTTONS = (T) => ({ 1: [T.textbot.sell, 'buy'], 2: [T.keyboard.start, 'start'], 3: [T.textbot.userTest, 'usertestbtn'], 4: [T.textbot.help, 'helpbtn'], 5: [T.textbot.affiliates, 'affiliatesbtn'], 6: [T.textbot.addBalance, 'Add_Balance'] })
export const broadcastButtons = (T) => Object.entries(BUTTONS(T)).map(([k, [label]]) => `${k} ← ${label}`).join('\n')

export async function broadcastStart(c, draft, button) {
  const total = Number((await one(sql`SELECT COUNT(*) AS n FROM user WHERE User_Status != 'block'`)).n)
  const b = BUTTONS(c.T)[button]
  const progress = await sendmessage(c.from_id, c.T.Admin.messageBulk.progress.replace('%s', String(total)), J({ inline_keyboard: [[{ text: c.T.keyboard.cancelOperation, callback_data: 'cancel_sendmessage' }, { text: '▶️ ادامه ارسال', callback_data: 'continue_sendmessage' }]] }), 'HTML')
  const job = { ...draft, markup: b ? J({ inline_keyboard: [[{ text: b[0], callback_data: b[1] }]] }) : null, admin: c.from_id, message_id: progress?.result?.message_id ?? progress?.message_id ?? 0, last_id: 0, sent: 0, failed: 0, total }
  await kvSet('broadcast:job', JSON.stringify(job))
  return job
}

/** send the next batch; returns true while there is more to send */
export async function broadcastTick(c, force = false) {
  const raw = await kvGet('broadcast:job')
  if (!raw) return false
  const job = JSON.parse(raw)
  const users = await all(sql`SELECT id FROM user WHERE User_Status != 'block' AND CAST(id AS INTEGER) > ${job.last_id} + 0 ORDER BY CAST(id AS INTEGER) LIMIT ${BATCH}`)
  for (const u of users) {
    const text = job.type === 'text' ? job.text : job.text
    const r = job.type === 'photo' ? await telegram('sendphoto', { chat_id: u.id, photo: job.photoid, caption: job.text, parse_mode: 'HTML', ...(job.markup ? { reply_markup: job.markup } : {}) })
      : job.type === 'video' ? await telegram('sendvideo', { chat_id: u.id, video: job.videoid, caption: job.text, parse_mode: 'HTML', ...(job.markup ? { reply_markup: job.markup } : {}) })
        : await sendmessage(u.id, text, job.markup, 'HTML')
    if (r && r.ok === false) job.failed++
    else job.sent++
    job.last_id = intval(u.id)
  }
  if (users.length < BATCH) {
    await kvDel('broadcast:job')
    await telegram('deleteMessage', { chat_id: job.admin, message_id: job.message_id })
    await sendmessage(job.admin, c.T.Admin.messageBulk.done + `\n✅ ${job.sent} · ❌ ${job.failed}`, null, 'HTML')
    return false
  }
  await kvSet('broadcast:job', JSON.stringify(job))
  const left = Math.max(0, job.total - job.sent - job.failed)
  await Editmessagetext(job.admin, job.message_id, c.T.Admin.messageBulk.progress.replace('%s', String(left)), J({ inline_keyboard: [[{ text: c.T.keyboard.cancelOperation, callback_data: 'cancel_sendmessage' }, { text: '▶️ ادامه ارسال', callback_data: 'continue_sendmessage' }]] }))
  return true
}

export const broadcastCancel = async () => { await kvDel('broadcast:job') }
