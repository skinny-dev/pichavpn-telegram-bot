// Renewal (تمدید) — index.php lines 1409–1917: plan list (categories / durations / products), custom renewal,
// discount code, confirm: pay from the wallet (or go to payment), extend on the panel, cashback, reports.
import { one, all, run, sql } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { step, shop, tehranDate } from '../bot.js'
import { backuserKb } from '../keyboards.js'
import { dataUser, extend as panelExtend } from '../panel.js'
import {
  savedata, userData, keyboardProduct, keyboardCategory, rowsBeforeBack, keyboardTimeCategory, customPlanPrice, customPricePrompt,
  promoInvoiceParts, promoQuote, promoApplyQuote, deductBalance, addBalance, stepPaymentKb, agentValue,
} from '../catalog.js'
import { jdate, phpRound } from '../fmt.js'
import { sprintf, strtr, numberFormat, intval, time, randomHex, J, eq, phpJson } from '../php.js'

const own = (inv, c) => !!inv && String(inv.id_user) === c.from_id
const ctypeDigit = (s) => typeof s === 'string' && /^[0-9]+$/.test(s)
/** PHP: (string) of a number (floats with 14 digits) */
const pstr = (v) => sprintf('%s', v)
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
const isCustom = (c, name) => eq(name, c.T.users.customSellVolume.btnVolume) || eq(name, c.T.users.customSellVolume.btnService)
const invoiceBy = (id) => one(sql`SELECT * FROM invoice WHERE id_invoice = ${id ?? null}`)
const panelBy = (name) => one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${name ?? null}`)
const report = (c, thread, text, extra = {}) =>
  String(c.setting.Channel_Report ?? '').length > 0
    ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML', ...extra })
    : null
const productsFor = (loc, agent, extra = {}) => {
  if (extra.category !== undefined) return all(sql`SELECT * FROM product WHERE (Location = ${loc} OR Location = '/all') AND agent = ${agent} AND one_buy_status = '0' AND category = ${extra.category}`)
  if (extra.time !== undefined) return all(sql`SELECT * FROM product WHERE (Location = ${loc} OR Location = '/all') AND agent = ${agent} AND Service_time = ${extra.time} AND one_buy_status = '0'`)
  return all(sql`SELECT * FROM product WHERE (Location = ${loc} OR Location = '/all') AND agent = ${agent} AND one_buy_status = '0'`)
}
const extendLabels = (T) => Object.fromEntries(['resetVolumeTime', 'addTimeVolumeNextMonth', 'resetTimeAddVolume', 'resetVolumeAddTime', 'addTimeConvertVolume']
  .map((k) => [String(T.keyboard[k] ?? '').trim(), k]).filter(([l]) => l !== ''))

export const extendRoutes = [
  // extend_<id_invoice>: what to renew with
  async (c) => {
    const m = /extend_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user, id = m[1]
    const inv = await invoiceBy(id)
    if (!inv || !own(inv, c)) { await sendmessage(c.from_id, T.users.extend.error, null, 'HTML'); return true }
    const panel = (await panelBy(inv.Service_location)) || {}
    if (panel.status_extend === 'off_extend') { await sendmessage(c.from_id, T.users.extend.notSupportedPanel, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    if (d.status === 'on_hold') { await sendmessage(c.from_id, T.users.extend.connectFirst, null, 'html'); return true }
    const custompricevalue = agentOf(panel.pricecustomvolume, user.agent)
    const mainvolume = agentOf(panel.mainvolume, user.agent)
    const maxvolume = agentOf(panel.maxvolume, user.agent)
    const count = (await productsFor(panel.name_panel ?? null, user.agent)).length
    await savedata(c, 'clear', 'id_invoice', inv.id_invoice)
    const backuser = backuserKb(c)
    if (count === 0 || isCustom(c, inv.name_product)) {
      const fmt = count === 0 ? T.users.sell.customVolumePrompt : T.users.sell.customVolumePrompt2
      await sendmessage(c.from_id, await customPricePrompt(c, fmt, panel, user.agent, 'volume', custompricevalue, mainvolume, maxvolume), backuser, 'html')
      await deletemessage(c.from_id, c.message_id)
      await step(c, 'gettimecustomvolomforextend')
      return true
    }
    if (c.setting.statuscategory === 'offcategory') {
      const renewRows = [[{ text: T.keyboard.renewCurrentPlan, callback_data: 'exntedagei' }]]
      if (c.setting.statuscategorygenral === 'oncategorys') {
        const kb = rowsBeforeBack(await keyboardCategory(c, inv.Service_location, user.agent, 'product_' + inv.id_invoice, 'extcat_', true), renewRows)
        await Editmessagetext(c.from_id, c.message_id, T.users.sell.selectCategory, kb)
      } else {
        const rows = await productsFor(inv.Service_location, user.agent)
        const kb = rowsBeforeBack(await keyboardProduct(c, inv.Service_location, rows, user.pricediscount, 'serviceextendselect_', false, 'product_' + inv.id_invoice, null, 'customsellvolume'), renewRows)
        await Editmessagetext(c.from_id, c.message_id, T.users.extend.selectservice, kb)
      }
    } else {
      const kb = await keyboardTimeCategory(c, inv.Service_location, user.agent, 'productextendmonths_', `product_${id}`, false, true)
      await Editmessagetext(c.from_id, c.message_id, T.users.sell.selectDuration, kb)
    }
    return true
  },
  // extcat_<category id>: the products of a category
  async (c) => {
    const m = /^extcat_(\d+)$/.exec(c.datain)
    if (!m) return false
    const T = c.T, ud = userData(c)
    const inv = ud.id_invoice ? await invoiceBy(ud.id_invoice) : null
    const cat = await one(sql`SELECT remark FROM category WHERE id = ${m[1]}`)
    if (!inv || !own(inv, c) || !cat) { await sendmessage(c.from_id, T.users.extend.error, null, 'HTML'); return true }
    const rows = await productsFor(inv.Service_location, c.user.agent, { category: cat.remark })
    await Editmessagetext(c.from_id, c.message_id, T.users.extend.selectservice, await keyboardProduct(c, inv.Service_location, rows, c.user.pricediscount, 'serviceextendselect_', false, 'extend_' + inv.id_invoice, null, 'customsellvolume'))
    return true
  },
  // custom renewal: the volume
  async (c) => {
    if (c.user.step !== 'gettimecustomvolomforextend') return false
    const T = c.T, user = c.user, ud = userData(c), backuser = backuserKb(c)
    const inv = (await invoiceBy(ud.id_invoice)) || {}
    const panel = (await panelBy(inv.Service_location)) || {}
    const mainvolume = agentOf(panel.mainvolume, user.agent), maxvolume = agentOf(panel.maxvolume, user.agent)
    const maintime = agentOf(panel.maintime, user.agent), maxtime = agentOf(panel.maxtime, user.agent)
    if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.common.invalidVolume, backuser, 'HTML'); return true }
    if (Number(c.text) > intval(maxvolume) || Number(c.text) < intval(mainvolume)) {
      await sendmessage(c.from_id, strtr(T.users.customSellVolume.invalidVolume, { '{mainvolume}': mainvolume ?? '', '{maxvolume}': maxvolume ?? '' }), backuser, 'HTML')
      return true
    }
    await savedata(c, 'save', 'volume', c.text)
    await sendmessage(c.from_id, await customPricePrompt(c, T.users.sell.customTimePrompt, panel, user.agent, 'time', agentOf(panel.pricecustomtime, user.agent), maintime, maxtime), backuser, 'html')
    await step(c, 'getvolumecustomuserforextend')
    return true
  },
  // productextendmonths_<days>: the products of a duration
  async (c) => {
    const m = /productextendmonths_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, ud = userData(c)
    const inv = (await invoiceBy(ud.id_invoice)) || {}
    const rows = isCustom(c, inv.name_product) ? [[{ text: T.keyboard.selectCurrentService, callback_data: 'serviceextendselect_pre' }]] : []
    const list = await productsFor(inv.Service_location ?? null, c.user.agent, { time: m[1] })
    const kb = rowsBeforeBack(await keyboardProduct(c, inv.Service_location, list, c.user.pricediscount, 'serviceextendselect_', false, 'product_' + (inv.id_invoice ?? ''), null, 'customsellvolume'), rows)
    await Editmessagetext(c.from_id, c.message_id, T.users.extend.selectservice, kb)
    return true
  },
  // the renewal invoice: a product, the custom days, or the current plan again
  async (c) => {
    const m = /^serviceextendselect_(.*)/.exec(c.datain)
    const byStep = c.user.step === 'getvolumecustomuserforextend'
    if (!m && !byStep && c.datain !== 'exntedagei') return false
    const T = c.T, user = c.user, ud = userData(c), backuser = backuserKb(c)
    const inv = (await invoiceBy(ud.id_invoice)) || {}
    let panel = (await panelBy(inv.Service_location)) || {}
    let code
    if (byStep) {
      if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.common.invalidTime, backuser, 'HTML'); return true }
      const maintime = agentOf(panel.maintime, user.agent), maxtime = agentOf(panel.maxtime, user.agent)
      if (intval(c.text) > intval(maxtime) || intval(c.text) < intval(maintime)) {
        await sendmessage(c.from_id, strtr(T.users.customSellVolume.invalidTimeRange, { '{maintime}': maintime ?? '', '{maxtime}': maxtime ?? '' }), backuser, 'HTML')
        return true
      }
    } else if (c.datain === 'exntedagei') {
      const so = await one(sql`SELECT value FROM service_other WHERE username = ${inv.username ?? null} AND type = 'extend_user' AND status = 'paid' ORDER BY time DESC, id DESC`)
      let prod
      if (!so) prod = await one(sql`SELECT * FROM product WHERE name_product = ${inv.name_product ?? null}`)
      else {
        let v = null
        try { v = JSON.parse(so.value) } catch { v = null }
        if (typeof so.value !== 'string' || !v || typeof v !== 'object') { await sendmessage(c.from_id, T.users.extend.planNotAvailable, c.keyboard, 'HTML'); return true }
        prod = await one(sql`SELECT code_product FROM product WHERE code_product = ${v.code_product ?? null}`)
      }
      if (!prod) { await sendmessage(c.from_id, T.users.extend.planNotAvailable, c.keyboard, 'HTML'); return true }
      code = prod.code_product
      panel = (await panelBy(inv.Service_location)) || {}
    } else code = m[1]
    let product
    if (byStep) {
      product = { name_product: inv.name_product ?? null, code_product: 'customvolume', note: '', price_product: await customPlanPrice(c, panel, user.agent, intval(ud.volume), c.text), Service_time: c.text, Volume_constraint: ud.volume ?? null }
      await step(c, 'home')
    } else {
      product = await one(sql`SELECT * FROM product WHERE (Location = ${inv.Service_location ?? null} OR Location = '/all') AND agent = ${user.agent} AND code_product = ${code}`)
    }
    if (!product) { await sendmessage(c.from_id, T.users.extend.restartError, c.keyboard, 'HTML'); return true }
    await savedata(c, 'save', 'time', product.Service_time)
    await savedata(c, 'save', 'data_limit', product.Volume_constraint)
    await savedata(c, 'save', 'price_product', product.price_product)
    await savedata(c, 'save', 'code_product', product.code_product)
    const kb = J({ inline_keyboard: [
      [{ text: T.users.extend.confirm, callback_data: 'confirmserivce' }, { text: T.users.extend.discount, callback_data: 'discountextend' }],
      [{ text: T.users.backbtn, callback_data: 'backuser' }],
    ] })
    let raw
    if (intval(user.pricediscount) !== 0) raw = phpRound(Number(product.price_product) - (Number(product.price_product) * Number(user.pricediscount)) / 100, 0)
    else raw = product.price_product
    let priceText = numberFormat(Number(raw))
    let name = product.name_product
    const pp = await promoInvoiceParts(product, raw)
    if (pp) { priceText = pp.price; name = pp.name }
    const q = await promoQuote(product)
    if (q) await savedata(c, 'save', 'promo_quote', q)
    const text = sprintf(T.users.extend.invoiceCreated, inv.username, name, priceText, product.Service_time, product.Volume_constraint, product.note, numberFormat(Number(user.Balance)))
    if (byStep) await sendmessage(c.from_id, text, kb, 'HTML')
    else await Editmessagetext(c.from_id, c.message_id, text, kb)
    return true
  },
  async (c) => {
    if (c.datain !== 'discountextend') return false
    await sendmessage(c.from_id, c.T.users.Discount.getcodesell, backuserKb(c), 'HTML')
    await step(c, 'getcodesellDiscountextend')
    await deletemessage(c.from_id, c.message_id)
    return true
  },
  // the discount code for a renewal
  async (c) => {
    if (c.user.step !== 'getcodesellDiscountextend') return false
    const T = c.T, user = c.user, ud = userData(c)
    const inv = (await invoiceBy(ud.id_invoice)) || {}
    const panel = (await panelBy(inv.Service_location)) || {}
    // MySQL compares the code without case (utf8mb4_general_ci)
    if (!(await one(sql`SELECT 1 AS x FROM DiscountSell WHERE codeDiscount = ${c.text} COLLATE NOCASE LIMIT 1`))) { await sendmessage(c.from_id, T.users.Discount.notcode, backuserKb(c), 'HTML'); return true }
    const d = await one(sql`SELECT * FROM DiscountSell WHERE (code_product = ${ud.code_product ?? null} OR code_product = 'all') AND (code_panel = ${panel.code_panel ?? null} OR code_panel = '/all')
      AND codeDiscount = ${c.text} COLLATE NOCASE AND (agent = ${user.agent} OR agent = 'allusers') AND (type = 'all' OR type = 'extend')`)
    const used = Number((await one(sql`SELECT COUNT(*) AS n FROM Giftcodeconsumed WHERE id_user = ${c.from_id} AND code = ${c.text} COLLATE NOCASE`)).n)
    if (d && intval(d.time) !== 0 && time() >= intval(d.time)) { await sendmessage(c.from_id, T.users.Discount.expired, null, 'HTML'); return true }
    if (!d) { await sendmessage(c.from_id, T.users.Discount.invalidCode, null, 'HTML'); return true }
    if (Number(d.limitDiscount) <= Number(d.usedDiscount)) { await sendmessage(c.from_id, T.users.Discount.errorLimit, null, 'HTML'); return true }
    if (used >= Number(d.useuser)) {
      await sendmessage(c.from_id, strtr(T.users.Discount.useLimit, { '{useuser}': d.useuser }), c.keyboard, 'HTML')
      await step(c, 'home')
      return true
    }
    if (String(d.usefirst) === '1') {
      const n = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${c.from_id}`)).n)
      if (n !== 0) { await sendmessage(c.from_id, T.users.Discount.firstdiscount, null, 'HTML'); return true }
    }
    await sendmessage(c.from_id, strtr(T.users.Discount.applied, { '{discount_price}': d.price }), c.keyboard, 'HTML')
    let info
    if (isCustom(c, inv.name_product)) {
      info = { code_product: 'pre', name_product: inv.name_product, price_product: await customPlanPrice(c, panel, user.agent, ud.data_limit, ud.time), Service_time: ud.time, Volume_constraint: ud.data_limit }
    } else {
      info = { ...((await one(sql`SELECT * FROM product WHERE code_product = ${ud.code_product ?? null} AND (Location = ${panel.name_panel ?? null} OR Location = '/all') LIMIT 1`)) || {}) }
    }
    const pr = Number(info.price_product ?? 0)
    info.price_product = phpRound(pr - (Number(d.price) / 100) * pr)
    if (intval(info.Service_time) === 0) info.Service_time = T.users.status.unlimited
    if (info.price_product < 0) info.price_product = 0
    const text = sprintf(T.users.extend.invoiceCreated2, inv.username, info.name_product, info.price_product, info.Service_time, info.Volume_constraint, info.note, user.Balance)
    await sendmessage(c.from_id, text, J({ inline_keyboard: [[{ text: T.users.extend.confirm, callback_data: 'confirmserdiscount' }]] }), 'HTML')
    await run(sql`UPDATE user SET Processing_value_four = ${'dis_' + c.text + '_' + pstr(info.price_product)} WHERE id = ${c.from_id}`)
    await step(c, 'home')
    return true
  },
  // confirm: pay and renew
  async (c) => {
    if (c.datain !== 'confirmserivce' && c.datain !== 'confirmserdiscount') return false
    const T = c.T, user = c.user
    await Editmessagetext(c.from_id, c.message_id, c.text_inline, J({ inline_keyboard: [] }))
    const parts = String(user.Processing_value_four ?? '').split('_')
    const ud = userData(c)
    const idInvoice = ud.id_invoice
    const inv = await invoiceBy(idInvoice)
    if (!inv) { await sendmessage(c.from_id, T.users.extend.error, null, 'HTML'); return true }
    const panel = (await panelBy(inv.Service_location)) || {}
    if (panel.status_extend === 'off_extend') { await sendmessage(c.from_id, T.users.extend.notSupportedPanel, null, 'html'); return true }
    const orderId = randomHex(2)
    let prod
    if (isCustom(c, inv.name_product)) {
      prod = { code_product: 'custom_volume', name_product: inv.name_product, price_product: await customPlanPrice(c, panel, user.agent, ud.data_limit, ud.time), Service_time: ud.time, Volume_constraint: ud.data_limit, inbounds: panel.inboundid }
    } else {
      prod = await one(sql`SELECT * FROM product WHERE (Location = ${inv.Service_location} OR Location = '/all') AND agent = ${user.agent} AND code_product = ${ud.code_product ?? null}`)
      if (prod) prod = promoApplyQuote(prod, ud.promo_quote ?? null)
    }
    let price = prod ? prod.price_product : null
    if (!prod || !['active', 'end_of_time', 'end_of_volume', 'sendedwarn', 'send_on_hold'].includes(inv.Status)) { await sendmessage(c.from_id, T.users.extend.error, null, 'HTML'); return true }
    if (c.datain === 'confirmserdiscount' && (await one(sql`SELECT * FROM DiscountSell WHERE codeDiscount = ${parts[1] ?? null} COLLATE NOCASE`))) price = parts[2]
    if (intval(user.pricediscount) !== 0) {
      price = Number(price) - (Number(price) * Number(user.pricediscount)) / 100
      await sendmessage(c.from_id, sprintf(T.users.Discount.discountapplied, user.pricediscount), null, 'HTML')
    }
    const du = await dataUser(inv.Service_location, inv.username, c.domain)
    if (Number(user.Balance) < Number(price) && user.agent !== 'n2' && intval(price) !== 0) {
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') {
        const pay = async (n) => { const r = await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${n}`); return agentOf(r?.ValuePay, user.agent) }
        const minb = numberFormat(await pay('minbalance')), maxb = numberFormat(await pay('maxbalance'))
        await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.Balance.insufficientbalance, minb, maxb), J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'account' }]] }), 'HTML')
        await step(c, 'getprice')
        return true
      }
      const rest = Number(price) - Number(user.Balance)
      await run(sql`UPDATE user SET Processing_value = ${pstr(rest)} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.users.sell.noCredit, await stepPaymentKb(c), 'HTML')
      await step(c, 'get_step_payment')
      const value = JSON.stringify({ volumebuy: prod.Volume_constraint, Service_time: prod.Service_time, oldvolume: du.data_limit ?? null, oldtime: du.expire ?? null, code_product: prod.code_product, id_order: orderId })
      await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output, status) VALUES (${c.from_id}, ${inv.username}, ${value}, 'extend_user', ${tehranDate()}, ${prod.price_product}, '', 'unpaid')`)
      await run(sql`UPDATE user SET Processing_value_one = ${`${inv.username}%${orderId}`}, Processing_value_tow = 'getextenduser' WHERE id = ${c.from_id}`)
      return true
    }
    const cbv = user.agent === 'f' ? await shop('chashbackextend') : agentOf(await shop('chashbackextend_agent'), user.agent)
    let cashback = 0
    if (intval(cbv) !== 0 && intval(price) !== 0) {
      cashback = (Number(price) * Number(cbv)) / 100
      price = Math.max(Number(price) - cashback, 0)
    }
    if (!(await deductBalance(user, price))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    if (c.datain === 'confirmserdiscount') {
      const d = await one(sql`SELECT * FROM DiscountSell WHERE codeDiscount = ${parts[1] ?? null} COLLATE NOCASE`)
      if (d) {
        await run(sql`UPDATE DiscountSell SET usedDiscount = ${intval(d.usedDiscount) + 1} WHERE codeDiscount = ${parts[1]} COLLATE NOCASE`)
        await run(sql`INSERT INTO Giftcodeconsumed (id_user, code) VALUES (${c.from_id}, ${parts[1]})`)
        await report(c, 'otherreport', strtr(T.Admin.reportgroup.discountUsedRenew, { '{username}': c.username, '{from_id}': c.from_id, '{discount_code}': parts[1] }))
      }
    }
    if (eq(inv.name_product, T.common.labels.testService2)) {
      await run(sql`UPDATE invoice SET name_product = ${prod.name_product}, price_product = ${prod.price_product} WHERE id_invoice = ${inv.id_invoice}`)
    }
    const ex = await panelExtend(panel.Methodextend, prod.Volume_constraint, prod.Service_time, inv.username, prod.code_product, panel.code_panel, extendLabels(T))
    if (ex.status === false) {
      await addBalance(c.from_id, price)
      await sendmessage(c.from_id, T.users.extend.errorSupport, null, 'HTML')
      await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorRenewService, panel.name_panel, inv.username, phpJson(ex.msg)))
      return true
    }
    if (cashback) await sendmessage(c.from_id, sprintf(T.users.extend.giftCharged, cashback), null, 'HTML')
    const value = JSON.stringify({ volumebuy: prod.Volume_constraint, Service_time: prod.Service_time, oldvolume: du.data_limit ?? null, oldtime: du.expire ?? null, code_product: prod.code_product, id_order: orderId })
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output, status) VALUES (${c.from_id}, ${inv.username}, ${value}, 'extend_user', ${tehranDate()}, ${prod.price_product}, ${JSON.stringify(ex)}, 'paid')`)
    await run(sql`UPDATE invoice SET Status = 'active' WHERE id_invoice = ${idInvoice}`)
    if (intval(c.setting.scorestatus) === 1 && !c.isAdmin) {
      await sendmessage(c.from_id, T.users.affiliates.pointsEarned2Alt, null, 'html')
      await run(sql`UPDATE user SET score = ${Number(user.score || 0) + 2} WHERE id = ${c.from_id}`)
    }
    const done = J({ inline_keyboard: [[{ text: T.users.status.backlist, callback_data: 'backorder' }], [{ text: T.users.status.backservice, callback_data: 'product_' + inv.id_invoice }]] })
    const after = numberFormat(Number((await one(sql`SELECT Balance FROM user WHERE id = ${c.from_id}`))?.Balance ?? 0), 0)
    const before = numberFormat(Number(user.Balance), 0)
    await sendmessage(c.from_id, sprintf(T.users.extend.success, inv.username, prod.name_product, numberFormat(price)), done, 'HTML')
    const kb = J({ inline_keyboard: [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + c.from_id }]] })
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.renewed, c.from_id, c.username, inv.username, c.first_name, inv.Service_location, prod.name_product, prod.Volume_constraint, prod.Service_time, prod.price_product, before, after, jdate('Y/m/d H:i:s')), { reply_markup: kb })
    return true
  },
]
