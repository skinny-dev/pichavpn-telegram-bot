// PasarGuard / Marzban panels — port of panels/Api/Marzban.php, panels/Drivers/Marzban.php and ManagePanel (panels.php).
// Results keep the PHP shapes: {status:'successful'|'Unsuccessful'|true|false, msg, …}.
import { b64ToBytes, utf8Decode } from './b64.js'
import { fetch } from 'sdk'
import { one, run, sql } from './db.js'

const nowSec = () => Math.floor(Date.now() / 1000)

export async function panelByName(name) { return one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${name}`) }
export async function panelByCode(code) { return one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${code}`) }

// the Serverless isolate may lack URL / URLSearchParams: use them when present, parse by hand otherwise
const formEncode = (form) => (typeof URLSearchParams === 'function' ? new URLSearchParams(form).toString()
  : Object.entries(form).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v ?? '').replace(/%20/g, '+')).join('&'))
function urlParts(u) {
  const s = String(u ?? '').trim()
  if (typeof URL === 'function') { try { return new URL(s) } catch { return null } }
  const m = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/@?#]*@)?([^/:?#]+)(?::(\d+))?([^?#]*)(\?[^#]*)?/i.exec(s)
  return m ? { protocol: m[1].toLowerCase() + ':', hostname: m[2].toLowerCase(), port: m[3] || '', pathname: m[4] || '/', search: m[5] || '' } : null
}

/** PHP CurlRequest: {status, body} or {error} — never throws */
async function req(method, url, { token, json, form } = {}) {
  const headers = { accept: 'application/json' }
  let body
  if (token) headers.Authorization = 'Bearer ' + token
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json) }
  if (form !== undefined) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = formEncode(form) }
  try {
    const res = await fetch(url, { method, headers, body })
    return { status: res.status, body: await res.text() }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
}
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

/** token_panel: cached for an hour in marzban_panel.datelogin (same as the PHP bot) */
export async function tokenPanel(panel, verify = true) {
  if (!panel) return null
  if (panel.datelogin && verify) {
    const d = parse(panel.datelogin)
    if (d && d.time && d.access_token) {
      const t = Date.parse(String(d.time).replace(/\//g, '-').replace(' ', 'T') + '+03:30') / 1000
      if (nowSec() - t <= 3600) return d
    }
  }
  const r = await req('POST', panel.url_panel + '/api/admin/token', { form: { username: panel.username_panel, password: panel.password_panel } })
  if (r.error) return { error: r.error }
  const body = parse(r.body) || {}
  if (body.access_token) {
    const data = JSON.stringify({ time: tehranStamp(), access_token: body.access_token })
    await run(sql`UPDATE marzban_panel SET datelogin = ${data} WHERE name_panel = ${panel.name_panel}`)
    panel.datelogin = data
  }
  return body
}
/** date('Y/m/d H:i:s') in Asia/Tehran */
export function tehranStamp(ts = nowSec()) {
  const d = new Date((ts + 12600) * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

async function authed(panel, method, path, opts = {}) {
  const t = await tokenPanel(panel)
  if (!t || t.error) return t || { error: 'panel not found' }
  return req(method, panel.url_panel + path, { ...opts, token: t.access_token })
}

export function absoluteSubUrl(sub, panelUrl) {
  sub = String(sub ?? '').trim()
  if (sub === '') return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(sub)) return sub
  if (sub[0] !== '/' && /[.:]/.test(sub.split('/')[0])) return sub
  return String(panelUrl).replace(/\/+$/, '') + '/' + sub.replace(/^\/+/, '')
}
/** panelSubscriptionLink: the bot domain link, or the panel's own one when subproxy is off */
export function subLink(panel, nativeUrl, invoice, domain) {
  const botLink = invoice ? `https://${domain}/sub/${invoice.id_invoice}` : nativeUrl
  if ((panel.subproxy || 'onsubproxy') !== 'offsubproxy' || !invoice) return botLink
  const native = String(nativeUrl ?? '').trim()
  if (native === '') return botLink
  return nativeSubUrl(panel, native)
}
export function nativeSubUrl(panel, native) {
  const base = String(panel.linksubx ?? '').trim()
  const baseUrl = base ? urlParts(base) : null
  const admin = urlParts(panel.url_panel)?.hostname ?? null
  if (baseUrl && baseUrl.hostname && baseUrl.hostname !== admin) {
    const u = urlParts(native)
    if (u && u.pathname) return `${baseUrl.protocol.replace(':', '') || 'https'}://${baseUrl.hostname}${baseUrl.port ? ':' + baseUrl.port : ''}${u.pathname}${u.search}`
  }
  return native
}

async function outputLink(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } })
    return await res.text()
  } catch { return null }
}
const looksBase64 = (s) => typeof s === 'string' && s.length > 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.replace(/\s/g, '').length % 4 === 0
function b64decode(s) {
  try {
    return utf8Decode(b64ToBytes(s))
  } catch { return s }
}
async function linksOf(subUrl, given) {
  let links = given ?? (await outputLink(subUrl + '/links'))
  if (typeof links === 'string' && looksBase64(links)) links = b64decode(links)
  return Array.isArray(links) ? links : String(links ?? '').split('\n')
}

