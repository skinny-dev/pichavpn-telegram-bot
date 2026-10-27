// Wallet top-up and paying for an order — index.php lines 4671–5916: amount, payment method (card-to-card, Variza,
// Telegram Stars), receipt photo to the admins, gift code, tariff list.
import { fetch } from 'sdk'
import { one, run, sql, kvGet } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram, sendphoto, sendvideo } from '../tg.js'
import { step, tehranDate } from '../bot.js'
import { backuserKb } from '../keyboards.js'
import { stepPaymentKb, customPlanPrice, addBalance } from '../catalog.js'
import { smsUniqueAmount, smsReconcileOrder, reportTs } from '../sms.js'
import { pullRelay } from '../relay.js'
import { sprintf, strtr, numberFormat, intval, time, randomHex, J } from '../php.js'

const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v))
const n = (v) => (isNumeric(v) ? Number(v) : 0)
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
const pay = async (name) => (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${name}`))?.ValuePay ?? null
/** PHP 8 `$a < $b` for DB strings / null */
const lt = (a, b) => (b === null || b === undefined ? false : isNumeric(a) && isNumeric(b) ? Number(a) < Number(b) : String(a ?? '') < String(b))
const gt = (a, b) => (b === null || b === undefined ? Boolean(a) && a !== '0' : isNumeric(a) && isNumeric(b) ? Number(a) > Number(b) : String(a ?? '') > String(b))
const orderBy = (id) => one(sql`SELECT * FROM Payment_report WHERE id_order = ${id ?? null}`)
const report = (c, thread, text) => (String(c.setting.Channel_Report ?? '').length > 0 ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML' }) : null)
const confirmKb = (c, o, extra = []) => J({ inline_keyboard: [
  [{ text: c.T.users.Balance.confirmPaying, callback_data: `Confirm_pay_${o.id_order}` }, { text: c.T.users.Balance.rejectPay, callback_data: `reject_pay_${o.id_order}` }],
  [{ text: c.T.users.Balance.addBalanceUser, callback_data: `addbalamceuser_${o.id_order}` }, { text: c.T.users.Balance.blockedfake, callback_data: `blockuserfake_${o.id_user}` }],
  ...extra,
] })
/** the help (text / photo / video) an admin set for a payment method */
async function sendHelp(c, name, withCaption) {
  const raw = await pay(name)
  if (raw === null || (isNumeric(raw) && Number(raw) === 2)) return // 2 = no help set
  let d = null
  try { d = JSON.parse(raw) } catch { d = null }
  if (!d || typeof d !== 'object') return
  if (d.type === 'text') await sendmessage(c.from_id, d.text, null, 'HTML')
  else if (d.type === 'photo') await sendphoto(c.from_id, d.photoid, withCaption ? d.text : null)
  else if (d.type === 'video') await sendvideo(c.from_id, d.videoid, withCaption ? d.text : null)
}
/** updatePaymentMessageId() */
async function rememberMessage(res, orderId) {
  if (res && res.ok && res.result && res.result.message_id !== undefined) await run(sql`UPDATE Payment_report SET message_id = ${intval(res.result.message_id)} WHERE id_order = ${orderId}`)
}
/** receiptAllowed(): is a receipt accepted for this order now (and say why not) */
async function receiptAllowed(c, order) {
  const B = c.T.users.Balance
  const since = tehranDate(time() - 600)
  const recent = Number((await one(sql`SELECT COUNT(*) AS n FROM Payment_report WHERE id_user = ${c.from_id} AND at_updated > ${since} AND payment_Status IN ('waiting','paid','reject')`)).n)
  const map = { paid: B.alreadyConfirmed, expire: B.transactionExpired, reject: B.varizaReceiptRejected || '❌ این پرداخت رد شده است.', waiting: B.varizaReceiptWaiting || '✅ رسید شما قبلاً ثبت شده است.' }
  let msg = map[String(order.payment_Status ?? '')] ?? null
  if (msg === null && !c.isAdmin && recent >= 3) msg = B.receiptTooMany || B.receiptCooldown
  if (msg !== null) { await sendmessage(c.from_id, msg, null, 'HTML'); return false }
  return true
}
/** minutes Variza may still need to confirm by itself (receiptGate's «early») */
async function varizaEarly(order) {
  const delay = intval((await pay('variza_receipt_delay')) ?? 5)
  const created = reportTs(order)
  const left = created > 0 ? created + Math.max(0, delay) * 60 - time() : 0
  return left > 0 ? Math.ceil(left / 60) : 0
}

/** createPayVariza(): the payment page; the return address is the payment relay when one is set up */
async function createPayVariza(c, price, orderId) {
  const token = String((await pay('variza_api_token')) ?? '').trim()
  if (token === '' || token === '0') return { error: 'variza_api_token not set' }
  const relay = String((await kvGet('config:pay_relay_url')) || '').replace(/\/+$/, '')
  const back = relay ? `${relay}/variza_return.php?order=${orderId}` : `https://${c.domain}/payment/variza.php?order=${orderId}`
  const payload = { amount: intval(price), return_url: back, title: 'Mirza order ' + orderId, expires_in: '1h' }
  try {
    let status, raw
    const key = String((await kvGet('config:pay_relay_key')) || '')
    if (relay && key) {
      // through the relay: it can reach Variza from inside Iran (Variza may refuse foreign servers)
      const res = await fetch(`${relay}/variza_create`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relay-Key': key }, body: JSON.stringify({ token, payload }) })
      const r = JSON.parse(await res.text())
      if (!r || !r.ok) return { error: 'relay: ' + (r?.error ?? res.status) }
      status = intval(r.http_code); raw = String(r.body ?? '')
    } else {
      const res = await fetch('https://variza.ir/api/v1/pay', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload) })
      status = res.status; raw = await res.text()
    }
    let d = null
    try { d = JSON.parse(raw) } catch { d = null }
    if (!d || typeof d !== 'object') return { error: 'invalid json', raw, http_code: status }
    if (status < 200 || status >= 300) return { error: 'http ' + status, raw, decoded: d, http_code: status }
    return d
  } catch (e) {
    return { error: 'fetch: ' + String((e && e.message) || e) }
  }
}

