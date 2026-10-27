// Telegram Stars: pre-checkout and the successful payment — index.php lines 6653–6700
import { one, run, sql } from '../db.js'
import { sendmessage, telegram } from '../tg.js'
import { directPayment } from '../directpay.js'
import { addBalance } from '../catalog.js'
import { sprintf, intval } from '../php.js'

export const starsRoutes = [
  async (c) => {
    const q = c.update.pre_checkout_query
    if (!q) return false
    const o = await one(sql`SELECT * FROM Payment_report WHERE id_order = ${q.invoice_payload ?? null}`)
    if (!o) return true
    await telegram('answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: true })
    if (o.payment_Status === 'paid') return true
    await run(sql`UPDATE Payment_report SET dec_not_confirmed = ${JSON.stringify(q)} WHERE id_order = ${o.id_order}`)
    return true
  },
  async (c) => {
    const sp = c.update.message?.successful_payment
    if (!sp) return false
    const T = c.T
    const o = await one(sql`SELECT * FROM Payment_report WHERE id_order = ${sp.invoice_payload ?? null}`)
    if (!o || o.payment_Status === 'paid') return true
    await run(sql`UPDATE Payment_report SET dec_not_confirmed = ${String(o.dec_not_confirmed ?? '') + JSON.stringify(sp)} WHERE id_order = ${o.id_order}`)
    // claim first: a second delivery of the same update never pays twice
    const claim = await run(sql`UPDATE Payment_report SET payment_Status = 'waiting' WHERE id_order = ${o.id_order} AND payment_Status != 'paid'`)
    if (Number(claim?.rowsAffected ?? 0) === 0) return true
    await directPayment(c, o.id_order)
    const cash = (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = 'chashbackstar'`))?.ValuePay ?? null
    const u = (await one(sql`SELECT * FROM user WHERE id = ${String(o.id_user)}`)) || {}
    if (String(cash ?? '') !== '0') {
      const result = (Number(o.price) * Number(cash)) / 100
      await addBalance(u.id, result)
      await sendmessage(u.id, sprintf(T.users.Discount['gift-deposit'], result), null, 'HTML')
    }
    if (String(c.setting.Channel_Report ?? '').length > 0) {
      await telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics.paymentreport, text: sprintf(T.Admin.reportgroup.newPaymentStar, u.username, u.id, o.price, ''), parse_mode: 'HTML' })
    }
    await run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ${o.id_order}`)
    return true
  },
]
