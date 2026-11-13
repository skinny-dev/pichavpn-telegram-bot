// the admin's on/off switches for the card-to-card gateways (پی‌چی and واریزا): the «💳 درگاه‌ها» button or /gateways
import { one, run, sql } from '../db.js'
import { sendmessage, Editmessagetext, answerCallback } from '../tg.js'
import { J } from '../php.js'

export const GATEWAY_BTN = '💳 درگاه‌های کارت به کارت'
const GW = {
  paychi: { name: 'پی‌چی', key: 'paychi_status', on: 'onpaychi', off: 'offpaychi', need: ['paychi_api_key', 'paychi_base_url'] },
  variza: { name: 'واریزا', key: 'variza_status', on: 'onvariza', off: 'offvariza', need: ['variza_api_token', 'variza_webhook_secret'] },
}
const getPay = async (k) => String((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay ?? '')
const setPay = async (k, v) => { await run(sql`DELETE FROM PaySetting WHERE NamePay = ${k}`); await run(sql`INSERT INTO PaySetting (NamePay, ValuePay) VALUES (${k}, ${v})`) }
const filled = (v) => v !== '' && v !== '0'

async function view() {
  const rows = []
  const kb = []
  for (const [id, g] of Object.entries(GW)) {
    const on = (await getPay(g.key)) === g.on
    const ready = (await Promise.all(g.need.map(async (k) => filled(await getPay(k))))).every(Boolean)
    rows.push(`${on ? '🟢' : '⚫️'} ${g.name}: ${on ? 'روشن' : 'خاموش'}${ready ? '' : ' ⚠️ (کلید/آدرس ثبت نشده)'}`)
    kb.push([{ text: on ? `⏹ خاموش کردن ${g.name}` : `▶️ روشن کردن ${g.name}`, callback_data: `gw_${on ? 'off' : 'on'}_${id}` }])
  }
  return { text: '💳 <b>درگاه‌های کارت به کارت</b>\n\n' + rows.join('\n') + '\n\nخاموش‌کردن فقط دکمهٔ پرداخت را از دید مشتری برمی‌دارد؛ پرداخت‌های در جریان همچنان تأیید می‌شوند.', kb: J({ inline_keyboard: kb }) }
}

export const adminGatewayRoutes = [
  async (c) => {
    if (c.adminRow?.rule !== 'administrator') return false
    if (c.text === GATEWAY_BTN || c.text === '/gateways' || c.text === '/paychi') {
      const v = await view()
      await sendmessage(c.from_id, v.text, v.kb, 'HTML')
      return true
    }
    const m = /^gw_(on|off)_(paychi|variza)$/.exec(c.datain ?? '')
    if (!m) return false
    const g = GW[m[2]]
    if (m[1] === 'on') {
      for (const k of g.need) if (!filled(await getPay(k))) { await answerCallback(c.callback_query_id, `${g.name}: ابتدا کلید و آدرس را ثبت کنید (tools/setpay.mjs)`, true); return true }
    }
    await setPay(g.key, m[1] === 'on' ? g.on : g.off)
    await answerCallback(c.callback_query_id, `${g.name} ${m[1] === 'on' ? 'روشن' : 'خاموش'} شد`)
    const v = await view()
    await Editmessagetext(c.from_id, c.message_id, v.text, v.kb, 'HTML')
    return true
  },
]
