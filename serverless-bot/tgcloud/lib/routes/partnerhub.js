// The partner corner in the bot: report, customers (renew), priority support. Only partners (agent n / n2) can use it.
import { all, sql } from '../db.js'
import { sendmessage, Editmessagetext } from '../tg.js'
import { backuserKb } from '../keyboards.js'
import { reportText, customersPage, isPartner } from '../partnerhub.js'
import { J } from '../php.js'

export const HUB = { report: '📊 گزارش من', customers: '👥 مشتری‌های من', support: '🎧 پشتیبانی ویژه' }
const back = J({ inline_keyboard: [[{ text: '↩️ بازگشت', callback_data: 'agentpanel' }]] })
const send = (c, text, kb) => (c.datain && c.message_id ? Editmessagetext(c.from_id, c.message_id, text, kb, 'HTML') : sendmessage(c.from_id, text, kb, 'HTML'))

export const hubRoutes = [
  async (c) => {
    if (!(c.text === HUB.report || c.datain === 'agentreport')) return false
    if (!isPartner(c.user)) { await sendmessage(c.from_id, 'این بخش مخصوص همکاران است.', null, 'HTML'); return true }
    await send(c, await reportText(c.user), J({ inline_keyboard: [[{ text: HUB.customers, callback_data: 'pcust_need_1' }], [{ text: '↩️ بازگشت', callback_data: 'agentpanel' }]] }))
    return true
  },
  async (c) => {
    const m = /^pcust_(need|all)_(\d+)$/.exec(c.datain || '')
    if (!(m || c.text === HUB.customers)) return false
    if (!isPartner(c.user)) { await sendmessage(c.from_id, 'این بخش مخصوص همکاران است.', null, 'HTML'); return true }
    const r = await customersPage(c.user, m ? m[1] : 'need', m ? Number(m[2]) : 1)
    await send(c, r.text, J(r.kb))
    return true
  },
  async (c) => {
    if (!(c.text === HUB.support || c.datain === 'agentsupport')) return false
    if (!isPartner(c.user)) { await sendmessage(c.from_id, 'این بخش مخصوص همکاران است.', null, 'HTML'); return true }
    const deps = await all(sql`SELECT * FROM departman`)
    const rows = deps.map((r) => [{ text: r.name_departman, callback_data: `departman_${r.id}` }])
    rows.push([{ text: '↩️ بازگشت', callback_data: 'agentpanel' }])
    await send(c, 'درود 🌿\n⭐ پیام‌های همکاران با <b>اولویت</b> بررسی می‌شود. بخش مورد نظر را انتخاب کنید و پیام را بنویسید.', J({ inline_keyboard: rows }))
    return true
  },
]