/** splitWireguardLinks(): wireguard:// links go to `wireguard` (sent as .conf files), out of configs / links */
function splitWg(panel, res) {
  if (!res || typeof res !== 'object' || !(panel.type === 'x-ui_single' || (panel.type === 'marzban' && String(panel.version_panel) === '1'))) return res
  const isWg = (l) => String(l ?? '').trim().toLowerCase().startsWith('wireguard://')
  res.wireguard = []
  for (const k of ['configs', 'links']) {
    if (Array.isArray(res[k])) {
      for (const l of res[k].filter(isWg)) if (!res.wireguard.includes(l)) res.wireguard.push(l)
      res[k] = res[k].filter((l) => !isWg(l))
    }
  }
  return res
}

/** DataUser (read) */
export async function dataUser(panelName, username, domain = '') {
  const panel = await panelByName(panelName)
  if (!panel) return { status: 'Unsuccessful', msg: 'Panel Not Found' }
  // the bot-domain link only with the panel's «subvip» setting (panels.php DataUser)
  const inv = panel.subvip === 'onsubvip' ? await one(sql`SELECT * FROM invoice WHERE username = ${username}`) : null
  const r = await authed(panel, 'GET', '/api/user/' + username)
  if (r.error) return { status: 'Unsuccessful', msg: r.error }
  if (r.status === 500) return { status: 'Unsuccessful', msg: 500 }
  const u = parse(r.body)
  if (!u || typeof u !== 'object' || u.detail || !u.username) return { status: 'Unsuccessful', msg: u && typeof u === 'object' ? u.detail ?? 'Unsuccessful' : 'Unsuccessful' }
  u.subscription_url = absoluteSubUrl(u.subscription_url ?? '', panel.url_panel)
  if (String(panel.version_panel) === '1') {
    // strtotime(): a date without a zone is read as Tehran time (the PHP bot's timezone)
    const ex = String(u.expire ?? '')
    const t = ex === '' ? NaN : Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(ex) || !/\d[T ]\d/.test(ex) ? ex : ex.replace(' ', 'T') + '+03:30')
    u.expire = Number.isFinite(t) ? Math.floor(t / 1000) : false
    u.links = await linksOf(u.subscription_url, u.links)
    const up = await authed(panel, 'GET', `/api/user/${username}/sub_update?offset=0&limit=1`)
    if (up.error) return { status: 'Unsuccessful', msg: up.error }
    if (up.status === 500) return { status: 'Unsuccessful', msg: 500 }
    const ub = parse(up.body)
    const first = ub && Array.isArray(ub.updates) ? ub.updates[0] : null
    u.sub_updated_at = first ? first.created_at ?? null : u.sub_updated_at ?? null
    u.sub_last_user_agent = first ? first.user_agent ?? null : u.sub_last_user_agent ?? null
    u.proxies = u.proxy_settings ?? null
  }
  if (inv) u.subscription_url = subLink(panel, u.subscription_url, inv, domain)
  return splitWg(panel, {
    status: u.status ?? 'Unknown', username: u.username ?? username, data_limit: u.data_limit ?? null, expire: u.expire ?? null,
    online_at: u.online_at ?? null, used_traffic: u.used_traffic ?? null, links: u.links ?? [], subscription_url: u.subscription_url ?? '',
    sub_updated_at: u.sub_updated_at ?? null, sub_last_user_agent: u.sub_last_user_agent ?? null, uuid: u.proxies ?? null,
    data_limit_reset: u.data_limit_reset_strategy ?? null,
  })
}

