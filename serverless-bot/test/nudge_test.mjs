// Pending orders: after 5 minutes the customer gets ONE friendly question («سفارشتون براتون ارسال شده؟»); fresh orders only; answers reach the administrators.
//   node --no-warnings --import ./register.mjs nudge_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { handleUpdate, systemContext } = await import('../tgcloud/lib/bot.js')
const { pendingNudge } = await import('../tgcloud/lib/cron.js')
const kv = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const nowT = Math.floor(Date.now() / 1000)
const tehran = (t) => new Date((t + 12600) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/')
await db.run(sql`DELETE FROM Payment_report`)
await db.run(sql`INSERT OR IGNORE INTO admin (id_admin, rule) VALUES ('5550001', 'administrator')`)
const mkUser = (id, st = 'Active') => db.run(sql`INSERT OR REPLACE INTO user (id, step, User_Status, Balance, roll_Status, joinchannel, verify, agent, username) VALUES (${String(id)}, 'home', ${st}, '0', 1, 'active', '1', 'f', ${'u' + id})`)
const order = (id, user, ageMin, status, invoice = 'getconfigafterpay|svc1', method = 'cart to cart') => db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES (${String(user)}, ${id}, ${tehran(nowT - ageMin * 60)}, '100000', ${status}, ${method}, ${invoice})`)
for (const u of [7401, 7402, 7403, 7404, 7405, 7406, 7407, 7408]) await mkUser(u)
await mkUser(7409, 'block')
await db.run(sql`DELETE FROM kv WHERE key LIKE 'nudge:%' OR key LIKE 'care:n:nudge%'`)
const run = async () => { const c = await systemContext(); calls.length = 0; await pendingNudge({ ...c, from_id: '0' }) }
const nudges = () => calls.filter(([m, p]) => /sendmessage/i.test(m) && /سفارشتون|پرداخت سفارشتون|شارژ کیف پولتون/.test(String(p.text)))
await order('o-young', 7401, 2, 'waiting')            // 2 minutes: too early
await order('o-wait', 7402, 7, 'waiting')              // a receipt waiting for approval
await order('o-unpaid', 7403, 8, 'Unpaid')             // a payment started, not finished
await order('o-undeliv', 7404, 9, 'paid', 'getconfigafterpay|svc-undelivered')  // paid, the service does not exist
await order('o-old', 7405, 600, 'waiting')             // 10 hours old: backlog, never messaged
await order('o-topup', 7406, 6, 'waiting', 'none')     // a wallet top-up waiting
await order('o-blocked', 7409, 7, 'waiting')           // blocked user
await order('o-paidlater-1', 7407, 8, 'Unpaid'); await order('o-paidlater-2', 7407, 3, 'paid', 'none') // paid afterwards
await order('o-delivered', 7408, 9, 'paid', 'getconfigafterpay|svc1')            // paid and delivered
await db.run(sql`INSERT OR REPLACE INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product, price_product) VALUES ('7408', 'dd1', 'svc1', ${String(nowT)}, 'active', 'x', '100000')`)
await run()
const got = nudges()
const to = (u) => got.filter(([, p]) => String(p.chat_id) === String(u))
check('a receipt waiting 7 min: asked «سفارشتون براتون ارسال شده؟» with the two buttons', to(7402).length === 1 && /^درود، وقت بخیر/.test(to(7402)[0][1].text) && /سفارشتون براتون ارسال شده؟/.test(to(7402)[0][1].text) && /nudge_ok_o-wait/.test(JSON.stringify(to(7402)[0][1].reply_markup)) && /nudge_no_o-wait/.test(JSON.stringify(to(7402)[0][1].reply_markup)), JSON.stringify(to(7402)))
check('paid but not delivered: asked', to(7404).length === 1 && /سفارشتون براتون ارسال شده؟/.test(to(7404)[0][1].text))
check('a payment started and not finished: a different, helpful question', to(7403).length === 1 && /کامل نشد/.test(to(7403)[0][1].text) && /nudge_help_o-unpaid/.test(JSON.stringify(to(7403)[0][1].reply_markup)))
check('a wallet top-up waiting: asked about the wallet', to(7406).length === 1 && /شارژ کیف پولتون/.test(to(7406)[0][1].text))
check('under 5 minutes: nothing yet', to(7401).length === 0)
check('older than 6 hours (backlog): never messaged', to(7405).length === 0)
check('a blocked user gets nothing', to(7409).length === 0)
check('someone who paid afterwards is not asked about the unfinished payment', to(7407).length === 0)
check('a delivered order is not pending', to(7408).length === 0)
check('each order is marked, so it is never asked twice', !!(await kv('nudge:o:o-wait')) && !!(await kv('nudge:o:o-undeliv')))
await run()
check('the next run sends nothing again', nudges().length === 0)
// one message per customer per 6 hours
await order('o-wait2', 7402, 6, 'waiting')
await run()
check('a second order of the same customer within 6 hours is not asked again', nudges().filter(([, p]) => String(p.chat_id) === '7402').length === 0)
// the switches
await db.run(sql`DELETE FROM kv WHERE key LIKE 'nudge:o:%' OR key LIKE 'nudge:u:%'`)
await kvSet('nudge:unpaid', '0'); await run()
check('«unpaid» switched off: only the real waiting/undelivered orders are asked', nudges().every(([, p]) => !/کامل نشد/.test(String(p.text))) && nudges().length >= 3)
await kvSet('nudge:on', '0'); await db.run(sql`DELETE FROM kv WHERE key LIKE 'nudge:o:%' OR key LIKE 'nudge:u:%'`); await run()
check('switched off: nothing at all', nudges().length === 0)
await db.run(sql`DELETE FROM kv WHERE key IN ('nudge:on', 'nudge:unpaid') OR key LIKE 'nudge:o:%' OR key LIKE 'nudge:u:%'`)

// the answers
let uid = 1
const cb = (from, data) => handleUpdate({ update_id: ++uid, callback_query: { id: 'q' + uid, from: { id: from, first_name: 'A', username: 'a' + from, is_bot: false }, chat_instance: '1', data, message: { message_id: 9, chat: { id: from, type: 'private' }, date: 1, text: 'x' } } })
const edits = () => calls.filter(([m]) => /editmessagetext/i.test(m))
calls.length = 0; await cb(7402, 'nudge_ok_o-wait')
check('«بله، دریافت کردم»: thanked, counted', edits().some(([, p]) => /سپاسگزارم/.test(String(p.text))) && Number(await kv('care:n:nudge:ok')) === 1)
calls.length = 0; await cb(7402, 'nudge_no_o-wait')
check('«هنوز نرسیده»: the customer is told it is followed up', edits().some(([, p]) => /پیگیری شد/.test(String(p.text))))
check('…and every administrator gets the order (user, order id, amount, method, status)', calls.some(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === '5550001' && /سفارشش نرسیده/.test(String(p.text)) && /o-wait/.test(String(p.text)) && /100,000/.test(String(p.text)) && /waiting/.test(String(p.text))))
calls.length = 0; await cb(7403, 'nudge_help_o-unpaid')
check('«کمک می‌خوام»: leads to support', edits().some(([, p]) => /supportbtns/.test(JSON.stringify(p.reply_markup))))
calls.length = 0; await cb(7401, 'nudge_no_o-wait')
check('a customer cannot answer for someone else\'s order (no alert to the administrators)', !calls.some(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === '5550001' && /سفارشش نرسیده/.test(String(p.text))))
// the admin command
const msg = (from, text) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: from, first_name: 'A', is_bot: false }, chat: { id: from, type: 'private' }, date: 1, text } })
calls.length = 0; await msg(5550001, '/nudge off')
check('/nudge off switches it off and shows the status', (await kv('nudge:on')) === '0' && calls.some(([m, p]) => /sendmessage/i.test(m) && /خاموش/.test(String(p.text))))
await msg(5550001, '/nudge on'); await msg(5550001, '/nudge unpaid off')
check('/nudge on and /nudge unpaid off', (await kv('nudge:on')) === '1' && (await kv('nudge:unpaid')) === '0')
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
