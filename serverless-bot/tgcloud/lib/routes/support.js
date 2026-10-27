// Help articles and support tickets — index.php lines 3082–3351
import { one, all, run, sql } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { step, tehranDate } from '../bot.js'
import { checkActiveBtn, backuserKb } from '../keyboards.js'
import { savedata, userData } from '../catalog.js'
import { jdate } from '../fmt.js'
import { sprintf, crc32, dechex, randomHex, J } from '../php.js'

const soon = (T) => T.users.helpComingSoon || '📚 این آموزش به‌زودی منتشر می‌شود!'
/** PHP truthiness of a string ("" and "0" are false) */
const truthy = (s) => s !== '' && s !== '0' && s !== null && s !== undefined

/** supportMediaFromMessage() */
function mediaOf(msg) {
  if (!msg || typeof msg !== 'object') return null
  for (const kind of ['photo', 'video', 'document', 'voice', 'audio', 'animation', 'video_note']) {
    const v = msg[kind]
    if (!v || typeof v !== 'object' || (Array.isArray(v) && !v.length)) continue
    const o = kind === 'photo' ? v[v.length - 1] : v
    if (!o || !o.file_id) continue
    return { type: kind, file_id: String(o.file_id), name: String(o.file_name ?? ''), size: Number(o.file_size ?? 0) }
  }
  return null
}
/** supportRecipients(): the department's support id + every administrator / support admin */
async function recipients(primary) {
  const ids = []
  if (primary !== null && primary !== undefined && String(primary).trim() !== '') ids.push(String(primary).trim())
  for (const r of await all(sql`SELECT id_admin FROM admin WHERE rule IN ('administrator','support')`)) if (String(r.id_admin ?? '').trim() !== '') ids.push(String(r.id_admin).trim())
  return [...new Set(ids)]
}
function sendMedia(chatId, type, fileId, caption = '', markup = null) {
  const map = { photo: ['sendPhoto', 'photo'], video: ['sendVideo', 'video'], voice: ['sendVoice', 'voice'], audio: ['sendAudio', 'audio'], animation: ['sendAnimation', 'animation'], video_note: ['sendVideoNote', 'video_note'] }
  const [method, field] = map[type] ?? ['sendDocument', 'document']
  const data = { chat_id: chatId, [field]: fileId }
  if (caption !== '' && type !== 'video_note') { data.caption = caption; data.parse_mode = 'HTML' }
  if (markup) data.reply_markup = markup
  return telegram(method, data)
}
const ticketBy = (t) => one(sql`SELECT * FROM support_message WHERE Tracking = ${t ?? null}`)

async function helpCategoryKb(c) {
  const T = c.T, seen = [], kb = { inline_keyboard: [] }
  for (const r of await all(sql`SELECT * FROM help`)) {
    if (r.category == null || seen.includes(r.category)) continue
    seen.push(r.category)
    kb.inline_keyboard.push([{ text: r.category, callback_data: `helpctg_${dechex(crc32(r.category))}` }])
  }
  if (String(c.setting.linkappstatus) === '1') kb.inline_keyboard.push([{ text: T.keyboard.appDownloadLink, callback_data: 'linkappdownlod' }])
  kb.inline_keyboard.push([{ text: T.users.backbtn, callback_data: 'backuser' }])
  return J(kb)
}

