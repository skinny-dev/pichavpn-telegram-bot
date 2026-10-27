// DirectPayment() of function.php: a confirmed payment either finishes what it was for (a purchase waiting for
// payment, a renewal, extra volume / time) or tops up the wallet. `c` is the update that confirmed it (the admin who
// approved a receipt, or the customer's own Stars payment); confirmKb is the admin message's keyboard.
import { one, run, sql } from './db.js'
import { sendmessage, Editmessagetext, telegram } from './tg.js'
import { shop, tehranDate } from './bot.js'
import { dataUser, createUserFor, extend as panelExtend, extraVolume, extraTime } from './panel.js'
import { sendMessageService, usernameMethodKey } from './service.js'
import { jdate } from './fmt.js'
import { sprintf, numberFormat, intval, time, J, eq, phpJson } from './php.js'

const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v))
const n = (v) => (isNumeric(v) ? Number(v) : 0)
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
const panelBy = (name) => one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${name ?? null}`)
const userBy = (id) => one(sql`SELECT * FROM user WHERE id = ${id == null ? null : String(id)}`)
const extendLabels = (T) => Object.fromEntries(['resetVolumeTime', 'addTimeVolumeNextMonth', 'resetTimeAddVolume', 'resetVolumeAddTime', 'addTimeConvertVolume']
  .map((k) => [String(T.keyboard[k] ?? '').trim(), k]).filter(([l]) => l !== ''))

/** paymentRefundOnce(): marks the order refunded; true only the first time */
async function refundOnce(orderId) {
  const r = await run(sql`UPDATE Payment_report SET id_invoice = 'refunded|' || COALESCE(id_invoice, '') WHERE id_order = ${String(orderId)} AND COALESCE(id_invoice, '') NOT LIKE 'refunded|%'`)
  return Number(r?.rowsAffected ?? 0) > 0
}

export async function directPayment(c, orderId, confirmKb = null) {
  const T = c.T
  const topics = c.topicsAll || c.topics
  const S = (await one(sql`SELECT * FROM setting LIMIT 1`)) || {}
  const report = (thread, text, extra = {}) =>
    String(S.Channel_Report ?? '').length > 0 ? telegram('sendmessage', { chat_id: S.Channel_Report, message_thread_id: topics[thread], text, ...extra }) : null
  const pay = await one(sql`SELECT * FROM Payment_report WHERE id_order = ${String(orderId)}`)
  if (!pay) return
  const priceFmt = numberFormat(n(pay.price))
  const bu = (await userBy(pay.id_user)) || {}
  const steppay = String(pay.id_invoice ?? '').split('|')
  if (steppay[0] === 'refunded') return
  await run(sql`UPDATE user SET Processing_value = '0', Processing_value_one = '0', Processing_value_tow = '0', Processing_value_four = '0' WHERE id = ${bu.id ?? null}`)
  const admins = c.admin_ids
  const adminMsg = async (text) => { if (c.from_id && intval(c.message_id) !== 0) await Editmessagetext(c.from_id, c.message_id, text, confirmKb) }
  const cardLike = pay.Payment_Method === 'cart to cart' || pay.Payment_Method === 'arze digital offline'
  const discountUsed = async (textKey) => {
    const parts = String(bu.Processing_value_four ?? '').split('_')
    if (parts[0] !== 'dis') return
    const d = await one(sql`SELECT * FROM DiscountSell WHERE codeDiscount = ${parts[1] ?? null}`)
    await run(sql`UPDATE DiscountSell SET usedDiscount = ${intval(d?.usedDiscount) + 1} WHERE codeDiscount = ${parts[1] ?? null}`)
    await run(sql`INSERT INTO Giftcodeconsumed (id_user, code) VALUES (${bu.id}, ${parts[1] ?? null})`)
    await report('otherreport', sprintf(T.Admin.reportgroup[textKey], bu.username, bu.id, parts[1]))
  }

  if (steppay[0] === 'getconfigafterpay') {
    const inv = await one(sql`SELECT * FROM invoice WHERE username = ${steppay[1] ?? null}`)
    if (!inv) {
      if (await refundOnce(orderId)) {
        await run(sql`UPDATE user SET Balance = ${intval(bu.Balance) + intval(pay.price)} WHERE id = ${bu.id}`)
        await sendmessage(bu.id, sprintf(T.users.Balance.refundOrderMissing || '💎 سفارش شما دیگر موجود نبود؛ مبلغ %s تومان به کیف پول شما اضافه شد. از «خرید اشتراک» با موجودی کیف پول خرید کنید.', numberFormat(intval(pay.price))), c.keyboard, 'HTML')
        await report('errorreport', sprintf(T.Admin.reportgroup.errorConfigCreate, 'سفارش «' + steppay[1] + '» پیدا نشد (حذف شده). مبلغ ' + numberFormat(intval(pay.price)) + ' تومان به کیف پول مشتری برگشت.', bu.id, bu.username, '-'), { parse_mode: 'HTML' })
      }
      return
    }
    if (inv.Status === 'active') return
    let info = { ...((await one(sql`SELECT * FROM product WHERE name_product = ${inv.name_product} AND (Location = ${inv.Service_location} OR Location = '/all')`)) || {}) }
    if (eq(inv.name_product, T.users.customSellVolume.btnVolume) || eq(inv.name_product, T.users.customSellVolume.btnService)) {
      info = { ...info, data_limit_reset: 'no_reset', Volume_constraint: inv.Volume, name_product: T.users.customSellVolume.title, code_product: 'customvolume', Service_time: inv.Service_time, price_product: inv.price_product }
    }
    const username = inv.username
    const panel = (await panelBy(inv.Service_location)) || {}
    const expire = intval(inv.Service_time) === 0 ? 0 : time() + Math.round(n(inv.Service_time) * 86400)
    const cfg = { expire, data_limit: n(inv.Volume) * 1024 ** 3, from_id: bu.id, username: bu.username, type: 'buy' }
    const before = inv.Status ?? null
    let claimed = false
    if (inv.id_invoice) {
      const r = await run(sql`UPDATE invoice SET Status = 'active' WHERE id_invoice = ${inv.id_invoice} AND Status <> 'active'`)
      if (Number(r?.rowsAffected ?? 0) === 0) return
      claimed = true
    }
    const out = await createUserFor(panel.name_panel ?? null, info.code_product ?? null, username, cfg, { domain: c.domain, customLabel: T.users.customSellVolume.btnVolume })
    if (!out || !out.username) {
      if (claimed) await run(sql`UPDATE invoice SET Status = ${before} WHERE id_invoice = ${inv.id_invoice}`)
      let msg = phpJson(out?.msg ?? out ?? 'unknown error')
      if (await refundOnce(orderId)) {
        await run(sql`UPDATE user SET Balance = ${n(bu.Balance) + n(pay.price)} WHERE id = ${bu.id}`)
        await sendmessage(bu.id, T.users.sell.errorConfig, c.keyboard, 'HTML')
        await sendmessage(bu.id, sprintf(T.users.Balance.refundCreateFailed, numberFormat(intval(pay.price))), c.keyboard, 'HTML')
      } else msg += ' (این پرداخت قبلاً به کیف پول برگشت داده شده بود؛ دوباره اضافه نشد)'
      await report('errorreport', sprintf(T.Admin.reportgroup.errorConfigCreate, msg, bu.id, bu.username, panel.name_panel), { parse_mode: 'HTML' })
      return
    }
    let configs = ''
    if (panel.config === 'onconfig' && Array.isArray(out.configs)) for (const l of out.configs) configs += '\n' + l
    const link = panel.sublink === 'onsublink' ? out.subscription_url : ''
    let after = T.textbot.afterPay
    if (panel.type === 'Manualsale') after = T.textbot.manual
    if (panel.type === 'WGDashboard') after = T.textbot.wgDashboard
    if (panel.type === 'ibsng' || panel.type === 'mikrotik') after = T.textbot.afterPayIbsng
    const days = intval(inv.Service_time) === 0 ? T.users.status.unlimited : inv.Service_time
    let msg = after.split('{username}').join(out.username).split('{name_service}').join(inv.name_product).split('{location}').join(panel.name_panel)
      .split('{day}').join(String(days)).split('{volume}').join(String(inv.Volume)).split('{config}').join(`<code>${link}</code>`)
      .split('{links}').join(configs).split('{links2}').join(link)
    if (['Manualsale', 'ibsng', 'mikrotik'].includes(panel.type)) {
      msg = msg.split('{password}').join(out.subscription_url)
      await run(sql`UPDATE invoice SET user_info = ${out.subscription_url} WHERE id_invoice = ${inv.id_invoice}`)
    }
    await sendMessageService(c, panel, out.configs, link, out.username, J({ inline_keyboard: [[{ text: T.keyboard.viewTutorial, callback_data: 'helpbtn' }]] }), msg, inv.id_invoice, inv.id_user, out.wireguard ?? [])
    await discountUsed('discountCodeUsed')
    const aff = (await one(sql`SELECT * FROM affiliates LIMIT 1`)) || {}
    const bought = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE name_product != ${T.common.labels.testServiceName} AND id_user = ${bu.id} AND Status != 'Unpaid'`)).n)
    if (aff.status_commission === 'oncommission' && bu.affiliates != null && intval(bu.affiliates) !== 0 && (aff.porsant_one_buy !== 'on_buy_porsant' || bought <= 1)) {
      const first = aff.porsant_one_buy === 'on_buy_porsant'
      const result = (n(pay.price) * n(S.affiliatespercentage)) / 100
      const ref = String(bu.affiliates)
      const ru = (await userBy(ref)) || {}
      if (intval(S.scorestatus) === 1 && !admins.includes(ref)) {
        await sendmessage(ref, T.users.affiliates.pointsEarned2Alt, null, 'html')
        await run(sql`UPDATE user SET score = ${n(ru.score) + 2} WHERE id = ${ref}`)
      }
      await run(sql`UPDATE user SET Balance = ${n(ru.Balance) + result} WHERE id = ${ref}`)
      const r = numberFormat(result)
      await report('porsantreport', sprintf(first ? T.Admin.reportgroup.commissionPaidFn : T.Admin.reportgroup.commissionPaidFn2, r, ref, bu.id, tehranDate()), { parse_mode: 'HTML' })
      await sendmessage(ref, sprintf(first ? T.users.affiliates.commissionPaidFn : T.users.affiliates.commissionPaidFn2, r), null, 'HTML')
    }
    const method = usernameMethodKey(T, panel.MethodUsername)
    if (['customTextSequential', 'usernameSequential', 'numericIdSequential', 'agentCustomTextSequential'].includes(method)) {
      await run(sql`UPDATE user SET number_username = ${intval(bu.number_username) + 1} WHERE id = ${bu.id}`)
      if (['customTextSequential', 'agentCustomTextSequential'].includes(method)) await run(sql`UPDATE setting SET numbercount = ${intval(S.numbercount) + 1}`)
    }
    const left = Math.max(0, n(bu.Balance) - n(inv.price_product))
    await run(sql`UPDATE user SET Balance = ${left <= 0 ? 0 : left} WHERE id = ${bu.id}`)
    const after2 = numberFormat(n((await userBy(inv.id_user))?.Balance), 0)
    const kb = J({ inline_keyboard: [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + bu.id }]] })
    await report('buyreport', sprintf(T.Admin.reportgroup.accountCreatedAfterPay, bought === 1 ? T.common.labels.firstPurchaseAlt : '', bu.id, bu.username, username, inv.Service_location, days, inv.name_product, inv.Volume,
      numberFormat(n(bu.Balance), 0), after2, inv.id_invoice, bu.agent, bu.number, inv.price_product, pay.price, jdate('Y/m/d H:i:s')), { parse_mode: 'HTML', reply_markup: kb })
    if (intval(S.scorestatus) === 1 && !admins.includes(String(bu.id))) {
      await sendmessage(bu.id, T.users.affiliates.pointsEarned1Alt, null, 'html')
      await run(sql`UPDATE user SET score = ${n(bu.score) + 1} WHERE id = ${bu.id}`)
    }
    await run(sql`UPDATE invoice SET Status = 'active' WHERE username = ${inv.username}`)
    if (cardLike) await adminMsg(sprintf(T.Admin.reportgroup.paymentConfirmedService, username, inv.Service_location, bu.id, pay.id_order, bu.username, bu.Balance, priceFmt, pay.dec_not_confirmed))
    return
  }

  if (steppay[0] === 'getextenduser') {
    const after2 = numberFormat(n((await userBy(bu.id))?.Balance), 0)
    const [uname, tag] = String(steppay[1] ?? '').split('%')
    const order = await one(sql`SELECT * FROM service_other WHERE username = ${uname ?? null} AND value LIKE '%' || ${tag ?? ''} || '%' AND id_user = ${bu.id}`)
    if (!order) { await sendmessage(bu.id, T.users.extend.genericError, c.keyboard, 'HTML'); return }
    let so = {}
    try { so = JSON.parse(order.value) || {} } catch { so = {} }
    const inv = (await one(sql`SELECT * FROM invoice WHERE username = ${uname}`)) || {}
    const panel = (await panelBy(inv.Service_location)) || {}
    let prod
    if (so.code_product === 'custom_volume') prod = { code_product: 'custom_volume', name_product: inv.name_product, price_product: order.price, Service_time: so.Service_time, Volume_constraint: so.volumebuy }
    else prod = (await one(sql`SELECT * FROM product WHERE (Location = ${inv.Service_location ?? null} OR Location = '/all') AND agent = ${bu.agent} AND code_product = ${so.code_product ?? null}`)) || {}
    if (eq(inv.name_product, T.common.labels.testServiceFn)) await run(sql`UPDATE invoice SET name_product = ${prod.name_product ?? null}, price_product = ${prod.price_product ?? null} WHERE id_invoice = ${inv.id_invoice}`)
    await run(sql`UPDATE user SET Balance = '0' WHERE id = ${bu.id}`)
    const ex = await panelExtend(panel.Methodextend, prod.Volume_constraint, prod.Service_time, inv.username, prod.code_product, panel.code_panel, extendLabels(T))
    if (ex.status === false) {
      const bal = n(bu.Balance) + n(pay.price)
      await run(sql`UPDATE user SET Balance = ${bal} WHERE id = ${bu.id}`)
      await sendmessage(bu.id, T.users.sell.errorConfig, c.keyboard, 'HTML')
      await sendmessage(bu.id, sprintf(T.users.Balance.refundRenewFailed, bal), c.keyboard, 'HTML')
      await sendmessage(inv.id_user, T.users.extend.errorSupport, null, 'HTML')
      await report('errorreport', sprintf(T.Admin.reportgroup.errorRenewServiceFn, panel.name_panel, inv.username, phpJson(ex.msg)), { parse_mode: 'HTML' })
      return
    }
    await run(sql`UPDATE service_other SET output = ${JSON.stringify(ex)}, status = 'paid' WHERE id = ${order.id}`)
    await discountUsed('discountCodeUsedFn')
    const cbv = bu.agent === 'f' ? await shop('chashbackextend') : agentOf(await shop('chashbackextend_agent'), bu.agent)
    if (intval(cbv) !== 0) {
      const result = (n(prod.price_product) * n(cbv)) / 100
      await run(sql`UPDATE user SET Balance = ${result} WHERE id = ${bu.id}`)
      await sendmessage(bu.id, sprintf(T.users.extend.giftChargedFn, result), null, 'HTML')
    }
    const pf = numberFormat(n(prod.price_product))
    const kb = J({ inline_keyboard: [[{ text: T.users.status.backlist, callback_data: 'backorder' }], [{ text: T.users.status.backservice, callback_data: 'product_' + inv.id_invoice }]] })
    await sendmessage(bu.id, sprintf(T.users.extend.successFn, uname, prod.name_product, pf), kb, 'HTML')
    if (intval(S.scorestatus) === 1 && !admins.includes(String(bu.id))) {
      await sendmessage(bu.id, T.users.affiliates.pointsEarned2Alt, null, 'html')
      await run(sql`UPDATE user SET score = ${n(bu.score) + 2} WHERE id = ${bu.id}`)
    }
    await report('otherservice', sprintf(T.Admin.reportgroup.renewedFn, bu.id, bu.username, uname, inv.Service_location, prod.name_product, prod.Volume_constraint, prod.Service_time, pf, after2, jdate('Y/m/d H:i:s')), { parse_mode: 'HTML' })
    await run(sql`UPDATE invoice SET Status = 'active' WHERE id_invoice = ${inv.id_invoice ?? null}`)
    if (cardLike) await adminMsg(sprintf(T.Admin.reportgroup.paymentConfirmedRenew, uname, prod.name_product, inv.Service_location, bu.id, pay.id_order, bu.username, bu.Balance, priceFmt, pay.dec_not_confirmed))
    return
  }

  if (steppay[0] === 'getextravolumeuser' || steppay[0] === 'getextratimeuser') {
    const vol = steppay[0] === 'getextravolumeuser'
    const [uname, amount] = String(steppay[1] ?? '').split('%')
    const inv = (await one(sql`SELECT * FROM invoice WHERE username = ${uname ?? null}`)) || {}
    const panel = (await panelBy(inv.Service_location)) || {}
    await run(sql`UPDATE user SET Balance = '0' WHERE id = ${vol ? bu.id : inv.id_user ?? null}`)
    const d = await dataUser(inv.Service_location ?? null, uname ?? null, c.domain)
    const value = JSON.stringify(vol ? { volume_value: amount, old_volume: d.data_limit ?? null, expire_old: d.expire ?? null } : { day: amount, old_volume: d.data_limit ?? null, expire_old: d.expire ?? null })
    const ex = vol ? await extraVolume(inv.username, panel.code_panel, amount) : await extraTime(inv.username, panel.code_panel, amount)
    if (ex.status === false) {
      await sendmessage(vol ? inv.id_user : c.from_id, T.users.extraVolume.serviceError, null, 'HTML')
      await report('errorreport', sprintf(vol ? T.Admin.reportgroup.errorExtraVolumeFn : T.Admin.reportgroup.errorExtraTimeFn, panel.name_panel, inv.username, phpJson(ex.msg)), { parse_mode: 'HTML' })
      return
    }
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (${bu.id}, ${uname}, ${value}, ${vol ? 'extra_user' : 'extra_time_user'}, ${tehranDate()}, ${pay.price}, ${JSON.stringify(ex)})`)
    const kb = J({ inline_keyboard: [[{ text: T.users.status.backservice, callback_data: 'product_' + inv.id_invoice }]] })
    const pf = numberFormat(n(pay.price), 0)
    if (intval(S.scorestatus) === 1 && !admins.includes(String(bu.id))) {
      await sendmessage(bu.id, T.users.affiliates.pointsEarned1Alt, null, 'html')
      await run(sql`UPDATE user SET score = ${n(bu.score) + 1} WHERE id = ${bu.id}`)
    }
    await sendmessage(bu.id, sprintf(vol ? T.users.extraVolume.successFn : T.users.extraTime.successFn, uname, amount, pf), kb, 'HTML')
    if (pay.Payment_Method === 'cart to cart') await adminMsg(sprintf(vol ? T.Admin.reportgroup.paymentConfirmedExtraVolume : T.Admin.reportgroup.paymentConfirmedExtraTime, amount, uname, bu.id, pay.id_order, bu.username, bu.Balance, priceFmt))
    await run(sql`UPDATE invoice SET Status = 'active' WHERE id_invoice = ${inv.id_invoice ?? null}`)
    if (vol) await report('otherservice', sprintf(T.Admin.reportgroup.extraVolumeFn, bu.id, amount, pay.price, uname, bu.Balance), { parse_mode: 'HTML' })
    else await report('otherservice', sprintf(T.Admin.reportgroup.extraTimeFn, bu.id, amount, pay.price, uname))
    return
  }

  // a wallet top-up
  await run(sql`UPDATE user SET Balance = ${intval(bu.Balance) + intval(pay.price)} WHERE id = ${pay.id_user}`)
  await run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ${pay.id_order}`)
  const pf = numberFormat(n(pay.price), 0)
  if (cardLike) await adminMsg(sprintf(T.Admin.reportgroup.newPaymentBalanceFn, bu.id, pay.id_order, bu.username, pf, bu.Balance, pay.dec_not_confirmed))
  await sendmessage(pay.id_user, sprintf(T.users.Balance.chargedThanks, pf, pay.id_order), null, 'HTML')
}