const protocolsConfigured = (raw) => { const d = parse(String(raw ?? '')); return d && typeof d === 'object' && Object.keys(d).length > 0 }

/** adduser + driver create: {status:'successful', username, subscription_url, configs} */
export async function createUser(panelName, { dataLimit, username, expire, note = '', dataLimitReset = 'no_reset', productName = false, invoice = null, domain = '' }) {
  const panel = await panelByName(panelName)
  if (!panel) return { status: 'Unsuccessful', msg: 'Panel Not Found' }
  let inbounds
  if (panel.inbounds != null && panel.inbounds !== 'null') {
    if (productName !== false && productName !== 'usertest') {
      const p = await one(sql`SELECT * FROM product WHERE name_product = ${productName} AND (Location = ${panelName} OR Location = '/all') ORDER BY Location = '/all' LIMIT 1`)
      if (!p || !p.inbounds) inbounds = parse(panel.inbounds)
      else { inbounds = parse(p.inbounds); panel.proxies = p.proxies }
    } else inbounds = parse(panel.inbounds)
  }
  if (!protocolsConfigured(panel.proxies)) return { status: 'Unsuccessful', msg: `⚠️ پروتکل و اینباند این موقعیت تنظیم نشده (${panel.name_panel})` }
  const v1 = String(panel.version_panel) === '1'
  const data = { [v1 ? 'proxy_settings' : 'proxies']: parse(panel.proxies), data_limit: dataLimit, username, note, data_limit_reset_strategy: dataLimitReset }
  if (inbounds !== undefined) data[v1 ? 'group_ids' : 'inbounds'] = inbounds
  const onHold = productName === 'usertest' ? String(panel.on_hold_test) !== '0' : panel.conecton !== 'offconecton'
  if (!expire) data.expire = 0
  else if (!onHold) data.expire = v1 ? new Date(expire * 1000).toISOString().replace('.000Z', '+00:00') : expire
  else { data.expire = 0; data.status = 'on_hold'; data.on_hold_expire_duration = expire - nowSec() }
  const r = await authed(panel, 'POST', '/api/user', { json: data })
  if (r.error) return { status: 'Unsuccessful', msg: r.error }
  if (r.status >= 400) {
    const e = parse(r.body)
    return { status: 'Unsuccessful', msg: e && e.detail ? e.detail : r.status }
  }
  const out = parse(r.body) || {}
  if (out.detail) return { status: 'Unsuccessful', msg: out.detail }
  out.subscription_url = absoluteSubUrl(out.subscription_url, panel.url_panel)
  if (v1) out.links = await linksOf(out.subscription_url, undefined)
  if (invoice) out.subscription_url = subLink(panel, out.subscription_url ?? '', invoice, domain)
  return splitWg(panel, { status: 'successful', username: out.username, subscription_url: out.subscription_url, configs: out.links })
}

