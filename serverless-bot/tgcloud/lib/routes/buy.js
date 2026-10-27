// Wallet page and buying a service with the wallet — index.php lines 3352–4315: location, categories, durations,
// products, custom service, username, pre-invoice, discount code, pay + create on the panel, referral commission, reports.
import { one, all, run, sql, kvGet, kvSet } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { step, shop, tehranDate } from '../bot.js'
import { checkActiveBtn, backuserKb, panelLists } from '../keyboards.js'
import { dataUser, createUserFor } from '../panel.js'
import {
  savedata, userData, keyboardProduct, keyboardCategory, keyboardTimeCategory, customPlanPrice, customPricePrompt,
  promoInvoiceParts, promoQuote, promoApplyQuote, deductBalance, addBalance, stepPaymentKb, soldOutCategoryKeys, categoryOffKey,
} from '../catalog.js'
import { generateUsername, usernameMethodKey, sendMessageService } from '../service.js'
import { jdate, phpRound } from '../fmt.js'
import { sprintf, strtr, numberFormat, intval, time, randomHex, J, eq } from '../php.js'

const LIVE = `(status = 'active' OR status = 'end_of_time' OR status = 'end_of_volume' OR status = 'sendedwarn' OR Status = 'send_on_hold')`
const ctypeDigit = (s) => typeof s === 'string' && /^[0-9]+$/.test(s)
const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v))
const n = (v) => (isNumeric(v) ? Number(v) : 0)
/** PHP 8 `$v == 0` */
const looseZero = (v) => v === null || v === undefined || v === false || v === 0 || (isNumeric(v) && Number(v) === 0)
const pstr = (v) => sprintf('%s', v)
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
/** PHP 8 `$string > $int` / `<`: numeric strings compare as numbers, others as strings */
const cmpInt = (s, i) => (isNumeric(s) ? Math.sign(Number(s) - i) : s > String(i) ? 1 : s < String(i) ? -1 : 0)
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
const panelBy = (name) => one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${name ?? null}`)
const customMethod = (c, p) => ['customUsername', 'customUsernameRandom'].includes(usernameMethodKey(c.T, p?.MethodUsername))
const customOn = (c, p) => eq(agentOf(p?.customvolume, c.user.agent), '1') && p?.type !== 'Manualsale'
const report = (c, thread, text, extra = {}) =>
  String(c.setting.Channel_Report ?? '').length > 0
    ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML', ...extra })
    : null
const productsAll = (loc, agent) => all(sql`SELECT * FROM product WHERE (Location = ${loc ?? null} OR Location = '/all') AND agent = ${agent}`)
const productCount = async () => Number((await one(sql`SELECT COUNT(*) AS n FROM product`)).n)
const liveOnPanel = async (name) => Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE ${sql.raw(LIVE)} AND Service_location = ${name ?? null}`)).n)
const activePanels = (agent) => all(sql`SELECT * FROM marzban_panel WHERE status = 'active' AND (agent = ${agent} OR agent = 'all')`)
const hiddenFor = (p, id) => { if (p.hide_user == null) return false; try { const l = JSON.parse(p.hide_user); return Array.isArray(l) && l.map(String).includes(id) } catch { return false } }
const show = (c, edit, text, kb) => (edit ? Editmessagetext(c.from_id, c.message_id, text, kb) : sendmessage(c.from_id, text, kb, 'HTML'))

/** the phone-number gate: true when the purchase must stop here */
async function needPhone(c) {
  const on = c.setting.get_number === 'onAuthenticationphone'
  if (on && c.user.step !== 'get_number' && c.user.number === 'none') {
    await sendmessage(c.from_id, c.T.users.number.confirming, c.request_contact, 'HTML')
    await step(c, 'get_number')
  }
  return c.user.number === 'none' && on
}
/** product list of a panel (+ optional category / days) as KeyboardProduct shows it */
async function productKb(c, panel, rows, back) {
  return keyboardProduct(c, panel.name_panel ?? null, rows, c.user.pricediscount, customMethod(c, panel) ? 'prodcutservices_' : 'prodcutservice_', customOn(c, panel), back, null, 'customsellvolume')
}
/** orderFailLog(): kept in kv (the last 300 lines) */
async function orderFailLog(kind, userId, service, price, paymentId, reason, panel = '') {
  const line = JSON.stringify({ at: time(), kind, user: String(userId), service, price: intval(price), payment: paymentId, panel, reason: [...(typeof reason === 'string' ? reason : JSON.stringify(reason))].slice(0, 300).join('') })
  const old = (await kvGet('log:order_failures')) || ''
  await kvSet('log:order_failures', (old + line + '\n').split('\n').filter(Boolean).slice(-300).join('\n') + '\n')
}

