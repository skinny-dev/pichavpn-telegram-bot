// My services: list, pages, search by name, a service's page — index.php lines 416–1153
import { one, all, run, sql } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { sendStartMessage, step, shop } from '../bot.js'
import { panelLists, backuserKb } from '../keyboards.js'
import { dataUser } from '../panel.js'
import { jdate, formatBytes, phpFloat, phpRound } from '../fmt.js'
import { sprintf, strtr, time, intval, J } from '../php.js'

const LIVE = `(status = 'active' OR status = 'end_of_time' OR status = 'end_of_volume' OR status = 'sendedwarn' OR status = 'send_on_hold')`

async function serviceRows(c, start, per) {
  return all(sql`SELECT * FROM invoice WHERE id_user = ${c.from_id} AND ${sql.raw(LIVE)} ORDER BY time_sell DESC LIMIT ${per} OFFSET ${start}`)
}
function serviceButtons(c, rows) {
  return rows.map((r) => [{ text: '✨' + r.username + (c.setting.statusnamecustom === 'onnamecustom' ? ` | ${r.note ?? ''}` : '') + '✨', callback_data: 'product_' + r.id_invoice }])
}
/** PHP '' / null / false / 0 are all "empty" */
const empty = (v) => v === null || v === undefined || v === '' || v === false || v === 0 || v === '0'
const nullish = (v) => v === null || v === undefined || v === '' || v === false || v === 0 // `== null`