export const payRoutes = [
  // Add_Balance: ask the amount
  async (c) => {
    if (c.datain !== 'Add_Balance') return false
    const T = c.T, user = c.user
    await run(sql`UPDATE user SET Processing_value = '0', Processing_value_one = '0', Processing_value_tow = '0', Processing_value_four = '0' WHERE id = ${c.from_id}`)
    await step(c, 'home')
    const on = c.setting.get_number === 'onAuthenticationphone'
    if (on && user.step !== 'get_number' && user.number === 'none') { await sendmessage(c.from_id, T.users.number.confirming, c.request_contact, 'HTML'); await step(c, 'get_number') }
    if (user.number === 'none' && on) return true
    const minb = numberFormat(n(agentOf(await pay('minbalance'), user.agent))), maxb = numberFormat(n(agentOf(await pay('maxbalance'), user.agent)))
    await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.Balance.enterAmount, minb, maxb), J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'account' }]] }), 'HTML')
    await step(c, 'getprice')
    await run(sql`UPDATE user SET Processing_value = ${String(c.message_id)} WHERE id = ${c.from_id}`)
    return true
  },
  async (c) => {
    if (c.user.step !== 'getprice') return false
    const T = c.T, user = c.user
    await deletemessage(c.from_id, user.Processing_value)
    if (!isNumeric(c.text)) { await sendmessage(c.from_id, T.users.Balance.errorprice, null, 'HTML'); return true }
    const minb = agentOf(await pay('minbalance'), user.agent), maxb = agentOf(await pay('maxbalance'), user.agent)
    if (gt(c.text, maxb) || lt(c.text, minb)) { await sendmessage(c.from_id, sprintf(T.users.Balance.amountRangeError, numberFormat(n(minb)), numberFormat(n(maxb))), null, 'HTML'); return true }
    if (n(user.Balance) < 0 && intval(c.setting.Debtsettlement) === 1) {
      const debt = Math.abs(n(user.Balance))
      if (Number(c.text) < debt) { await sendmessage(c.from_id, sprintf(T.users.Balance.debtRequired, debt), null, 'HTML'); return true }
    }
    await run(sql`UPDATE user SET Processing_value = ${c.text} WHERE id = ${c.from_id}`)
    await sendmessage(c.from_id, T.users.Balance.selectPayment, await stepPaymentKb(c), 'HTML')
    await step(c, 'get_step_payment')
    return true
  },
  // a payment method
  async (c) => {
    const GW = ['cart_to_offline', 'aqayepardakht', 'zarinpal', 'variza', 'plisio', 'nowpayment', 'iranpay1', 'iranpay2', 'iranpay4', 'iranpay3', 'digitaltron', 'startelegrams']
    if (!(c.user.step === 'get_step_payment' && GW.includes(c.datain))) return false
    const T = c.T, user = c.user, B = T.users.Balance
    const amount = user.Processing_value
    const range = async (minKey, maxKey) => {
      const lo = await pay(minKey), hi = await pay(maxKey)
      if (lt(amount, lo) || gt(amount, hi)) {
        await sendmessage(c.from_id, strtr(B.depositRange, { '{mainbalance}': numberFormat(n(lo)), '{maxbalance}': numberFormat(n(hi)) }), null, 'HTML')
        return false
      }
      return true
    }
    const invoiceTag = `${user.Processing_value_tow ?? ''}|${user.Processing_value_one ?? ''}`
    if (c.datain === 'cart_to_offline') {
      if (!(await range('minbalancecart', 'maxbalancecart'))) return true
      const card = await one(sql`SELECT * FROM card_number ORDER BY RANDOM() LIMIT 1`)
      if (!card || !card.cardnumber || !card.namecard) { await sendmessage(c.from_id, B.noActiveCard, null, 'HTML'); return true }
      let price = intval(amount)
      const sms = ((await pay('smsautoconfirm')) ?? 'offsms') === 'onsms'
      if (sms) price = await smsUniqueAmount(price)
      let text = strtr(T.textbot.cart, { '{price}': numberFormat(price), '{card_number}': card.cardnumber, '{name_card}': card.namecard })
      if (sms) text += '\n\n⚠️ <b>دقیقاً همین مبلغ</b> را واریز کنید تا پرداخت شما خودکار و فوری تأیید شود.'
      const orderId = randomHex(5)
      await run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES (${c.from_id}, ${orderId}, ${tehranDate()}, ${price}, 'Unpaid', 'cart to cart', ${invoiceTag})`)
      await deletemessage(c.from_id, c.message_id)
      const receiptBtn = [{ text: T.keyboard.paidSendReceipt, callback_data: 'sendresidcart-' + orderId }]
      const kb = String(c.setting.statuscopycart) === '1'
        ? J({ inline_keyboard: [[{ text: T.keyboard.copyCardNumber, copy_text: { text: card.cardnumber } }, { text: T.keyboard.copyAmount, copy_text: { text: intval(price + '0') } }], receiptBtn] })
        : J({ inline_keyboard: [receiptBtn] })
      await sendHelp(c, 'helpcart', true)
      await rememberMessage(await telegram('sendmessage', { chat_id: c.from_id, text, reply_markup: kb, parse_mode: 'html' }), orderId)
      return true
    }
    if (c.datain === 'variza') {
      if (n(amount) < 5000) { await sendmessage(c.from_id, B.variza, null, 'HTML'); return true }
      if (!(await range('minbalancevariza', 'maxbalancevariza'))) return true
      await deletemessage(c.from_id, c.message_id)
      await sendmessage(c.from_id, B.linkpayments, c.keyboard, 'HTML')
      const orderId = randomHex(5)
      const p = await createPayVariza(c, amount, orderId)
      if (!p.pay_url) {
        const err = p.error ?? JSON.stringify(p)
        await sendmessage(c.from_id, B.errorLinkPayment, c.keyboard, 'HTML')
        await step(c, 'home')
        await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorZarinpalLink || 'Variza link error: %s user %s', err, c.from_id))
        return true
      }
      await run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice, dec_not_confirmed)
        VALUES (${c.from_id}, ${orderId}, ${tehranDate()}, ${amount}, 'Unpaid', 'variza', ${invoiceTag}, ${p.slug ?? orderId})`)
      const kb = J({ inline_keyboard: [[{ text: B.payments, url: p.pay_url }], [{ text: B.varizaReceiptButton || '📎 پرداخت کردم، ارسال رسید', callback_data: 'sendresidvariza-' + orderId }]] })
      await sendHelp(c, 'helpvariza', false)
      await rememberMessage(await sendmessage(c.from_id, sprintf(B.invoiceCreated2, orderId, numberFormat(n(amount), 0)), kb, 'HTML'), orderId)
      return true
    }
    if (c.datain === 'startelegrams') {
      const rates = await rateArze()
      if (!rates || !rates.USD) { await sendmessage(c.from_id, B.errorLinkPayment, c.keyboard, 'HTML'); await step(c, 'home'); return true }
      const usd = Number(rates.USD)
      const stars = Math.trunc(n(amount) / (usd * 0.016))
      if (!(await range('minbalancestar', 'maxbalancestar'))) return true
      await deletemessage(c.from_id, c.message_id)
      await sendmessage(c.from_id, B.linkpayments, c.keyboard, 'HTML')
      const orderId = randomHex(5)
      await run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES (${c.from_id}, ${orderId}, ${tehranDate()}, ${amount}, 'Unpaid', 'Star Telegram', ${invoiceTag})`)
      const link = await telegram('createInvoiceLink', { title: `Buy for Price ${amount}`, description: 'Buy price', payload: orderId, currency: 'XTR', prices: J([{ label: 'Price', amount: stars }]) })
      if (!link || link.ok === false) {
        await sendmessage(c.from_id, B.errorLinkPayment, c.keyboard, 'HTML')
        await step(c, 'home')
        await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorStarInvoice, JSON.stringify(link), c.from_id, 'Star Telegram', c.username))
        return true
      }
      const fmt = numberFormat(n(amount), 0)
      const kb = J({ inline_keyboard: [[{ text: B.payments, url: link.result }]] })
      await sendHelp(c, 'helpstar', false)
      await rememberMessage(await sendmessage(c.from_id, sprintf(B.transactionCreatedStar, orderId, stars, fmt, fmt), kb, 'HTML'), orderId)
      return true
    }
    // gateways that need the PHP server's callback pages
    await sendmessage(c.from_id, B.errorLinkPayment, c.keyboard, 'HTML')
    await step(c, 'home')
    return true
  },
  // «I paid, send the receipt» (Variza)
  async (c) => {
    const m = /^sendresidvariza-([A-Za-z0-9]+)$/.exec(c.datain)
    if (!m) return false
    await pullRelay(c, true) // Variza may have confirmed it already
    const o = await orderBy(m[1])
    if (!o || String(o.id_user) !== c.from_id || o.Payment_Method !== 'variza') return true
    if (!(await receiptAllowed(c, o))) return true
    await deletemessage(c.from_id, c.message_id)
    await sendmessage(c.from_id, c.T.users.Balance.askReceiptImage, backuserKb(c), 'HTML')
    await step(c, 'cart_to_cart_user')
    await run(sql`UPDATE user SET Processing_value = ${o.id_order} WHERE id = ${c.from_id}`)
    return true
  },
  // «I paid, send the receipt» (card-to-card): an SMS that already arrived approves it at once
  async (c) => {
    const m = /^sendresidcart-(.*)/.exec(c.datain)
    if (!m) return false
    await pullRelay(c, true) // the bank SMS may be waiting in the relay
    const o = await orderBy(m[1])
    if (!o || String(o.id_user) !== c.from_id) return true
    if (!(await receiptAllowed(c, o))) return true
    if ((await pay('smsautoconfirm')) === 'onsms' && (await smsReconcileOrder(c, o))) { await deletemessage(c.from_id, c.message_id); return true }
    await deletemessage(c.from_id, c.message_id)
    await sendmessage(c.from_id, c.T.users.Balance.askReceiptImage, backuserKb(c), 'HTML')
    await step(c, 'cart_to_cart_user')
    await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
    return true
  },
  // the receipt photo: to every admin with approve / reject buttons
  async (c) => {
    if (c.user.step !== 'cart_to_cart_user') return false
    const T = c.T, B = T.users.Balance, user = c.user
    const bal = numberFormat(n(user.Balance), 0)
    if (!c.photo || c.update.message?.media_group_id !== undefined) { await sendmessage(c.from_id, B.onlyOneImage, null, 'HTML'); return true }
    await step(c, 'home')
    const o = await orderBy(user.Processing_value)
    if (!o || String(o.id_user) !== c.from_id) { await sendmessage(c.from_id, T.users.infoFetchErrorRestart, c.keyboard, 'HTML'); return true }
    if (['paid', 'reject', 'expire'].includes(o.payment_Status)) { await sendmessage(c.from_id, o.payment_Status === 'paid' ? B.alreadyConfirmed : B.transactionExpired, c.keyboard, 'HTML'); return true }
    let kb = confirmKb(c, o)
    const priceFmt = numberFormat(n(o.price), 0)
    const [kind, rest = ''] = String(o.id_invoice ?? '').split('|')
    const R = T.Admin.reportgroup
    let text
    if (kind === 'getconfigafterpay') {
      const inv = await one(sql`SELECT * FROM invoice WHERE username = ${rest}`)
      if (!inv) { await sendmessage(c.from_id, B.restartPurchaseOrPay, c.keyboard, 'HTML'); return true }
      text = sprintf(R.newPaymentService2, inv.username, inv.name_product, inv.Volume, inv.Service_time, c.first_name, c.from_id, c.from_id, bal, o.id_order, c.username, priceFmt)
      await sendmessage(c.from_id, B.sendReceiptAndConfig, c.keyboard, 'HTML')
    } else if (kind === 'getextenduser') {
      const [uname, tag = ''] = rest.split('%')
      const so = await one(sql`SELECT * FROM service_other WHERE username = ${uname} AND value LIKE '%' || ${tag} || '%' AND id_user = ${c.from_id}`)
      if (!so) { await sendmessage(c.from_id, T.users.infoFetchErrorRestart, c.keyboard, 'HTML'); return true }
      let v = {}
      try { v = JSON.parse(so.value) || {} } catch { v = {} }
      const inv = (await one(sql`SELECT * FROM invoice WHERE username = ${uname}`)) || {}
      let prod
      if (v.code_product === 'custom_volume') {
        const panel = (await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${inv.Service_location ?? null}`)) || {}
        prod = { name_product: inv.name_product, price_product: await customPlanPrice(c, panel, user.agent, v.volumebuy, v.Service_time) }
      } else prod = (await one(sql`SELECT * FROM product WHERE (Location = ${inv.Service_location ?? null} OR Location = '/all') AND agent = ${user.agent} AND code_product = ${v.code_product ?? null}`)) || {}
      kb = confirmKb(c, o, [[{ text: T.keyboard.configInfo, callback_data: `manageinvoice_${inv.id_invoice ?? ''}` }]])
      text = sprintf(R.newPaymentRenew2, uname, prod.name_product, c.first_name, c.from_id, c.from_id, bal, o.id_order, c.username, priceFmt)
      await sendmessage(c.from_id, B.receiptSentRenew, c.keyboard, 'HTML')
    } else if (kind === 'getextravolumeuser' || kind === 'getextratimeuser') {
      const [uname, amount] = rest.split('%')
      const vol = kind === 'getextravolumeuser'
      text = sprintf(vol ? R.newPaymentExtraVolume2 : R.newPaymentExtraTime2, uname, amount, c.first_name, c.from_id, c.from_id, bal, o.id_order, c.username, priceFmt)
      await sendmessage(c.from_id, vol ? B.receiptSentExtraVolume : B.receiptSentExtraTime, c.keyboard, 'HTML')
    } else {
      text = sprintf(R.newPaymentBalance2, c.first_name, c.from_id, c.from_id, bal, o.id_order, c.username, priceFmt)
      await sendmessage(c.from_id, B.sendReceipt, c.keyboard, 'HTML')
    }
    if (o.Payment_Method === 'variza') {
      text += '\n\n⚠️ روش پرداخت: <b>واریزا (رسید دستی)</b>\nتأیید خودکار واریزا دریافت نشده؛ قبل از تأیید، واریز را در پنل واریزا یا حساب بانکی بررسی کنید.'
      const early = await varizaEarly(o)
      if (early > 0) {
        text += `\n⏳ این رسید زود ارسال شده؛ واریزا ممکن است تا حدود ${early} دقیقهٔ دیگر خودش تأیید کند (در این صورت لازم نیست کاری کنید).`
        await sendmessage(c.from_id, B.varizaReceiptEarlyNote, null, 'HTML')
      }
    }
    for (const id of c.admin_ids) {
      const a = await one(sql`SELECT rule FROM admin WHERE id_admin = ${id}`)
      if (a && a.rule === 'support') continue
      await telegram('sendphoto', { chat_id: id, photo: c.photoid, caption: c.caption, parse_mode: 'HTML' })
      await sendmessage(id, text, kb, 'HTML')
    }
    await run(sql`UPDATE Payment_report SET payment_Status = 'waiting', at_updated = ${tehranDate()} WHERE id_order = ${o.id_order} AND payment_Status IN ('Unpaid','waiting')`)
    return true
  },
  // gift code (wallet credit)
  async (c) => {
    if (c.datain !== 'Discount') return false
    await Editmessagetext(c.from_id, c.message_id, c.T.users.Discount.getcode, J({ inline_keyboard: [[{ text: c.T.users.status.backinfo, callback_data: 'account' }]] }))
    await step(c, 'get_code_user')
    return true
  },
  async (c) => {
    if (c.user.step !== 'get_code_user') return false
    const T = c.T, D = T.users.Discount
    const code = await one(sql`SELECT * FROM Discount WHERE code = ${c.text} COLLATE NOCASE LIMIT 1`)
    if (!code) { await sendmessage(c.from_id, D.notcode, null, 'HTML'); return true }
    if (n(code.limitused) >= n(code.limituse)) { await sendmessage(c.from_id, D.errorLimitDiscount, backuserKb(c), 'HTML'); return true }
    const used = Number((await one(sql`SELECT COUNT(*) AS n FROM Giftcodeconsumed WHERE id_user = ${c.from_id} AND code = ${c.text} COLLATE NOCASE`)).n)
    if (used !== 0) { await sendmessage(c.from_id, D.giftcodeonce, c.keyboard, 'HTML'); await step(c, 'home'); return true }
    await addBalance(c.from_id, code.price)
    await run(sql`UPDATE Discount SET limitused = ${intval(code.limitused) + 1} WHERE code = ${c.text} COLLATE NOCASE`)
    await step(c, 'home')
    await sendmessage(c.from_id, sprintf(D.giftcodesuccess, code.price), c.keyboard, 'HTML')
    await run(sql`INSERT INTO Giftcodeconsumed (id_user, code) VALUES (${c.from_id}, ${c.text})`)
    await report(c, 'otherreport', sprintf(D.giftcodeused, c.username, c.from_id, c.text))
    return true
  },
  async (c) => {
    if (!(c.text === c.T.textbot.tariffList || c.datain === 'Tariff_list')) return false
    await sendmessage(c.from_id, c.T.textbot.tariffListDesc, null, 'HTML')
    return true
  },
  async (c) => {
    if (c.datain !== 'colselist') return false
    await deletemessage(c.from_id, c.message_id)
    await sendmessage(c.from_id, c.T.users.back, c.keyboard, 'HTML')
    return true
  },
]

/** rate_arze(): USD / TON prices in toman */
export async function rateArze() {
  try {
    const res = await fetch('https://demo.mirzabot.com/b.php')
    const d = JSON.parse(await res.text())
    return d && typeof d.result === 'object' ? d.result : null
  } catch {
    return null
  }
}
