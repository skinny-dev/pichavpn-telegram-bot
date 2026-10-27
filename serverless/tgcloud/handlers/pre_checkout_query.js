// Telegram Stars / invoice payments: handled by the main bot's code (relay).
import { api, BotApiError } from 'sdk'
import { relay } from '../lib/picha.js'

export default async function (q, ctx) {
  try {
    if (await relay(ctx.update)) return
  } catch (e) {
    console.error(e)
  }
  try {
    await api.answerPreCheckoutQuery({ pre_checkout_query_id: q.id, ok: false, error_message: 'الان پرداخت ممکن نیست؛ چند دقیقه بعد دوباره امتحان کنید.' })
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e
  }
}
