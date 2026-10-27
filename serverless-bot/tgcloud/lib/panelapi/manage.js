// manage_api.php: one order / one customer from the panel (renew, volume, time, status, wallet, messages …).
import { qAll, qOne, qRun, qVal } from './qb.js'
import { kvGet, kvSet } from '../db.js'
import { PanelError, fail, str, now, latinDigits, randomHex12 } from './util.js'
import { orderStatusKeys } from './resources.js'
import { tehranDate, systemContext } from '../bot.js'
import { telegram } from '../tg.js'
import { dataUser, extend as panelExtend, extraVolume, extraTime, changeStatus, resetUsage, revokeSub, removeUser } from '../panel.js'
import { phpJson, numberFormat } from '../php.js'

const extendLabels = (T) => Object.fromEntries(['resetVolumeTime', 'addTimeVolumeNextMonth', 'resetTimeAddVolume', 'resetVolumeAddTime', 'addTimeConvertVolume'].map((k) => [String(T.keyboard[k] ?? '').trim(), k]).filter(([l]) => l !== ''))
const normalizeNum = (v) => { const s = latinDigits(str(v)).replace(/[,٬ ]/g, ''); return /^-?\d+(\.\d+)?$/.test(s) ? s : '0' }
const intOf = (v) => parseInt(normalizeNum(v), 10) || 0
const numStr = (n) => String(Number(n))
const htmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** every change is logged (who, when, what): the last 300 entries in kv */
async function log(admin, what, data) {
  let list = []
  try { list = JSON.parse((await kvGet('log:panel_actions')) || '[]') } catch { list = [] }
  list.push({ at: new Date().toISOString(), admin, what, ...data })
  await kvSet('log:panel_actions', JSON.stringify(list.slice(-300)))
}

async function invoiceOf(id) {
  const inv = await qOne('SELECT * FROM invoice WHERE id_invoice = ?', [id])
  if (!inv) fail('سفارش پیدا نشد', 404)
  return inv
}
const panelOf = (name) => qOne('SELECT * FROM marzban_panel WHERE name_panel = ?', [name])

async function live(inv, domain) {
  let d
  try { d = await dataUser(inv.Service_location, inv.username, domain) } catch (e) { return { ok: false, error: String(e && e.message) } }
  if (!d || typeof d !== 'object' || d.status === 'Unsuccessful') return { ok: false, error: str(d && d.msg) || 'پنل جواب نداد', not_found: d && d.msg === 'User not found' }
  const configs = d.links ?? d.configs ?? []
  return { ok: true, status: str(d.status), data_limit: parseInt(d.data_limit) || 0, used: parseInt(d.used_traffic) || 0, expire: parseInt(d.expire) || 0, online_at: d.online_at ?? null,
    sub: str(d.subscription_url), configs: (Array.isArray(configs) ? configs.map(String) : String(configs).split('\n')).filter((x) => x !== '') }
}
const userRow = (id) => qOne('SELECT id, username, namecustom, number, Balance, agent, User_Status, register, pricediscount, affiliatescount, affiliates, score FROM user WHERE id = ?', [id])

async function notify(chat, text) {
  if (!/^\d+$/.test(chat) || chat === '0') return false
  const r = await telegram('sendMessage', { chat_id: chat, text, parse_mode: 'HTML' })
  return !!(r && r.ok)
}
const okResult = (r) => r && typeof r === 'object' && r.status !== false && r.status !== 'Unsuccessful'
const errOf = (r) => { const m = r && typeof r === 'object' ? r.msg ?? r.error ?? 'خطای پنل' : 'خطای پنل'; return typeof m === 'string' ? m : JSON.stringify(m) }

async function logBalance(userId, oldB, newB) {
  const diff = newB - oldB
  if (diff === 0) return
  await qRun("INSERT INTO Payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES (?,?,?,?,?,?,?)", [userId, randomHex12(), tehranDate(), Math.abs(diff), 'paid', diff > 0 ? 'add balance by admin' : 'low balance by admin', 'none'])
}

