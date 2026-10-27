// Support inbox of the panel (support_* routes of dashboard/api.php).
import { InputFile } from 'sdk'
import { qAll, qOne, qRun, qVal } from './qb.js'
import { fail, likeEscape, str, now } from './util.js'
import { telegram, sendmessage } from '../tg.js'
import { loadTexts } from '../texts.js'
import { sprintf, randomHex } from '../php.js'
import { tehranDate } from '../bot.js'
import { sendMedia } from '../routes/support.js'

/** supportFileDelivery(): [content type, inline?] */
export function fileDelivery(type, name = '') {
  const ext = (String(name).split('.').pop() || '').toLowerCase()
  const byExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4' }
  switch (type) {
    case 'photo': return ['image/jpeg', true]
    case 'video': case 'animation': case 'video_note': return ['video/mp4', true]
    case 'voice': return ['audio/ogg', true]
    case 'audio': return [byExt[ext] ?? 'audio/mpeg', true]
  }
  return byExt[ext] ? [byExt[ext], true] : ['application/octet-stream', false]
}
const OPEN = "'Unseen','Customerresponse'"

export async function unread() {
  return { ok: true, unread: Number(await qVal(`SELECT COUNT(DISTINCT iduser) FROM support_message WHERE status IN (${OPEN})`, [])) }
}

export async function threads(q) {
  const filter = String(q.f ?? 'open')
  const text = String(q.q ?? '').trim()
  const having = filter === 'closed' ? 'HAVING open_rows = 0' : filter === 'all' ? '' : 'HAVING open_rows > 0'
  let where = '', params = []
  if (text !== '') {
    where = "WHERE s.iduser LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR u.namecustom LIKE ? ESCAPE '\\'"
    const like = '%' + likeEscape(text) + '%'
    params = [like, like, like]
  }
  const rows = await qAll(`SELECT s.iduser, MAX(s.id) AS last_id, COUNT(*) AS n, SUM(s.status IN (${OPEN})) AS unread, SUM(s.status != 'close') AS open_rows, u.username AS tg_username, u.namecustom AS name FROM support_message s LEFT JOIN user u ON u.id = s.iduser ${where} GROUP BY s.iduser, u.username, u.namecustom ${having} ORDER BY (SUM(s.status IN (${OPEN})) > 0) DESC, last_id DESC LIMIT 200`, params)
  const out = []
  for (const t of rows) {
    const l = (await qOne('SELECT name_departman, text, result, time, result_time, file_id, result_file_id FROM support_message WHERE id = ?', [t.last_id])) || {}
    const hasReply = (str(l.result) !== '' && str(l.result) !== '0') || str(l.result_file_id) !== ''
    const snip = hasReply ? 'شما: ' + (l.result === '0' ? '' : str(l.result)) : str(l.text)
    const hasFile = hasReply ? str(l.result_file_id) !== '' : str(l.file_id) !== ''
    const { open_rows, last_id, ...rest } = t
    out.push({ ...rest, snippet: [...(snip + (hasFile ? ' 📎' : '')).trim()].slice(0, 80).join(''), department: str(l.name_departman),
      time: hasReply && str(l.result_time) !== '' ? l.result_time : str(l.time), unread: Number(t.unread), open: Number(open_rows) > 0 })
  }
  return { ok: true, threads: out }
}

export async function thread(q) {
  const uid = String(q.uid ?? '').trim()
  const rows = await qAll('SELECT id, Tracking, name_departman, text, result, time, result_time, result_by, status, file_id, file_type, file_name, result_file_id, result_file_type, result_file_name FROM support_message WHERE iduser = ? ORDER BY id', [uid])
  if (!rows.length) fail('گفتگو پیدا نشد', 404)
  const fileInfo = (type, name, row, side) => {
    const [mime, inline] = fileDelivery(type, name)
    const kind = !inline ? 'file' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'audio'
    return { row, side, kind, name: name !== '' ? name : type === 'photo' ? 'photo.jpg' : type }
  }
  const msgs = []
  for (const r of rows) {
    if (str(r.text) !== '' || str(r.file_id) !== '') {
      const m = { id: r.id + 'c', from: 'customer', text: str(r.text), time: str(r.time), dept: str(r.name_departman) }
      if (str(r.file_id) !== '') m.file = fileInfo(str(r.file_type), str(r.file_name), Number(r.id), 'c')
      msgs.push(m)
    }
    if ((str(r.result) !== '' && str(r.result) !== '0') || str(r.result_file_id) !== '') {
      const m = { id: r.id + 's', from: 'support', text: r.result === '0' ? '' : str(r.result), time: str(r.result_time) !== '' ? r.result_time : str(r.time), by: str(r.result_by) }
      if (str(r.result_file_id) !== '') m.file = fileInfo(str(r.result_file_type), str(r.result_file_name), Number(r.id), 's')
      msgs.push(m)
    }
  }
  await qRun(`UPDATE support_message SET status = 'Pending' WHERE iduser = ? AND status IN (${OPEN})`, [uid])
  const u = await qOne('SELECT username, namecustom, Balance, number FROM user WHERE id = ?', [uid])
  return { ok: true, uid, user: u, messages: msgs, open: rows.some((r) => r.status !== 'close') }
}

