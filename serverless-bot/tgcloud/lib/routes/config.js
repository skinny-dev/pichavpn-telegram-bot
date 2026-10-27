// Subscription link (QR), delete an ended service, configs, turn on/off — index.php lines 1154–1408
import { InputFile } from 'sdk'
import { one, run, sql } from '../db.js'
import { sendmessage, Editmessagetext, telegram } from '../tg.js'
import { shop } from '../bot.js'
import { keyboardConfig } from '../keyboards.js'
import { dataUser, removeUser, changeStatus } from '../panel.js'
import { qrPng } from '../qr.js'
import { sprintf, J } from '../php.js'

const own = (inv, c) => inv && String(inv.id_user) === c.from_id
const backinfo = (c, cb = 'productcheckdata') => J({ inline_keyboard: [[{ text: c.T.users.status.backinfo, callback_data: cb }]] })
const png = (text) => new InputFile(qrPng(text), 'qr.png', { type: 'image/png' })

/** a QR picture with a caption; the text alone when the QR cannot be made */
async function sendQr(c, data, caption, keyboard) {
  let pic = null
  try { pic = String(data ?? '') === '' ? null : png(data) } catch { pic = null }
  if (!pic) return sendmessage(c.from_id, caption, keyboard, 'HTML')
  return telegram('sendphoto', { chat_id: c.from_id, photo: pic, reply_markup: keyboard, caption, parse_mode: 'HTML' })
}

export const config = [
  async (c) => {
    const m = /subscriptionurl_(\w+)/.exec(c.datain)
    if (!m && !c.text.includes('/sub ')) return false
    const T = c.T
    let inv
    if (c.text !== '' && c.text[0] === '/') {
      inv = await one(sql`SELECT * FROM invoice WHERE username = ${c.text.split(' ')[1] ?? ''}`)
      if (!own(inv, c)) inv = null
    } else {
      inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]}`)
      if (inv && !own(inv, c)) inv = null
    }
    if (!inv) return true
    const panel = (await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${inv.Service_location}`)) || {}
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    const url = d.subscription_url
    await run(sql`UPDATE user SET Processing_value = ${inv.username} WHERE id = ${c.from_id}`)
    if (panel.type === 'WGDashboard') {
      await telegram('senddocument', { chat_id: c.from_id, document: new InputFile(new TextEncoder().encode(url), `${panel.inboundid}_${inv.username}.conf`), reply_markup: backinfo(c), caption: T.users.status.subscriptionFile, parse_mode: 'HTML' })
      return true
    }
    const textsub = `\n${T.users.status.linksub}\n           \n<code>${url}</code>`
    await sendQr(c, url, textsub, backinfo(c))
    return true
  },
  async (c) => {
    const m = /removeauto-(\w+)/.exec(c.datain)
    if (!m) return false
    const inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]}`)
    if (!own(inv, c)) return true
    await removeUser(inv.Service_location, inv.username)
    await run(sql`UPDATE invoice SET status = 'removebyuser' WHERE id_invoice = ${m[1]}`)
    if (String(c.setting.Channel_Report ?? '').length > 0) {
      await telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics.otherreport, text: sprintf(c.T.Admin.reportgroup.userDeletedService, inv.username), parse_mode: 'HTML' })
    }
    await sendmessage(c.from_id, c.T.users.status.deletedSuccess, null, 'html')
    return true
  },
  async (c) => {
    const m = /config_(\w+)/.exec(c.datain)
    if (!m && !c.text.includes('/link ')) return false
    const T = c.T
    let inv
    if (c.text !== '' && c.text[0] === '/') {
      inv = await one(sql`SELECT * FROM invoice WHERE username = ${c.text.split(' ')[1] ?? ''}`)
      if (!own(inv, c)) inv = null
    } else {
      inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]}`)
      if (inv && !own(inv, c) && !c.isAdmin) inv = null
    }
    if (!inv) { await sendmessage(c.from_id, T.users.status.userNotFound, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    if (!Array.isArray(d.links)) { await sendmessage(c.from_id, T.users.status.configReadError, null, 'html'); return true }
    await Editmessagetext(c.from_id, c.message_id, T.users.status.selectConfig, await keyboardConfig(T, d.links, inv.id_invoice))
    return true
  },
  async (c) => {
    const m = /configget_(.*)_(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    let inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]}`)
    if (inv && !own(inv, c) && !c.isAdmin) inv = null
    if (!inv) { await sendmessage(c.from_id, T.users.status.userNotFound, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    if (m[2] === '1520') {
      for (const link of d.links || []) await sendQr(c, link, `<code>${link}</code>`, null)
      return true
    }
    const link = (d.links || [])[Number(m[2])]
    await sendQr(c, link, `<code>${link ?? ''}</code>`, null)
    return true
  },
  async (c) => {
    const m = /changestatus_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, S = T.users.status
    if ((await shop('statuschangeservice')) === 'offstatus') { await sendmessage(c.from_id, T.users.featureUnavailable, null, 'html'); return true }
    const inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]}`)
    if (!own(inv, c)) return true
    if (inv.Status === 'disablebyadmin') { await sendmessage(c.from_id, T.users.featureUnavailable, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'on_hold') { await sendmessage(c.from_id, S.notConnectedCannotChangeStatus, null, 'html'); return true }
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, S.error, null, 'html'); return true }
    const on = d.status === 'active'
    const kb = J({ inline_keyboard: [[{ text: on ? S.btnConfirmDisableAlt : S.btnConfirmEnableAlt, callback_data: 'confirmaccountdisable_' + m[1] }], [{ text: S.backinfo, callback_data: 'product_' + inv.id_invoice }]] })
    await Editmessagetext(c.from_id, c.message_id, on ? S.confirmDisableConfig : S.confirmEnableConfig, kb)
    return true
  },
  async (c) => {
    const m = /confirmaccountdisable_(\w+)/.exec(c.datain)
    if (!m) return false
    const S = c.T.users.status
    const inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]}`)
    if (!own(inv, c)) return true
    const back = backinfo(c, 'product_' + inv.id_invoice)
    const r = await changeStatus(inv.Service_location, inv.username, c.domain)
    if (r.status === 'Unsuccessful') { await Editmessagetext(c.from_id, c.message_id, S.notchanged, back); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    await Editmessagetext(c.from_id, c.message_id, d.status === 'active' ? S.activedconfig : S.disabledconfig, back)
    return true
  },
]
