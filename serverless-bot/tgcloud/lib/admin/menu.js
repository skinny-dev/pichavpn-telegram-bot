// Admin in the bot, the part that needs a chat: statistics, receipts waiting, a user's card and the actions behind its buttons,
// service-removal requests, an order's card. Everything else an admin does is in the Mini App panel (a button on every card).
import { one, all, run, sql, kvGet, kvSet } from '../db.js'
import { sendmessage, Editmessagetext, deletemessage, telegram } from '../tg.js'
import { step } from '../bot.js'
import { keyboardAdmin, backAdmin } from './keyboards.js'
import { jdate } from '../fmt.js'
import { sprintf, numberFormat, intval, J } from '../php.js'
import { dataUser, removeUser } from '../panel.js'
import { statsReport, statsTs, accParseDateTime } from '../panelapi/stats.js'
import { qOne } from '../panelapi/qb.js'
import { backuserKb } from '../keyboards.js'

const isAdmin = (c) => !!c.adminRow && ['administrator', 'support', 'Seller'].includes(c.adminRow.rule)
const isBoss = (c) => c.adminRow?.rule === 'administrator'
const alert = (c, text) => telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id, text, show_alert: true, cache_time: 5 })
const report = (c, thread, text, extra = {}) => (String(c.setting.Channel_Report ?? '').length > 0 ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML', ...extra }) : null)
const now = () => Math.floor(Date.now() / 1000)
const ACTIVE = "(status = 'active' OR status = 'end_of_time' OR status = 'end_of_volume' OR status = 'sendedwarn' OR Status = 'send_on_hold')"

async function panelButton(label = '🖥 باز کردن در پنل', hash = '') {
  const url = String((await kvGet('config:panel_url')) || '')
  return url ? { text: label, web_app: { url: url.replace(/\/+$/, '') + '/' + hash } } : null
}
const withPanel = async (rows, hash) => { const b = await panelButton(undefined, hash); return J({ inline_keyboard: b ? [...rows, [b]] : rows }) }

export function statsKeyboard(current = '') {
  const b = (t, k) => ({ text: (current === k ? '✅ ' : '') + t, callback_data: 'pstat_' + k })
  return J({ inline_keyboard: [[b('📊 آمار کل', 'all'), b('🕐 یک ساعت اخیر', 'hour')], [b('📅 امروز', 'today'), b('📅 دیروز', 'yesterday')], [b('🗓 ماه فعلی', 'month'), b('🗓 ماه قبل', 'lastmonth')], [{ text: '🗓 آمار در تاریخ مشخص', callback_data: 'view_stat_time' }]] })
}

/** the user's card (manageuser_, /user, /id) */
async function userCard(c, id, edit) {
  const T = c.T
  const u = await one(sql`SELECT * FROM user WHERE id = ${id}`)
  if (!u) { await sendmessage(c.from_id, T.Admin.notUser, null, 'HTML'); return }
  const cnt = async (extra = '', t = null) => (await one(sql`SELECT COUNT(*) AS c, COALESCE(SUM(CAST(price_product AS INTEGER)), 0) AS s FROM invoice WHERE ${sql.raw(ACTIVE)} AND id_user = ${id} ${sql.raw(extra)}`))
  const act = await cnt()
  const paid = await one(sql`SELECT SUM(price) AS s FROM Payment_report WHERE payment_Status = 'paid' AND id_user = ${id} AND Payment_Method != 'low balance by admin'`)
  const vol = await one(sql`SELECT SUM(Volume) AS s FROM invoice WHERE ${sql.raw(ACTIVE)} AND id_user = ${id} AND name_product != ${T.common.labels.testServiceName}`)
  const period = async (from) => one(sql`SELECT COUNT(*) AS c, COALESCE(SUM(CAST(price_product AS INTEGER)), 0) AS s FROM invoice WHERE CAST(time_sell AS INTEGER) > ${from} + 0 AND ${sql.raw(ACTIVE)} AND name_product != ${T.common.labels.testServiceName} AND id_user = ${id}`)
  const h = await period(now() - 3600), m = await period(now() - 2592000)
  const M = T.Admin.manageUser
  const roll = { 1: M.acceptedPhone, 0: M.failedPhone }[u.roll_Status]
  const verify = { 0: M.notVerified, 1: M.verified }[u.verify]
  const showcart = { 0: T.Admin.managepanel.hidden, 1: T.Admin.managepanel.shown }[u.cardpayment]
  const join = u.register && u.register !== 'none' ? jdate('Y/m/d H:i:s', intval(u.register)) : M.unknownName
  const last = u.last_message_time ? jdate('Y/m/d H:i:s', intval(u.last_message_time)) : ''
  const exp = u.agent !== 'f' && u.expire ? T.Admin.agent.expiryDateLabel + jdate('Y/m/d H:i:s', intval(u.expire)) : ''
  const text = sprintf(M.infoSummary, u.User_Status, u.username, id, id, u.codeInvitation, join, last, u.limit_usertest, roll, u.number, u.agent, u.affiliatescount, u.affiliates, verify, showcart, u.score,
    vol?.s ?? 0, exp, numberFormat(intval(u.Balance)), act.c, paid?.s ?? 0, act.s ?? 0, u.pricediscount, h.c, h.s, m.c, m.s)
  const rows = [
    [{ text: T.keyboard.refreshInfoAlt, callback_data: 'updateinfouser_' + id }],
    [{ text: M.addBalanceUser, callback_data: 'addbalanceuser_' + id }, { text: M.lowBalanceUser, callback_data: 'lowbalanceuser_' + id }],
    [{ text: M.banUserList, callback_data: 'banuserlist_' + id }, { text: M.unbanUserList, callback_data: 'unbanuserr_' + id }],
    [{ text: T.keyboard.sendMessageToUser, callback_data: 'sendmessageuser_' + id }, { text: M.viewOrderUser, callback_data: 'vieworderuser_' + id }],
  ]
  const kb = await withPanel(rows, '#/users')
  if (edit) { await alert(c, T.keyboard.infoUpdated); await Editmessagetext(c.from_id, c.message_id, text, kb) } else { await sendmessage(c.from_id, text, kb, 'HTML'); await sendmessage(c.from_id, T.users.selectoption, keyboardAdmin(c), 'HTML') }
  await step(c, 'home')
}

/** an order's card (manageinvoice_, /config) */
async function orderCard(c, inv) {
  const T = c.T
  const when = inv.time_sell ? jdate('Y/m/d H:i:s', intval(inv.time_sell)) : T.Admin.manageUser.dataorder
  const isTest = inv.name_product === T.common.labels.testServiceName
  const time = inv.Service_time + (isTest ? T.Admin.unit.hours : T.Admin.unit.days)
  const vol = inv.Volume + (isTest ? T.Admin.unit.megabytes : T.Admin.unit.gigabytes)
  let text = sprintf(T.Admin.order.detailRow, inv.id_invoice, inv.Status, inv.id_user, inv.username, inv.Service_location, inv.name_product, inv.price_product, vol, time, when)
  const d = await dataUser(inv.Service_location, inv.username, c.domain)
  if (d && d.status && d.status !== 'Unsuccessful') {
    const gb = (n) => (Number(n || 0) / 1024 ** 3).toFixed(2)
    text += `\n\n📡 وضعیت روی پنل: ${d.status}\n📊 مصرف: ${gb(d.used_traffic)} از ${d.data_limit ? gb(d.data_limit) : '∞'} گیگ` + (d.expire ? `\n⏳ انقضا: ${jdate('Y/m/d H:i', intval(d.expire))}` : '')
  }
  const kb = await withPanel([[{ text: T.keyboard.refresh, callback_data: 'manageinvoice_' + inv.id_invoice }], ...(inv.id_user && inv.id_user !== '0' ? [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + inv.id_user }]] : [])], '#/orders')
  await sendmessage(c.from_id, text, kb, 'HTML')
}

