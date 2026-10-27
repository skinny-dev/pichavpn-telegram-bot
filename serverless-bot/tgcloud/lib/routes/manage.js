// A service's actions — index.php lines 1917–2899: new subscription link, extra volume, change location,
// report a problem, extra time, delete request, transfer to another user.
import { one, all, run, sql } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { step, shop, tehranDate } from '../bot.js'
import { backuserKb, keyboardConfig, panelLists } from '../keyboards.js'
import { dataUser, revokeSub, extraVolume, extraTime, removeUser, createUserFor } from '../panel.js'
import { savedata, userData, deductBalance, addBalance, stepPaymentKb } from '../catalog.js'
import { sendWireguardFiles } from '../wg.js'
import { utcSec } from './services.js'
import { jdate, formatBytes, phpFloat, phpRound } from '../fmt.js'
import { sprintf, strtr, numberFormat, intval, time, J, eq, phpJson } from '../php.js'

const own = (inv, c) => !!inv && String(inv.id_user) === c.from_id
const ctypeDigit = (s) => typeof s === 'string' && /^[0-9]+$/.test(s)
const pstr = (v) => sprintf('%s', v)
const nullish = (v) => v === null || v === undefined || v === '' || v === false || v === 0 || v === '0'
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
const invoiceBy = (id) => one(sql`SELECT * FROM invoice WHERE id_invoice = ${id ?? null}`)
const panelBy = (name) => one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${name ?? null}`)
const LIVE = ['active', 'end_of_time', 'end_of_volume', 'sendedwarn', 'send_on_hold']
const backTo = (c, cb) => J({ inline_keyboard: [[{ text: c.T.users.status.backinfo, callback_data: cb }]] })
const report = (c, thread, text, extra = {}) =>
  String(c.setting.Channel_Report ?? '').length > 0
    ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML', ...extra })
    : null
/** PHP number (string) math: "2000" * "5" */
const n = (v) => Number(v ?? 0) || 0

/** strtotime(): a date without a zone is Tehran time (the bot's default timezone) */
function tehranSec(s) {
  s = String(s)
  if (/^\d+$/.test(s)) return Number(s)
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + '+03:30'
  return Math.floor(Date.parse(iso) / 1000)
}
/** the status lines several messages share */
function summaryParts(c, d) {
  const T = c.T, S = T.users.status
  let lastonline
  if (eq(d.online_at, 'online')) lastonline = T.common.connection.onlineAlt
  else if (eq(d.online_at, 'offline')) lastonline = T.common.connection.offlineAlt
  else if (d.online_at !== undefined && d.online_at !== null) lastonline = jdate('Y/m/d H:i:s', tehranSec(d.online_at))
  else lastonline = T.common.connection.notConnectedAlt
  const expirationDate = d.expire ? jdate('Y/m/d', d.expire) : S.unlimited
  const LastTraffic = d.data_limit ? formatBytes(T, d.data_limit) : S.unlimited
  const Remaining = d.data_limit ? formatBytes(T, n(d.data_limit) - n(d.used_traffic)) : T.common.labels.unlimitedShort
  const used = d.used_traffic ? formatBytes(T, d.used_traffic) : S.notConsumed
  const day = d.expire ? Math.floor((n(d.expire) - time()) / 86400) + S.day : S.unlimited
  return { lastonline, expirationDate, LastTraffic, Remaining, used, day }
}
const statusName = (S, st) => ({ active: S.active, limited: S.limited, disabled: S.disabled, expired: S.expired, on_hold: S.on_hold, Unknown: S.unknown, deactivev: S.disabled })[st]

/** wallet short and «direct buy» off: the min/max top-up message */
async function insufficient(c) {
  const T = c.T
  const pay = async (name) => agentOf((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${name}`))?.ValuePay, c.user.agent)
  await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.Balance.insufficientbalance, numberFormat(await pay('minbalance')), numberFormat(await pay('maxbalance'))), backTo(c, 'account'), 'HTML')
  await step(c, 'getprice')
}
const discountMsg = (c) => sendmessage(c.from_id, sprintf(c.T.users.Discount.discountapplied, c.user.pricediscount), null, 'HTML')