export const services = [
  // phone number (contact) step
  async (c) => {
    if (c.user.step !== 'get_number') return false
    const T = c.T
    const rc = c.request_contact
    if (empty(c.user_phone)) { await sendmessage(c.from_id, T.users.number.false, rc, 'html'); return true }
    if (String(c.contact_id) !== c.from_id) { await sendmessage(c.from_id, T.users.number.warning, rc, 'html'); return true }
    if (c.setting.iran_number === 'onAuthenticationiran' && !/989[0-9]{9}$/.test(String(c.user_phone))) { await sendmessage(c.from_id, T.users.number.erroriran, rc, 'html'); return true }
    await sendmessage(c.from_id, T.users.number.active, J({ inline_keyboard: [], remove_keyboard: true }), 'html')
    await sendStartMessage(c, c.from_id, c.keyboard)
    await run(sql`UPDATE user SET number = ${c.user_phone} WHERE id = ${c.from_id}`)
    await step(c, 'home')
    return true
  },
  // the list
  async (c) => {
    const T = c.T
    if (!(c.text === T.textbot.purchasedServices || c.datain === 'backorder' || c.text === '/services')) return false
    await run(sql`UPDATE user SET pagenumber = 1 WHERE id = ${c.from_id}`)
    const kb = { inline_keyboard: serviceButtons(c, await serviceRows(c, 0, 20)) }
    if (c.setting.NotUser === 'onnotuser') kb.inline_keyboard.push([{ text: T.users.page.notusernameme, callback_data: 'notusernameme' }])
    kb.inline_keyboard.push([{ text: T.users.page.next, callback_data: 'next_page' }, { text: T.users.search.title, callback_data: 'searchservice' }])
    kb.inline_keyboard.push([{ text: T.keyboard.backToMainMenu, callback_data: 'backuser' }])
    if (c.datain === 'backorder') await Editmessagetext(c.from_id, c.message_id, T.users.sell.service_sell, J(kb))
    else await sendmessage(c.from_id, T.users.sell.service_sell, J(kb), 'html')
    return true
  },
  // next / previous page
  async (c) => {
    if (c.datain !== 'next_page' && c.datain !== 'previous_page') return false
    const T = c.T
    const numpage = (await one(sql`SELECT COUNT(id_user) AS n FROM invoice WHERE id_user = ${c.from_id}`)).n
    const page = intval(c.user.pagenumber)
    const sum = page * 20
    let target
    if (c.datain === 'next_page') target = sum > numpage ? 1 : page + 1
    else { target = sum > numpage ? 1 : page - 1; if (target < 1) target = 1 }
    const kb = { inline_keyboard: serviceButtons(c, await serviceRows(c, (target - 1) * 20, 20)) }
    kb.inline_keyboard.push([{ text: T.users.search.title, callback_data: 'searchservice' }])
    if (c.setting.NotUser === 'onnotuser') kb.inline_keyboard.push([{ text: T.users.page.notusernameme, callback_data: 'notusernameme' }])
    kb.inline_keyboard.push([{ text: T.users.page.next, callback_data: 'next_page' }, { text: T.users.page.previous, callback_data: 'previous_page' }])
    kb.inline_keyboard.push([{ text: T.keyboard.backToMainMenu, callback_data: 'backuser' }])
    await run(sql`UPDATE user SET pagenumber = ${target} WHERE id = ${c.from_id}`)
    await Editmessagetext(c.from_id, c.message_id, T.users.sell.service_sell, J(kb))
    return true
  },
  // a service that is on the panel but not in my list
  async (c) => {
    if (c.datain !== 'notusernameme') return false
    await sendmessage(c.from_id, c.T.users.status.sendUsername, backuserKb(c), 'html')
    await step(c, 'getusernameinfo')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getusernameinfo') return false
    if (empty(c.text)) return true
    await run(sql`UPDATE user SET Processing_value = ${c.text} WHERE id = ${c.from_id}`)
    await sendmessage(c.from_id, c.T.textbot.selectLocation, (await panelLists(c)).list_marzban_panel_user, 'html')
    await step(c, 'getdata')
    return true
  },
  async (c) => {
    const m = /locationnotuser_(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const panel = await one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${m[1]}`)
    await run(sql`UPDATE user SET Processing_value_four = ${panel?.code_panel ?? null} WHERE id = ${c.from_id}`)
    const d = await dataUser(panel?.name_panel, c.user.Processing_value, c.domain)
    if (d.status === 'Unsuccessful') {
      await sendmessage(c.from_id, d.msg === 'User not found' ? T.users.status.notUsernameGet : T.users.status.error, c.keyboard, 'html')
      await step(c, 'home')
      return true
    }
    const S = T.users.status
    const statusVar = { active: S.active, limited: S.limited, disabled: S.disabled, deactivev: S.disabled, expired: S.expired, on_hold: S.on_hold, Unknown: S.unknown }[d.status] ?? null
    const expirationDate = d.expire ? jdate('Y/m/d', d.expire) : S.unlimited
    const LastTraffic = d.data_limit ? formatBytes(T, d.data_limit) : S.unlimited
    const Remaining = d.data_limit ? formatBytes(T, Number(d.data_limit) - Number(d.used_traffic || 0)) : T.common.labels.unlimitedShort
    const used = d.used_traffic ? formatBytes(T, d.used_traffic) : S.notConsumed
    const day = d.expire ? Math.floor((Number(d.expire) - time()) / 86400) + S.day : S.unlimited
    const kb = { inline_keyboard: [
      [{ text: d.username, callback_data: 'username' }, { text: S.username, callback_data: 'username' }],
      [{ text: statusVar, callback_data: 'status_var' }, { text: S.stateus, callback_data: 'status_var' }],
      [{ text: expirationDate, callback_data: 'expirationDate' }, { text: S.expirationDate, callback_data: 'expirationDate' }],
      [],
      [{ text: day, callback_data: T.common.units.dayShort }, { text: S.daysleft, callback_data: 'day' }],
      [{ text: LastTraffic, callback_data: 'LastTraffic' }, { text: S.lastTraffic, callback_data: 'LastTraffic' }],
      [{ text: used, callback_data: 'expirationDate' }, { text: S.usedTrafficGb, callback_data: 'expirationDate' }],
      [{ text: Remaining, callback_data: 'RemainingVolume' }, { text: S.remainingVolume, callback_data: 'RemainingVolume' }],
    ] }
    if ((await shop('statusextra')) === 'onextra') {
      kb.inline_keyboard.push([{ text: T.users.extend.title, callback_data: 'extends_' + d.username + '_' + m[1] }, { text: T.users.extraVolume.sellextra, callback_data: 'Extra_volumes_' + d.username + '_' + m[1] }])
    } else kb.inline_keyboard.push([{ text: T.users.extend.title, callback_data: 'extends_' + d.username + '_' + m[1] }])
    await Editmessagetext(c.from_id, c.message_id, S.info, J(kb))
    await sendmessage(c.from_id, T.users.selectoption, c.keyboard, 'html')
    await step(c, 'home')
    return true
  },
  // a service's page (also: refresh, search result, back from config)
  async (c) => {
    const m1 = /^product_(\w+)/.exec(c.datain), m2 = /updateproduct_(\w+)/.exec(c.datain)
    const m = m1 || m2
    if (!(m || c.user.step === 'getuseragnetservice' || c.datain === 'productcheckdata')) return false
    return servicePage(c, m)
  },
]

async function servicePage(c, m) {
  const T = c.T, S = T.users.status
  let rows
  if (c.user.step === 'getuseragnetservice') {
    const q = escHtml(c.text)
    rows = await all(sql`SELECT * FROM invoice WHERE (username LIKE '%' || ${q} || '%' OR note LIKE '%' || ${q} || '%' OR Volume LIKE '%' || ${q} || '%' OR Service_time LIKE '%' || ${q} || '%') AND id_user = ${c.from_id} AND ${sql.raw(LIVE)}`)
  } else if (c.datain === 'productcheckdata') {
    rows = await all(sql`SELECT * FROM invoice WHERE username = ${c.user.Processing_value} AND id_user = ${c.from_id}`)
  } else if (c.datain[0] === 'u') {
    rows = await all(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]} AND id_user = ${c.from_id}`)
    await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id, text: T.keyboard.infoRefreshed, show_alert: false, cache_time: 5 })
  } else {
    rows = await all(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]} AND id_user = ${c.from_id}`)
  }
  if (c.user.step === 'getuseragnetservice' && rows.length > 1) {
    await run(sql`UPDATE user SET pagenumber = 1 WHERE id = ${c.from_id}`)
    const kb = { inline_keyboard: serviceButtons(c, rows) }
    if (c.setting.NotUser === 'onnotuser') kb.inline_keyboard.push([{ text: T.users.page.notusernameme, callback_data: 'notusernameme' }])
    kb.inline_keyboard.push([{ text: T.keyboard.backToMainMenu, callback_data: 'backuser' }])
    await sendmessage(c.from_id, strtr(S.servicesFound, { '{countservice}': rows.length }), J(kb), 'html')
    await step(c, 'home')
    return true
  }
  const inv = rows[0]
  if (!inv || !['active', 'end_of_time', 'end_of_volume', 'sendedwarn', 'send_on_hold'].includes(inv.Status)) {
    await sendmessage(c.from_id, S.infoUnavailable, c.keyboard, 'html')
    await step(c, 'home')
    return true
  }
  const id = inv.id_invoice
  const panel = (await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${inv.Service_location}`)) || {}
  if (panel.name_panel != null) await run(sql`UPDATE user SET Processing_value_four = ${panel.name_panel} WHERE id = ${c.from_id}`)
  const d = await dataUser(inv.Service_location, inv.username, c.domain)
  if (d.msg === 'User not found') {
    await run(sql`UPDATE invoice SET Status = 'disabledn' WHERE id_invoice = ${inv.id_invoice}`)
    await sendmessage(c.from_id, S.userNotFound, c.keyboard, 'html')
    await step(c, 'home')
    return true
  }
  if (d.status === 'Unsuccessful') {
    await sendmessage(c.from_id, S.panelNotConnected, c.keyboard, 'html')
    await step(c, 'home')
    return true
  }
  let lastonline
  if (d.online_at === 'online') lastonline = T.common.connection.onlineAlt
  else if (d.online_at === 'offline') lastonline = T.common.connection.offlineAlt
  else if (d.online_at !== undefined && d.online_at !== null) lastonline = jdate('Y/m/d H:i:s', utcSec(d.online_at))
  else lastonline = T.common.connection.notConnectedAlt
  const status = d.status ?? 'Unknown'
  const statusVar = { active: S.active, limited: S.limited, disabled: S.disabled, expired: S.expired, on_hold: S.on_hold, Unknown: S.unknown, deactivev: S.disabled }[status] ?? S.unknown
  const expirationDate = d.expire ? jdate('Y/m/d', d.expire) : S.unlimited
  const LastTraffic = d.data_limit ? formatBytes(T, d.data_limit) : S.unlimited
  const Remaining = d.data_limit ? formatBytes(T, Number(d.data_limit) - Number(d.used_traffic || 0)) : T.common.labels.unlimitedShort
  const used = d.used_traffic ? formatBytes(T, d.used_traffic) : S.notConsumed
  const timeDiff = Number(d.expire || 0) - time()
  let day
  if (timeDiff < 0) day = 0
  else {
    day = ''
    const months = Math.floor(timeDiff / 2592000)
    let rest = timeDiff
    if (months > 0) { day += months + S.month; rest = timeDiff - 2592000 * months }
    const days = Math.floor(rest / 86400)
    if (days > 0) day += days + S.day
    const hours = Math.trunc((rest - days * 86400) / 3600)
    if (hours > 0) day += hours + S.hour
    const mins = Math.trunc((rest - days * 86400 - hours * 3600) / 60)
    if (mins > 0) day += mins + S.min
    day += T.common.labels.remainingSuffix
  }
  let lastupdate = ''
  if (d.sub_updated_at !== null && d.sub_updated_at !== undefined) lastupdate = jdate('Y/m/d H:i:s', utcSec(d.sub_updated_at))
  let Percent
  if (!nullish(d.data_limit) && !nullish(d.used_traffic)) Percent = ((Number(d.data_limit) - Number(d.used_traffic)) * 100) / Number(d.data_limit)
  else Percent = 100
  if (Percent < 0) Percent = -Percent
  Percent = phpFloat(phpRound(Percent, 2))
  let kbs = J({ inline_keyboard: [[{ text: S.backlist, callback_data: 'backorder' }]] })
  const userpassword = panel.type === 'ibsng' || panel.type === 'mikrotik' ? strtr(S.servicePassword, { '{subscription_url}': d.subscription_url }) : ''
  if (panel.type === 'Manualsale') {
    const ui = (await one(sql`SELECT * FROM manualsell WHERE username = ${inv.username}`)) || {}
    const textinfo = sprintf(S.infoBasic, statusVar, d.username, inv.id_invoice, ui.contentrecord)
    await show(c, textinfo, kbs)
    return true
  }
  const nameconfig = !nullish(inv.note) ? strtr(S.configNote, { '{note}': inv.note }) : ''
  const so = await one(sql`SELECT value FROM service_other WHERE username = ${inv.username} AND type = 'extend_user' AND status = 'paid' ORDER BY time DESC`)
  if (so) {
    let v = null
    try { v = typeof so.value === 'string' ? JSON.parse(so.value) : null } catch { v = null }
    if (v && typeof v === 'object') {
      const p = await one(sql`SELECT * FROM product WHERE code_product = ${v.code_product}`)
      if (p) { inv.name_product = p.name_product; inv.Volume = p.Volume_constraint; inv.Service_time = p.Service_time }
    }
  }
  const [timeextra, extra, disorder, changeservice, showconfig, removeservice] = await Promise.all(['statustimeextra', 'statusextra', 'statusdisorder', 'statuschangeservice', 'configshow', 'backserviecstatus'].map(shop))
  let textinfo
  if (!['active', 'on_hold', 'disabled', 'Unknown'].includes(status)) {
    textinfo = sprintf(S.infoDetailed, statusVar, d.username, inv.Service_location, inv.name_product, lastonline, LastTraffic, used, Remaining, Percent, expirationDate, day, nameconfig)
    const rowsK = [
      [{ text: T.users.extend.title, callback_data: 'extend_' + id }, { text: T.users.extraVolume.sellextra, callback_data: 'Extra_volume_' + id }],
      [{ text: T.keyboard.deleteService, callback_data: 'removeauto-' + id }, { text: T.users.extraTime.title, callback_data: 'Extra_time_' + id }],
      [{ text: S.backlist, callback_data: 'backorder' }],
    ]
    const keep = rowsK.map((r) => r.map(() => true))
    let row0 = true
    if (panel.type === 'ibsng' || panel.type === 'mikrotik') { keep[1][1] = false; row0 = false }
    if (timeextra === 'offtimeextraa') keep[1][1] = false
    if (extra === 'offextra') keep[0][1] = false
    const outRows = rowsK.map((r, i) => r.filter((_, j) => keep[i][j])).filter((_, i) => i !== 0 || row0)
    kbs = J({ inline_keyboard: outRows })
  } else {
    const marzbancount = (await one(sql`SELECT COUNT(*) AS n FROM marzban_panel WHERE status = 'active'`)).n
    const namestatus = d.status === 'active' ? S.btnTurnOff : S.btnTurnOn
    const k = {
      updateinfo: [T.keyboard.refreshInfo, 'updateproduct_'], linksub: [S.linksub, 'subscriptionurl_'], config: [S.config, 'config_'],
      extend: [T.users.extend.title, 'extend_'], changelink: [T.users.changeLink.btnTitle, 'changelink_'], removeservice: [S.removeservice, 'removeserviceuser_'],
      changenameconfig: [S.btnEditNote, 'changenote_'], Extra_volume: [T.users.extraVolume.sellextra, 'Extra_volume_'], Extra_time: [T.users.extraTime.title, 'Extra_time_'],
      changestatus: [namestatus, 'changestatus_'], transfor: [T.users.transfer.title, 'transfer_'], 'change-location': [T.users.changeLocation.title, 'changeloc_'],
      ekhtelal: [T.keyboard.sendDisruptionReport, 'disorder-'],
    }
    const del = (...keys) => keys.forEach((x) => delete k[x])
    if (inv.name_product === T.common.labels.testService1) del('transfor', 'Extra_time', 'removeservice')
    if (panel.type === 'ibsng' || panel.type === 'mikrotik') del('linksub', 'config', 'extend', 'changestatus', 'change-location', 'changelink', 'Extra_volume', 'Extra_time')
    if (panel.type === 'WGDashboard') del('config', 'changestatus', 'change-location', 'changelink')
    if (panel.status_extend === 'off_extend') del('Extra_time', 'Extra_volume', 'extend')
    if (removeservice === 'off') del('removeservice')
    if (showconfig === 'offconfig') del('config')
    if (panel.type === 'hiddify') del('changelink', 'changestatus', 'config')
    if (disorder === 'offdisorder') del('ekhtelal')
    if (String(inv.Service_time) === '0') del('Extra_time')
    if (String(inv.Volume) === '0') del('Extra_volume', 'Extra_time')
    if (changeservice === 'offstatus') del('changestatus')
    if (c.setting.statusnamecustom === 'offnamecustom') del('changenameconfig')
    if (Number(marzbancount) === 1) del('change-location')
    if (panel.changeloc === 'offchangeloc') del('change-location')
    if (timeextra === 'offtimeextraa') del('Extra_time')
    if (extra === 'offextra') del('Extra_volume')
    const kb = { inline_keyboard: [] }
    let tmp = []
    for (const [text, cb] of Object.values(k)) {
      tmp.push({ text, callback_data: cb + id })
      if (tmp.length === 2 || text === S.btnRefresh) { kb.inline_keyboard.push(tmp); tmp = [] }
    }
    if (tmp.length) kb.inline_keyboard.push(tmp)
    kb.inline_keyboard.push([{ text: S.backlist, callback_data: 'backorder' }])
    kbs = J(kb)
    let textconnect
    if (d.sub_updated_at !== null && d.sub_updated_at !== undefined) textconnect = sprintf(S.connectionInfo, lastonline, lastupdate, d.sub_last_user_agent)
    else if (panel.type === 'WGDashboard') textconnect = ''
    else textconnect = strtr(S.lastOnline, { '{lastonline}': lastonline })
    textinfo = sprintf(S.infoFull, statusVar, d.username, userpassword, nameconfig, inv.Service_location, inv.name_product, LastTraffic, used, Remaining, Percent, expirationDate, day, textconnect)
  }
  await show(c, textinfo, kbs)
  await step(c, 'home')
  return true
}

async function show(c, text, kb) {
  if (c.user.step === 'getuseragnetservice') await sendmessage(c.from_id, text, kb, 'html')
  else if (c.datain === 'productcheckdata') { await deletemessage(c.from_id, c.message_id); await sendmessage(c.from_id, text, kb, 'html') }
  else await Editmessagetext(c.from_id, c.message_id, text, kb)
}
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
/** new DateTime($s, UTC) → unix time ($s without a zone is UTC) */
export function utcSec(s) {
  s = String(s)
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'
  return Math.floor(Date.parse(iso) / 1000)
}