/** the reply typed in the panel goes to the customer through the bot, exactly like a reply typed in Telegram */
async function deliver(uid, text, tracking, file) {
  const { T } = await loadTexts()
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const msg = sprintf(T.users.support.messageFromAdmin, esc(text === '' ? '📎' : text))
  const kb = JSON.stringify({ inline_keyboard: [[{ text: T.users.support.answermessage, callback_data: 'Responsesusera_' + tracking }]] })
  if (!file) {
    const r = await sendmessage(uid, msg, kb, 'HTML')
    return r && r.ok !== false && r !== false ? { ok: true, file: null } : { ok: false, error: String((r && r.description) || 'unknown') }
  }
  const fits = [...msg].length <= 1000
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))
  const mime = file.mime
  let attempts = []
  if (['image/jpeg', 'image/png', 'image/webp'].includes(mime) && bytes.length <= 10 * 1024 * 1024) attempts.push(['sendPhoto', 'photo', 'photo'])
  else if (mime.startsWith('video/') && bytes.length <= 50 * 1024 * 1024) attempts.push(['sendVideo', 'video', 'video'])
  else if (['audio/mpeg', 'audio/mp4', 'audio/x-m4a'].includes(mime)) attempts.push(['sendAudio', 'audio', 'audio'])
  attempts.push(['sendDocument', 'document', 'document'])
  let res = { ok: false }, sentType = 'document'
  for (const [method, field, type] of attempts) {
    const data = { chat_id: uid, [field]: new InputFile(bytes, file.name, { type: mime }) }
    if (fits) { data.caption = msg; data.parse_mode = 'HTML'; data.reply_markup = kb }
    res = await telegram(method, data)
    if (res.ok) { sentType = type; break }
  }
  if (!res.ok) return { ok: false, error: String(res.description || 'unknown') }
  if (!fits) await sendmessage(uid, msg, kb, 'HTML')
  const r = res.result || {}
  const fid = sentType === 'photo' ? str((r.photo || []).at(-1)?.file_id) : str(r[sentType]?.file_id)
  return { ok: true, file: fid !== '' ? { type: sentType, id: fid, name: file.name } : null }
}

export async function reply(body, admin) {
  const uid = String(body.uid ?? '').trim()
  const text = String(body.text ?? '').trim()
  let file = null
  if (body.file && body.file.data) {
    const size = Math.floor((String(body.file.data).length * 3) / 4)
    if (size > 5 * 1024 * 1024) fail('حداکثر حجم فایل در مینی‌اپ ۵ مگابایت است', 413)
    const name = String(body.file.name ?? 'file').replace(/[\x00-\x1f\x7f/\\]+/g, '_').slice(0, 120) || 'file'
    file = { data: String(body.file.data), name, mime: String(body.file.mime || 'application/octet-stream'), size }
  }
  if ((text === '' && !file) || [...text].length > 3500) fail('متن پیام خالی یا بیش از حد طولانی است', 422)
  const rows = await qAll('SELECT * FROM support_message WHERE iduser = ? ORDER BY id DESC', [uid])
  if (!rows.length) fail('گفتگو پیدا نشد', 404)
  const pending = rows.filter((r) => ['Unseen', 'Customerresponse', 'Pending'].includes(r.status))
  const by = String(admin.id_admin || admin.username)
  const when = tehranDate()
  const trk = pending.length ? String(pending[0].Tracking) : randomHex(4)
  const d = await deliver(uid, text, trk, file)
  if (!d.ok) fail('ارسال به تلگرام ناموفق بود: ' + d.error + ' (شاید مشتری ربات را مسدود کرده است)', 502)
  const sent = d.file || {}
  if (pending.length) {
    await qRun("UPDATE support_message SET status = 'Answered' WHERE iduser = ? AND status IN ('Unseen','Customerresponse','Pending')", [uid])
    await qRun('UPDATE support_message SET result = ?, result_time = ?, result_by = ?, result_file_id = ?, result_file_type = ?, result_file_name = ? WHERE Tracking = ?', [text, when, by, sent.id ?? '', sent.type ?? '', sent.name ?? '', trk])
  } else {
    await qRun("INSERT INTO support_message (Tracking,idsupport,iduser,name_departman,text,result,result_time,result_by,time,status,result_file_id,result_file_type,result_file_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [trk, rows[0].idsupport, uid, rows[0].name_departman, '', text, when, by, when, 'Answered', sent.id ?? '', sent.type ?? '', sent.name ?? ''])
  }
  return { ok: true }
}

export async function close(body) {
  await qRun("UPDATE support_message SET status = 'close' WHERE iduser = ? AND status != 'close'", [String(body.uid ?? '').trim()])
  return { ok: true }
}

/** Telegram Serverless cannot stream a file to a page: the attachment is sent to the admin's own chat with the bot */
export async function file(q, admin) {
  const r = await qOne('SELECT file_id, file_type, file_name, result_file_id, result_file_type, result_file_name FROM support_message WHERE id = ?', [parseInt(q.row) || 0])
  const s = (q.side ?? 'c') === 's' ? 'result_' : ''
  const fid = str(r && r[s + 'file_id'])
  if (fid === '') fail('فایل پیدا نشد', 404)
  const res = await sendMedia(String(admin.id_admin), str(r[s + 'file_type']), fid, '')
  if (!res || res.ok === false) fail('ارسال فایل ناموفق بود', 502)
  return { ok: true, sent: true }
}