/** Modifyuser (driver modify): {status:true,data} | {status:false,msg} */
export async function modifyUser(panelName, username, config) {
  const panel = await panelByName(panelName)
  if (!panel) return { status: false, msg: 'Panel Not Found' }
  if (String(panel.version_panel) === '1') {
    const cur = await authed(panel, 'GET', '/api/user/' + username)
    config = { ...config, proxy_settings: (parse(cur.body) || {}).proxy_settings }
  }
  const r = await authed(panel, 'PUT', '/api/user/' + username, { json: config })
  if (r.error) return { status: false, msg: r.error }
  if (r.status === 500) return { status: false, msg: 'error code : 500' }
  const c = parse(r.body)
  if (c && c.detail) return { status: false, msg: c.detail }
  return { status: true, data: r }
}

export async function removeUser(panelName, username) {
  const panel = await panelByName(panelName)
  if (!panel) return { status: 'Unsuccessful', msg: 'Panel Not Found' }
  const r = await authed(panel, 'DELETE', '/api/user/' + username)
  if (r.status && r.status !== 200) return { status: 'Unsuccessful', msg: r.status }
  if (r.error) return { status: 'Unsuccessful', msg: r.error }
  const b = parse(r.body) || {}
  return b.detail !== 'User successfully deleted' ? { status: 'Unsuccessful', msg: b.detail } : { status: 'successful', msg: b.detail }
}

export async function resetUsage(panelName, username) {
  const panel = await panelByName(panelName)
  if (!panel) return { status: false, msg: 'data not found' }
  const r = await authed(panel, 'POST', `/api/user/${username}/reset`, { json: {} })
  if (r.status && r.status !== 200) return { status: false, msg: 'error code : ' + r.status }
  if (r.error) return { status: false, msg: 'error  : ' + r.error }
  const b = parse(r.body) || {}
  return b.detail ? { status: false, msg: b.detail } : { status: true, msg: 'successful' }
}

export async function revokeSub(panelName, username, domain = '') {
  const panel = await panelByName(panelName)
  if (!panel) return { status: 'Unsuccessful', msg: 'Panel Not Found' }
  const r = await authed(panel, 'POST', `/api/user/${username}/revoke_sub`, { json: {} })
  const b = parse(r.body) || {}
  if (b.detail) return { status: 'Unsuccessful', msg: b.detail }
  const d = await dataUser(panelName, username, domain)
  // dataUser already split the wireguard links out (the same result as splitWireguardLinks on the driver's answer)
  return { status: 'successful', configs: d.links, subscription_url: absoluteSubUrl(d.subscription_url, panel.url_panel), ...(d.wireguard ? { wireguard: d.wireguard } : {}) }
}

/** Change_status: active <-> disabled */
export async function changeStatus(panelName, username, domain = '') {
  const d = await dataUser(panelName, username, domain)
  if (d.status === 'Unsuccessful') return { status: 'Unsuccessful', msg: d.msg }
  if (!['active', 'disabled'].includes(d.status)) return { status: 'Unsuccessful', msg: 'status invalid' }
  await modifyUser(panelName, username, { status: d.status === 'active' ? 'disabled' : 'active' })
  return { status: 'successful', msg: null }
}

const EXTEND_KEYS = ['resetVolumeTime', 'addTimeVolumeNextMonth', 'resetTimeAddVolume', 'resetVolumeAddTime', 'addTimeConvertVolume']
/** extendMethodKey: stored key, or a label in any language (labels: {label: key}) */
export function extendMethodKey(value, labels = {}, def = 'resetVolumeTime') {
  value = typeof value === 'string' ? value.trim() : ''
  if (value === '') return def
  if (EXTEND_KEYS.includes(value)) return value
  return labels[value] ?? def
}