export async function order(q) {
  const inv = await invoiceOf(str(q.id))
  const domain = (await kvGet('config:domainhosts')) || ''
  const panel = await panelOf(str(inv.Service_location))
  const user = inv.id_user !== '0' ? await userRow(str(inv.id_user)) : null
  const agent = (user && user.agent) || 'f'
  let products = []
  if (panel) {
    products = (await qAll("SELECT id, name_product, price_product, Volume_constraint, Service_time, category FROM product WHERE (Location = ? OR Location = '/all') AND agent = ? AND COALESCE(NULLIF(status_product,''),'active') = 'active' ORDER BY CAST(sort_order AS INTEGER), id", [panel.name_panel, agent]))
      .map((p) => ({ id: Number(p.id), name: p.name_product, price: parseInt(p.price_product) || 0, gb: parseFloat(p.Volume_constraint) || 0, days: parseInt(p.Service_time) || 0, category: p.category }))
  }
  const hist = await qAll('SELECT type, value, time, price FROM service_other WHERE username = ? ORDER BY time DESC LIMIT 20', [inv.username])
  return { ok: true,
    order: { id: inv.id_invoice, user_id: str(inv.id_user), username: inv.username, product: inv.name_product, price: parseInt(inv.price_product) || 0, gb: parseFloat(inv.Volume) || 0, days: parseInt(inv.Service_time) || 0,
      location: inv.Service_location, status: inv.Status, time: parseInt(inv.time_sell) || 0, note: str(inv.note), sub_page: `https://${domain}/sub/${inv.id_invoice}` },
    user: user ? { id: str(user.id), name: user.namecustom || user.username, username: user.username, balance: parseInt(user.Balance) || 0, status: user.User_Status, agent: user.agent } : null,
    panel: panel ? { name: panel.name_panel, type: panel.type, active: panel.status !== 'disabled' } : null,
    live: panel ? await live(inv, domain) : { ok: false, error: 'این پنل دیگر در ربات نیست' },
    products, history: hist }
}