export const buyRoutes = [
  // the wallet / account page
  async (c) => {
    const T = c.T, user = c.user
    if (!(c.text === T.textbot.accountWallet || c.datain === 'account' || c.text === '/wallet')) return false
    if (user.codeInvitation == null || user.codeInvitation === '') {
      const code = randomHex(6)
      await run(sql`UPDATE user SET codeInvitation = ${code} WHERE id = ${c.from_id}`)
      user.codeInvitation = code
    }
    let phone = user.number === 'none' ? T.common.labels.notSent : user.number
    if (user.number === 'confrim number by admin') phone = T.common.labels.confirmedByAdminAlt
    const orders = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${c.from_id} AND name_product != ${T.common.labels.testServiceName} AND ${sql.raw(LIVE)}`)).n)
    const pays = Number((await one(sql`SELECT COUNT(*) AS n FROM Payment_report WHERE id_user = ${c.from_id} AND payment_Status = 'paid'`)).n)
    const group = { f: T.common.roles.normalAlt, n: T.common.roles.agentAlt, n2: T.common.roles.advancedAgentAlt }[user.agent]
    let score = intval(c.setting.scorestatus) === 1 ? strtr(T.users.affiliates.accountScore, { '{score}': user.score }) : ''
    if (c.setting.verifybucodeuser === 'onverify' && c.setting.verifystart === 'onverify') score = sprintf(T.users.affiliates.referralLink, (await kvGet('config:usernamebot')) || '', user.codeInvitation)
    const text = sprintf(T.users.account.info, c.from_id, escHtml(c.first_name), user.codeInvitation, phone, jdate('Y/m/d H:i:s', intval(user.register)), numberFormat(n(user.Balance), 0), orders, pays, user.affiliatescount, group, score, '', jdate('Y/m/d'), jdate('H:i:s'))
    await show(c, c.datain === 'account', text, c.keyboardPanel)
    await step(c, 'home')
    return true
  },
  // buy with a custom name first («نام دلخواه»)
  async (c) => {
    const T = c.T
    if (!((c.text === T.textbot.sell || c.datain === 'buy' || c.datain === 'buyback' || c.text === '/buy' || c.text === 'buy') && c.statusnote)) return false
    if (await needPhone(c)) return true
    if (!checkActiveBtn(c.setting.keyboardmain, 'text_sell')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    if (c.datain === 'buy') await Editmessagetext(c.from_id, c.message_id, T.users.sell.notestep, backuserKb(c))
    else if (c.datain === 'buyback') { await deletemessage(c.from_id, c.message_id); await sendmessage(c.from_id, T.users.sell.notestep, backuserKb(c), 'HTML') }
    else await sendmessage(c.from_id, T.users.sell.notestep, backuserKb(c), 'HTML')
    await step(c, 'statusnamecustom')
    return true
  },
  // buy: the location (or straight to the plans when there is one location)
  async (c) => {
    const T = c.T, user = c.user, S = c.setting
    if (!(c.text === T.textbot.sell || c.datain === 'buy' || c.datain === 'buybacktow' || c.datain === 'buyback' || c.text === '/buy' || c.text === 'buy' || user.step === 'statusnamecustom')) return false
    if (!checkActiveBtn(S.keyboardmain, 'text_sell')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    const panels = await activePanels(user.agent)
    if (panels.length === 0) { await sendmessage(c.from_id, T.users.sell.nullPanel, null, 'HTML'); return true }
    if (await needPhone(c)) return true
    const backuser = backuserKb(c)
    if (panels.length === 1) {
      const location = panels[0].name_panel
      const panel = (await panelBy(location)) || {}
      if (hiddenFor(panel, c.from_id)) { await sendmessage(c.from_id, T.users.sell.nullPanel, null, 'HTML'); return true }
      if (isNumeric(panel.limit_panel) && (await liveOnPanel(location)) >= intval(panel.limit_panel)) { await sendmessage(c.from_id, T.users.sell.capacityFull, null, 'HTML'); return true }
      if (user.step === 'statusnamecustom') {
        await savedata(c, 'clear', 'nameconfig', c.text)
        await savedata(c, 'save', 'name_panel', location)
        await step(c, 'home')
      } else await savedata(c, 'clear', 'name_panel', location)
      if (S.statuscategory === 'offcategory') {
        if ((await productCount()) === 0) {
          await sendmessage(c.from_id, await customPricePrompt(c, T.users.sell.customVolumePrompt3, panel, user.agent, 'volume', agentOf(panel.pricecustomvolume, user.agent), agentOf(panel.mainvolume, user.agent), agentOf(panel.maxvolume, user.agent)), backuser, 'html')
          await step(c, 'gettimecustomvol')
          return true
        }
        if (S.statuscategorygenral === 'oncategorys') {
          const back = S.statusnamecustom === 'onnamecustom' ? 'buyback' : 'backuser'
          await show(c, c.datain === 'buy', T.users.sell.selectCategory, await keyboardCategory(c, location, user.agent, back))
        } else {
          await show(c, c.datain === 'buy', T.users.sell.serviceSelectFirst, await productKb(c, panel, await productsAll(location, user.agent), 'backuser'))
        }
      } else {
        if ((await productCount()) === 0) { await sendmessage(c.from_id, T.users.sell.nullProduct, null, 'HTML'); return true }
        const kb = await keyboardTimeCategory(c, panel.name_panel, user.agent, 'productmonth_', c.statusnote ? 'buyback' : 'backuser', customOn(c, panel), false)
        await show(c, c.datain === 'buy' || c.datain === 'buybacktow', T.users.sell.selectDuration, kb)
      }
      return true
    }
    if (user.step === 'statusnamecustom') { await savedata(c, 'clear', 'nameconfig', c.text); await step(c, 'home') }
    await show(c, ['buy', 'buybacktow', 'buyback'].includes(c.datain), T.textbot.selectLocation, (await panelLists(c)).list_marzban_panel_user)
    return true
  },
  // location_<code>
  async (c) => {
    const m = /^location_(.*)/.exec(c.datain)
    if (!m && c.datain !== 'backproduct') return false
    const T = c.T, user = c.user, S = c.setting, ud = userData(c)
    const location = c.datain !== 'backproduct' ? (await one(sql`SELECT name_panel FROM marzban_panel WHERE code_panel = ${m[1]}`))?.name_panel ?? null : ud.name_panel ?? null
    const panel = (await panelBy(location)) || {}
    if (isNumeric(panel.limit_panel) && (await liveOnPanel(panel.name_panel)) >= intval(panel.limit_panel)) { await sendmessage(c.from_id, T.users.sell.panelCapacityFull, null, 'HTML'); return true }
    await savedata(c, c.statusnote ? 'save' : 'clear', 'name_panel', location)
    if ((await productCount()) === 0) {
      await sendmessage(c.from_id, await customPricePrompt(c, T.users.sell.customVolumePrompt4, panel, user.agent, 'volume', agentOf(panel.pricecustomvolume, user.agent), agentOf(panel.mainvolume, user.agent), agentOf(panel.maxvolume, user.agent)), backuserKb(c), 'html')
      await step(c, 'gettimecustomvol')
      return true
    }
    if (S.statuscategory === 'offcategory') {
      if (S.statuscategorygenral === 'oncategorys') await Editmessagetext(c.from_id, c.message_id, T.users.sell.selectCategory, await keyboardCategory(c, location, user.agent, 'buybacktow'))
      else {
        const back = ud.nameconfig !== undefined && ud.nameconfig !== null ? 'buybacktow' : 'buyback'
        await Editmessagetext(c.from_id, c.message_id, T.users.sell.serviceSelect, await productKb(c, panel, await productsAll(location, user.agent), back))
      }
    } else {
      const kb = await keyboardTimeCategory(c, panel.name_panel ?? null, user.agent, 'productmonth_', 'buybacktow', customOn(c, panel), false)
      await Editmessagetext(c.from_id, c.message_id, T.users.sell.selectDuration, kb)
    }
    return true
  },
  // categorynames_<id>
  async (c) => {
    const m = /^categorynames_(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user, ud = userData(c)
    const name = (await one(sql`SELECT remark FROM category WHERE id = ${m[1]}`))?.remark ?? null
    if ((await soldOutCategoryKeys()).includes(categoryOffKey(name))) {
      await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id, text: T.users.sell.productSoldOut, show_alert: true })
      return true
    }
    const rows = ud.monthproduct !== undefined && ud.monthproduct !== null
      ? await all(sql`SELECT * FROM product WHERE (Location = ${ud.name_panel ?? null} OR Location = '/all') AND agent = ${user.agent} AND category = ${name} AND Service_time = ${ud.monthproduct}`)
      : await all(sql`SELECT * FROM product WHERE (Location = ${ud.name_panel ?? null} OR Location = '/all') AND agent = ${user.agent} AND category = ${name}`)
    const panel = (await panelBy(ud.name_panel)) || {}
    await Editmessagetext(c.from_id, c.message_id, T.users.sell.serviceSelectFirst, await productKb(c, panel, rows, 'backuser'))
    return true
  },
  // productmonth_<days>
  async (c) => {
    const m = /^productmonth_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user, ud = userData(c)
    const fail = async () => { await sendmessage(c.from_id, T.users.sell.panelUnavailable, c.keyboard, 'HTML'); await step(c, 'home'); return true }
    if (!ud.name_panel) return fail()
    const panel = await panelBy(ud.name_panel)
    if (!panel) return fail()
    if (c.setting.statuscategorygenral === 'oncategorys') {
      await savedata(c, 'save', 'monthproduct', m[1])
      const back = (await activePanels(user.agent)).length === 1 ? 'buybacktow' : `location_${panel.code_panel}`
      await Editmessagetext(c.from_id, c.message_id, T.users.sell.selectCategory, await keyboardCategory(c, panel.name_panel, user.agent, back))
    } else {
      const rows = await all(sql`SELECT * FROM product WHERE (Location = ${ud.name_panel} OR Location = '/all') AND agent = ${user.agent} AND Service_time = ${m[1]}`)
      await Editmessagetext(c.from_id, c.message_id, T.users.sell.serviceSelectFirst, await productKb(c, panel, rows, 'backuser'))
    }
    return true
  },
  // custom service: the volume
  async (c) => {
    if (c.datain !== 'customsellvolume') return false
    const T = c.T, user = c.user
    const panel = (await panelBy(userData(c).name_panel)) || {}
    await sendmessage(c.from_id, await customPricePrompt(c, T.users.sell.customVolumePrompt5, panel, user.agent, 'volume', agentOf(panel.pricecustomvolume, user.agent), agentOf(panel.mainvolume, user.agent), agentOf(panel.maxvolume, user.agent)), backuserKb(c), 'html')
    await deletemessage(c.from_id, c.message_id)
    await step(c, 'gettimecustomvol')
    return true
  },
  async (c) => {
    if (c.user.step !== 'gettimecustomvol') return false
    const T = c.T, user = c.user, backuser = backuserKb(c)
    const panel = (await panelBy(userData(c).name_panel)) || {}
    const mainv = agentOf(panel.mainvolume, user.agent), maxv = agentOf(panel.maxvolume, user.agent)
    if (cmpInt(c.text, intval(maxv)) > 0 || cmpInt(c.text, intval(mainv)) < 0) {
      await sendmessage(c.from_id, strtr(T.users.customSellVolume.invalidVolume, { '{mainvolume}': mainv ?? '', '{maxvolume}': maxv ?? '' }), backuser, 'HTML')
      return true
    }
    if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.common.invalidVolume, backuser, 'HTML'); return true }
    await run(sql`UPDATE user SET Processing_value_one = ${c.text} WHERE id = ${c.from_id}`)
    await sendmessage(c.from_id, await customPricePrompt(c, T.users.sell.customTimePrompt2, panel, user.agent, 'time', agentOf(panel.pricecustomtime, user.agent), agentOf(panel.maintime, user.agent), agentOf(panel.maxtime, user.agent)), backuser, 'html')
    await step(c, customMethod(c, panel) ? 'getvolumecustomusername' : 'getvolumecustomuser')
    return true
  },
  // a sold-out product / category
  async (c) => {
    let sold = c.datain === 'productsoldout' || c.datain === 'categorysoldout'
    if (!sold) {
      const m = /^prodcutservices?(?:om)?_([^-]+)/.exec(c.datain)
      if (m) {
        const p = await one(sql`SELECT status_product, category FROM product WHERE code_product = ${m[1]} ORDER BY id LIMIT 1`)
        sold = !!p && ((p.status_product ?? '') === 'disable' || (await soldOutCategoryKeys()).includes(categoryOffKey(p.category ?? '')))
      }
    }
    if (!sold) return false
    await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id, text: c.T.users.sell.productSoldOut, show_alert: true })
    return true
  },
  // custom-username panels: ask the username
  async (c) => {
    const m = /^prodcutservices_(.*)/.exec(c.datain)
    if (!(c.user.step === 'getvolumecustomusername' || m)) return false
    const T = c.T, user = c.user, backuser = backuserKb(c)
    if (user.step === 'getvolumecustomusername') {
      if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.common.invalidTime, backuser, 'HTML'); return true }
      const panel = (await panelBy(userData(c).name_panel)) || {}
      const mint = agentOf(panel.maintime, user.agent), maxt = agentOf(panel.maxtime, user.agent)
      if (intval(c.text) > intval(maxt) || intval(c.text) < intval(mint)) {
        await sendmessage(c.from_id, strtr(T.users.customSellVolume.invalidTimeRange, { '{maintime}': mint ?? '', '{maxtime}': maxt ?? '' }), backuser, 'HTML')
        return true
      }
      await run(sql`UPDATE user SET Processing_value_one = ${`customvolume_${c.text}_${user.Processing_value_one ?? ''}`} WHERE id = ${c.from_id}`)
      await step(c, 'endstepusers')
    } else {
      await run(sql`UPDATE user SET Processing_value_one = ${m[1]} WHERE id = ${c.from_id}`)
      await step(c, 'endstepuser')
      await deletemessage(c.from_id, c.message_id)
    }
    await sendmessage(c.from_id, T.users.selectusername, backuser, 'html')
    return true
  },
  // the pre-invoice
  async (c) => {
    const m = /prodcutservice_(.*)/.exec(c.datain)
    const user = c.user
    if (!(user.step === 'endstepuser' || user.step === 'endstepusers' || m || user.step === 'getvolumecustomuser')) return false
    const T = c.T, ud = userData(c), backuser = backuserKb(c)
    if (!ud.name_panel) { await sendmessage(c.from_id, T.users.sell.panelUnavailable, c.keyboard, 'HTML'); await step(c, 'home'); return true }
    let code
    if (user.step === 'getvolumecustomuser') {
      if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.users.customSellVolume.invalidTime, backuser, 'HTML'); return true }
      const p = (await panelBy(ud.name_panel)) || {}
      const mint = agentOf(p.maintime, user.agent), maxt = agentOf(p.maxtime, user.agent)
      if (intval(c.text) > intval(maxt) || intval(c.text) < intval(mint)) {
        await sendmessage(c.from_id, strtr(T.users.customSellVolume.invalidTimeRange, { '{maintime}': mint ?? '', '{maxtime}': maxt ?? '' }), backuser, 'HTML')
        return true
      }
      code = `customvolume_${c.text}_${user.Processing_value_one ?? ''}`
    } else if (user.step === 'endstepusers' || user.step === 'endstepuser') code = user.Processing_value_one
    else code = m[1]
    const panel = (await panelBy(ud.name_panel)) || {}
    if (panel.status === 'disable') { await sendmessage(c.from_id, T.users.sell.panelUnavailable, backuser, 'html'); await step(c, 'home'); return true }
    let loc
    if (customMethod(c, panel)) {
      if (!/^(?!_)[a-z][a-z\d_]{2,32}(?<!_)$/i.test(c.text)) { await sendmessage(c.from_id, T.users.invalidusername, backuser, 'HTML'); return true }
      loc = user.Processing_value_one
    } else loc = code
    await run(sql`UPDATE user SET Processing_value_one = ${loc ?? null} WHERE id = ${c.from_id}`)
    const parts = String(loc ?? '').split('_')
    let info
    if (parts[0] === 'customvolume') {
      info = { Volume_constraint: parts[2], name_product: T.users.customSellVolume.title, code_product: T.users.customSellVolume.title, Service_time: parts[1], price_product: await customPlanPrice(c, panel, user.agent, parts[2], parts[1]) }
    } else info = await one(sql`SELECT * FROM product WHERE code_product = ${loc ?? null} AND (Location = ${ud.name_panel} OR Location = '/all') LIMIT 1`)
    if (!info || info.price_product === undefined || info.price_product === null) { await sendmessage(c.from_id, T.users.Balance.confirmError, c.keyboard, 'HTML'); return true }
    info = { ...info }
    if (intval(user.pricediscount) !== 0) info.price_product = n(info.price_product) - (n(info.price_product) * n(user.pricediscount)) / 100
    const text = c.text.toLowerCase()
    let username = (await generateUsername(T, c.from_id, panel.MethodUsername, c.username, randomHex(2), text, panel.namecustom, user.namecustom)).toLowerCase()
    const d = await dataUser(panel.name_panel, username, c.domain)
    if (d.username !== undefined || (await one(sql`SELECT 1 AS x FROM invoice WHERE username = ${username} LIMIT 1`))) username = `${1000000 + Math.floor(Math.random() * 9000000)}_${username}`
    await run(sql`UPDATE user SET Processing_value_tow = ${username} WHERE id = ${c.from_id}`)
    if (intval(info.Volume_constraint) === 0) info.Volume_constraint = T.users.status.unlimited
    if (intval(info.Service_time) === 0) info.Service_time = T.users.status.unlimited
    let price = numberFormat(n(info.price_product))
    const pp = await promoInvoiceParts(info, info.price_product)
    if (pp) price = pp.price
    const q = await promoQuote(info)
    if (q) await savedata(c, 'save', 'promo_quote', q)
    let textin = strtr(T.textbot.preInvoice, {
      '{username}': username, '{name_product}': pp ? pp.name : info.name_product, '{Service_time}': info.Service_time, '{note}': info.note ?? '',
      '{price}': price, '{Volume}': info.Volume_constraint, '{userBalance}': numberFormat(n(user.Balance)),
    })
    if (intval(info.Volume_constraint) === 0) textin = textin.split(T.common.units.gb).join('')
    const kb = J({ inline_keyboard: [
      [{ text: T.keyboard.payAndGetService, callback_data: 'confirmandgetservice' }],
      [{ text: T.keyboard.registerDiscountCode, callback_data: 'aptdc' }],
      [{ text: T.users.backbtn, callback_data: 'backuser' }],
    ] })
    if (user.step !== 'getvolumecustomuser' && !customMethod(c, panel)) await Editmessagetext(c.from_id, c.message_id, textin, kb)
    else await sendmessage(c.from_id, textin, kb, 'HTML')
    await step(c, 'payment')
    return true
  },
  // pay and create the service
  async (c) => {
    if (!(c.user.step === 'payment' && (c.datain === 'confirmandgetservice' || c.datain === 'confirmandgetserviceDiscount'))) return false
    const T = c.T, user = c.user, S = c.setting, ud = userData(c)
    await Editmessagetext(c.from_id, c.message_id, c.text_inline, J({ inline_keyboard: [] }))
    const parts = String(user.Processing_value_one ?? '').split('_')
    const dis = String(user.Processing_value_four ?? '').split('_')
    if (!ud.name_panel) { await sendmessage(c.from_id, T.users.sell.restartProcess, c.keyboard, 'HTML'); await step(c, 'home'); return true }
    let panel = (await panelBy(ud.name_panel)) || {}
    if (panel.status === 'disable') { await sendmessage(c.from_id, T.users.sell.panelUnavailable, backuserKb(c), 'html'); await step(c, 'home'); return true }
    let info
    if (parts[0] === 'customvolume') {
      info = { Volume_constraint: parts[2], name_product: T.users.customSellVolume.title, code_product: 'customvolume', Service_time: parts[1], price_product: await customPlanPrice(c, panel, user.agent, parts[2], parts[1]), data_limit_reset: 'no_reset' }
    } else {
      info = await one(sql`SELECT * FROM product WHERE code_product = ${user.Processing_value_one ?? null} AND (Location = ${ud.name_panel} OR Location = '/all') LIMIT 1`)
      if (info) info = promoApplyQuote(info, ud.promo_quote ?? null)
    }
    if (!info || info.price_product === undefined || info.price_product === null) { await sendmessage(c.from_id, T.users.sell.restartProcess, c.keyboard, 'HTML'); await step(c, 'home'); return true }
    let price
    if (c.datain === 'confirmandgetserviceDiscount') {
      if (!(await one(sql`SELECT 1 AS x FROM DiscountSell WHERE codeDiscount = ${dis[0]} COLLATE NOCASE`))) { await sendmessage(c.from_id, T.users.Discount.notAllowed, null, 'HTML'); return true }
      price = dis[1]
    } else price = info.price_product
    const username = String(user.Processing_value_tow ?? '').toLowerCase()
    const d = await dataUser(panel.name_panel, username, c.domain)
    if (d.username !== undefined || (await one(sql`SELECT 1 AS x FROM invoice WHERE username = ${username} LIMIT 1`))) { await sendmessage(c.from_id, T.users.sell.restartProcess, null, 'HTML'); return true }
    let invoiceId = randomHex(4)
    if (await one(sql`SELECT 1 AS x FROM invoice WHERE id_invoice = ${invoiceId} LIMIT 1`)) invoiceId = `${1000000 + Math.floor(Math.random() * 9000000)}${invoiceId}`
    if (panel.type === 'Manualsale') {
      const left = Number((await one(sql`SELECT COUNT(*) AS n FROM manualsell WHERE codepanel = ${panel.code_panel} AND codeproduct = ${info.code_product} AND status = 'active'`)).n)
      if (left === 0) { await sendmessage(c.from_id, T.users.sell.stockFinishedBuyAnother, null, 'HTML'); return true }
    }
    if (intval(user.pricediscount) !== 0) {
      price = n(price) - (n(price) * n(user.pricediscount)) / 100
      await sendmessage(c.from_id, sprintf(T.users.Discount.discountapplied, user.pricediscount), null, 'HTML')
    }
    const notif = JSON.stringify({ volume: false, time: false })
    await run(sql`INSERT OR IGNORE INTO invoice (id_user, id_invoice, username, time_sell, Service_location, name_product, price_product, Volume, Service_time, Status, note, refral, notifctions)
      VALUES (${c.from_id}, ${invoiceId}, ${username}, ${time()}, ${panel.name_panel}, ${info.name_product}, ${pstr(price)}, ${info.Volume_constraint}, ${info.Service_time}, 'unpaid', ${ud.nameconfig ?? null}, ${user.affiliates ?? null}, ${notif})`)
    if (n(price) > n(user.Balance) && user.agent !== 'n2' && intval(price) !== 0) {
      let rest = n(price) - n(user.Balance)
      if (rest <= 1) rest = 0
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') {
        const pay = async (name) => agentOf((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${name}`))?.ValuePay, user.agent)
        await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.Balance.insufficientbalance, numberFormat(await pay('minbalance')), numberFormat(await pay('maxbalance'))), J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'account' }]] }), 'HTML')
        await step(c, 'getprice')
      } else {
        await run(sql`UPDATE user SET Processing_value = ${pstr(rest)} WHERE id = ${c.from_id}`)
        await sendmessage(c.from_id, T.users.sell.noCredit, await stepPaymentKb(c), 'HTML')
        await step(c, 'get_step_payment')
        await run(sql`UPDATE user SET Processing_value_one = ${username}, Processing_value_tow = 'getconfigafterpay' WHERE id = ${c.from_id}`)
        if (c.datain === 'confirmandgetserviceDiscount') await run(sql`UPDATE user SET Processing_value_four = ${`dis_${dis[0]}`} WHERE id = ${c.from_id}`)
      }
      return true
    }
    if (!(await deductBalance(user, price))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    await Editmessagetext(c.from_id, c.message_id, T.users.sell.creating, null)
    if (c.datain === 'confirmandgetserviceDiscount') {
      const dc = await one(sql`SELECT * FROM DiscountSell WHERE codeDiscount = ${dis[0]} COLLATE NOCASE`)
      if (dc) {
        await run(sql`INSERT INTO Giftcodeconsumed (id_user, code) VALUES (${c.from_id}, ${dis[0]})`)
        await run(sql`UPDATE DiscountSell SET usedDiscount = ${intval(dc.usedDiscount) + 1} WHERE codeDiscount = ${dis[0]} COLLATE NOCASE`)
        await report(c, 'otherreport', strtr(T.Admin.reportgroup.discountUsed, { '{username}': c.username, '{from_id}': c.from_id, '{discount_code}': dis[0] }))
      }
    }
    const days = n(info.Service_time)
    const expire = looseZero(info.Service_time) ? 0 : time() + Math.round(days * 86400)
    const cfg = { expire, data_limit: n(info.Volume_constraint) * 1024 ** 3, from_id: c.from_id, username: c.username, type: 'buy' }
    const out = await createUserFor(panel.name_panel, info.code_product, username, cfg, { domain: c.domain, customLabel: T.users.customSellVolume.btnVolume })
    if (!out || out.username === undefined || out.username === null || out.username === '') {
      let msg = out?.msg ?? 'unknown error'
      msg = typeof msg === 'object' && msg !== null ? JSON.stringify(msg) : String(msg)
      await addBalance(c.from_id, price)
      await sendmessage(c.from_id, T.users.sell.errorConfig, c.keyboard, 'HTML')
      await orderFailLog('wallet', c.from_id, username, price, '', msg, String(panel.name_panel ?? ''))
      if (intval(price) > 0) await sendmessage(c.from_id, sprintf(T.users.Balance.refundCreateFailed, numberFormat(intval(price))), c.keyboard, 'HTML')
      await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorSubscriptionCreate, msg, c.from_id, c.username, panel.name_panel))
      await step(c, 'home')
      return true
    }
    await run(sql`UPDATE invoice SET Status = 'active' WHERE username = ${username}`)
    const link = panel.sublink === 'onsublink' ? out.subscription_url : ''
    let configs = ''
    if (panel.config === 'onconfig' && Array.isArray(out.configs)) for (const l of out.configs) configs += '\n' + l
    let after = T.textbot.afterPay
    if (panel.type === 'Manualsale') after = T.textbot.manual
    if (panel.type === 'WGDashboard') after = T.textbot.wgDashboard
    if (panel.type === 'ibsng' || panel.type === 'mikrotik') after = T.textbot.afterPayIbsng
    const shown = { ...info }
    if (intval(shown.Service_time) === 0) shown.Service_time = T.users.status.unlimited
    if (intval(shown.Volume_constraint) === 0) shown.Volume_constraint = T.users.status.unlimited
    let msg = after.split('{username}').join(`<code>${out.username}</code>`).split('{name_service}').join(shown.name_product).split('{location}').join(panel.name_panel)
      .split('{day}').join(String(shown.Service_time)).split('{volume}').join(String(shown.Volume_constraint)).split('{config}').join(`<code>${link}</code>`)
      .split('{links}').join(configs).split('{links2}').join(link)
    if (intval(shown.Volume_constraint) === 0) msg = msg.split(T.common.units.gigabyte).join('')
    if (['Manualsale', 'ibsng', 'mikrotik'].includes(panel.type)) {
      msg = msg.split('{password}').join(out.subscription_url)
      await run(sql`UPDATE invoice SET user_info = ${out.subscription_url} WHERE id_invoice = ${invoiceId}`)
    }
    await sendMessageService(c, panel, out.configs, link, out.username, J({ inline_keyboard: [[{ text: T.users.help.btninlinebuy, callback_data: 'helpbtn' }]] }), msg, invoiceId, null, out.wireguard ?? [])
    await sendmessage(c.from_id, T.users.selectoption, c.keyboard, 'HTML')
    const method = usernameMethodKey(T, panel.MethodUsername)
    if (['customTextSequential', 'usernameSequential', 'numericIdSequential', 'agentCustomTextSequential'].includes(method)) {
      await run(sql`UPDATE user SET number_username = ${intval(user.number_username) + 1} WHERE id = ${c.from_id}`)
      if (['customTextSequential', 'agentCustomTextSequential'].includes(method)) await run(sql`UPDATE setting SET numbercount = ${intval(S.numbercount) + 1}`)
    }
    // referral commission
    const aff = (await one(sql`SELECT * FROM affiliates LIMIT 1`)) || {}
    const bought = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE name_product != ${T.common.labels.testServiceName} AND id_user = ${c.from_id} AND Status != 'Unpaid'`)).n)
    const ref = user.affiliates
    if (aff.status_commission === 'oncommission' && ref != null && intval(ref) !== 0 && (aff.porsant_one_buy !== 'on_buy_porsant' || bought === 1)) {
      const first = aff.porsant_one_buy === 'on_buy_porsant'
      const result = (n(price) * n(S.affiliatespercentage)) / 100
      const ru = (await one(sql`SELECT * FROM user WHERE id = ${String(ref)}`)) || {}
      if (intval(S.scorestatus) === 1 && !c.admin_ids.includes(String(ref))) {
        await sendmessage(String(ref), T.users.affiliates.pointsEarned2Alt, null, 'html')
        await run(sql`UPDATE user SET score = ${n(ru.score) + 2} WHERE id = ${String(ref)}`)
      }
      await addBalance(String(ref), result)
      const r = numberFormat(result)
      await report(c, 'porsantreport', sprintf(first ? T.Admin.reportgroup.commissionPaid : T.Admin.reportgroup.commissionPaid2, r, ref, c.from_id, tehranDate()))
      await sendmessage(String(ref), sprintf(first ? T.users.affiliates.commissionPaid : T.users.affiliates.commissionPaid2, r), null, 'HTML')
    }
    if (intval(S.scorestatus) === 1 && !c.isAdmin) {
      await sendmessage(c.from_id, T.users.affiliates.pointsEarned1Alt, null, 'html')
      await run(sql`UPDATE user SET score = ${n(user.score) + 1} WHERE id = ${c.from_id}`)
    }
    const after2 = numberFormat(n((await one(sql`SELECT Balance FROM user WHERE id = ${c.from_id}`))?.Balance), 0)
    const kb = J({ inline_keyboard: [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + c.from_id }]] })
    await report(c, 'buyreport', sprintf(T.Admin.reportgroup.accountCreated, bought === 1 ? T.common.labels.firstPurchaseAlt : '', c.from_id, c.username, username, c.first_name, ud.name_panel, shown.name_product,
      shown.Service_time, shown.Volume_constraint, numberFormat(n(user.Balance), 0), after2, invoiceId, user.agent, user.number, info.category ?? '', info.price_product, price, jdate('Y/m/d H:i:s')), { reply_markup: kb })
    await run(sql`UPDATE user SET Processing_value_four = 'none' WHERE id = ${c.from_id}`)
    await step(c, 'home')
    return true
  },
  async (c) => {
    if (c.datain !== 'aptdc') return false
    await sendmessage(c.from_id, c.T.users.Discount.getcodesell, backuserKb(c), 'HTML')
    await step(c, 'getcodesellDiscount')
    await deletemessage(c.from_id, c.message_id)
    return true
  },
  // a discount code on the pre-invoice
  async (c) => {
    if (c.user.step !== 'getcodesellDiscount') return false
    const T = c.T, user = c.user, ud = userData(c)
    if (ud.name_panel === undefined || ud.name_panel === null) { await sendmessage(c.from_id, T.users.sell.restartFromStart, c.keyboard, 'HTML'); return true }
    let info = await one(sql`SELECT * FROM product WHERE code_product = ${user.Processing_value_one ?? null} AND (Location = ${ud.name_panel} OR Location = '/all') LIMIT 1`)
    const panel = (await panelBy(ud.name_panel)) || {}
    if (!(await one(sql`SELECT 1 AS x FROM DiscountSell WHERE codeDiscount = ${c.text} COLLATE NOCASE LIMIT 1`))) { await sendmessage(c.from_id, T.users.Discount.notcode, backuserKb(c), 'HTML'); return true }
    const d = await one(sql`SELECT * FROM DiscountSell WHERE (code_product = ${info?.code_product ?? null} OR code_product = 'all') AND (code_panel = ${panel.code_panel ?? null} OR code_panel = '/all')
      AND codeDiscount = ${c.text} COLLATE NOCASE AND (agent = ${user.agent} OR agent = 'allusers') AND (type = 'all' OR type = 'buy')`)
    const used = Number((await one(sql`SELECT COUNT(*) AS n FROM Giftcodeconsumed WHERE id_user = ${c.from_id} AND code = ${c.text} COLLATE NOCASE`)).n)
    if (!d) { await sendmessage(c.from_id, T.users.Discount.invalidCode, null, 'HTML'); return true }
    if (intval(d.time) !== 0 && time() >= intval(d.time)) { await sendmessage(c.from_id, T.users.Discount.expired, null, 'HTML'); return true }
    if (n(d.limitDiscount) <= n(d.usedDiscount)) { await sendmessage(c.from_id, T.users.Discount.errorLimit, null, 'HTML'); return true }
    if (used >= n(d.useuser)) {
      await sendmessage(c.from_id, strtr(T.users.Discount.useLimit, { '{useuser}': d.useuser }), c.keyboard, 'HTML')
      await step(c, 'home')
      return true
    }
    if (String(d.usefirst) === '1') {
      const k = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${c.from_id} AND name_product != ${T.common.labels.testServiceName} AND ${sql.raw(LIVE)}`)).n)
      if (k !== 0) { await sendmessage(c.from_id, T.users.Discount.firstdiscount, null, 'HTML'); return true }
    }
    await sendmessage(c.from_id, strtr(T.users.Discount.applied, { '{discount_price}': d.price }), null, 'HTML')
    await step(c, 'payment')
    const parts = String(user.Processing_value_one ?? '').split('_')
    if (parts[0] === 'customvolume') {
      info = { ...(info || {}), Volume_constraint: parts[2], name_product: T.users.customSellVolume.title, code_product: T.users.customSellVolume.title, Service_time: parts[1], price_product: await customPlanPrice(c, panel, user.agent, parts[2], parts[1]) }
    } else info = { ...((await one(sql`SELECT * FROM product WHERE code_product = ${user.Processing_value_one ?? null} AND (Location = ${ud.name_panel} OR Location = '/all') LIMIT 1`)) || {}) }
    const main = info.price_product
    let price = phpRound(n(main) - (n(d.price) / 100) * n(main))
    if (looseZero(info.Service_time)) info.Service_time = T.users.status.unlimited
    if (intval(info.Volume_constraint) === 0) info.Volume_constraint = T.users.status.unlimited
    if (price < 0) price = 0
    const textin = sprintf(T.users.sell.preInvoice, user.Processing_value_tow, info.name_product, info.Service_time, main, price, info.Volume_constraint, user.Balance)
    const kb = J({ inline_keyboard: [[{ text: T.keyboard.payAndGetService, callback_data: 'confirmandgetserviceDiscount' }], [{ text: T.users.backbtn, callback_data: 'backuser' }]] })
    await run(sql`UPDATE user SET Processing_value_four = ${c.text + '_' + pstr(price)} WHERE id = ${c.from_id}`)
    await sendmessage(c.from_id, textin, kb, 'HTML')
    return true
  },
]