export const adminMenuRoutes = [
  // ---- entering the admin menu, and coming back to it
  async (c) => {
    if (!isAdmin(c)) return false
    const T = c.T
    const enter = ['panel', '/panel', T.Admin.panelAdmin].includes(c.text) || c.datain === 'admin'
    const back = c.text === T.Admin.backAdminBtn || c.text === T.Admin.backMenuBtn
    if (!enter && !back) return false
    if (c.datain === 'admin') await deletemessage(c.from_id, c.message_id)
    await sendmessage(c.from_id, '🛠 <b>پنل ادمین پیچا</b>\n\nکارهای سریع همین‌جاست؛ مدیریت کامل (سفارش‌ها، کاربران، پشتیبانی، آمار، تخفیف‌ها، مالی …) در «🖥 پنل مدیریت (مینی‌اپ)».', keyboardAdmin(c), 'HTML')
    await step(c, 'home')
    return true
  },
  // ---- statistics
  async (c) => {
    if (!isBoss(c)) return false
    if (c.text === c.T.Admin.Status.btn || c.datain === 'stat_all_bot') {
      const txt = await statsReport('all')
      if (c.datain === 'stat_all_bot') await Editmessagetext(c.from_id, c.message_id, txt, statsKeyboard('all'), 'HTML')
      else await sendmessage(c.from_id, txt, statsKeyboard('all'), 'HTML')
      return true
    }
    if (c.datain === 'view_stat_time') {
      await sendmessage(c.from_id, sprintf(c.T.Admin.getStats, new Date().toISOString().slice(0, 10).replace(/-/g, '/')), backAdmin(c), 'HTML')
      await step(c, 'get_time_start')
      return true
    }
    if (c.user.step === 'get_time_start') {
      if (accParseDateTime(c.text) === null || c.text.trim() === '') { await sendmessage(c.from_id, c.T.Admin.stats.invalidDate, null, 'HTML'); return true }
      await run(sql`UPDATE user SET Processing_value = ${JSON.stringify({ start_time: c.text.trim() })} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, c.T.Admin.stats.askDate, backAdmin(c), 'HTML')
      await step(c, 'get_time_end')
      return true
    }
    if (c.user.step === 'get_time_end') {
      const a = accParseDateTime(JSON.parse(c.user.Processing_value || '{}').start_time ?? ''), b = accParseDateTime(c.text)
      if (b === null || c.text.trim() === '') { await sendmessage(c.from_id, c.T.Admin.stats.invalidDate, null, 'HTML'); return true }
      const start = a - ((a + 12600) % 86400), end = b - ((b + 12600) % 86400) + 86399 - 60
      const P = { s: start, e: end }
      const T = c.T
      const inv = await qOne(`SELECT COUNT(*) c, SUM(CAST(price_product AS INTEGER)) s FROM invoice WHERE CAST(time_sell AS INTEGER) BETWEEN ? AND ? AND Status != 'Unpaid' AND name_product != ?`, [P.s, P.e, T.common.labels.testServiceName])
      const tests = await qOne(`SELECT COUNT(*) c FROM invoice WHERE CAST(time_sell AS INTEGER) BETWEEN ? AND ? AND name_product = ?`, [P.s, P.e, T.common.labels.testServiceName])
      const so = (types, extra = '') => qOne(`SELECT COUNT(*) c, SUM(CAST(price AS INTEGER)) s FROM service_other WHERE ${statsTs('time')} BETWEEN ? AND ? AND type = '${types}' ${extra}`, [P.s, P.e])
      const ext = await so('extend_user', "AND status != 'unpaid'"), vol = await so('extra_user'), tim = await so('extra_time_user'), loc = await so('change_location')
      const nu = await qOne("SELECT COUNT(*) c FROM user WHERE register != 'none' AND register != '' AND register NOT GLOB '*[^0-9]*' AND CAST(register AS INTEGER) BETWEEN ? AND ?", [P.s, P.e])
      const f = (r) => numberFormat(Number(r?.s ?? 0))
      await step(c, 'home')
      await sendmessage(c.from_id, sprintf(T.Admin.stats.selectedRange, jdate('Y/m/d H:i', start), jdate('Y/m/d H:i', end), inv.c, f(inv), ext.c, f(ext), vol.c, f(vol), tim.c, f(tim), loc.c, f(loc), tests.c, nu.c), keyboardAdmin(c), 'HTML')
      return true
    }
    if (c.datain.startsWith('pstat_')) {
      let key = c.datain.slice(6)
      if (!['all', 'hour', 'today', 'yesterday', 'month', 'lastmonth'].includes(key)) key = 'all'
      await Editmessagetext(c.from_id, c.message_id, await statsReport(key), statsKeyboard(key), 'HTML')
      return true
    }
    return false
  },
  // ---- receipts waiting
  async (c) => {
    if (!isAdmin(c)) return false
    const T = c.T
    if (c.text === T.keyboard.pendingReceipts) {
      const list = await all(sql`SELECT * FROM Payment_report WHERE Payment_Method = 'cart to cart' AND payment_Status = 'waiting'`)
      if (!list.length) { await sendmessage(c.from_id, T.Admin.Payment.noPending, null, 'HTML'); return true }
      const kb = { inline_keyboard: [] }
      for (const p of list) {
        kb.inline_keyboard.push([{ text: p.id_user, callback_data: 'checkpay' }])
        kb.inline_keyboard.push([{ text: '✅', callback_data: 'Confirm_pay_' + p.id_order }, { text: '❌', callback_data: 'reject_pay_' + p.id_order }, { text: '📝', callback_data: 'showinfopay_' + p.id_order }, { text: '🗑', callback_data: 'removeresid_' + p.id_order }])
        kb.inline_keyboard.push([{ text: '💸💸💸💸💸💸💸💸💸', callback_data: 'checkpay' }])
      }
      kb.inline_keyboard.push([{ text: T.keyboard.deleteAllReceipts, callback_data: 'removeresid' }])
      await sendmessage(c.from_id, T.Admin.Payment.pendingIntro, J(kb), 'HTML')
      return true
    }
    if (c.datain === 'removeresid') {
      await deletemessage(c.from_id, c.message_id)
      await sendmessage(c.from_id, T.Admin.Payment.allReceiptsDeleted, null, 'HTML')
      await run(sql`UPDATE Payment_report SET payment_Status = 'reject', dec_not_confirmed = 'remove_all' WHERE Payment_Method = 'cart to cart' AND payment_Status = 'waiting'`)
      return true
    }
    let m = /^removeresid_(\w+)$/.exec(c.datain)
    if (m) {
      await run(sql`DELETE FROM Payment_report WHERE id_order = ${m[1]}`)
      await sendmessage(c.from_id, T.Admin.Payment.receiptDeleted, null, 'HTML')
      return true
    }
    m = /showinfopay_(\w+)/.exec(c.datain)
    if (m) {
      const p = await one(sql`SELECT * FROM Payment_report WHERE id_order = ${m[1]}`)
      if (!p) { await alert(c, T.keyboard.transactionDeleted); return true }
      await sendmessage(c.from_id, sprintf(T.Admin.Payment.detailRow2, p.id_order, p.id_user, p.price, p.payment_Status, p.Payment_Method, p.time), null, 'HTML')
      return true
    }
    return false
  },
  // ---- a user's card and what its buttons do
  async (c) => {
    if (!isAdmin(c)) return false
    const T = c.T
    let id = null, edit = false
    let m = /manageuser_(\w+)/.exec(c.datain)
    if (m) id = m[1]
    if (!id && (m = /updateinfouser_(\w+)/.exec(c.datain))) { id = m[1]; edit = true }
    if (!id && (m = /^\/(?:user|id) (\S+)/.exec(c.text))) id = m[1]
    if (!id && c.user.step === 'show_info') id = c.text.trim()
    if (id) { await userCard(c, id, edit); return true }
    if (c.text === T.Admin.btnKeyboard.manageUser && !c.datain) {
      await sendmessage(c.from_id, '👤 آیدی عددی کاربر را بفرستید (یا <code>/user 12345</code>).\n\nجستجو، لیست کاربران و عملیات گروهی در پنل مینی‌اپ است.', await withPanel([], '#/users'), 'HTML')
      await step(c, 'show_info')
      return true
    }
    if ((m = /addbalanceuser_(\w+)/.exec(c.datain))) {
      await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
      await telegram('sendmessage', { chat_id: c.from_id, text: T.Admin.manageUser.addBalanceUserDesc, reply_markup: backAdmin(c), parse_mode: 'HTML', reply_to_message_id: c.message_id })
      await step(c, 'addbalanceusercurrent')
      return true
    }
    if ((m = /lowbalanceuser_(\w+)/.exec(c.datain))) {
      await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
      await telegram('sendmessage', { chat_id: c.from_id, text: T.Admin.manageUser.lowBalanceUserDesc, reply_markup: backAdmin(c), parse_mode: 'HTML', reply_to_message_id: c.message_id })
      await step(c, 'addbalanceuser')
      return true
    }
    if (['addbalanceusercurrent', 'addbalanceuser'].includes(c.user.step)) {
      const add = c.user.step === 'addbalanceusercurrent'
      if (!/^\d+$/.test(c.text)) { await sendmessage(c.from_id, T.Admin.Balance.invalidPrice, backAdmin(c), 'HTML'); return true }
      if (Number(c.text) > 100000000) { await sendmessage(c.from_id, T.Admin.Balance.maxAmountToman, backAdmin(c), 'HTML'); return true }
      const uid = c.user.Processing_value
      const rnd = [...crypto.getRandomValues(new Uint8Array(5))].map((x) => x.toString(16).padStart(2, '0')).join('')
      const tehran = new Date((now() + 12600) * 1000), p2 = (n) => String(n).padStart(2, '0')
      const when = `${tehran.getUTCFullYear()}/${p2(tehran.getUTCMonth() + 1)}/${p2(tehran.getUTCDate())} ${p2(tehran.getUTCHours())}:${p2(tehran.getUTCMinutes())}:${p2(tehran.getUTCSeconds())}`
      await run(sql`INSERT INTO Payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES (${uid}, ${rnd}, ${when}, ${c.text}, 'paid', ${add ? 'add balance by admin' : 'low balance by admin'}, NULL)`)
      await sendmessage(c.from_id, add ? T.Admin.manageUser.addBalanced : T.Admin.manageUser.lowBalanced, keyboardAdmin(c), 'html')
      const bu = (await one(sql`SELECT * FROM user WHERE id = ${uid}`)) || {}
      const nb = intval(bu.Balance) + (add ? 1 : -1) * Number(c.text)
      await run(sql`UPDATE user SET Balance = ${nb} WHERE id = ${uid}`)
      await sendmessage(uid, sprintf(add ? T.users.Balance.addedNotice : T.users.Balance.deductedNotice2, numberFormat(Number(c.text), 0)), null, 'HTML')
      await step(c, 'home')
      await report(c, 'paymentreport', add ? sprintf(T.Admin.reportgroup.balanceIncreased, c.username, c.from_id, uid, numberFormat(Number(c.text)), numberFormat(nb)) : sprintf(T.Admin.reportgroup.balanceDecreased2, c.username, c.from_id, uid, c.text, numberFormat(nb)))
      return true
    }
    if ((m = /unbanuserr_(\w+)/.exec(c.datain))) {
      const u = (await one(sql`SELECT * FROM user WHERE id = ${m[1]}`)) || {}
      if (u.User_Status === 'Active') { await sendmessage(c.from_id, T.Admin.manageUser.userNotBlock, null, 'HTML'); return true }
      await report(c, 'otherservice', sprintf(T.Admin.reportgroup.userUnblocked, m[1], c.from_id), { reply_markup: J({ inline_keyboard: [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + m[1] }]] }) })
      await run(sql`UPDATE user SET User_Status = 'Active' WHERE id = ${m[1]}`)
      await sendmessage(c.from_id, T.Admin.manageUser.unblockedUser ?? '✅ کاربر آزاد شد', null, 'HTML')
      return true
    }
    if ((m = /sendmessageuser_(\w+)/.exec(c.datain))) {
      await run(sql`UPDATE user SET Processing_value = ${JSON.stringify({ iduser: m[1] })} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.Admin.messageBulk.askTextOrImage, backAdmin(c), 'HTML')
      await step(c, 'sendmessagetext')
      return true
    }
    if (c.user.step === 'sendmessagetext') {
      const d = JSON.parse(c.user.Processing_value || '{}')
      if (c.photoid) { d.type = 'photo'; d.photoid = c.photoid; d.text = c.caption } else { d.type = 'text'; d.text = c.text }
      await run(sql`UPDATE user SET Processing_value = ${JSON.stringify(d)} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.Admin.messageBulk.askAllowReply, backAdmin(c), 'HTML')
      await step(c, 'sendmessagetid')
      return true
    }
    if (c.user.step === 'sendmessagetid') {
      const d = JSON.parse(c.user.Processing_value || '{}')
      if (!/^\d+$/.test(c.text)) { await sendmessage(c.from_id, T.common.invalidInput, backAdmin(c), 'HTML'); return true }
      const msg = sprintf(T.users.support.messageFromAdminAlt, d.text)
      const kb = intval(c.text) === 1 ? J({ inline_keyboard: [[{ text: T.users.support.answermessage, callback_data: 'Responseuser' }]] }) : null
      if (d.type === 'photo') await telegram('sendphoto', { chat_id: d.iduser, photo: d.photoid, caption: msg, ...(kb ? { reply_markup: kb } : {}), parse_mode: 'HTML' })
      else await sendmessage(d.iduser, msg, kb, 'HTML')
      await sendmessage(c.from_id, T.Admin.manageUser.messageSent, keyboardAdmin(c), 'HTML')
      await step(c, 'home')
      return true
    }
    if ((m = /vieworderuser_(\w+)/.exec(c.datain))) {
      const rows = await all(sql`SELECT id_invoice, username, Status FROM invoice WHERE id_user = ${m[1]} ORDER BY CAST(time_sell AS INTEGER) DESC LIMIT 40`)
      if (!rows.length) { await sendmessage(c.from_id, T.Admin.order.notFound, null, 'HTML'); return true }
      await sendmessage(c.from_id, T.Admin.order.selectService, J({ inline_keyboard: rows.map((r) => [{ text: 'ℹ️', callback_data: 'manageinvoice_' + r.id_invoice }, { text: r.Status, callback_data: 'username' }, { text: r.username, callback_data: 'username' }]) }), 'HTML')
      return true
    }
    return false
  },
  // ---- an order (manageinvoice_, /config)
  async (c) => {
    if (!isAdmin(c)) return false
    const T = c.T
    let m = /manageinvoice_(\w+)/.exec(c.datain)
    let name = null, exact = false
    if (m) { name = (await one(sql`SELECT username FROM invoice WHERE id_invoice = ${m[1]}`))?.username; exact = true }
    else if ((m = /^\/config (\S+)/.exec(c.text))) name = m[1]
    else if (c.user.step === 'GetusernameconfigAndOrdedrs') name = c.text
    else if (c.text === T.keyboard.searchOrder && !c.datain) { await sendmessage(c.from_id, T.Admin.managepanel.askConfigUsername, backAdmin(c), 'HTML'); await step(c, 'GetusernameconfigAndOrdedrs'); return true }
    else return false
    if (name === null || name === undefined) return false
    await step(c, 'home')
    const rows = exact ? await all(sql`SELECT * FROM invoice WHERE username = ${name} OR note = ${name}`) : await all(sql`SELECT * FROM invoice WHERE username LIKE ${'%' + name + '%'} OR note LIKE ${'%' + name + '%'}`)
    if (rows.length > 1) {
      await sendmessage(c.from_id, T.Admin.order.selectService, J({ inline_keyboard: rows.slice(0, 40).map((r) => [{ text: T.keyboard.viewInfo, callback_data: 'manageinvoice_' + r.id_invoice }, { text: r.Status, callback_data: 'username' }, { text: r.username, callback_data: 'username' }]) }), 'HTML')
      return true
    }
    if (!rows.length) { await sendmessage(c.from_id, T.Admin.order.notFound, null, 'HTML'); return true }
    await orderCard(c, rows[0])
    return true
  },
  // ---- the customer asked to delete a service
  async (c) => {
    if (!isAdmin(c)) return false
    const T = c.T
    const request = async (idInvoice) => {
      const invoice = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${idInvoice}`)
      const req = invoice ? await one(sql`SELECT * FROM cancel_service WHERE username = ${invoice.username}`) : null
      return { invoice, req }
    }
    let m = /rejectremoceserviceadmin-(\w+)/.exec(c.datain)
    if (m) {
      const { req } = await request(m[1])
      if (!req) return true
      if (req.status === 'accept' || req.status === 'reject') { await alert(c, T.keyboard.alreadyReviewed); return true }
      await step(c, 'descriptionsrequsts')
      await run(sql`UPDATE user SET Processing_value = ${req.username} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.Admin.order.askRejectReason, backuserKb(c), 'HTML')
      return true
    }
    if (c.user.step === 'descriptionsrequsts') {
      await sendmessage(c.from_id, T.Admin.order.requestRegistered, keyboardAdmin(c), 'HTML')
      const inv = await one(sql`SELECT * FROM invoice WHERE username = ${c.user.Processing_value}`)
      await run(sql`UPDATE cancel_service SET status = 'reject', description = ${c.text} WHERE username = ${c.user.Processing_value}`)
      await step(c, 'home')
      if (inv) await sendmessage(inv.id_user, sprintf(T.users.status.deleteRequestRejected, c.user.Processing_value, c.text), null, 'HTML')
      return true
    }
    if ((m = /remoceserviceadminmanual-(\w+)/.exec(c.datain))) {
      await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
      const { invoice, req } = await request(m[1])
      if (!req) return true
      if (req.status === 'accept' || req.status === 'reject') { await alert(c, T.keyboard.alreadyReviewed); return true }
      await removeUser(invoice.Service_location, req.username)
      await run(sql`UPDATE cancel_service SET status = 'accept' WHERE username = ${req.username}`)
      await run(sql`UPDATE invoice SET status = 'removedbyadmin' WHERE username = ${req.username}`)
      await sendmessage(invoice.id_user, sprintf(T.users.status.deleteRequestApproved2, invoice.username), null, 'HTML')
      await sendmessage(c.from_id, T.Admin.order.askRefundAmount, backAdmin(c), 'HTML')
      await step(c, 'getpricebackremove')
      return true
    }
    if (c.user.step === 'getpricebackremove') {
      if (!/^\d+$/.test(c.text)) { await sendmessage(c.from_id, T.common.invalidInput, backAdmin(c), 'HTML'); return true }
      const inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${c.user.Processing_value}`)
      const u = (await one(sql`SELECT * FROM user WHERE id = ${inv.id_user}`)) || {}
      await run(sql`UPDATE user SET Balance = ${intval(u.Balance) + intval(c.text)} WHERE id = ${inv.id_user}`)
      await sendmessage(inv.id_user, sprintf(T.users.Balance.addedNotice5, c.text), null, 'HTML')
      await sendmessage(c.from_id, T.Admin.Balance.addedToUser, keyboardAdmin(c), 'HTML')
      await report(c, 'otherreport', sprintf(T.Admin.reportgroup.deleteRequestApproved2, c.from_id, c.text, inv.username, inv.id_user))
      await step(c, 'home')
      return true
    }
    if ((m = /remoceserviceadmin-(\w+)/.exec(c.datain))) {
      const { invoice, req } = await request(m[1])
      if (!req) return true
      if (req.status === 'accept' || req.status === 'reject') { await alert(c, T.keyboard.alreadyReviewed); return true }
      const inv = await one(sql`SELECT * FROM invoice WHERE username = ${req.username}`)
      const d = await dataUser(inv.Service_location, req.username, c.domain)
      const sum = intval((await one(sql`SELECT SUM(CAST(price AS INTEGER)) AS s FROM service_other WHERE username = ${inv.username} AND type != 'change_location' AND type != 'extend_user'`))?.s)
      if (d && d.msg === 'User not found') { await sendmessage(c.from_id, T.users.status.userNotFound, null, 'html'); await step(c, 'home'); return true }
      if ((d.data_limit == null) && (d.expire == null)) { await sendmessage(c.from_id, T.Admin.cronjob.cannotDeleteUnlimited, null, 'html'); await step(c, 'home'); return true }
      const price = Number(invoice.price_product) || 0
      const st = Number(inv.Service_time) || 0
      const GB = 1024 ** 3
      let left
      if (d.status === 'on_hold') left = price
      else if (d.data_limit == null) left = st > 0 ? ((Number(d.expire) - now()) / 86400) * (Number(inv.price_product) / st + sum) : 0
      else if (d.expire == null) {
        const lim = Number(d.data_limit) || 0
        left = lim > 0 ? Math.round(((lim - Number(d.used_traffic || 0)) / GB / (lim / GB)) * (Number(inv.price_product) + sum) * 100) / 100 : 0
      } else {
        const lim = Number(d.data_limit) || 0, div = lim / GB
        if (st > 0 && div > 0) left = Math.round((Math.round((Number(d.expire) - now()) / 86400) / st) * ((lim - Number(d.used_traffic || 0)) / GB / div) * (Number(inv.price_product) + sum) * 100) / 100
        else left = 0
      }
      left = Math.trunc(left)
      if (left !== 0) {
        const bu = (await one(sql`SELECT * FROM user WHERE id = ${inv.id_user}`)) || {}
        await run(sql`UPDATE user SET Balance = ${intval(bu.Balance) + left} WHERE id = ${inv.id_user}`)
        await sendmessage(inv.id_user, sprintf(T.users.Balance.addedNotice4, left), null, 'HTML')
      }
      await removeUser(inv.Service_location, req.username)
      await run(sql`UPDATE cancel_service SET status = 'accept' WHERE username = ${req.username}`)
      await run(sql`UPDATE invoice SET status = 'removedbyadmin' WHERE username = ${req.username}`)
      await sendmessage(c.from_id, sprintf(T.Admin.Balance.addedToUserNotice, left), null, 'HTML')
      await sendmessage(inv.id_user, sprintf(T.users.status.deleteRequestApproved, inv.username), null, 'HTML')
      await report(c, 'otherreport', sprintf(T.Admin.reportgroup.deleteRequestApproved, c.from_id, left, req.username, inv.id_user))
      return true
    }
    return false
  },
  // ---- the Mini App
  async (c) => {
    if (!isAdmin(c)) return false
    const sp = /^\/setpanel\s+(https:\/\/\S+)\s*$/.exec(c.text)
    if (isBoss(c) && sp) {
      const m = sp
      await kvSet('config:panel_url', m[1].replace(/\/+$/, ''))
      await sendmessage(c.from_id, '✅ آدرس پنل مینی‌اپ ذخیره شد. حالا /webpanel را بزنید.', null, 'HTML')
      return true
    }
    if (c.text === '🖥 پنل مدیریت (مینی‌اپ)' || c.text === '/webpanel') {
      const url = String((await kvGet('config:panel_url')) || '').replace(/\/+$/, '')
      if (!url) { await sendmessage(c.from_id, '⚠️ آدرس پنل هنوز ثبت نشده. مدیر کل یک‌بار بفرستد: <code>/setpanel https://appXXXX.tgcloud.ai</code> (آدرسی که بعد از <code>npm run deploy</code> چاپ می‌شود).', null, 'HTML'); return true }
      await telegram('setChatMenuButton', { chat_id: c.from_id, menu_button: { type: 'web_app', text: 'پنل', web_app: { url: url + '/' } } })
      await sendmessage(c.from_id, '🖥 <b>پنل مدیریت پیچا</b>\n\nهمه‌ی بخش‌های مدیریتی (سفارش‌ها، کاربران، پشتیبانی، آمار، تخفیف‌ها …) داخل تلگرام. ورود با همین حساب تلگرام است.\n\nدکمه‌ی «پنل» کنار کادر پیام هم همین را باز می‌کند.',
        J({ inline_keyboard: [[{ text: '🖥 باز کردن پنل', web_app: { url: url + '/' } }]] }), 'HTML')
      return true
    }
    return false
  },
  // ---- the rest of the old admin keyboard lives in the panel
  async (c) => {
    if (!isAdmin(c) || c.datain) return false
    const T = c.T
    const labels = [T.Admin.btnKeyboard.managementPanel, T.Admin.btnKeyboard.addPanel, T.keyboard.quickSetTimePrice, T.keyboard.quickSetVolumePrice, T.keyboard.shopSettings, T.keyboard.financial, T.keyboard.cronStatus,
      T.keyboard.supportSection, T.keyboard.educationSection, T.keyboard.botReport, T.keyboard.generalSettings].filter(Boolean)
    if (!labels.includes(c.text)) return false
    const b = await panelButton('🖥 باز کردن پنل مدیریت')
    await sendmessage(c.from_id, '🖥 این بخش در <b>پنل مدیریت (مینی‌اپ)</b> است؛ دکمه‌ی زیر را بزنید.' + (b ? '' : '\n\n(مدیر کل: <code>/setpanel https://appXXXX.tgcloud.ai</code>)'), b ? J({ inline_keyboard: [[b]] }) : null, 'HTML')
    return true
  },
]
