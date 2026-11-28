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
check('…and after accepting them the partnership INTRO follows (what a partner gets, the tier table, how this person starts)', body(SHOP).some((t) => /همکاری با پیچا/.test(t) && /تخفیف پله‌ای/.test(t) && /شروع/.test(t) && /پنل|مشتری‌ها/.test(t)), JSON.stringify(body(SHOP).map((t) => t.slice(0, 40))))
check('…the intro tells a marketer-referred person that the first tier is active at once after approval', body(SHOP).some((t) => /با معرف اومدی/.test(t) && /همون لحظه/.test(t)))
check('…and has the buttons: apply / free test / back', to(SHOP).some(([, p]) => ['agentstart', 'usertestbtn', 'backuser'].every((d) => JSON.stringify(p.reply_markup ?? '').includes(d))))
calls.length = 0
await cb(SHOP, 'agentstart')
check('tapping «ثبت درخواست» opens the clear form (name, city, kind, volume, contact + an example)', body(SHOP).some((t) => /نام فروشگاه/.test(t) && /شهر/.test(t) && /نمونه/.test(t)), JSON.stringify(body(SHOP).map((t) => t.slice(0, 40))))
// a walk-in reads a different last line
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status, roll_Status) VALUES ('8820', 'w8820', 'f', '0', 'home', 'Active', 1)`)
calls.length = 0; await msg(8820, '/start agent')
check('a walk-in intro says the tier starts after a first wallet charge (with the amount)', body(8820).some((t) => /همکاری با پیچا/.test(t) && /حداقل/.test(t) && /شارژ کیف پول/.test(t)), JSON.stringify(body(8820)).slice(0, 200))
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

// 5) a walk-in (no marketer): the partner list at once, the tier percent only after a first wallet charge (default 300,000 toman)
await db.run(sql`UPDATE setting SET agentreqprice = '0'`)
const { decide, tiersGet } = await import('../tgcloud/lib/partners.js')
const nowT = Math.floor(Date.now() / 1000), tehran = (t) => new Date((t + 12600) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/')
const walkin = async (id, bal = '0') => { await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status, roll_Status, pricediscount) VALUES (${String(id)}, ${'w' + id}, 'f', ${bal}, 'home', 'Active', 1, '0')`); await db.run(sql`INSERT OR REPLACE INTO Requestagent (id, username, time, Description, status, type) VALUES (${String(id)}, ${'w' + id}, ${String(nowT)}, 'یک فروشگاه', 'waiting', 'None')`) }
const topup = (id, amount, minAgo = 1) => db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES (${String(id)}, ${'tp' + id + amount}, ${tehran(nowT - minAgo * 60)}, ${String(amount)}, 'paid', 'variza', 'none')`)
const W = 8810
await db.run(sql`DELETE FROM kv WHERE key LIKE 'partner:min_charge' OR key LIKE 'partner:need:%'`)
await walkin(W)
calls.length = 0; await cb(ADMIN, 'addagentrequest_' + W)
const w1 = await db.get(sql`SELECT agent, pricediscount FROM user WHERE id = ${String(W)}`)
check('walk-in approved: partner list now, but the tier percent NOT yet', w1.agent === 'n' && Number(w1.pricediscount) === 0, JSON.stringify(w1))
check('…he is told the exact first-charge amount and may take the free test meanwhile', body(W).some((t) => /۳۰۰٬۰۰۰|300,000|۳۰۰,۰۰۰/.test(t) && /اکانت تست/.test(t)), JSON.stringify(body(W)).slice(0, 260))
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status, roll_Status) VALUES ('8813', 'w8813', 'f', '0', 'getagentrequest', 'Active', 1)`)
calls.length = 0; await msg(8813, 'فروشگاه دیجیتال، کرج، موبایل، ۲۰ مشتری، @w')
check('…and the administrators see that a walk-in request has no marketer and must charge first', body(ADMIN).some((t) => /بدون معرف/.test(t) && /شارژ/.test(t)), JSON.stringify(body(ADMIN)).slice(0, 200))
await topup(W, 100000)
calls.length = 0; await msg(W, 'درود')
check('a charge below the minimum does not activate the tier percent', Number((await db.get(sql`SELECT pricediscount FROM user WHERE id = ${String(W)}`)).pricediscount) === 0)
await topup(W, 250000)
calls.length = 0; await msg(W, 'درود')
const w2 = await db.get(sql`SELECT pricediscount FROM user WHERE id = ${String(W)}`)
check('charges adding up to the minimum activate the first tier (10%) on his next message', Number(w2.pricediscount) === 10, JSON.stringify(w2))
check('…he is thanked and told it is active; the waiting flag is gone', body(W).some((t) => /قیمت همکار شما فعال شد/.test(t)) && !((await db.get(sql`SELECT value FROM kv WHERE key = ${'partner:need:' + W}`))?.value))
const tiers0 = await tiersGet()
check('the daily tier engine leaves a partner who waits for his first charge alone', decide({ level: 'n', pending: true, locked: false, expired: false, pct: 0, gb30: 0, below: 0 }, tiers0).action === 'none')
// the minimum can be changed or removed
await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('partner:min_charge', '0', 0)`)
await walkin(8811); calls.length = 0; await cb(ADMIN, 'addagentrequest_8811')
check('minimum = 0: even a walk-in gets the first tier at once', Number((await db.get(sql`SELECT pricediscount FROM user WHERE id = '8811'`)).pricediscount) === 10)
await db.run(sql`DELETE FROM kv WHERE key = 'partner:min_charge'`)
await walkin(8812, '400000'); calls.length = 0; await cb(ADMIN, 'addagentrequest_8812')
check('a walk-in who already has enough in the wallet gets the tier at once', Number((await db.get(sql`SELECT pricediscount FROM user WHERE id = '8812'`)).pricediscount) === 10)
// a marketer's shop is unchanged: 10% at once even with an empty wallet (section 3 above)

// 6) a campaign of type «جذب همکار» (platform partner): its PLAIN link opens the partnership page; an ordinary campaign still shows the start page
await db.run(sql`DELETE FROM referral_links WHERE code IN ('hire-1', 'adv-1')`)
await db.run(sql`INSERT INTO referral_links (name, platform, code, active, created_at) VALUES ('بازاریاب حسن', 'partner', 'hire-1', 1, 1)`)
await db.run(sql`INSERT INTO referral_links (name, platform, code, active, created_at) VALUES ('تبلیغ اینستاگرام', 'instagram', 'adv-1', 1, 1)`)
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status, roll_Status) VALUES ('8830', 'h8830', 'f', '0', 'home', 'Active', 1)`)
calls.length = 0; await msg(8830, '/start hire-1')
check('a partner-recruitment link (plain, no ag_) goes straight to the partnership page', body(8830).some((t) => /همکاری با پیچا/.test(t) && /تخفیف پله‌ای/.test(t)), JSON.stringify(body(8830).map((t) => t.slice(0, 40))))
check('…and the shop is attached to that marketer', !!(await db.get(sql`SELECT 1 AS x FROM referral_signups s JOIN referral_links l ON l.id = s.link_id WHERE s.user_id = '8830' AND l.code = 'hire-1'`)))
check('…as a marketer-referred person (the intro says the first tier is active at once)', body(8830).some((t) => /با معرف اومدی/.test(t)))
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status, roll_Status) VALUES ('8831', 'h8831', 'f', '0', 'home', 'Active', 1)`)
calls.length = 0; await msg(8831, '/start adv-1')
check('an ordinary campaign link still shows the normal start page (not the partnership page)', !body(8831).some((t) => /همکاری با پیچا/.test(t)) && body(8831).length >= 1)
// a brand-new person with a partner-recruitment link: rules first, then the partnership page
calls.length = 0; await msg(8832, '/start hire-1')
check('a brand-new person: rules first', body(8832).some((t) => /قوانین/.test(t)) && !body(8832).some((t) => /همکاری با پیچا/.test(t)))
calls.length = 0; await cb(8832, 'acceptrule')
check('…then the partnership page (the intent survives the rules)', body(8832).some((t) => /همکاری با پیچا/.test(t)), JSON.stringify(body(8832).map((t) => t.slice(0, 40))))
const AR = (await import('../tgcloud/endpoints/admin_report.js')).default
await db.run(sql`DELETE FROM kv WHERE key = 'config:usernamebot'`); await db.run(sql`INSERT INTO kv (key, value, updated_at) VALUES ('config:usernamebot', '@pichanet_bot', 0)`)
const mk = (await AR({ tool: 'marketers' }, {})).marketers
check('the marketers tool tells which link to give: the plain one for a recruitment campaign, the ag_ one for an ordinary campaign', mk.find((m) => m.code === 'hire-1').give_the_marketer === 'https://t.me/pichanet_bot?start=hire-1' && mk.find((m) => m.code === 'adv-1').give_the_marketer === 'https://t.me/pichanet_bot?start=ag_adv-1', JSON.stringify(mk.map((m) => [m.code, m.give_the_marketer])))
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)
