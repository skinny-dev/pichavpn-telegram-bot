// index.php lines 5918–6652: referral page and membership gift, agents (extra volume for a panel user, panel,
// custom name, request to become an agent), message to the admins, lucky wheel, price commands, renew list, apps, notes.
import { one, all, run, sql, kvGet } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { step, shop, tehranDate } from '../bot.js'
import { checkActiveBtn, backuserKb } from '../keyboards.js'
import { dataUser, extraVolume } from '../panel.js'
import { deductBalance, addBalance, stepPaymentKb } from '../catalog.js'
import { rateArze } from './pay.js'
import { reportTs } from '../sms.js'
import { jdate } from '../fmt.js'
import { sprintf, numberFormat, intval, time, J, phpJson } from '../php.js'

const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v))
const n = (v) => (isNumeric(v) ? Number(v) : 0)
const truthy = (s) => s !== '' && s !== '0' && s !== null && s !== undefined && s !== 0
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
const report = (c, thread, text) => (String(c.setting.Channel_Report ?? '').length > 0 ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML' }) : null)
const LIVE = `(status = 'active' OR status = 'end_of_time' OR status = 'end_of_volume' OR status = 'sendedwarn' OR Status = 'send_on_hold')`

/** $keyboardagent of keyboard.php */
export async function keyboardAgent(c) {
  const T = c.T
  const named = Number((await one(sql`SELECT COUNT(*) AS n FROM marzban_panel WHERE MethodUsername = 'agentCustomTextSequential'`)).n)
  if (c.setting.inlinebtnmain === 'oninline') {
    const row = [{ text: T.keyboard.bulkPurchase, callback_data: 'kharidanbuh' }]
    if (named) row.push({ text: T.keyboard.selectCustomName, callback_data: 'selectname' })
    return J({ inline_keyboard: [row, [{ text: T.users.backbtn, callback_data: 'backuser' }]], resize_keyboard: true })
  }
  const row = [{ text: T.keyboard.bulkPurchase }]
  if (named) row.push({ text: T.keyboard.selectCustomName })
  return J({ keyboard: [row, [{ text: T.users.backbtn }]], resize_keyboard: true })
}
/** the renew list (20 a page) */
async function renewList(c, page) {
  const T = c.T
  const rows = await all(sql`SELECT * FROM invoice WHERE id_user = ${c.from_id} AND ${sql.raw(LIVE)} ORDER BY time_sell DESC LIMIT 20 OFFSET ${(page - 1) * 20}`)
  const kb = { inline_keyboard: rows.map((r) => [{ text: '✨' + r.username + (c.statusnote ? ` | ${r.note ?? ''}` : '') + '✨', callback_data: 'extend_' + r.id_invoice }]) }
  return kb
}
const sanitizeName = (s) => ["'", '"', '<', '>', '--', '#', ';', '\\', '%', '(', ')'].reduce((a, ch) => a.split(ch).join(''), String(s))

export const miscRoutes = [
  // the referral page
  async (c) => {
    const T = c.T, user = c.user
    if (!(c.text === T.textbot.affiliates || c.datain === 'affiliatesbtn')) return false
    if (!checkActiveBtn(c.setting.keyboardmain, 'text_affiliates')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    const aff = (await one(sql`SELECT * FROM affiliates LIMIT 1`)) || {}
    const bot = (await kvGet('config:usernamebot')) || ''
    const intro = `${aff.description ?? ''}\n\n🔗 https://t.me/${bot}?start=${c.from_id}`
    if (String(aff.id_media ?? '').length >= 5) await telegram('sendphoto', { chat_id: c.from_id, photo: aff.id_media, caption: intro, parse_mode: 'HTML' })
    const info = (await one(sql`SELECT COUNT(*) AS orders, SUM(price_product) AS total_price FROM invoice WHERE Status IN ('active', 'end_of_time', 'sendedwarn', 'send_on_hold') AND refral = ${c.from_id} AND name_product != ${T.common.labels.testServiceName}`)) || {}
    const total = (n(info.total_price) * n(c.setting.affiliatespercentage)) / 100
    const kb = J({ inline_keyboard: [[{ text: T.keyboard.receiveMembershipGift, callback_data: 'get_gift_start' }, { text: T.keyboard.shareLink, url: `https://t.me/share/url?url=https://t.me/${bot}?start=${c.from_id}` }]] })
    const start = aff.Discount === 'onDiscountaffiliates' ? sprintf(T.users.affiliates.membershipGiftInfo, aff.price_Discount) : ''
    const porsant = aff.status_commission === 'oncommission' ? sprintf(T.users.affiliates.purchaseCommissionInfo, c.setting.affiliatespercentage) : ''
    await sendmessage(c.from_id, sprintf(T.users.affiliates.welcomeGiftInfo, start, porsant, user.affiliatescount, info.orders, numberFormat(total, 0)), kb, 'HTML')
    return true
  },
  // the membership gift (half to the user, half to who invited them)
  async (c) => {
    if (c.datain !== 'get_gift_start') return false
    const T = c.T, user = c.user, A = T.users.affiliates
    const aff = (await one(sql`SELECT * FROM affiliates LIMIT 1`)) || {}
    if (aff.Discount === 'offDiscountaffiliates') { await sendmessage(c.from_id, T.users.sectionDisabled, c.keyboard, 'HTML'); return true }
    if (!(await one(sql`SELECT 1 AS x FROM user WHERE id = ${user.affiliates ?? null} LIMIT 1`))) { await sendmessage(c.from_id, A.notReferral, c.keyboard, 'HTML'); return true }
    const rg = await one(sql`SELECT * FROM reagent_report WHERE user_id = ${c.from_id}`)
    if (!rg) { await sendmessage(c.from_id, A.notReferral, c.keyboard, 'HTML'); return true }
    // MySQL: '' = 0 is true
    const claim = await run(sql`UPDATE reagent_report SET get_gift = 1 WHERE user_id = ${c.from_id} AND (get_gift = 0 OR get_gift = '' OR get_gift = '0')`)
    if (Number(claim?.rowsAffected ?? 0) !== 1) { await sendmessage(c.from_id, A.membershipGiftClaimed, c.keyboard, 'HTML'); return true }
    const gift = intval(aff.price_Discount) / 2
    const ref = (await one(sql`SELECT * FROM user WHERE id = ${String(rg.reagent)}`)) || {}
    await addBalance(rg.reagent, gift)
    await addBalance(c.from_id, gift)
    await sendmessage(rg.reagent, A.joinedGift, null, 'html')
    await sendmessage(c.from_id, A.joinGiftActivated, null, 'html')
    await report(c, 'porsantreport', sprintf(T.Admin.reportgroup.membershipGiftPaid, c.from_id, c.username, rg.reagent, user.Balance, n(user.Balance) + gift, ref.Balance, n(ref.Balance) + gift))
    return true
  },
  // agents: extra volume for a panel user found by username
  async (c) => {
    const m = /Extra_volumes_(\w+)_(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const inv = await one(sql`SELECT * FROM invoice WHERE username = ${m[1]}`)
    if (!inv || String(inv.id_user) !== c.from_id) return true
    const p = (await one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${m[2]}`)) || {}
    await run(sql`UPDATE user SET Processing_value = ${m[1]}, Processing_value_one = ${p.name_panel ?? null} WHERE id = ${c.from_id}`)
    await sendmessage(c.from_id, sprintf(T.users.extraVolume.enterextravolume, agentOf(p.priceextravolume, c.user.agent)), backuserKb(c), 'HTML')
    await step(c, 'getvolumeextras')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getvolumeextras') return false
    const T = c.T, backuser = backuserKb(c)
    if (!/^[0-9]+$/.test(c.text)) { await sendmessage(c.from_id, T.common.invalidVolume, backuser, 'HTML'); return true }
    if (Number(c.text) < 1) { await sendmessage(c.from_id, T.users.extraVolume.invalidprice, backuser, 'HTML'); return true }
    const p = (await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${c.user.Processing_value_one ?? null}`)) || {}
    const per = agentOf(p.priceextravolume, c.user.agent)
    const price = n(per) * Number(c.text)
    await sendmessage(c.from_id, sprintf(T.users.extraVolume.extravolumeinvoice, numberFormat(n(per), 0), numberFormat(price, 0), c.text), J({ inline_keyboard: [[{ text: T.users.extraVolume.extracheck, callback_data: 'confirmaextras_' + sprintf('%s', price) }]] }), 'HTML')
    await step(c, 'home')
    return true
  },
  async (c) => {
    const m = /confirmaextras_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    let price = m[1]
    const inv = await one(sql`SELECT * FROM invoice WHERE username = ${user.Processing_value ?? null}`)
    if (!inv || String(inv.id_user) !== c.from_id) return true
    if (n(user.Balance) < n(price) && user.agent !== 'n2') {
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') {
        const pay = async (k) => agentOf((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay, user.agent)
        await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.Balance.insufficientbalance, numberFormat(n(await pay('minbalance'))), numberFormat(n(await pay('maxbalance')))), J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'account' }]] }), 'HTML')
        await step(c, 'getprice')
        return true
      }
      if (intval(user.pricediscount) !== 0) { price = n(price) - (n(price) * n(user.pricediscount)) / 100; await sendmessage(c.from_id, sprintf(T.users.Discount.discountapplied, user.pricediscount), null, 'HTML') }
      await run(sql`UPDATE user SET Processing_value = ${sprintf('%s', n(price) - n(user.Balance))} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.users.sell.noCredit, await stepPaymentKb(c), 'HTML')
      await step(c, 'get_step_payment')
      return true
    }
    const p = await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${user.Processing_value_one ?? null}`)
    if (!p) { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    const per = agentOf(p.priceextravolume, user.agent)
    await deletemessage(c.from_id, c.message_id)
    if (intval(user.pricediscount) !== 0) { price = n(price) - (n(price) * n(user.pricediscount)) / 100; await sendmessage(c.from_id, sprintf(T.users.Discount.discountapplied, user.pricediscount), null, 'HTML') }
    if (!(await deductBalance(user, price))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    const d = await dataUser(user.Processing_value_one, user.Processing_value, c.domain)
    const gb = intval(price) / intval(per)
    const limit = n(d.data_limit) + gb * 1024 ** 3
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price) VALUES (${c.from_id}, ${user.Processing_value}, ${sprintf('%s', limit)}, 'extra_not_user', ${tehranDate()}, ${sprintf('%s', price)})`)
    const ex = await extraVolume(user.Processing_value, p.code_panel, gb)
    if (ex.status === false) {
      await addBalance(c.from_id, price)
      await sendmessage(c.from_id, T.users.extraVolume.serviceError, null, 'HTML')
      await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorExtraVolume2, user.Processing_value_one, user.Processing_value, phpJson(ex.msg)))
      return true
    }
    await sendmessage(c.from_id, T.users.extend.thanks, J({ inline_keyboard: [[{ text: T.users.backbtn, callback_data: 'backuser' }]] }), 'HTML')
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.volumePurchase, c.from_id, numberFormat(n(price) / n(per), 0), price, user.Balance, user.Processing_value))
    return true
  },
  async (c) => {
    if (c.datain !== 'searchservice') return false
    await sendmessage(c.from_id, c.T.users.search.usernamgeget, backuserKb(c), 'HTML')
    await step(c, 'getuseragnetservice')
    return true
  },
  // a message to the admins (answer to an admin message)
  async (c) => {
    if (c.datain !== 'Responseuser') return false
    await step(c, 'getmessageAsuser')
    await sendmessage(c.from_id, c.T.Admin.manageUser.getTextResponse, backuserKb(c), 'HTML')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getmessageAsuser') return false
    const T = c.T
    await sendmessage(c.from_id, T.users.support.sendmessageadmin, c.keyboard, 'HTML')
    const kb = J({ inline_keyboard: [[{ text: T.users.support.answermessage, callback_data: 'Response_' + c.from_id }]] })
    for (const id of c.admin_ids) {
      const a = await one(sql`SELECT rule FROM admin WHERE id_admin = ${id}`)
      if (a && a.rule === 'Seller') continue
      if (truthy(c.text)) await sendmessage(id, sprintf(T.Admin.messageBulk.userMessage, c.from_id, c.username, c.caption + c.text), kb, 'HTML')
      if (c.photo) await telegram('sendphoto', { chat_id: id, photo: c.photoid, reply_markup: kb, caption: sprintf(T.Admin.messageBulk.userResponse, c.from_id, c.username, c.caption), parse_mode: 'HTML' })
    }
    await step(c, 'home')
    return true
  },
  // agent panel
  async (c) => {
    const T = c.T
    if (!((c.text === T.textbot.agentPanel || c.datain === 'agentpanel') && c.user.agent !== 'f')) return false
    if (c.setting.inlinebtnmain === 'oninline') await Editmessagetext(c.from_id, c.message_id, T.users.agent.welcome, await keyboardAgent(c), 'HTML')
    else await sendmessage(c.from_id, T.users.agent.welcome, await keyboardAgent(c), 'HTML')
    return true
  },
  async (c) => {
    if (!(c.text === c.T.users.agent.customnameusername || c.datain === 'selectname')) return false
    await sendmessage(c.from_id, c.T.users.selectusername, backuserKb(c), 'html')
    await step(c, 'selectusernamecustom')
    return true
  },
  async (c) => {
    if (c.user.step !== 'selectusernamecustom') return false
    const T = c.T
    if (!/^(?!_)[a-z][a-z\d_]{2,32}(?<!_)$/i.test(c.text)) { await sendmessage(c.from_id, T.users.invalidusername, backuserKb(c), 'HTML'); return true }
    await sendmessage(c.from_id, T.users.agent.usernameSaved, await keyboardAgent(c), 'html')
    await run(sql`UPDATE user SET namecustom = ${c.text} WHERE id = ${c.from_id}`)
    await step(c, 'home')
    return true
  },
  // request to become an agent
  async (c) => {
    const T = c.T, user = c.user, A = T.users.agent
    if (!(c.text === T.textbot.requestAgent || c.datain === 'requestagent')) return false
    if (!checkActiveBtn(c.setting.keyboardmain, 'text_requestagent')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    if (n(user.Balance) < n(c.setting.agentreqprice)) { await sendmessage(c.from_id, sprintf(A.insufficientbalanceagent, numberFormat(n(c.setting.agentreqprice))), backuserKb(c), 'HTML'); return true }
    if (Number((await one(sql`SELECT COUNT(*) AS n FROM Requestagent WHERE id = ${c.from_id}`)).n) !== 0) { await sendmessage(c.from_id, A.requestreport, null, 'html'); return true }
    if (user.agent !== 'f') { await sendmessage(c.from_id, A.isagent, null, 'html'); return true }
    if (c.datain === 'requestagent') await Editmessagetext(c.from_id, c.message_id, T.textbot.agentRequestDesc, backuserKb(c))
    else await sendmessage(c.from_id, T.textbot.agentRequestDesc, backuserKb(c), 'html')
    await step(c, 'getagentrequest')
    return true
  },
  async (c) => {
    if (!(c.user.step === 'getagentrequest' && truthy(c.text))) return false
    const T = c.T, A = T.users.agent
    if (!(await deductBalance(c.user, intval(c.setting.agentreqprice)))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, c.keyboard, 'HTML'); await step(c, 'home'); return true }
    await sendmessage(c.from_id, A.endrequest, c.keyboard, 'html')
    await step(c, 'home')
    await run(sql`INSERT INTO Requestagent (id, username, time, Description, status, type) VALUES (${c.from_id}, ${c.username}, ${time()}, ${c.text}, 'waiting', 'None')`)
    const kb = J({ inline_keyboard: [
      [{ text: A.acceptrequest, callback_data: 'addagentrequest_' + c.from_id }, { text: A.rejectrequest, callback_data: 'rejectrequesta_' + c.from_id }],
      [{ text: T.users.SendMessage, callback_data: 'Response_' + c.from_id }],
    ] })
    const text = sprintf(A.agentRequest, c.from_id, c.username, c.first_name, c.text)
    for (const id of c.admin_ids) await sendmessage(id, text, kb, 'HTML')
    return true
  },
  async (c) => {
    if (c.text !== '/privacy') return false
    await sendmessage(c.from_id, c.T.textbot.rules, null, 'HTML')
    return true
  },
  // lucky wheel (a dice)
  async (c) => {
    const T = c.T, user = c.user, S = c.setting, W = T.users.wheelLuck
    if (!(c.text === T.textbot.wheelLuck || c.datain === 'wheel_luck' || c.text === '/gift')) return false
    if (!checkActiveBtn(S.keyboardmain, 'text_wheel_luck')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    if (String(S.wheelagent) === '0' && user.agent !== 'f') { await sendmessage(c.from_id, T.users.buttonDisabledForYou, null, 'HTML'); return true }
    const bought = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE name_product != ${T.common.labels.testServiceName} AND id_user = ${c.from_id} AND status != 'Unpaid'`)).n)
    if (intval(S.statusfirstwheel) === 1 && bought !== 0) { await sendmessage(c.from_id, T.users.sell.noPurchaseUsersOnly, null, 'HTML'); return true }
    const recent = async () => {
      const last = await one(sql`SELECT * FROM wheel_list WHERE id_user = ${c.from_id} ORDER BY time DESC LIMIT 1`)
      const t = last ? reportTs(last) : 0
      return last && t > 0 && time() - t <= 86400
    }
    if (await recent()) { await sendmessage(c.from_id, W.alreadyParticipated, null, 'HTML'); return true }
    const dice = intval(S.Dice) === 1
    const r = await telegram('sendDice', { chat_id: c.from_id, emoji: dice ? '🎲' : '🎰' })
    await new Promise((res) => setTimeout(res, dice ? 4000 : 2000))
    const value = r && r.ok && r.result?.dice?.value !== undefined ? intval(r.result.dice.value) : null
    if (value === null) { await sendmessage(c.from_id, W.error || W.resultError, null, 'HTML'); return true }
    if (await recent()) { await sendmessage(c.from_id, W.alreadyParticipated, null, 'HTML'); return true }
    const won = dice ? value === 6 : [1, 43, 64, 22].includes(value)
    const prize = S['wheelـluck_price']
    let paid = 0
    if (won) {
      await addBalance(c.from_id, intval(prize))
      await sendmessage(c.from_id, sprintf(W.winnerCongratulations, numberFormat(n(prize))), null, 'HTML')
      paid = prize
      await report(c, 'otherreport', sprintf(W.wheelWinner, c.username, c.from_id))
    } else await sendmessage(c.from_id, W.notWinner, null, 'HTML')
    await run(sql`INSERT OR IGNORE INTO wheel_list (id_user, first_name, wheel_code, time, price) VALUES (${c.from_id}, ${c.first_name}, ${value}, ${tehranDate()}, ${paid})`)
    return true
  },
  async (c) => {
    if (c.text !== '/tron' && c.text !== '/usd') return false
    const P = c.T.users.priceArze
    const rates = await rateArze()
    if (!rates) { await sendmessage(c.from_id, P.fetchError, null, 'HTML'); return true }
    if (c.text === '/tron') await sendmessage(c.from_id, sprintf(P.tronPrice, rates.TRX), null, 'HTML')
    else await sendmessage(c.from_id, sprintf(P.tetherPrice, rates.USD), null, 'HTML')
    return true
  },
  // «renew»: the list of services
  async (c) => {
    const T = c.T
    if (!(c.text === T.textbot.extend || c.datain === 'extendbtn')) return false
    const count = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${c.from_id} AND ${sql.raw(LIVE)}`)).n)
    if (count === 0) { await sendmessage(c.from_id, T.users.extend.emptyServiceforExtend, null, 'html'); return true }
    await run(sql`UPDATE user SET pagenumber = '1' WHERE id = ${c.from_id}`)
    const kb = await renewList(c, 1)
    kb.inline_keyboard.push([{ text: T.users.page.next, callback_data: 'next_page_extends' }], [{ text: T.users.backbtn, callback_data: 'backuser' }])
    await sendmessage(c.from_id, T.users.extend.selectOrderDirect, J(kb), 'html')
    return true
  },
  async (c) => {
    if (c.datain !== 'next_page_extends' && c.datain !== 'previous_page_extends') return false
    const T = c.T, user = c.user
    const total = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${c.from_id}`)).n)
    const page = intval(user.pagenumber)
    let to
    if (n(user.pagenumber) * 20 > total) to = 1
    else to = c.datain === 'next_page_extends' ? page + 1 : page - 1
    if (to < 1) to = 1
    const kb = await renewList(c, to)
    kb.inline_keyboard.push([{ text: T.users.page.next, callback_data: 'next_page_extends' }, { text: T.users.page.previous, callback_data: 'previous_page_extends' }], [{ text: T.users.backbtn, callback_data: 'backuser' }])
    await run(sql`UPDATE user SET pagenumber = ${to} WHERE id = ${c.from_id}`)
    await Editmessagetext(c.from_id, c.message_id, T.users.extend.selectOrderDirect, J(kb))
    return true
  },
  async (c) => {
    if (c.datain !== 'linkappdownlod') return false
    const apps = await all(sql`SELECT * FROM app`)
    const kb = J({ inline_keyboard: [...apps.map((a) => [{ text: a.name, url: a.link }]), [{ text: c.T.users.backbtn, callback_data: 'backuser' }]] })
    await sendmessage(c.from_id, apps.length === 0 ? c.T.users.app.appempty : c.T.users.app.selectapp, kb, 'html')
    return true
  },
  // a service's note
  async (c) => {
    const m = /changenote_(\w+)/.exec(c.datain)
    if (!m) return false
    const inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]}`)
    if (!inv || String(inv.id_user) !== c.from_id) return true
    await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
    await Editmessagetext(c.from_id, c.message_id, c.T.users.note.sendNote, J({ inline_keyboard: [[{ text: c.T.users.status.backinfo, callback_data: 'product_' + m[1] }]] }))
    await step(c, 'getnotedit')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getnotedit') return false
    const T = c.T, id = c.user.Processing_value
    const inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${id ?? null}`)
    if (!inv || String(inv.id_user) !== c.from_id) return true
    if (new TextEncoder().encode(c.text).length > 150) { await sendmessage(c.from_id, T.users.note.errorLongNote, c.keyboard, 'html'); return true }
    const note = sanitizeName(c.text)
    await run(sql`UPDATE invoice SET note = ${note} WHERE id_invoice = ${id}`)
    await sendmessage(c.from_id, T.users.note.changednote, J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'product_' + id }]] }), 'html')
    await step(c, 'home')
    await report(c, 'otherreport', sprintf(T.Admin.reportgroup.noteChanged, inv.username, inv.note, note, jdate('Y/m/d H:i:s')))
    return true
  },
]
