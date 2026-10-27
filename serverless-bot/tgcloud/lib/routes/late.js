// index.php lines 6700–6890: an agent renews a panel user that is not in the bot; the bot language
import { one, all, run, sql } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { step, shop, tehranDate } from '../bot.js'
import { dataUser, extend as panelExtend } from '../panel.js'
import { keyboardProduct, promoInvoiceParts, deductBalance, addBalance, stepPaymentKb } from '../catalog.js'

import { jdate } from '../fmt.js'
import { sprintf, numberFormat, intval, J, eq, phpJson } from '../php.js'

const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v))
const n = (v) => (isNumeric(v) ? Number(v) : 0)
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
const report = (c, thread, text) => (String(c.setting.Channel_Report ?? '').length > 0 ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML' }) : null)
const productIn = (loc, agent, code) => one(sql`SELECT * FROM product WHERE (Location = ${loc ?? null} OR Location = '/all') AND agent = ${agent} AND code_product = ${code}`)
const extendLabels = (T) => Object.fromEntries(['resetVolumeTime', 'addTimeVolumeNextMonth', 'resetTimeAddVolume', 'resetVolumeAddTime', 'addTimeConvertVolume']
  .map((k) => [String(T.keyboard[k] ?? '').trim(), k]).filter(([l]) => l !== ''))

export const lateRoutes = [
  async (c) => {
    const m = /extends_(\w+)_(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    const loc = await one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${user.Processing_value_four ?? null}`)
    if (!loc) { await sendmessage(c.from_id, T.users.genericRestart2, null, 'html'); return true }
    await run(sql`UPDATE user SET Processing_value = ${loc.name_panel} WHERE id = ${c.from_id}`)
    const panel = await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${loc.name_panel}`)
    if (!panel) { await sendmessage(c.from_id, T.users.status.infoUnavailable, null, 'HTML'); await step(c, 'home'); return true }
    const rows = await all(sql`SELECT * FROM product WHERE (Location = ${loc.name_panel} OR Location = '/all') AND agent = ${user.agent}`)
    // KeyboardProduct(..., $valuetow = $username): the Telegram username, as the PHP bot passes it
    await Editmessagetext(c.from_id, c.message_id, T.users.extend.selectservice, await keyboardProduct(c, panel.name_panel, rows, user.pricediscount, 'serviceextendselects-', false, 'backuser', c.username, 'customsellvolume'))
    return true
  },
  async (c) => {
    const m = /^serviceextendselects-(.*)-(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    await deletemessage(c.from_id, c.message_id)
    const prod = await productIn(user.Processing_value, user.agent, m[1])
    if (!prod) { await sendmessage(c.from_id, T.users.erroroccurred, c.keyboard, 'html'); return true }
    const kb = J({ inline_keyboard: [[{ text: T.users.extend.confirm, callback_data: `confirmserivces-${m[1]}-${m[2]}` }]] })
    const pp = await promoInvoiceParts(prod, prod.price_product)
    await sendmessage(c.from_id, sprintf(T.users.extend.renewalinvoice, m[2], pp ? pp.name : prod.name_product, pp ? pp.price : numberFormat(n(prod.price_product)), prod.Service_time, prod.Volume_constraint, prod.note, numberFormat(n(user.Balance))), kb, 'html')
    return true
  },
  async (c) => {
    const m = /^confirmserivces-(.*)-(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user, uname = m[2]
    await deletemessage(c.from_id, c.message_id)
    const prod = { ...((await productIn(user.Processing_value, user.agent, m[1])) || {}) }
    const panel = await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${user.Processing_value ?? null}`)
    const d = await dataUser(panel?.name_panel ?? null, uname, c.domain)
    if (d.status === 'Unsuccessful' || !panel) { await sendmessage(c.from_id, T.users.extend.renewalerror, c.keyboard, 'HTML'); return true }
    const discount = async () => {
      if (intval(user.pricediscount) === 0) return
      prod.price_product = n(prod.price_product) - (n(prod.price_product) * n(user.pricediscount)) / 100
      await sendmessage(c.from_id, sprintf(T.users.Discount.discountapplied, user.pricediscount), null, 'HTML')
    }
    if (n(user.Balance) < n(prod.price_product) && user.agent !== 'n2') {
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') {
        const pay = async (k) => agentOf((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay, user.agent)
        await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.Balance.insufficientbalance, numberFormat(n(await pay('minbalance'))), numberFormat(n(await pay('maxbalance')))), J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'account' }]] }), 'HTML')
        await step(c, 'getprice')
        return true
      }
      await discount()
      await run(sql`UPDATE user SET Processing_value = ${sprintf('%s', n(prod.price_product) - n(user.Balance))} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.users.sell.noCredit, await stepPaymentKb(c), 'HTML')
      await step(c, 'get_step_payment')
      return true
    }
    await discount()
    if (!(await deductBalance(user, prod.price_product))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    const ex = await panelExtend(panel.Methodextend, prod.Volume_constraint, prod.Service_time, uname, prod.code_product, panel.code_panel, extendLabels(T))
    if (ex.status === false) {
      await addBalance(c.from_id, prod.price_product)
      await sendmessage(c.from_id, T.users.extend.errorSupport, null, 'HTML')
      await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorRenewService2, panel.name_panel, uname, phpJson(ex.msg)))
      return true
    }
    const value = JSON.stringify({ volumebuy: prod.Volume_constraint, Service_time: prod.Service_time, oldvolume: d.data_limit ?? null, oldtime: d.expire ?? null, code_product: prod.code_product })
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (${c.from_id}, ${uname}, ${value}, 'extends_not_user', ${tehranDate()}, ${sprintf('%s', prod.price_product)}, ${JSON.stringify(ex)})`)
    const pf = numberFormat(n(prod.price_product))
    const after = numberFormat(n((await one(sql`SELECT Balance FROM user WHERE id = ${c.from_id}`))?.Balance), 0)
    await sendmessage(c.from_id, sprintf(T.users.extend.success2, uname, prod.name_product, pf), c.keyboard, 'HTML')
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.renewalDetails, c.from_id, c.username, uname, c.first_name, panel.name_panel, prod.name_product, prod.Volume_constraint, prod.Service_time, pf, after, jdate('Y/m/d H:i:s')))
    return true
  },
  async (c) => {
    if (c.datain !== 'ّchange_language') return false
    const L = c.T.language
    const kb = J({ inline_keyboard: [
      [{ text: L.btnFa, callback_data: 'setlang:fa' }, { text: L.btnEn, callback_data: 'setlang:en' }],
      [{ text: L.btnZh, callback_data: 'setlang:zh' }, { text: L.btnRu, callback_data: 'setlang:ru' }],
      [{ text: c.T.users.backbtn, callback_data: 'account' }],
    ] })
    await Editmessagetext(c.from_id, c.message_id, L.selectPrompt, kb)
    return true
  },
  async (c) => {
    const m = /^setlang:(.*)/.exec(c.datain)
    if (!m) return false
    await run(sql`UPDATE user SET lang = ${m[1]} WHERE id = ${c.from_id}`)
    await Editmessagetext(c.from_id, c.message_id, c.T.language.setSuccess, J({ inline_keyboard: [[{ text: c.T.users.backbtn, callback_data: 'account' }]] }))
    return true
  },
]
