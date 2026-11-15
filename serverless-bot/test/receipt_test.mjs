// The receipt photo goes to every administrator even when a name breaks the HTML; if nobody can be reached, the report channel hears about it.
//   node --no-warnings --import ./register.mjs receipt_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls, replies, BotApiError } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { systemContext } = await import('../tgcloud/lib/bot.js')
const { payRoutes } = await import('../tgcloud/lib/routes/pay.js')
const c = await systemContext()
const run = async () => { for (const r of payRoutes) if (await r(c)) return true; return false }
const admins = (await db.all(sql`SELECT id_admin FROM admin WHERE rule = 'administrator'`)).map((r) => String(r.id_admin))
check('there are administrators', admins.length >= 1)
const setup = async (id) => {
  await db.run(sql`DELETE FROM Payment_report WHERE id_order = ${id}`)
  await db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, Payment_Method, payment_Status, id_invoice) VALUES ('7001', ${id}, '2026/11/14 10:00:00', '100000', 'variza', 'Unpaid', 'none')`)
  await db.run(sql`UPDATE user SET step = 'cart_to_cart_user', Processing_value = ${id} WHERE id = '7001'`)
  c.user = await db.get(sql`SELECT * FROM user WHERE id = '7001'`); c.from_id = '7001'; c.first_name = 'A<b&c'; c.username = 'x'; c.photo = true; c.photoid = 'PHOTO'; c.caption = 'رسید <نمونه>'; c.update = { message: {} }; c.datain = ''; c.text = ''
  calls.length = 0
}
// 1) a name that breaks HTML: the first try is rejected (400), the plain text still arrives with the buttons
await setup('rcpt1')
replies.sendmessage = (p) => { if (admins.includes(String(p.chat_id)) && p.parse_mode === 'HTML') throw new BotApiError(400, "Bad Request: can't parse entities: Unsupported start tag", 'sendmessage'); return { message_id: 1, chat: { id: Number(p.chat_id) }, date: 0 } }
await run()
const toAdmin = calls.filter(([m, p]) => /sendmessage/i.test(m) && admins.includes(String(p.chat_id)))
check('the plain-text retry reaches every administrator, with the approve/reject buttons', admins.every((a) => toAdmin.some(([, p]) => String(p.chat_id) === a && !p.parse_mode && p.reply_markup)), JSON.stringify(toAdmin.map(([, p]) => [p.chat_id, !!p.parse_mode])))
check('the photo is sent without HTML parsing (a «<» in the caption cannot drop it)', calls.some(([m, p]) => /sendphoto/i.test(m) && !p.parse_mode && p.caption === 'رسید <نمونه>'))
check('the order is marked waiting', (await db.get(sql`SELECT payment_Status AS s FROM Payment_report WHERE id_order = 'rcpt1'`)).s === 'waiting')
// 2) nobody can be reached: the report channel is told
await setup('rcpt2')
await db.run(sql`UPDATE setting SET Channel_Report = '-1001234567890'`); c.setting = (await db.get(sql`SELECT * FROM setting`)); c.topicsAll = c.topicsAll || {}
replies.sendmessage = (p) => { if (admins.includes(String(p.chat_id))) throw new BotApiError(403, 'Forbidden: bot was blocked by the user', 'sendmessage'); return { message_id: 1, chat: { id: Number(p.chat_id) }, date: 0 } }
replies.sendphoto = (p) => { if (admins.includes(String(p.chat_id))) throw new BotApiError(403, 'Forbidden: bot was blocked by the user', 'sendphoto'); return { message_id: 1, chat: { id: Number(p.chat_id) }, date: 0 } }
await run()
check('no administrator reachable: the report channel is told with the order id', calls.some(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === '-1001234567890' && /rcpt2/.test(String(p.text)) && /پرداخت‌های معلق/.test(String(p.text))), JSON.stringify(calls.map(([m, p]) => [m, p.chat_id])))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