export async function orderAction(b, admin) {
  const inv = await invoiceOf(str(b.id))
  const act = str(b.action)
  const domain = (await kvGet('config:domainhosts')) || ''
  const panel = await panelOf(str(inv.Service_location))
  if (!['edit', 'message', 'purge', 'delete'].includes(act) && !panel) fail('پنل این سرویس دیگر در ربات نیست', 409)
  let msg = ''
  switch (act) {
    case 'renew': {
      let gb, days, code, name, price
      if (b.product_id) {
        const p = await qOne('SELECT * FROM product WHERE id = ?', [parseInt(b.product_id) || 0])
        if (!p) fail('محصول پیدا نشد', 404)
        gb = parseFloat(p.Volume_constraint) || 0; days = parseInt(p.Service_time) || 0; code = p.code_product; name = p.name_product; price = parseInt(p.price_product) || 0
      } else {
        gb = parseFloat(b.gb ?? 0) || 0; days = parseInt(b.days ?? 0) || 0
        if (gb < 0 || days < 0 || (gb === 0 && days === 0) || gb > 10000 || days > 3650) fail('حجم یا روز نامعتبر است', 422)
        code = 'custom_volume'; name = inv.name_product; price = parseInt(b.price ?? 0) || 0
      }
      const charge = !!b.charge && price > 0
      if (charge) { const u = await userRow(str(inv.id_user)); if (!u || (parseInt(u.Balance) || 0) < price) fail('موجودی کیف پول کاربر کافی نیست', 422) }
      const { T } = await systemContext()
      const r = await panelExtend(panel.Methodextend, gb, days, inv.username, code, panel.code_panel, extendLabels(T))
      if (!okResult(r)) fail('تمدید روی پنل نشد: ' + errOf(r), 502)
      await qRun('INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (?,?,?,?,?,?,?)', [inv.id_user, inv.username, numStr(gb) + '_' + days, 'extend_user_by_admin', tehranDate(), charge ? price : 0, phpJson(r)])
      await qRun("UPDATE invoice SET Status = 'active' WHERE id_invoice = ?", [inv.id_invoice])
      if (charge) { await qRun('UPDATE user SET Balance = Balance - ? WHERE id = ?', [price, inv.id_user]); await logBalance(str(inv.id_user), price, 0) }
      msg = `تمدید شد: ${numStr(gb)} گیگ، ${days} روز` + (charge ? '، ' + numberFormat(price) + ' تومان از کیف پول کم شد' : '')
      if (b.notify) await notify(str(inv.id_user), `✅ سرویس <code>${inv.username}</code> تمدید شد (${numStr(gb)} گیگ، ${days} روز).`)
      break
    }
    case 'add_volume': {
      const gb = parseFloat(b.gb ?? 0) || 0
      if (gb <= 0 || gb > 10000) fail('حجم نامعتبر است', 422)
      const r = await extraVolume(inv.username, panel.code_panel, gb)
      if (!okResult(r)) fail('افزودن حجم نشد: ' + errOf(r), 502)
      await qRun('INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (?,?,?,?,?,?,?)', [inv.id_user, inv.username, numStr(gb), 'extra_user', tehranDate(), 0, phpJson(r)])
      msg = `${numStr(gb)} گیگ اضافه شد`
      if (b.notify) await notify(str(inv.id_user), `🎁 ${numStr(gb)} گیگ به سرویس <code>${inv.username}</code> اضافه شد.`)
      break
    }
    case 'add_time': {
      const days = parseInt(b.days ?? 0) || 0
      if (days <= 0 || days > 3650) fail('تعداد روز نامعتبر است', 422)
      const r = await extraTime(inv.username, panel.code_panel, days)
      if (!okResult(r)) fail('افزودن زمان نشد: ' + errOf(r), 502)
      await qRun('INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (?,?,?,?,?,?,?)', [inv.id_user, inv.username, String(days), 'extra_time_user', tehranDate(), 0, phpJson(r)])
      msg = `${days} روز اضافه شد`
      if (b.notify) await notify(str(inv.id_user), `🎁 ${days} روز به سرویس <code>${inv.username}</code> اضافه شد.`)
      break
    }
    case 'toggle': {
      const r = await changeStatus(inv.Service_location, inv.username, domain)
      if (!okResult(r)) fail('تغییر وضعیت نشد: ' + errOf(r), 502)
      const lv = await live(inv, domain)
      msg = lv.status === 'disabled' ? 'سرویس غیرفعال شد' : 'سرویس فعال شد'
      break
    }
    case 'reset_usage': {
      const r = await resetUsage(inv.Service_location, inv.username)
      if (!okResult(r)) fail('صفر کردن مصرف نشد: ' + errOf(r), 502)
      msg = 'مصرف صفر شد'
      break
    }
    case 'revoke_sub': {
      const r = await revokeSub(inv.Service_location, inv.username, domain)
      if (!okResult(r)) fail('تغییر لینک نشد: ' + errOf(r), 502)
      await qRun('UPDATE invoice SET user_info = NULL, uuid = NULL WHERE id_invoice = ?', [inv.id_invoice])
      msg = 'لینک اشتراک عوض شد (لینک قبلی دیگر کار نمی‌کند)'
      break
    }
    case 'delete': case 'purge': {
      if (panel) {
        const lv = await live(inv, domain)
        if (lv.ok) {
          await removeUser(inv.Service_location, inv.username)
          if ((await live(inv, domain)).ok) fail('سرویس از پنل پاک نشد؛ سفارش دست نخورد', 502)
        } else if (!lv.not_found && !b.force) fail('پنل جواب نداد: ' + lv.error + ' (برای پاک کردن فقط سفارش، «پاک کردن بدون پنل» را بزنید)', 502)
      }
      const price = parseInt(inv.price_product) || 0
      const refund = !!b.refund && price > 0 && inv.id_user !== '0'
      if (refund) { await qRun('UPDATE user SET Balance = Balance + ? WHERE id = ?', [price, inv.id_user]); await logBalance(str(inv.id_user), 0, price) }
      if (act === 'purge') {
        await log(admin.username, 'order.purge.removed', { invoice: inv })
        await qRun('DELETE FROM invoice WHERE id_invoice = ?', [inv.id_invoice])
      } else await qRun("UPDATE invoice SET Status = 'removebyadmin' WHERE id_invoice = ?", [inv.id_invoice])
      msg = (act === 'purge' ? 'سرویس و سفارش پاک شد' : 'سرویس حذف شد') + (refund ? '، ' + numberFormat(price) + ' تومان به کیف پول برگشت' : '')
      if (b.notify && refund) await notify(str(inv.id_user), '💰 مبلغ ' + numberFormat(price) + ` تومان بابت سرویس <code>${inv.username}</code> به کیف پول شما برگشت.`)
      break
    }
    case 'edit': {
      const f = b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields) ? b.fields : {}
      const allowed = { name_product: 'text', price_product: 'int', note: 'text', Status: 'text', Volume: 'num', Service_time: 'int' }
      const set = {}
      for (const [k, v0] of Object.entries(f)) {
        if (!(k in allowed)) continue
        const v = allowed[k] === 'int' ? String(intOf(v0)) : allowed[k] === 'num' ? numStr(parseFloat(normalizeNum(v0))) : [...str(v0).trim()].slice(0, 500).join('')
        if (k === 'Status' && !orderStatusKeys().includes(v)) fail('وضعیت نامعتبر است', 422)
        set[k] = v
      }
      if (!Object.keys(set).length) fail('چیزی برای ذخیره نیست', 422)
      await qRun(`UPDATE invoice SET ${Object.keys(set).map((k) => `\`${k}\` = ?`).join(', ')} WHERE id_invoice = ?`, [...Object.values(set), inv.id_invoice])
      msg = 'ذخیره شد'
      break
    }
    case 'message': {
      const text = str(b.text).trim()
      if (text === '' || [...text].length > 3500) fail('متن پیام را بنویسید', 422)
      if (!(await notify(str(inv.id_user), htmlEsc(text)))) fail('پیام نرسید (کاربر ربات را بسته یا آیدی تلگرام ندارد)', 502)
      msg = 'پیام فرستاده شد'
      break
    }
    default: fail('کار نامعتبر', 400)
  }
  const { id, action, ...input } = b
  await log(admin.username, 'order.' + act, { order: inv.id_invoice, service: inv.username, input, result: msg })
  return { ok: true, message: msg }
}

export async function user(q) {
  const id = str(q.id)
  const u = await userRow(id)
  if (!u) fail('کاربر پیدا نشد', 404)
  const o = await qAll('SELECT id_invoice, username, name_product, price_product, Volume, Service_time, Service_location, Status, time_sell FROM invoice WHERE id_user = ? ORDER BY time_sell DESC LIMIT 200', [id])
  const p = await qAll('SELECT id_order, time, price, payment_Status, Payment_Method, id_invoice FROM Payment_report WHERE id_user = ? ORDER BY id DESC LIMIT 50', [id])
  const spent = Number(await qVal("SELECT COALESCE(SUM(CAST(price_product AS INTEGER)),0) FROM invoice WHERE id_user = ? AND Status NOT IN ('unpaid','removebyadmin')", [id]))
  return { ok: true, user: { id: str(u.id), username: str(u.username), name: str(u.namecustom), phone: str(u.number), balance: parseInt(u.Balance) || 0, agent: u.agent, status: u.User_Status, register: parseInt(u.register) || 0,
      discount: parseInt(u.pricediscount) || 0, referrals: parseInt(u.affiliatescount) || 0, referrer: str(u.affiliates), score: parseInt(u.score) || 0, spent },
    orders: o.map((r) => ({ id: r.id_invoice, username: r.username, product: r.name_product, price: parseInt(r.price_product) || 0, gb: parseFloat(r.Volume) || 0, days: parseInt(r.Service_time) || 0, location: r.Service_location, status: r.Status, time: parseInt(r.time_sell) || 0 })),
    payments: p.map((r) => ({ id: r.id_order, time: str(r.time), price: parseInt(r.price) || 0, status: r.payment_Status, method: r.Payment_Method, for: str(r.id_invoice) })) }
}

export async function userAction(b, admin) {
  const id = str(b.id)
  const u = await userRow(id)
  if (!u) fail('کاربر پیدا نشد', 404)
  const act = str(b.action)
  let msg = ''
  switch (act) {
    case 'wallet': {
      const amount = intOf(b.amount ?? 0)
      if (amount === 0 || Math.abs(amount) > 1000000000) fail('مبلغ نامعتبر است', 422)
      const old = parseInt(u.Balance) || 0
      const nw = old + amount
      if (nw < 0 && !b.allow_negative) fail('موجودی منفی می‌شود (' + numberFormat(nw) + ')', 422)
      await qRun('UPDATE user SET Balance = ? WHERE id = ?', [nw, id])
      await logBalance(id, old, nw)
      const reason = str(b.reason).trim()
      msg = (amount > 0 ? numberFormat(amount) + ' تومان اضافه شد' : numberFormat(-amount) + ' تومان کم شد') + '؛ موجودی: ' + numberFormat(nw)
      if (b.notify) await notify(id, (amount > 0 ? '💰 ' + numberFormat(amount) + ' تومان به کیف پول شما اضافه شد.' : '💳 ' + numberFormat(-amount) + ' تومان از کیف پول شما کم شد.') + (reason !== '' ? '\n' + htmlEsc(reason) : '') + '\nموجودی: ' + numberFormat(nw) + ' تومان')
      break
    }
    case 'block': case 'unblock':
      await qRun('UPDATE user SET User_Status = ?, description_blocking = ? WHERE id = ?', [act === 'block' ? 'block' : 'Active', act === 'block' ? [...str(b.reason).trim()].slice(0, 500).join('') : '', id])
      msg = act === 'block' ? 'کاربر مسدود شد' : 'کاربر آزاد شد'
      break
    case 'message': {
      const text = str(b.text).trim()
      if (text === '' || [...text].length > 3500) fail('متن پیام را بنویسید', 422)
      if (!(await notify(id, htmlEsc(text)))) fail('پیام نرسید (کاربر ربات را بسته است)', 502)
      msg = 'پیام فرستاده شد'
      break
    }
    case 'edit': {
      const f = b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields) ? b.fields : {}
      const allowed = { namecustom: 'text', number: 'text', agent: ['f', 'n', 'n2'], pricediscount: 'int', score: 'int' }
      const set = {}
      for (const [k, v] of Object.entries(f)) {
        if (!(k in allowed)) continue
        if (Array.isArray(allowed[k])) { if (!allowed[k].includes(str(v))) fail('نقش نامعتبر است', 422); set[k] = str(v) } else set[k] = allowed[k] === 'int' ? String(intOf(v)) : [...str(v).trim()].slice(0, 200).join('')
      }
      if (!Object.keys(set).length) fail('چیزی برای ذخیره نیست', 422)
      await qRun(`UPDATE user SET ${Object.keys(set).map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...Object.values(set), id])
      msg = 'ذخیره شد'
      break
    }
    default: fail('کار نامعتبر', 400)
  }
  const { id: _i, action, ...input } = b
  await log(admin.username, 'user.' + act, { user: id, input, result: msg })
  return { ok: true, message: msg }
}