/** ManagePanel::extend — $panelCode is code_panel, like the PHP call sites */
export async function extend(methodExtend, newLimitGb, timeDay, username, codeProduct, panelCode, labels = {}) {
  const panel = await panelByCode(panelCode)
  let product = await one(sql`SELECT * FROM product WHERE code_product = ${codeProduct}`)
  const invoice = await one(sql`SELECT * FROM invoice WHERE username = ${username}`)
  if (codeProduct === 'custom_volume') product = product || {}
  if (!panel || !product) return { status: false, msg: 'data not found' }
  const du = await dataUser(panel.name_panel, username)
  if (du.status === 'Unsuccessful') return { status: false, msg: du.msg }
  if (invoice) await run(sql`UPDATE invoice SET notifctions = ${JSON.stringify({ volume: false, time: false })} WHERE id_invoice = ${invoice.id_invoice}`)
  const GB = 1024 ** 3
  const now = nowSec()
  const oldLimit = Number(du.data_limit || 0)
  let timeOld = Number(du.expire || 0)
  timeOld = now - timeOld > 0 ? now : timeOld
  let dataLimitNew = Number(newLimitGb) === 0 ? 0 : Number(newLimitGb) * GB
  const dataLimitNewAdd = Number(newLimitGb) === 0 ? 0 : oldLimit + Number(newLimitGb) * GB
  let timeNew = Number(timeDay) === 0 ? 0 : now + Number(timeDay) * 86400
  timeOld = timeOld === 0 ? now : timeOld
  const timeNewAdd = Number(timeDay) === 0 ? 0 : timeOld + Number(timeDay) * 86400
  let inbounds = typeof panel.inbounds === 'string' ? parse(panel.inbounds) : '{}'
  if (product.inbounds != null) inbounds = parse(product.inbounds)
  if (panel.type !== 'WGDashboard') await run(sql`UPDATE invoice SET user_info = NULL WHERE username = ${username}`)
  await run(sql`UPDATE invoice SET uuid = NULL, Status = 'active' WHERE username = ${username}`)
  const m = extendMethodKey(methodExtend, labels)
  const reset = async () => {
    const r = await resetUsage(panel.name_panel, username)
    return r.status === false ? { status: false, msg: 'error reset : ' + r.msg } : null
  }
  if (m === 'resetVolumeTime') { const e = await reset(); if (e) return e }
  else if (m === 'addTimeVolumeNextMonth') { dataLimitNew = dataLimitNewAdd; timeNew = timeNewAdd }
  else if (m === 'resetTimeAddVolume') dataLimitNew = dataLimitNewAdd
  else if (m === 'resetVolumeAddTime') { const e = await reset(); if (e) return e; timeNew = timeNewAdd }
  else if (m === 'addTimeConvertVolume') {
    const e = await reset(); if (e) return e
    timeNew = timeNewAdd
    dataLimitNew = dataLimitNew + Math.max(0, Number(du.data_limit || 0) - Number(du.used_traffic || 0))
  }
  const data = { data_limit: dataLimitNew, expire: timeNew, inbounds }
  if (invoice && invoice.uuid != null && invoice.uuid !== "") data.proxies = parse(invoice.uuid) // the value read before it was cleared (as the PHP driver does)
  return modifyUser(panel.name_panel, username, data)
}

/** extra_volume ($gb added) */
export async function extraVolume(username, panelCode, gb) {
  const panel = await panelByCode(panelCode)
  const invoice = await one(sql`SELECT * FROM invoice WHERE username = ${username}`)
  if (!panel) return { status: false, msg: 'data not found' }
  const nv = parse(invoice?.notifctions) || {}
  if (invoice) await run(sql`UPDATE invoice SET notifctions = ${JSON.stringify({ volume: false, time: nv.time ?? null })} WHERE id_invoice = ${invoice.id_invoice}`)
  const du = await dataUser(panel.name_panel, username)
  if (du.status === 'Unsuccessful') return { status: false, msg: du.msg }
  const newLimit = Number(gb) === 0 ? 0 : Number(gb) * 1024 ** 3 + Number(du.data_limit || 0)
  const inbounds = typeof panel.inbounds === 'string' ? parse(panel.inbounds) : '{}'
  if (panel.type !== 'WGDashboard') await run(sql`UPDATE invoice SET user_info = NULL WHERE username = ${username}`)
  await run(sql`UPDATE invoice SET uuid = NULL, Status = 'active' WHERE username = ${username}`)
  const data = { data_limit: newLimit, inbounds }
  if (invoice && invoice.uuid != null && invoice.uuid !== "") data.proxies = parse(invoice.uuid)
  return modifyUser(panel.name_panel, username, data)
}