export const supportRoutes = [
  async (c) => {
    if (c.datain !== 'helpsoon') return false
    await sendmessage(c.from_id, soon(c.T), J({ inline_keyboard: [[{ text: c.T.users.backmenu, callback_data: 'backuser' }]] }), 'HTML')
    await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id })
    return true
  },
  async (c) => {
    const T = c.T
    if (!(c.text === T.textbot.help || c.datain === 'helpbtn' || c.datain === 'helpbtns' || c.text === '/help' || c.text === 'help')) return false
    if (!checkActiveBtn(c.setting.keyboardmain, 'text_help')) { await sendmessage(c.from_id, T.users.help.disablehelp, null, 'HTML'); return true }
    if (Number((await one(sql`SELECT COUNT(*) AS n FROM help`)).n) === 0) {
      await sendmessage(c.from_id, soon(T), J({ inline_keyboard: [[{ text: T.users.backmenu, callback_data: 'backuser' }]] }), 'HTML')
      if (c.datain !== '') await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id })
      return true
    }
    let text, kb
    if (String(c.setting.categoryhelp) === '1') { text = T.users.sell.selectCategoryShort; kb = await helpCategoryKb(c) }
    else {
      const k = { inline_keyboard: (await all(sql`SELECT * FROM help`)).map((r) => [{ text: r.name_os, callback_data: `helpos_${r.id}` }]) }
      if (String(c.setting.linkappstatus) === '1') k.inline_keyboard.push([{ text: T.keyboard.appDownloadLink, callback_data: 'linkappdownlod' }])
      k.inline_keyboard.push([{ text: T.users.backmenu, callback_data: 'backuser' }])
      text = T.users.selectoption; kb = J(k)
    }
    if (c.datain === 'helpbtns') await Editmessagetext(c.from_id, c.message_id, text, kb, 'HTML')
    else await sendmessage(c.from_id, text, kb, 'HTML')
    return true
  },
  async (c) => {
    const m = /^helpctg_([0-9a-f]+)/.exec(c.datain) || /^helpctgoryـ(.*)/.exec(c.datain)
    if (!m) return false
    const map = {}
    for (const r of await all(sql`SELECT category FROM help WHERE category IS NOT NULL`)) map[dechex(crc32(r.category))] ??= r.category
    const name = map[m[1]] ?? m[1]
    const rows = (await all(sql`SELECT * FROM help WHERE category = ${name}`)).map((r) => [{ text: r.name_os, callback_data: `helpos_${r.id}` }])
    rows.push([{ text: c.T.users.backmenu, callback_data: 'helpbtns' }])
    await Editmessagetext(c.from_id, c.message_id, c.T.users.selectoption, J({ inline_keyboard: rows }), 'HTML')
    return true
  },
  async (c) => {
    const m = /^helpos_(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    await deletemessage(c.from_id, c.message_id)
    const h = await one(sql`SELECT * FROM help WHERE id = ${m[1]}`)
    if (!h) return true
    const back = (cb) => J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: cb }]] })
    if (String(h.Media_os ?? '').length !== 0) {
      const send = { video: ['sendvideo', 'video'], document: ['sendDocument', 'document'], photo: ['sendphoto', 'photo'] }[h.type_Media_os]
      if (send) await telegram(send[0], { chat_id: c.from_id, [send[1]]: h.Media_os, caption: h.Description_os, reply_markup: back('helpbtn'), parse_mode: 'HTML' })
    } else await sendmessage(c.from_id, h.Description_os, back('helpbtns'), 'HTML')
    return true
  },
  async (c) => {
    const T = c.T
    if (!(c.text === T.textbot.support || c.datain === 'supportbtns' || c.text === '/support')) return false
    if (!checkActiveBtn(c.setting.keyboardmain, 'text_support')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    const second = c.setting.statussupportpv === 'onpvsupport'
      ? { text: T.keyboard.sendMessageToSupport, url: `https://t.me/${c.setting.id_support ?? ''}` }
      : { text: T.keyboard.sendMessageToSupport, callback_data: 'support' }
    const kb = J({ inline_keyboard: [[{ text: T.textbot.faq, callback_data: 'fqQuestions' }, second], [{ text: T.keyboard.backToMainMenu, callback_data: 'backuser' }]] })
    if (c.datain === 'supportbtns') await Editmessagetext(c.from_id, c.message_id, T.users.support.btnsupport, kb)
    else await sendmessage(c.from_id, T.users.support.btnsupport, kb, 'HTML')
    return true
  },
  async (c) => {
    if (c.datain !== 'support') return false
    const rows = (await all(sql`SELECT * FROM departman`)).map((r) => [{ text: r.name_departman, callback_data: `departman_${r.id}` }])
    rows.push([{ text: c.T.users.backbtn, callback_data: 'backuser' }])
    await Editmessagetext(c.from_id, c.message_id, c.T.users.support.selectDepartment, J({ inline_keyboard: rows }), 'HTML')
    return true
  },
  async (c) => {
    const m = /^departman_(.*)/.exec(c.datain)
    if (!m) return false
    await savedata(c, 'clear', 'iddeparteman', m[1])
    await deletemessage(c.from_id, c.message_id)
    await sendmessage(c.from_id, c.T.users.support.sendMessage, backuserKb(c), 'HTML')
    await step(c, 'gettextticket')
    return true
  },
  // a new ticket
  async (c) => {
    const media = mediaOf(c.update.message)
    if (!(c.user.step === 'gettextticket' && (truthy(c.text) || truthy(c.caption) || media))) return false
    const T = c.T
    const ticket = c.text !== '' ? c.text : c.caption
    const dep = (await one(sql`SELECT * FROM departman WHERE id = ${userData(c).iddeparteman ?? null}`)) || {}
    const tracking = randomHex(4)
    await run(sql`INSERT OR IGNORE INTO support_message (Tracking, idsupport, iduser, name_departman, text, time, status) VALUES (${tracking}, ${dep.idsupport ?? null}, ${c.from_id}, ${dep.name_departman ?? null}, ${ticket}, ${tehranDate()}, 'Unseen')`)
    const to = await recipients(dep.idsupport)
    if (media) {
      await run(sql`UPDATE support_message SET file_id = ${media.file_id}, file_type = ${media.type}, file_name = ${media.name} WHERE Tracking = ${tracking}`)
      for (const id of to) await sendMedia(id, media.type, media.file_id)
    }
    const text = sprintf(T.Admin.reportgroup.supportMessage, c.from_id, c.from_id, jdate('Y/m/d H:i:s'), c.username, dep.name_departman, ticket, '')
    const kb = J({ inline_keyboard: [[{ text: T.users.support.answermessage, callback_data: 'Responsesupport_' + tracking }]] })
    for (const id of to) await sendmessage(id, text, kb, 'HTML')
    await sendmessage(c.from_id, T.users.support.sentForReview, c.keyboard, 'HTML')
    await step(c, 'home')
    if (dep.idsupport != null) await step(c, 'home', String(dep.idsupport))
    return true
  },
  // support answers a ticket
  async (c) => {
    const m = /Responsesupport_(\w+)/.exec(c.datain)
    if (!m) return false
    const t = await ticketBy(m[1])
    if (t && t.status === 'Answered') { await sendmessage(c.from_id, c.T.Admin.messageBulk.answeredByOther, null, 'HTML'); return true }
    await sendmessage(c.from_id, c.T.users.support.sendMessageText, backuserKb(c), 'HTML')
    await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
    await step(c, 'getextsupport')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getextsupport') return false
    const T = c.T, tracking = c.user.Processing_value
    const t = (await ticketBy(tracking)) || {}
    const media = mediaOf(c.update.message)
    const reply = c.text !== '' ? c.text : c.caption
    if (reply === '' && !media) { await sendmessage(c.from_id, T.users.support.sendMessageText, backuserKb(c), 'HTML'); return true }
    await run(sql`UPDATE support_message SET status = 'Answered', result = ${reply}, result_time = ${tehranDate()}, result_by = ${c.from_id} WHERE Tracking = ${tracking}`)
    const text = sprintf(T.users.support.messageFromAdmin, reply)
    const kb = J({ inline_keyboard: [[{ text: T.users.support.answermessage, callback_data: 'Responsesusera_' + (t.Tracking ?? '') }]] })
    if (media) {
      await run(sql`UPDATE support_message SET result_file_id = ${media.file_id}, result_file_type = ${media.type}, result_file_name = ${media.name} WHERE Tracking = ${tracking}`)
      const fits = [...text].length <= 1000
      await sendMedia(t.iduser, media.type, media.file_id, fits ? text : '', fits ? kb : null)
      if (!fits) await sendmessage(t.iduser, text, kb, 'HTML')
    } else await sendmessage(t.iduser, text, kb, 'HTML')
    await sendmessage(c.from_id, T.users.support.sentSuccess, null, 'HTML')
    await step(c, 'home')
    return true
  },
  // the customer answers back
  async (c) => {
    const m = /Responsesusera_(\w+)/.exec(c.datain)
    if (!m) return false
    await sendmessage(c.from_id, c.T.users.support.sendMessageText, backuserKb(c), 'HTML')
    await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
    await step(c, 'getextuserfors')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getextuserfors') return false
    const T = c.T
    const media = mediaOf(c.update.message)
    const ticket = c.text !== '' ? c.text : c.caption
    const t = (await ticketBy(c.user.Processing_value)) || {}
    await step(c, 'home')
    await Editmessagetext(c.from_id, c.message_id, c.text_inline, J({ inline_keyboard: [] }))
    const tracking = randomHex(4)
    await run(sql`INSERT OR IGNORE INTO support_message (Tracking, idsupport, iduser, name_departman, text, time, status) VALUES (${tracking}, ${t.idsupport ?? null}, ${t.iduser ?? null}, ${t.name_departman ?? null}, ${ticket}, ${tehranDate()}, 'Customerresponse')`)
    if (media) await run(sql`UPDATE support_message SET file_id = ${media.file_id}, file_type = ${media.type}, file_name = ${media.name} WHERE Tracking = ${tracking}`)
    const text = sprintf(T.Admin.reportgroup.supportMessage2, c.from_id, c.from_id, jdate('Y/m/d H:i:s'), c.username, t.name_departman, ticket)
    const kb = J({ inline_keyboard: [[{ text: T.users.support.answermessage, callback_data: 'Responsesupport_' + tracking }]] })
    const to = await recipients(t.idsupport)
    if (media) for (const id of to) await sendMedia(id, media.type, media.file_id)
    for (const id of to) await sendmessage(id, text, kb, 'HTML')
    await sendmessage(c.from_id, T.users.support.sentForRequestReview, null, 'HTML')
    return true
  },
  async (c) => {
    if (c.datain !== 'fqQuestions') return false
    await sendmessage(c.from_id, c.T.textbot.faqDesc, null, 'HTML')
    return true
  },
]