export const manageRoutes = [
  // changelink_: warning
  async (c) => {
    const m = /changelink_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    if (d.status === 'disabled' || d.status === 'on_hold') { await sendmessage(c.from_id, T.users.changeLink.serviceInactive, null, 'html'); return true }
    const kb = J({ inline_keyboard: [[{ text: T.users.changeLink.confirm, callback_data: 'confirmchange_' + inv.id_invoice }], [{ text: T.users.status.backinfo, callback_data: 'product_' + inv.id_invoice }]] })
    await Editmessagetext(c.from_id, c.message_id, T.users.changeLink.warnchange, kb)
    return true
  },
  // confirmchange_: revoke the subscription
  async (c) => {
    const m = /confirmchange_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    const panel = (await panelBy(inv.Service_location)) || {}
    const d = await revokeSub(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.changeLink.error, null, 'HTML'); return true }
    let text = T.users.changeLink.updated
    if (panel.sublink === 'onsublink') text += strtr(T.users.status.subscriptionLine, { '{output_config_link}': d.subscription_url })
    if (panel.config === 'onconfig') await Editmessagetext(c.from_id, c.message_id, text, await keyboardConfig(T, d.configs ?? [], inv.id_invoice, true))
    else await Editmessagetext(c.from_id, c.message_id, text, backTo(c, 'product_' + inv.id_invoice))
    await sendWireguardFiles(T, c.from_id, d.wireguard ?? [], inv.username)
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.linkChanged, c.from_id, c.username, inv.username, c.first_name, panel.name_panel, c.user.agent, jdate('Y/m/d H:i:s')))
    return true
  },
  // Extra_volume_: the price per GB, ask the GB
  async (c) => {
    const m = /Extra_volume_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    const panel = (await panelBy(inv.Service_location)) || {}
    if (panel.status_extend === 'off_extend') { await sendmessage(c.from_id, T.users.extraVolume.notSupportedPanel, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    await run(sql`UPDATE user SET Processing_value = ${inv.id_invoice} WHERE id = ${c.from_id}`)
    await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.extraVolume.prompt, agentOf(panel.priceextravolume, c.user.agent)), backTo(c, 'product_' + inv.id_invoice))
    await step(c, 'getvolumeextra')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getvolumeextra') return false
    const T = c.T, backuser = backuserKb(c)
    if (!ctypeDigit(c.text)) { await sendmessage(c.from_id, T.common.invalidVolume, backuser, 'HTML'); return true }
    if (Number(c.text) < 1) { await sendmessage(c.from_id, T.users.extraVolume.invalidprice, backuser, 'HTML'); return true }
    const inv = (await invoiceBy(c.user.Processing_value)) || {}
    const panel = (await panelBy(inv.Service_location)) || {}
    const per = agentOf(panel.priceextravolume, c.user.agent)
    const price = n(per) * Number(c.text)
    const kb = J({ inline_keyboard: [[{ text: T.users.extraVolume.extracheck, callback_data: 'confirmaextra-' + pstr(price) }]] })
    await sendmessage(c.from_id, sprintf(T.users.extraVolume.invoiceCreated, numberFormat(n(per), 0), c.text, numberFormat(price, 0)), kb, 'HTML')
    await step(c, 'home')
    return true
  },
  // confirmaextra-<price>: pay and add the GB
  async (c) => {
    const m = /confirmaextra-(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    let volume = m[1]
    const inv = await invoiceBy(user.Processing_value)
    if (!own(inv, c)) return true
    if (!LIVE.includes(inv.Status)) { await sendmessage(c.from_id, T.users.sell.purchaseError, null, 'HTML'); return true }
    const panel = (await panelBy(inv.Service_location)) || {}
    const per = agentOf(panel.priceextravolume, user.agent)
    if (n(user.Balance) < n(volume) && user.agent !== 'n2') {
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') { await insufficient(c); return true }
      const gb = intval(volume) / intval(per)
      if (intval(user.pricediscount) !== 0) { volume = n(volume) - (n(volume) * n(user.pricediscount)) / 100; await discountMsg(c) }
      await run(sql`UPDATE user SET Processing_value = ${pstr(n(volume) - n(user.Balance))} WHERE id = ${c.from_id}`)
      await Editmessagetext(c.from_id, c.message_id, T.users.sell.noCredit, await stepPaymentKb(c))
      await step(c, 'get_step_payment')
      await run(sql`UPDATE user SET Processing_value_one = ${`${inv.username}%${pstr(gb)}`}, Processing_value_tow = 'getextravolumeuser' WHERE id = ${c.from_id}`)
      return true
    }
    await deletemessage(c.from_id, c.message_id)
    let last = volume
    if (intval(user.pricediscount) !== 0) { last = n(volume) - (n(volume) * n(user.pricediscount)) / 100; await discountMsg(c) }
    if (!(await deductBalance(user, last))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    const gb = intval(volume) / intval(per)
    const value = JSON.stringify({ volume_value: gb, 'priceـper_gig': per, old_volume: d.data_limit ?? null, expire_old: d.expire ?? null })
    const ex = await extraVolume(inv.username, panel.code_panel, gb)
    if (ex.status === false) {
      await addBalance(c.from_id, last)
      await sendmessage(c.from_id, T.users.extraVolume.serviceError, null, 'HTML')
      await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorExtraVolume, panel.name_panel, inv.username, phpJson(ex.msg)))
      return true
    }
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (${c.from_id}, ${inv.username}, ${value}, 'extra_user', ${tehranDate()}, ${pstr(last)}, ${JSON.stringify(ex)})`)
    if (intval(c.setting.scorestatus) === 1 && !c.isAdmin) {
      await sendmessage(c.from_id, T.users.affiliates.pointsEarned1Alt, null, 'html')
      await run(sql`UPDATE user SET score = ${n(user.score) + 1} WHERE id = ${c.from_id}`)
    }
    const fmt = numberFormat(n(last), 0)
    const gbs = n(volume) / n(per)
    await sendmessage(c.from_id, sprintf(T.users.extraVolume.success, inv.username, gbs, fmt), backToService(c, inv), 'HTML')
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.extraVolume, c.from_id, gbs, fmt, inv.username, user.Balance))
    return true
  },
  // changeloc_: pick the new location
  async (c) => {
    const m = /changeloc_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    const lim = parseJson(c.setting.limitnumber)
    if (n(user.limitchangeloc) > n(lim.all) && intval(c.setting.statuslimitchangeloc) === 1) { await sendmessage(c.from_id, T.users.changeLocation.limitReached, null, 'html'); return true }
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    await run(sql`UPDATE user SET Processing_value = ${inv.id_invoice} WHERE id = ${c.from_id}`)
    const panel = (await panelBy(inv.Service_location)) || {}
    if (panel.changeloc === 'offchangeloc') { await sendmessage(c.from_id, T.users.featureUnavailable2, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful' || d.status === 'disabled') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    await Editmessagetext(c.from_id, c.message_id, T.textbot.selectLocation, (await panelLists(c)).list_marzban_panel_userschange)
    return true
  },
  async (c) => {
    const m = /changelocselectlo-(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    await run(sql`UPDATE user SET Processing_value_one = ${m[1]} WHERE id = ${c.from_id}`)
    const lim = parseJson(c.setting.limitnumber)
    const left = n(lim.all) - n(user.limitchangeloc)
    const free = Math.max(0, n(lim.free) - n(user.limitchangeloc))
    const price = (await one(sql`SELECT priceChangeloc FROM marzban_panel WHERE code_panel = ${m[1]}`))?.priceChangeloc ?? null
    const kb = J({ inline_keyboard: [[{ text: T.users.changeLocation.confirm, callback_data: 'confirmchangeloccha_' + user.Processing_value }], [{ text: T.users.status.backinfo, callback_data: 'product_' + user.Processing_value }]] })
    await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.changeLocation.confirmPrompt, price, left, free), kb)
    return true
  },
  // confirmchangeloccha_: move the service to the new panel
  async (c) => {
    const m = /confirmchangeloccha_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    const oldP = (await panelBy(inv.Service_location)) || {}
    const newP = await one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${user.Processing_value_one ?? null}`)
    const lim = parseJson(c.setting.limitnumber)
    const limited = intval(c.setting.statuslimitchangeloc) === 1
    const limitfree = !(n(user.limitchangeloc) < n(lim.free) && limited)
    if (n(user.limitchangeloc) >= n(lim.all) && limited) { await sendmessage(c.from_id, T.users.changeLocation.limitReached, null, 'html'); return true }
    if (newP && newP.changeloc === 'offchangeloc') { await sendmessage(c.from_id, T.users.featureUnavailable2, null, 'html'); return true }
    if (!newP) { await sendmessage(c.from_id, T.users.genericRestart, null, 'html'); return true }
    let price = newP.priceChangeloc
    const custom = eq(inv.name_product, T.users.customSellVolume.btnVolume) || eq(inv.name_product, T.users.customSellVolume.btnService)
    const prod = custom ? { code_product: T.users.customSellVolume.btnVolume }
      : await one(sql`SELECT * FROM product WHERE (Location = ${inv.Service_location} OR Location = '/all') AND agent = ${user.agent} AND name_product = ${inv.name_product}`)
    if (newP.type === 'Manualsale' && oldP.url_panel === newP.url_panel) { await sendmessage(c.from_id, T.users.changeLocation.notPossible, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'on_hold') { await sendmessage(c.from_id, T.users.changeLocation.configUnused, null, 'html'); return true }
    if (d.status !== 'active') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    if (!limitfree) price = 0
    if (n(user.Balance) < n(price) && user.agent !== 'n2' && limitfree) {
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') { await insufficient(c); return true }
      if (intval(user.pricediscount) !== 0) { price = n(price) - (n(price) * n(user.pricediscount)) / 100; await discountMsg(c) }
      if (intval(price) !== 0) {
        await run(sql`UPDATE user SET Processing_value = ${pstr(n(price) - n(user.Balance))} WHERE id = ${c.from_id}`)
        await Editmessagetext(c.from_id, c.message_id, T.users.sell.noCredit, await stepPaymentKb(c))
        await step(c, 'get_step_payment')
        return true
      }
    }
    if (intval(user.pricediscount) !== 0 && intval(price) !== 0) { price = n(price) - (n(price) * n(user.pricediscount)) / 100; await discountMsg(c) }
    if (!(await deductBalance(user, price))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    const value = JSON.stringify({ old_panel: oldP.code_panel ?? null, new_panel: newP.code_panel, volume: d.data_limit ?? null, used_traffic: d.used_traffic ?? null, expire: d.expire ?? null, stateus: d.status })
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price) VALUES (${c.from_id}, ${inv.username}, ${value}, 'change_location', ${tehranDate()}, ${prod ? prod.price_product ?? null : null})`)
    const dataLimit = nullish(d.data_limit) ? 0 : n(d.data_limit) - n(d.used_traffic)
    const cfg = { expire: d.expire, data_limit: dataLimit, from_id: c.from_id, username: c.username, type: 'usertest' }
    const { expirationDate, day, Remaining } = summaryParts(c, d)
    const fail = async (out) => {
      await addBalance(c.from_id, price)
      await sendmessage(c.from_id, T.users.sell.errorConfig, c.keyboard, 'HTML')
      await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorChangeLocation, phpJson(out.msg ?? null), c.from_id, c.username, oldP.name_panel, newP.name_panel))
    }
    const opts = { domain: c.domain, customLabel: T.users.customSellVolume.btnVolume }
    let out
    if (oldP.url_panel === newP.url_panel) {
      await removeUser(inv.Service_location, inv.username)
      out = await createUserFor(newP.name_panel, 'usertest', d.username, cfg, opts)
      if (out.username == null) { await fail(out); return true }
    } else {
      out = await createUserFor(newP.name_panel, 'usertest', d.username, cfg, opts)
      if (out.username == null) { await fail(out); return true }
      await removeUser(inv.Service_location, inv.username)
    }
    let links = newP.sublink === 'onsublink' ? out.subscription_url : ''
    if (newP.config === 'onconfig' && Array.isArray(out.configs)) for (const l of out.configs) links += '\n' + l
    await run(sql`UPDATE user SET limitchangeloc = ${n(user.limitchangeloc) + 1} WHERE id = ${c.from_id}`)
    const text = sprintf(T.users.changeLocation.success, newP.name_panel, inv.username, Remaining, expirationDate, day, links)
    await run(sql`UPDATE invoice SET Service_location = ${newP.name_panel} WHERE username = ${inv.username}`)
    if (newP.inboundid != null) await run(sql`UPDATE invoice SET inboundid = ${newP.inboundid} WHERE username = ${inv.username}`)
    await Editmessagetext(c.from_id, c.message_id, text, backTo(c, 'product_' + inv.id_invoice))
    await sendWireguardFiles(T, c.from_id, out.wireguard ?? [], inv.username)
    const bal = numberFormat(n((await one(sql`SELECT Balance FROM user WHERE id = ${c.from_id}`))?.Balance), 0)
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.locationChanged, c.from_id, c.username, oldP.name_panel, newP.name_panel, inv.username, formatBytes(T, dataLimit), bal))
    return true
  },
  // disorder-: report a problem
  async (c) => {
    const m = /disorder-(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    await Editmessagetext(c.from_id, c.message_id, T.users.support.disruptionPrompt, backTo(c, 'product_' + m[1]))
    await step(c, 'getdesdisorder')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getdesdisorder') return false
    const T = c.T, id = c.user.Processing_value
    await run(sql`UPDATE user SET Processing_value = ${c.text} WHERE id = ${c.from_id}`)
    const inv = (await invoiceBy(id)) || {}
    const d = await dataUser(inv.Service_location ?? null, inv.username ?? null, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    const kb = J({ inline_keyboard: [[{ text: T.keyboard.confirmDisruptionReport, callback_data: 'confirmdisorders-' + id }], [{ text: T.users.status.backinfo, callback_data: 'product_' + id }]] })
    await sendmessage(c.from_id, T.users.support.disruptionConfirm, kb, 'html')
    await step(c, 'home')
    return true
  },
  async (c) => {
    const m = /confirmdisorders-(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, S = T.users.status
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    const kb = J({ inline_keyboard: [[{ text: T.users.support.answermessage, callback_data: 'Response_' + c.from_id }]] })
    let text = sprintf(T.Admin.reportgroup.disruption, c.username, c.from_id, inv.username, inv.name_product, inv.Service_location, c.user.Processing_value)
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    const p = summaryParts(c, d)
    const statusVar = statusName(S, d.status ?? 'Unknown') ?? S.unknown
    const lastupdate = d.sub_updated_at !== null && d.sub_updated_at !== undefined ? jdate('Y/m/d H:i:s', utcSec(d.sub_updated_at)) : ''
    let Percent = !nullish(d.data_limit) && !nullish(d.used_traffic) ? ((n(d.data_limit) - n(d.used_traffic)) * 100) / n(d.data_limit) : 100
    if (Percent < 0) Percent = -Percent
    Percent = phpFloat(phpRound(Percent, 2))
    text += sprintf(S.summary, statusVar, p.LastTraffic, p.used, p.Remaining, Percent, p.expirationDate, p.day, d.subscription_url, p.lastonline, lastupdate, d.sub_last_user_agent)
    for (const admin of c.admin_ids) {
      const a = await one(sql`SELECT rule FROM admin WHERE id_admin = ${admin}`)
      if (a && a.rule === 'Seller') continue
      await sendmessage(admin, text, kb, 'html')
    }
    await Editmessagetext(c.from_id, c.message_id, T.users.support.requestSubmitted, backTo(c, `product_${m[1]}`), 'html')
    return true
  },
  // Extra_time_: the price per day, ask the days
  async (c) => {
    const m = /Extra_time_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    const panel = (await panelBy(inv.Service_location)) || {}
    if (panel.status_extend === 'off_extend') { await sendmessage(c.from_id, T.users.extraTime.notSupportedPanel, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    if (d.status === 'on_hold') { await sendmessage(c.from_id, T.users.extend.connectFirst, null, 'html'); return true }
    await run(sql`UPDATE user SET Processing_value = ${inv.id_invoice} WHERE id = ${c.from_id}`)
    await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.extraTime.prompt, agentOf(panel.priceextratime, c.user.agent)), backTo(c, 'product_' + inv.id_invoice))
    await step(c, 'gettimeextra')
    return true
  },
  async (c) => {
    if (c.user.step !== 'gettimeextra') return false
    const T = c.T
    if (!ctypeDigit(c.text) || Number(c.text) < 1) { await sendmessage(c.from_id, T.common.invalidTime, backuserKb(c), 'HTML'); return true }
    const inv = (await invoiceBy(c.user.Processing_value)) || {}
    const panel = (await panelBy(inv.Service_location)) || {}
    const per = agentOf(panel.priceextratime, c.user.agent)
    const price = n(per) * Number(c.text)
    const kb = J({ inline_keyboard: [[{ text: T.users.extraTime.extratimecheck, callback_data: 'confirmaextratime-' + pstr(price) }]] })
    await sendmessage(c.from_id, sprintf(T.users.extraTime.invoiceCreated, per, c.text, numberFormat(price, 0)), kb, 'HTML')
    await step(c, 'home')
    return true
  },
  // confirmaextratime-<price>: pay and add the days
  async (c) => {
    const m = /confirmaextratime-(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    const price = m[1]
    let last = price
    const inv = await invoiceBy(user.Processing_value)
    if (!own(inv, c)) return true
    if (!LIVE.includes(inv.Status)) { await sendmessage(c.from_id, T.users.sell.purchaseError, null, 'HTML'); return true }
    const panel = (await panelBy(inv.Service_location)) || {}
    const per = agentOf(panel.priceextratime, user.agent)
    if (n(user.Balance) < n(price) && user.agent !== 'n2') {
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') { await insufficient(c); return true }
      const days = n(price) / n(per)
      if (intval(user.pricediscount) !== 0) { last = n(price) - (n(price) * n(user.pricediscount)) / 100; await discountMsg(c) }
      if (intval(last) !== 0) {
        await run(sql`UPDATE user SET Processing_value = ${pstr(n(last) - n(user.Balance))} WHERE id = ${c.from_id}`)
        await Editmessagetext(c.from_id, c.message_id, T.users.sell.noCredit, await stepPaymentKb(c))
        await step(c, 'get_step_payment')
        await run(sql`UPDATE user SET Processing_value_one = ${`${inv.username}%${pstr(days)}`}, Processing_value_tow = 'getextratimeuser' WHERE id = ${c.from_id}`)
        return true
      }
    }
    await deletemessage(c.from_id, c.message_id)
    if (intval(user.pricediscount) !== 0 && intval(last) !== 0) { last = n(price) - (n(price) * n(user.pricediscount)) / 100; await discountMsg(c) }
    if (!(await deductBalance(user, last))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    await run(sql`UPDATE invoice SET Status = 'active' WHERE id_invoice = ${inv.id_invoice}`)
    const days = n(price) / n(per)
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    const value = JSON.stringify({ day: days, 'priceـper_day': days, old_volume: d.data_limit ?? null, expire_old: d.expire ?? null })
    const ex = await extraTime(inv.username, panel.code_panel, days)
    if (ex.status === false) {
      await addBalance(c.from_id, last)
      await sendmessage(c.from_id, T.users.extraVolume.serviceError, null, 'HTML')
      await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorExtraTime, panel.name_panel, inv.username, phpJson(ex.msg)))
      return true
    }
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (${c.from_id}, ${inv.username}, ${value}, 'extra_time_user', ${tehranDate()}, ${pstr(last)}, ${JSON.stringify(ex)})`)
    if (intval(c.setting.scorestatus) === 1 && !c.isAdmin) {
      await sendmessage(c.from_id, T.users.affiliates.pointsEarned1Alt, null, 'html')
      await run(sql`UPDATE user SET score = ${n(user.score) + 1} WHERE id = ${c.from_id}`)
    }
    const fmt = numberFormat(n(price))
    await sendmessage(c.from_id, sprintf(T.users.extraTime.success, inv.username, days, fmt), backToService(c, inv), 'HTML')
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.extraTime, c.from_id, days, fmt, inv.username))
    return true
  },
  // removeserviceuser_: ask why
  async (c) => {
    const m = /removeserviceuser_(\w+)/.exec(c.datain)
    if (!m) return false
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    await savedata(c, 'clear', 'id_invoice', m[1])
    await Editmessagetext(c.from_id, c.message_id, c.T.users.status.askDeleteReason, backTo(c, 'product_' + inv.id_invoice))
    await step(c, 'getdisdeleteconfig')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getdisdeleteconfig') return false
    const T = c.T
    const id = userData(c).id_invoice ?? null
    await savedata(c, 'save', 'descritionsremove', c.text)
    const inv = (await invoiceBy(id)) || {}
    if (eq(inv.name_product, T.common.labels.testService3)) { await sendmessage(c.from_id, T.users.status.errorusertest, null, 'html'); return true }
    const d = await dataUser(inv.Service_location ?? null, inv.username ?? null, c.domain)
    if (['expired', 'limited', 'disabled'].includes(d.status)) { await sendmessage(c.from_id, T.users.status.error, null, 'html'); await step(c, 'home'); return true }
    const pending = Number((await one(sql`SELECT COUNT(*) AS n FROM cancel_service WHERE username = ${inv.username ?? null}`)).n)
    if (pending !== 0) { await sendmessage(c.from_id, T.users.status.errorexits, null, 'html'); return true }
    await sendmessage(c.from_id, T.users.status.descriptionsRemoveService, J({ inline_keyboard: [[{ text: T.keyboard.confirmDeleteService, callback_data: `confirmremoveservices-${id ?? ''}` }]] }), 'html')
    await step(c, 'home')
    return true
  },
  // confirmremoveservices-: the request goes to the admins
  async (c) => {
    const m = /confirmremoveservices-(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, S = T.users.status
    const ud = userData(c)
    const waiting = Number((await one(sql`SELECT COUNT(*) AS n FROM cancel_service WHERE id_user = ${c.from_id} AND status = 'waiting'`)).n)
    if (waiting !== 0) { await sendmessage(c.from_id, S.exitsRequests, null, 'HTML'); return true }
    const inv = (await invoiceBy(m[1])) || {}
    await run(sql`INSERT OR IGNORE INTO cancel_service (id_user, username, description, status) VALUES (${c.from_id}, ${inv.username ?? null}, '0', 'waiting')`)
    const d = await dataUser(inv.Service_location ?? null, inv.username ?? null, c.domain)
    if (d.msg === 'User not found') { await sendmessage(c.from_id, S.userNotFound, null, 'html'); await step(c, 'home'); return true }
    if (d.status === 'Unsuccessful') { await sendmessage(c.from_id, S.panelNotConnected, null, 'html'); await step(c, 'home'); return true }
    const p = summaryParts(c, d)
    const text = sprintf(T.Admin.reportgroup.deleteServiceRequest, c.from_id, c.username, inv.username, statusName(S, d.status), inv.Service_location, inv.id_invoice, p.lastonline, p.used, p.LastTraffic, p.Remaining, p.expirationDate, p.day, ud.descritionsremove)
    const kb = J({ inline_keyboard: [[
      { text: T.keyboard.manualDelete, callback_data: `remoceserviceadminmanual-${inv.id_invoice ?? ''}` },
      { text: T.keyboard.deleteServiceAlt, callback_data: `remoceserviceadmin-${inv.id_invoice ?? ''}` },
      { text: T.keyboard.rejectDelete, callback_data: `rejectremoceserviceadmin-${inv.id_invoice ?? ''}` },
    ]] })
    for (const admin of c.admin_ids) { await sendmessage(admin, text, kb, 'html'); await step(c, 'home', admin) }
    await deletemessage(c.from_id, c.message_id)
    await sendmessage(c.from_id, S.sendrequestsremove, c.keyboard, 'html')
    return true
  },
  // transfer_: ask the new owner's id
  async (c) => {
    const m = /transfer_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    if (eq(inv.name_product, T.common.labels.testService4)) { await sendmessage(c.from_id, T.users.transfer.transferNotValid, null, 'html'); return true }
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (['expired', 'limited', 'disabled'].includes(d.status)) { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    await Editmessagetext(c.from_id, c.message_id, T.users.transfer.description, backTo(c, 'product_' + inv.id_invoice))
    await step(c, 'getidfortransfer')
    await run(sql`UPDATE user SET Processing_value_one = ${inv.username}, Processing_value_tow = ${inv.id_invoice} WHERE id = ${c.from_id}`)
    return true
  },
  async (c) => {
    if (c.user.step !== 'getidfortransfer') return false
    const T = c.T
    if (!(await one(sql`SELECT 1 AS x FROM user WHERE id = ${c.text} LIMIT 1`))) { await sendmessage(c.from_id, T.users.transfer.notUserTrans, backuserKb(c), 'HTML'); return true }
    await run(sql`UPDATE user SET Processing_value_one = ${c.text} WHERE id = ${c.from_id}`)
    await sendmessage(c.from_id, T.users.transfer.confirm, J({ inline_keyboard: [[{ text: T.keyboard.confirmTransferService, callback_data: `confrimtransfers_${c.user.Processing_value_tow ?? ''}` }]] }), 'HTML')
    await step(c, 'home')
    return true
  },
  async (c) => {
    const m = /confrimtransfers_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, to = String(c.user.Processing_value_one ?? '')
    if (c.from_id === to) { await sendmessage(c.from_id, T.users.transfer.notSendServiceYou, c.keyboard, 'HTML'); return true }
    const inv = await invoiceBy(m[1])
    if (!own(inv, c)) return true
    await run(sql`UPDATE invoice SET id_user = ${to} WHERE id_invoice = ${m[1]}`)
    await Editmessagetext(c.from_id, c.message_id, T.users.transfer.confirmed, backTo(c, 'backorder'))
    await sendmessage(to, strtr(T.users.transfer.receivedNotice, { '{service_username}': inv.username, '{from_id}': c.from_id }), c.keyboard, 'HTML')
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price) VALUES (${c.from_id}, ${inv.username}, ${to}, 'transfertouser', ${tehranDate()}, '0')`)
    return true
  },
]

function parseJson(s) { try { const d = JSON.parse(s); return d && typeof d === 'object' ? d : {} } catch { return {} } }
const backToService = (c, inv) => J({ inline_keyboard: [[{ text: c.T.users.status.backservice, callback_data: 'product_' + inv.id_invoice }]] })
