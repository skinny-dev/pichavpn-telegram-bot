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

// 3) the order is settled by the gateway AFTER the receipt went out: the administrators' messages are closed, buttons gone
let mid = 100
delete replies.sendphoto
replies.sendmessage = (p) => ({ message_id: ++mid, chat: { id: Number(p.chat_id) }, date: 0 })
const { directPayment } = await import('../tgcloud/lib/directpay.js')
const { neutral } = await import('../tgcloud/lib/relay.js')
const { adminPayRoutes } = await import('../tgcloud/lib/admin/payments.js')
const kvGet = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
await db.run(sql`UPDATE setting SET Channel_Report = ''`); c.setting = await db.get(sql`SELECT * FROM setting`)
await setup('rcpt3')
await run()
const remembered = JSON.parse((await kvGet('receipt:rcpt3')) || '[]')
check('every administrator message of the receipt is remembered', remembered.length === admins.length && remembered.every((r) => r.m > 100), JSON.stringify(remembered.map((r) => [r.c, r.m])))
calls.length = 0
await db.run(sql`UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = 'rcpt3'`)
await directPayment(neutral(c), 'rcpt3') // Variza's webhook, a minute later
const edits = calls.filter(([m]) => /editmessagetext/i.test(m)).map(([, p]) => p)
check('the gateway settles it: every administrator message is edited with the note', admins.every((a) => edits.some((p) => String(p.chat_id) === a && /خودکار تأیید شد/.test(String(p.text)))), JSON.stringify(edits.map((p) => [p.chat_id, String(p.text).slice(-40)])))
check('the original text stays and the buttons are removed', edits.every((p) => String(p.text).includes('rcpt3') || String(p.text).length > 60) && edits.every((p) => { const rm = typeof p.reply_markup === 'string' ? JSON.parse(p.reply_markup) : p.reply_markup; return !rm || (rm.inline_keyboard ?? []).length === 0 }))
check('nothing is left to close', (await kvGet('receipt:rcpt3')) === null)
calls.length = 0
await directPayment(neutral(c), 'rcpt3')
check('a repeat edits nothing more', !calls.some(([m]) => /editmessagetext/i.test(m)))

// 4) one administrator approves: the others' copies are closed, his own is left to his handler
await setup('rcpt4')
await run()
const mine = JSON.parse(await kvGet('receipt:rcpt4'))
const first = mine[0]
c.adminRow = { rule: 'administrator' }; c.from_id = first.c; c.datain = 'Confirm_pay_rcpt4'; c.message_id = first.m; c.callback_query_id = 'cb1'; c.text = ''; c.step = ''
calls.length = 0
let handled = false; for (const r of adminPayRoutes) { if (await r(c)) { handled = true; break } }
const edited = calls.filter(([m]) => /editmessagetext/i.test(m)).map(([, p]) => `${p.chat_id}:${p.message_id}`)
check('the approving administrator handled it', handled && (await db.get(sql`SELECT payment_Status AS s FROM Payment_report WHERE id_order = 'rcpt4'`)).s === 'paid')
check('the other administrators\' copies were closed', mine.slice(1).every((r) => edited.includes(`${r.c}:${r.m}`)) || admins.length === 1, JSON.stringify(edited))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
