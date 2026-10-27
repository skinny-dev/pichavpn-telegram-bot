// Bulk purchase (several services at once, paid from the wallet) — index.php lines 4316–4670
import { one, all, run, sql } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { step, shop } from '../bot.js'
import { backuserKb, panelLists } from '../keyboards.js'
import { dataUser, createUserFor } from '../panel.js'
import { keyboardProduct, customPlanPrice, customPricePrompt, deductBalance, addBalance, stepPaymentKb } from '../catalog.js'
import { generateUsername, usernameMethodKey, sendMessageService } from '../service.js'
import { jdate } from '../fmt.js'
import { sprintf, strtr, numberFormat, intval, time, randomHex, J, eq, phpJson } from '../php.js'

const ctypeDigit = (s) => typeof s === 'string' && /^[0-9]+$/.test(s)
const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v))
const n = (v) => (isNumeric(v) ? Number(v) : 0)
const looseZero = (v) => v === null || v === undefined || v === false || v === 0 || (isNumeric(v) && Number(v) === 0)
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
/** PHP 8 `$int > $v` where $v may be null (null compares as a boolean) */
const gt = (a, b) => (b === null || b === undefined ? Boolean(a) && true : a > n(b))
const lt = (a, b) => (b === null || b === undefined ? false : a < n(b))
const cmpInt = (s, i) => (isNumeric(s) ? Math.sign(Number(s) - i) : s > String(i) ? 1 : s < String(i) ? -1 : 0)
const panelBy = (name) => one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${name ?? null}`)
const customMethod = (c, p) => ['customUsername', 'customUsernameRandom'].includes(usernameMethodKey(c.T, p?.MethodUsername))
const report = (c, thread, text) => (String(c.setting.Channel_Report ?? '').length > 0 ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML' }) : null)
const rand7 = () => 1000000 + Math.floor(Math.random() * 9000000)

export const bulkRoutes = [
  async (c) => {
    const T = c.T, user = c.user
    if (!(c.text === T.keyboard.bulkPurchase || c.datain === 'kharidanbuh')) return false
    if (c.setting.bulkbuy === 'offbulk') { await sendmessage(c.from_id, T.users.Major.disabled, null, 'HTML'); return true }
    const min = (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = 'minbalancebuybulk'`))?.ValuePay ?? null
    if (min !== null && n(user.Balance) < n(min)) { await sendmessage(c.from_id, strtr(T.users.Major.minBalance, { '{PaySetting}': min }), null, 'HTML'); return true }
    if (Number((await one(sql`SELECT COUNT(*) AS n FROM marzban_panel`)).n) === 0) { await sendmessage(c.from_id, T.users.sell.nullPanel, null, 'HTML'); return true }
    const on = c.setting.get_number === 'onAuthenticationphone'
    if (on && user.step !== 'get_number' && user.number === 'none') { await sendmessage(c.from_id, T.users.number.confirming, c.request_contact, 'HTML'); await step(c, 'get_number') }
    if (user.number === 'none' && on) return true
    if (c.datain === 'kharidanbuh') await Editmessagetext(c.from_id, c.message_id, T.users.Major.title, backuserKb(c), 'HTML')
    else await sendmessage(c.from_id, T.users.Major.title, backuserKb(c), 'HTML')
    await step(c, 'getcountconfig')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getcountconfig') return false
    const T = c.T
    if (intval(c.text) > 15 || intval(c.text) < 1) { await sendmessage(c.from_id, T.common.invalidInput, backuserKb(c), 'HTML'); return true }
    if (!isNumeric(c.text)) { await sendmessage(c.from_id, T.users.Balance.errorprice, null, 'HTML'); return true }
    await sendmessage(c.from_id, T.textbot.selectLocation, (await panelLists(c)).list_marzban_panel_userom, 'HTML')
    await run(sql`UPDATE user SET Processing_value_four = ${c.text} WHERE id = ${c.from_id}`)
    await step(c, 'home')
    return true
  },
  async (c) => {
    const m = /^locationom_(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    const panel = (await one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${m[1]}`)) || {}
    if (Number((await one(sql`SELECT COUNT(*) AS n FROM product`)).n) === 0) { await sendmessage(c.from_id, T.users.sell.nullProduct, null, 'HTML'); return true }
    await run(sql`UPDATE user SET Processing_value = ${panel.name_panel ?? null} WHERE id = ${c.from_id}`)
    const custom = eq(agentOf(panel.customvolume, user.agent), '1') && panel.type !== 'Manualsale'
    const rows = await all(sql`SELECT * FROM product WHERE (Location = ${panel.name_panel ?? null} OR Location = '/all') AND agent = ${user.agent}`)
    const kb = await keyboardProduct(c, panel.name_panel ?? null, rows, user.pricediscount, customMethod(c, panel) ? 'prodcutservicesom_' : 'prodcutserviceom_', custom, 'backuser', null, 'customsellvolumeom')
    await Editmessagetext(c.from_id, c.message_id, T.users.sell.serviceSelect, kb)
    return true
  },
  async (c) => {
    if (c.datain !== 'customsellvolumeom') return false
    const T = c.T, user = c.user
    const panel = (await panelBy(user.Processing_value)) || {}
    await sendmessage(c.from_id, await customPricePrompt(c, T.users.sell.volumePrompt, panel, user.agent, 'volume', agentOf(panel.pricecustomvolume, user.agent)), backuserKb(c), 'html')
    await deletemessage(c.from_id, c.message_id)
    await step(c, 'gettimecustomvolom')
    return true
  },
  async (c) => {
    if (c.user.step !== 'gettimecustomvolom') return false
    const T = c.T, user = c.user, backuser = backuserKb(c)
    const panel = (await panelBy(user.Processing_value)) || {}
    const mainv = agentOf(panel.mainvolume, user.agent), maxv = agentOf(panel.maxvolume, user.agent)
    if (cmpInt(c.text, intval(maxv)) > 0 || cmpInt(c.text, intval(mainv)) < 0) {
      await sendmessage(c.from_id, strtr(T.users.customSellVolume.invalidVolume, { '{mainvolume}': mainv ?? '', '{maxvolume}': maxv ?? '' }), backuser, 'HTML')
      return true
    }
    if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.common.invalidVolume, backuser, 'HTML'); return true }
    await run(sql`UPDATE user SET Processing_value_one = ${c.text} WHERE id = ${c.from_id}`)
    await sendmessage(c.from_id, await customPricePrompt(c, T.users.sell.timePrompt, panel, user.agent, 'time', agentOf(panel.pricecustomtime, user.agent), agentOf(panel.maintime, user.agent), agentOf(panel.maxtime, user.agent)), backuser, 'html')
    await step(c, customMethod(c, panel) ? 'getvolumecustomusernameom' : 'getvolumecustomuserom')
    return true
  },
  async (c) => {
    const m = /^prodcutservicesom_(.*)/.exec(c.datain)
    if (!(c.user.step === 'getvolumecustomusernameom' || m)) return false
    const T = c.T, user = c.user, backuser = backuserKb(c)
    if (user.step === 'getvolumecustomusernameom') {
      if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.users.customSellVolume.invalidTime, backuser, 'HTML'); return true }
      const panel = (await panelBy(user.Processing_value)) || {}
      const mint = agentOf(panel.maintime, user.agent), maxt = agentOf(panel.maxtime, user.agent)
      if (intval(c.text) > intval(maxt) || intval(c.text) < intval(mint)) {
        await sendmessage(c.from_id, strtr(T.users.customSellVolume.invalidTimeRange, { '{maintime}': mint ?? '', '{maxtime}': maxt ?? '' }), backuser, 'HTML')
        return true
      }
      await run(sql`UPDATE user SET Processing_value_one = ${`customvolume_${c.text}_${user.Processing_value_one ?? ''}`} WHERE id = ${c.from_id}`)
      await step(c, 'endstepusersom')
    } else {
      await run(sql`UPDATE user SET Processing_value_one = ${m[1]} WHERE id = ${c.from_id}`)
      await step(c, 'endstepuserom')
    }
    await sendmessage(c.from_id, T.users.selectusername, backuser, 'html')
    return true
  },
  // the bulk pre-invoice
  async (c) => {
    const m = /prodcutserviceom_(.*)/.exec(c.datain)
    const user = c.user
    if (!(user.step === 'endstepuserom' || user.step === 'endstepusersom' || m || user.step === 'getvolumecustomuserom')) return false
    const T = c.T, backuser = backuserKb(c)
    let code
    if (user.step === 'getvolumecustomuserom') {
      if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.users.customSellVolume.invalidTime, backuser, 'HTML'); return true }
      const p = (await panelBy(user.Processing_value)) || {}
      const mint = agentOf(p.maintime, user.agent), maxt = agentOf(p.maxtime, user.agent)
      if (gt(intval(c.text), maxt) || lt(intval(c.text), mint)) {
        await sendmessage(c.from_id, strtr(T.users.customSellVolume.invalidTimeRange, { '{maintime}': mint ?? '', '{maxtime}': maxt ?? '' }), backuser, 'HTML')
        return true
      }
      code = `customvolume_${c.text}_${user.Processing_value_one ?? ''}`
    } else if (user.step === 'endstepusersom' || user.step === 'endstepuserom') code = user.Processing_value_one
    else code = m[1]
    const panel = (await panelBy(user.Processing_value)) || {}
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
    } else info = { ...((await one(sql`SELECT * FROM product WHERE code_product = ${loc ?? null} AND (Location = ${user.Processing_value ?? null} OR Location = '/all') LIMIT 1`)) || {}) }
    const username = (await generateUsername(T, c.from_id, panel.MethodUsername, c.username, randomHex(2), c.text, panel.namecustom, user.namecustom)).toLowerCase()
    await run(sql`UPDATE user SET Processing_value_tow = ${username} WHERE id = ${c.from_id}`)
    if (looseZero(info.Volume_constraint)) info.Volume_constraint = T.users.status.unlimited
    if (looseZero(info.Service_time)) info.Service_time = T.users.status.unlimited
    const price = intval(info.price_product) * intval(user.Processing_value_four)
    const text = sprintf(T.users.sell.preInvoice2, username, info.name_product, info.Service_time, numberFormat(price), info.Volume_constraint, numberFormat(n(user.Balance)), user.Processing_value_four)
    await sendmessage(c.from_id, text, J({ inline_keyboard: [[{ text: T.keyboard.payAndGetService, callback_data: 'confirmandgetservice' }], [{ text: T.users.backbtn, callback_data: 'backuser' }]] }), 'HTML')
    await step(c, 'payments')
    return true
  },
  // pay and create every service
  async (c) => {
    if (!(c.user.step === 'payments' && c.datain === 'confirmandgetservice')) return false
    const T = c.T, user = c.user, S = c.setting
    const panel = (await panelBy(user.Processing_value)) || {}
    const parts = String(user.Processing_value_one ?? '').split('_')
    let info
    if (parts[0] === 'customvolume') {
      info = { Volume_constraint: parts[2], name_product: T.users.customSellVolume.title, code_product: 'customvolume', Service_time: parts[1], price_product: await customPlanPrice(c, panel, user.agent, parts[2], parts[1]), data_limit_reset: 'no_reset' }
    } else info = await one(sql`SELECT * FROM product WHERE code_product = ${user.Processing_value_one ?? null} AND (Location = ${user.Processing_value ?? null} OR Location = '/all') LIMIT 1`)
    if (!info || looseZero(info.price_product) || info.price_product === '') return true
    const count = intval(user.Processing_value_four)
    let price = n(info.price_product) * n(user.Processing_value_four)
    await Editmessagetext(c.from_id, c.message_id, c.text_inline, null)
    const base = user.Processing_value_tow
    if (intval(user.pricediscount) !== 0) {
      price = price - (price * n(user.pricediscount)) / 100
      await sendmessage(c.from_id, sprintf(T.users.Discount.discountapplied, user.pricediscount), null, 'HTML')
    }
    const single = count !== 0 ? price / count : price
    if (price > n(user.Balance) && user.agent !== 'n2') {
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') {
        const pay = async (name) => agentOf((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${name}`))?.ValuePay, user.agent)
        await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.Balance.insufficientbalance, numberFormat(await pay('minbalance')), numberFormat(await pay('maxbalance'))), J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'account' }]] }), 'HTML')
        await step(c, 'getprice')
        return true
      }
      await run(sql`UPDATE user SET Processing_value = ${sprintf('%s', price - n(user.Balance))} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.users.sell.noCredit, await stepPaymentKb(c), 'HTML')
      await step(c, 'get_step_payment')
      return true
    }
    if (!(await deductBalance(user, price))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    const method = usernameMethodKey(T, panel.MethodUsername)
    if (['customTextSequential', 'usernameSequential', 'numericIdSequential', 'agentCustomTextSequential'].includes(method)) {
      await run(sql`UPDATE user SET number_username = ${intval(user.number_username) + n(user.Processing_value_four)} WHERE id = ${c.from_id}`)
      if (['customTextSequential', 'agentCustomTextSequential'].includes(method)) await run(sql`UPDATE setting SET numbercount = ${intval(S.numbercount) + n(user.Processing_value_four)}`)
    }
    const expire = looseZero(info.Service_time) ? 0 : time() + Math.round(n(info.Service_time) * 86400)
    const cfg = { expire, data_limit: n(info.Volume_constraint) * 1024 ** 3, from_id: c.from_id, username: c.username, type: 'buyomdh' }
    const notif = JSON.stringify({ volume: false, time: false })
    const helpKb = J({ inline_keyboard: [[{ text: T.users.help.btninlinebuy, callback_data: 'helpbtn' }]] })
    let invoiceId = ''
    for (let i = 0; i < n(user.Processing_value_four); i++) {
      let uname = `${base}_${i}`
      const d = await dataUser(panel.name_panel, uname, c.domain)
      if (d.username !== undefined || (await one(sql`SELECT 1 AS x FROM invoice WHERE username = ${uname} LIMIT 1`))) uname = `${rand7()}_${uname}`
      invoiceId = randomHex(4)
      if (await one(sql`SELECT 1 AS x FROM invoice WHERE id_invoice = ${invoiceId} LIMIT 1`)) invoiceId = `${rand7()}${invoiceId}`
      const out = await createUserFor(panel.name_panel, info.code_product, uname, cfg, { domain: c.domain, customLabel: T.users.customSellVolume.btnVolume })
      if (!out || out.username == null) {
        await addBalance(c.from_id, single * (count - i))
        await sendmessage(c.from_id, T.users.sell.errorConfig, c.keyboard, 'HTML')
        await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorBulkAccountCreate, phpJson(out?.msg ?? null), c.from_id, c.username, panel.name_panel))
        await step(c, 'home')
        return true
      }
      await run(sql`INSERT OR IGNORE INTO invoice (id_user, id_invoice, username, time_sell, Service_location, name_product, price_product, Volume, Service_time, Status, notifctions)
        VALUES (${c.from_id}, ${invoiceId}, ${uname}, ${time()}, ${user.Processing_value}, ${info.name_product}, ${info.price_product}, ${info.Volume_constraint}, ${info.Service_time}, 'active', ${notif})`)
      const link = panel.sublink === 'onsublink' ? out.subscription_url : ''
      const configs = panel.config === 'onconfig' && Array.isArray(out.configs) ? out.configs.join('') : ''
      let after = panel.type === 'Manualsale' ? T.textbot.manual : T.textbot.afterPay
      if (panel.type === 'WGDashboard') after = T.users.sell.created2
      const msg = after.split('{username}').join(`<code>${out.username}</code>`).split('{name_service}').join(info.name_product).split('{location}').join(panel.name_panel)
        .split('{day}').join(String(info.Service_time)).split('{volume}').join(String(info.Volume_constraint)).split('{config}').join(`<code>${link}</code>`)
        .split('{links}').join(`<code>${configs}</code>`).split('{links2}').join(link)
      await sendMessageService(c, panel, out.configs, link, out.username, helpKb, msg, invoiceId, null, out.wireguard ?? [])
    }
    await sendmessage(c.from_id, T.users.selectoption, c.keyboard, 'HTML')
    const after2 = numberFormat(n((await one(sql`SELECT Balance FROM user WHERE id = ${c.from_id}`))?.Balance), 0)
    await report(c, 'buyreport', sprintf(T.Admin.reportgroup.bulkAccountCreated, c.from_id, c.username, base, user.Processing_value_four, c.first_name, user.Processing_value, info.name_product, info.Service_time, info.Volume_constraint,
      numberFormat(n(user.Balance), 0), after2, invoiceId, user.agent, user.number, info.price_product, info.price_product, user.Processing_value_four, jdate('Y/m/d H:i:s')))
    await step(c, 'home')
    return true
  },
]