/** extra_time ($days added) */
export async function extraTime(username, panelCode, days) {
  const panel = await panelByCode(panelCode)
  const invoice = await one(sql`SELECT * FROM invoice WHERE username = ${username}`)
  if (!panel) return { status: false, msg: 'data not found' }
  const nv = parse(invoice?.notifctions) || {}
  if (invoice) await run(sql`UPDATE invoice SET notifctions = ${JSON.stringify({ volume: nv.volume ?? null, time: false })} WHERE id_invoice = ${invoice.id_invoice}`)
  const du = await dataUser(panel.name_panel, username)
  if (du.status === 'Unsuccessful') return { status: false, msg: du.msg }
  let old = Number(du.expire || 0)
  old = nowSec() - old > 0 ? nowSec() : old
  const newLimit = Number(days) === 0 ? 0 : Number(days) * 86400 + old
  const inbounds = typeof panel.inbounds === 'string' ? parse(panel.inbounds) : '{}'
  if (panel.type !== 'WGDashboard') await run(sql`UPDATE invoice SET user_info = NULL WHERE username = ${username}`)
  await run(sql`UPDATE invoice SET uuid = NULL, Status = 'active' WHERE username = ${username}`)
  const data = { expire: newLimit, inbounds }
  if (invoice && invoice.uuid != null && invoice.uuid !== "") data.proxies = parse(invoice.uuid)
  return modifyUser(panel.name_panel, username, data)
}

/** ManagePanel::createUser($name_panel, $code_product, $usernameC, $Data_Config) — the bot-side wrapper */
export async function createUserFor(panelName, codeProduct, usernameC, cfg, { domain = '', customLabel = '' } = {}) {
  if (String(usernameC ?? '').length < 3) return { status: 'Unsuccessful', msg: 'Username must be at least 3 characters long.' }
  const panel = await panelByName(panelName)
  if (!panel) return { status: 'Unsuccessful', msg: 'Panel Not Found' }
  const invoice = panel.subvip === 'onsubvip' ? await one(sql`SELECT * FROM invoice WHERE username = ${usernameC}`) : null
  let productName, reset
  if (!['usertest', customLabel, 'customvolume'].includes(codeProduct)) {
    const p = await one(sql`SELECT * FROM product WHERE (Location = ${panelName} OR Location = '/all') AND code_product = ${codeProduct}`)
    productName = p ? p.name_product : null
    reset = p ? p.data_limit_reset : null
  } else {
    productName = codeProduct === 'usertest' ? 'usertest' : false
    reset = 'no_reset'
  }
  return createUser(panelName, {
    dataLimit: cfg.data_limit, username: usernameC, expire: cfg.expire, note: `${cfg.from_id ?? ''} | ${cfg.username ?? ''} | ${cfg.type ?? ''}`,
    dataLimitReset: reset ?? 'no_reset', productName, invoice, domain,
  })
}

/** getusers($location, $status): the panel's users with a status (on_hold …) */
export async function getUsers(panelName, status, limit = 200) {
  const panel = await panelByName(panelName)
  if (!panel) return { users: [] }
  const r = await authed(panel, 'GET', `/api/users?status=${encodeURIComponent(status)}&limit=${limit}`)
  const d = parse(r.body)
  return d && Array.isArray(d.users) ? d : { users: [] }
}
