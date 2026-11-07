// Admin: approve / reject a payment receipt, add balance by hand, block a user for a fake receipt — admin.php
import { one, run, sql } from '../db.js'
import { sendmessage, Editmessagetext, telegram } from '../tg.js'
import { step } from '../bot.js'
import { directPayment } from '../directpay.js'
import { keyboardAdmin, backAdmin } from './keyboards.js'
import { sprintf, numberFormat, intval, J } from '../php.js'

const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v))
const n = (v) => (isNumeric(v) ? Number(v) : 0)
const canPay = (c) => ['administrator', 'Seller'].includes(c.adminRow?.rule)
const alert = (c, text) => telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id, text, show_alert: true, cache_time: 5 })
const report = (c, thread, text, extra = {}) => (String(c.setting.Channel_Report ?? '').length > 0 ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML', ...extra }) : null)
const orderBy = (id) => one(sql`SELECT * FROM Payment_report WHERE id_order = ${id ?? null}`)

export const adminPayRoutes = [
  async (c) => {
    const m = /Confirm_pay_(\w+)/.exec(c.datain)
    if (!m || !canPay(c)) return false
    const T = c.T, P = T.Admin.Payment, id = m[1]
    const o = await orderBy(id)
    const done = J({ inline_keyboard: [[{ text: T.keyboard.confirmed, callback_data: 'confirmpaid' }], [{ text: T.keyboard.userManagementBtn, callback_data: 'manageuser_' + (o?.id_user ?? '') }]] })
    if (!o) { await alert(c, T.keyboard.transactionDeleted); return true }
    const pending = Number((await one(sql`SELECT COUNT(*) AS n FROM Payment_report WHERE id_user = ${o.id_user} AND payment_Status != 'paid' AND payment_Status != 'Unpaid' AND payment_Status != 'expire' AND payment_Status != 'reject'
      AND (id_invoice LIKE '%getconfigafterpay%' OR id_invoice LIKE '%getextenduser%' OR id_invoice LIKE '%getextravolumeuser%' OR id_invoice LIKE '%getextratimeuser%')`)).n)
    const kind = String(o.id_invoice ?? '').split('|')[0]
    if (pending > 0 && !['getconfigafterpay', 'getextenduser', 'getextravolumeuser', 'getextratimeuser'].includes(kind)) { await sendmessage(c.from_id, P.reviewReceiptsFirst, null, 'HTML'); return true }
    const fmt = numberFormat(n(o.price))
    let bu = (await one(sql`SELECT * FROM user WHERE id = ${String(o.id_user)}`)) || {}
    const other = async () => {
      await alert(c, P.reviewedPayment)
      await Editmessagetext(c.from_id, c.message_id, sprintf(P.approvedByOther, bu.id, o.id_order, bu.username, bu.Balance, fmt), done)
    }
    if (o.payment_Status === 'paid' || o.payment_Status === 'reject') { await other(); return true }
    // a second Variza / Tetraminator link for the same amount is easy to approve by hand after the first one was paid by the gateway; the order lock
    // cannot see that (two orders): refused when the same customer has an equal paid order of the same gateway from the last 30 minutes
    if (['variza', 'tetraminator'].includes(o.Payment_Method)) {
      const d = new Date((Math.floor(Date.now() / 1000) - 1800 + 12600) * 1000), p2 = (x) => String(x).padStart(2, '0')
      const cut = `${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
      const dup = await one(sql`SELECT id_order FROM Payment_report WHERE id_user = ${o.id_user} AND Payment_Method = ${o.Payment_Method} AND payment_Status = 'paid' AND price = ${o.price} AND id_order <> ${id} AND time >= ${cut} LIMIT 1`)
      if (dup) { await alert(c, `⚠️ این کاربر همین الان یک پرداخت هم‌مبلغ تأییدشده از همین درگاه دارد (سفارش ${dup.id_order}). احتمالاً تکراری است؛ تأیید نشد.`); return true }
    }
    const claim = await run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ${id} AND payment_Status NOT IN ('paid', 'reject')`)
    if (Number(claim?.rowsAffected ?? 0) === 0) { await other(); return true }
    await directPayment(c, id, done)
    if (o.Payment_Method === 'variza') await Editmessagetext(c.from_id, c.message_id, `✅ پرداخت واریزا (رسید دستی) تأیید شد\n🧾 سفارش: <code>${id}</code>\n💰 مبلغ: ${fmt} تومان`, done)
    const cash = (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = 'chashbackcart'`))?.ValuePay ?? null
    bu = (await one(sql`SELECT * FROM user WHERE id = ${String(o.id_user)}`)) || {}
    if (String(cash ?? '') !== '0') {
      const result = (n(o.price) * n(cash)) / 100
      await run(sql`UPDATE user SET Balance = ${intval(bu.Balance) + result} WHERE id = ${bu.id ?? null}`)
      await sendmessage(bu.id, sprintf(T.users.Balance.giftDepositAlt, result), null, 'HTML')
    }
    await report(c, 'paymentreport', sprintf(T.Admin.reportgroup.paymentApproved, o.Payment_Method, c.from_id, numberFormat(n(o.price)), o.id_user, bu.username, id))
    await run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ${o.id_order}`)
    await run(sql`UPDATE user SET Processing_value_one = 'none', Processing_value_tow = 'none', Processing_value_four = 'none' WHERE id = ${bu.id ?? null}`)
    return true
  },
  async (c) => {
    const m = /reject_pay_(\w+)/.exec(c.datain)
    if (!m || !canPay(c)) return false
    const T = c.T
    const o = await orderBy(m[1])
    if (!o) { await alert(c, T.keyboard.transactionDeleted); return true }
    await run(sql`UPDATE user SET Processing_value = ${o.id_user}, Processing_value_one = ${m[1]} WHERE id = ${c.from_id}`)
    if (o.payment_Status === 'reject' || o.payment_Status === 'paid') { await alert(c, T.Admin.Payment.reviewedPayment); return true }
    await run(sql`UPDATE Payment_report SET payment_Status = 'reject' WHERE id_order = ${m[1]}`)
    await sendmessage(c.from_id, T.Admin.Payment.reasonRejecting, backAdmin(c), 'HTML')
    await step(c, 'reject-dec')
    await Editmessagetext(c.from_id, c.message_id, c.text_inline, null)
    return true
  },
  async (c) => {
    if (c.user.step !== 'reject-dec') return false
    const T = c.T, id = c.user.Processing_value_one
    const o = (await orderBy(id)) || {}
    await run(sql`UPDATE Payment_report SET dec_not_confirmed = ${c.text} WHERE id_order = ${id ?? null}`)
    await sendmessage(c.from_id, T.Admin.Payment.rejected, keyboardAdmin(c), 'HTML')
    await sendmessage(c.user.Processing_value, sprintf(T.users.Balance.rejectedNotice, c.text, id), null, 'HTML')
    await step(c, 'home')
    await report(c, 'paymentreport', sprintf(T.Admin.reportgroup.paymentRejected, o.Payment_Method, c.from_id, c.username, o.price, c.text, o.id_user))
    return true
  },
  // block for a fake receipt: confirm first
  async (c) => {
    const m = /banuserlist_(\w+)/.exec(c.datain) || /blockuserfake_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const u = (await one(sql`SELECT * FROM user WHERE id = ${m[1]}`)) || {}
    if (u.User_Status === 'block') { await sendmessage(c.from_id, T.Admin.manageUser.blockedUser, null, 'HTML'); return true }
    await sendmessage(c.from_id, T.Admin.confirmByButton, J({ inline_keyboard: [[{ text: T.keyboard.confirm, callback_data: 'acceptblock_' + m[1] }]] }), 'HTML')
    return true
  },
  async (c) => {
    if (c.user.step !== 'adddecriptionblock') return false
    await run(sql`UPDATE user SET description_blocking = ${c.text} WHERE id = ${c.user.Processing_value ?? null}`)
    await sendmessage(c.from_id, c.T.Admin.manageUser.descriptionBlock, keyboardAdmin(c), 'HTML')
    await step(c, 'home')
    return true
  },
  async (c) => {
    const m = /acceptblock_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, id = m[1]
    await run(sql`UPDATE user SET Processing_value = ${id} WHERE id = ${c.from_id}`)
    await run(sql`UPDATE user SET User_Status = 'block' WHERE id = ${id}`)
    await sendmessage(c.from_id, T.Admin.manageUser.blockUser, backAdmin(c), 'HTML')
    await step(c, 'adddecriptionblock')
    const kb = J({ inline_keyboard: [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + id }]] })
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.userBlocked, id, c.from_id), { reply_markup: kb })
    return true
  },
  // add balance by hand instead of approving
  async (c) => {
    const m = /addbalamceuser_(\w+)/.exec(c.datain)
    if (!m || !canPay(c)) return false
    const T = c.T
    const o = (await orderBy(m[1])) || {}
    await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
    if (o.payment_Status === 'paid' || o.payment_Status === 'reject') { await alert(c, T.Admin.Payment.reviewedPayment); return true }
    await run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ${m[1]}`)
    await sendmessage(c.from_id, T.Admin.manageUser.addBalanceUserDesc, backAdmin(c), 'html')
    await step(c, 'addbalancemanual')
    await Editmessagetext(c.from_id, c.message_id, c.text_inline, null)
    return true
  },
  async (c) => {
    if (c.user.step !== 'addbalancemanual') return false
    const T = c.T
    if (!/^[0-9]+$/.test(c.text)) { await sendmessage(c.from_id, T.Admin.Balance.invalidPrice, backAdmin(c), 'HTML'); return true }
    await sendmessage(c.from_id, T.Admin.Balance.addBalanceUser, keyboardAdmin(c), 'HTML')
    const o = (await orderBy(c.user.Processing_value)) || {}
    const u = (await one(sql`SELECT * FROM user WHERE id = ${o.id_user ?? null}`)) || {}
    await run(sql`UPDATE user SET Balance = ${n(u.Balance) + Number(c.text)} WHERE id = ${o.id_user ?? null}`)
    await sendmessage(o.id_user, sprintf(T.users.Balance.addedNotice3, numberFormat(Number(c.text), 0)), null, 'HTML')
    await report(c, 'paymentreport', sprintf(T.Admin.reportgroup.balanceManualAdd, o.id_user, u.username, o.price, c.text))
    await step(c, 'home')
    return true
  },
]
