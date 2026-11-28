// The partnership flow a marketer drives: his link (?start=ag_<code>) → the clear request form → the administrator sees who brought the shop →
// the approval (bot button or panel: ONE decision) → a friendly message with the first steps and buttons.
//   node --no-warnings --import ./register.mjs partner_flow_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { handleUpdate } = await import('../tgcloud/lib/bot.js')
const ADMIN = 5550001
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status) VALUES (${String(ADMIN)}, 'adm', 'f', '0', 'home', 'Active')`)
await db.run(sql`DELETE FROM admin`); await db.run(sql`INSERT INTO admin (id_admin, rule) VALUES (${String(ADMIN)}, 'administrator')`)
await db.run(sql`UPDATE setting SET agentreqprice = '0'`)
await db.run(sql`DELETE FROM referral_links WHERE code = 'ali-mobile'`)
await db.run(sql`INSERT INTO referral_links (name, platform, code, active, created_at) VALUES ('بازاریاب علی', 'telegram', 'ali-mobile', 1, 1)`)
let uid = 9000
const msg = (from, text) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: from, first_name: 'Shop', username: 'shop' + from, is_bot: false }, chat: { id: from, type: 'private' }, date: 1, text } })
const cb = (from, data) => handleUpdate({ update_id: ++uid, callback_query: { id: 'q' + uid, from: { id: from, first_name: 'Adm', username: 'adm', is_bot: false }, chat_instance: '1', data, message: { message_id: 9, chat: { id: from, type: 'private' }, date: 1 } } })
const to = (id) => calls.filter(([m, p]) => /sendmessage|editmessagetext/i.test(m) && String(p.chat_id) === String(id))
const body = (id) => to(id).map(([, p]) => String(p.text ?? ''))

// 1) the marketer's link — a brand-new shop first meets the rules, and must still land on the request afterwards
const SHOP = 8801
const rulesOn = (await db.get(sql`SELECT roll_Status AS r FROM setting LIMIT 1`)).r
check('(the test shop has the rules gate ON)', rulesOn === 'rolleon', String(rulesOn))
calls.length = 0
await msg(SHOP, '/start ag_ali-mobile')
check("the link attaches the shop to the marketer's campaign", !!(await db.get(sql`SELECT 1 AS x FROM referral_signups s JOIN referral_links l ON l.id = s.link_id WHERE s.user_id = ${String(SHOP)} AND l.code = 'ali-mobile'`)))
check('a new person sees the rules first (as always)', body(SHOP).some((t) => /قوانین/.test(t)) && !body(SHOP).some((t) => /نام فروشگاه/.test(t)))
calls.length = 0
await cb(SHOP, 'acceptrule')
check('…and after accepting them the clear partnership form follows (the action is not lost)', body(SHOP).some((t) => /نام فروشگاه/.test(t) && /شهر/.test(t) && /نمونه/.test(t)), JSON.stringify(body(SHOP).map((t) => t.slice(0, 40))))
check('the click is counted', Number((await db.get(sql`SELECT value FROM kv WHERE key = 'care:n:ag:ali-mobile'`))?.value) === 1)
check('the remembered action is used up (not replayed later)', !((await db.get(sql`SELECT value FROM kv WHERE key = ${'pending_action:' + SHOP}`))?.value))
// the same for a channel button «خرید» pressed by a new person: after the rules the buy menu follows
const NEWBIE = 8803
calls.length = 0; await msg(NEWBIE, '/start buy')
check('a channel «buy» button from a new person: rules first', body(NEWBIE).some((t) => /قوانین/.test(t)))
calls.length = 0; await cb(NEWBIE, 'acceptrule')
check('…then the buy flow, not just a welcome message', body(NEWBIE).length >= 2, JSON.stringify(body(NEWBIE).map((t) => t.slice(0, 30))))
// an old action is not replayed a day later
await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('pending_action:8804', ${JSON.stringify({ a: 'buy', t: 1 })}, 0)`)
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status, roll_Status) VALUES ('8804', 'old', 'f', '0', 'home', 'Active', 0)`)
calls.length = 0; await cb(8804, 'acceptrule')
check('an action remembered long ago is NOT replayed', body(8804).length === 1)

// 2) the shop answers
calls.length = 0
await msg(SHOP, 'موبایل پارس، شیراز، موبایل‌فروشی، حدود ۳۰ مشتری در ماه، @shop')
check('with the request fee at 0 a new shop with an empty wallet can apply', !!(await db.get(sql`SELECT 1 AS x FROM Requestagent WHERE id = ${String(SHOP)} AND status = 'waiting'`)))
check('the shop gets a friendly confirmation (no vague promise), with the test suggestion', body(SHOP).some((t) => /درخواست‌تون ثبت شد/.test(t) && /اکانت تست/.test(t)), JSON.stringify(body(SHOP)))
check('the administrator sees the answer AND the marketer who brought the shop', body(ADMIN).some((t) => /موبایل پارس/.test(t) && /معرف: بازاریاب علی \(ali-mobile\)/.test(t)), JSON.stringify(body(ADMIN)).slice(0, 300))

// 3) the approval from the bot's button
calls.length = 0
await cb(ADMIN, 'addagentrequest_' + SHOP)
const u = await db.get(sql`SELECT agent, pricediscount FROM user WHERE id = ${String(SHOP)}`)
check('approved: partner (n) with the first tier', u.agent === 'n' && Number(u.pricediscount) === 10, JSON.stringify(u))
const ok = to(SHOP).map(([, p]) => p)
check('the new partner gets the friendly message with the 3 first steps', ok.some((p) => /شروع در ۳ قدم/.test(String(p.text)) && /کیف پول را کمی شارژ/.test(String(p.text)) && /پنل نمایندگی/.test(String(p.text))), JSON.stringify(body(SHOP)).slice(0, 200))
check('…with buttons: partner menu, wallet, free test, support', ok.some((p) => ['backuser', 'account', 'usertestbtn', 'supportbtns'].every((d) => JSON.stringify(p.reply_markup ?? '').includes(d))))
calls.length = 0; await cb(ADMIN, 'addagentrequest_' + SHOP)
check('a second tap changes nothing and tells the partner nothing again', to(SHOP).length === 0)

// 4) a rejection through the bot is the same decision as the panel's (refund once, respectful text)
const SHOP2 = 8802
await db.run(sql`UPDATE setting SET agentreqprice = '50000'`)
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status) VALUES (${String(SHOP2)}, 'shop2', 'f', '0', 'home', 'Active')`)
await db.run(sql`INSERT OR REPLACE INTO Requestagent (id, username, time, Description, status, type) VALUES (${String(SHOP2)}, 'shop2', '1', 'x', 'waiting', 'None')`)
calls.length = 0
await cb(ADMIN, 'rejectrequesta_' + SHOP2)
check('rejected: the fee is refunded once and the person is told respectfully', Number((await db.get(sql`SELECT Balance FROM user WHERE id = ${String(SHOP2)}`)).Balance) === 50000 && body(SHOP2).some((t) => /تأیید نشد/.test(t)), JSON.stringify(body(SHOP2)))
calls.length = 0; await cb(ADMIN, 'rejectrequesta_' + SHOP2)
check('…and not refunded twice', Number((await db.get(sql`SELECT Balance FROM user WHERE id = ${String(SHOP2)}`)).Balance) === 50000)
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)
