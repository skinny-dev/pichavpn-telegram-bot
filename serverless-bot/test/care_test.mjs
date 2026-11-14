// Customer-care follow-up C6 (test finished, not converted): detector, rules, answers, switch.
//   node --no-warnings --import ./register.mjs care_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }

await seed(process.argv[2])
const { systemContext, handleUpdate } = await import('../tgcloud/lib/bot.js')
const { careRun, careStats } = await import('../tgcloud/lib/care.js')
const c = await systemContext()
const TEST = c.T.common.labels.testServiceName
const DAY = 86400
// a Saturday noon (inside the working window) and the same day 23:30
const base = Date.UTC(2026, 10, 14, 0, 0, 0) / 1000 - 12600 // Saturday 14 Nov 2026 00:00 Tehran (a fixed working day)
const NOON = base + 12 * 3600, LATE = base + 23.5 * 3600
const kvGet = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const mkUser = (id) => db.run(sql`UPDATE user SET User_Status = 'Active', last_message_time = '0', step = 'home', roll_Status = 1, joinchannel = 'active' WHERE id = ${String(id)}`)
let inv = 9000
const invoice = async (uid, ageH, name = TEST, status = 'active', at = NOON) => { const id = ++inv; await db.run(sql`INSERT INTO invoice (id_invoice, id_user, username, Service_location, time_sell, name_product, price_product, Volume, Service_time, Status) VALUES (${String(id)}, ${String(uid)}, ${'u' + id}, 'x', ${String(Math.floor(at - ageH * 3600))}, ${name}, '0', '1', '1', ${status})`); return String(id) }
const texts = () => calls.filter(([m]) => m.toLowerCase() === 'sendmessage')
const U = [7101, 7102, 7103, 7104, 7105, 7106]
for (const u of U) { await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, Balance) VALUES (${String(u)}, 'home', 'Active', '0')`); await mkUser(u) }

// off by default
const a1 = await invoice(7101, 30)
let r = await careRun(c, { at: NOON })
check('off by default: nothing is sent', r.sent === 0 && r.reason === 'off' && texts().length === 0)
await kvSet('care:on:C6', '1')
await kvSet('care:bands', JSON.stringify({ C6: [[0, 24]] })); await kvSet('care:avoid', '[]') // the older checks run at any hour; the hour rules are tested below

// quiet hours
r = await careRun(c, { at: LATE })
check('quiet hours (after 22:00 Tehran): nothing is sent and nothing is recorded', r.sent === 0 && r.reason === 'quiet' && (await kvGet('care:C6:7101:' + a1)) === null)

// the working week: Friday and a holiday are closed, Thursday afternoon is closed, Thursday morning is open
const FRI = base - DAY + 12 * 3600, THU_PM = base - 2 * DAY + 16 * 3600, THU_AM = base - 2 * DAY + 11 * 3600, NOWRUZ = Date.UTC(2027, 2, 21, 8, 30) / 1000
for (const [name, at, why] of [['Friday', FRI, 'closed_day'], ['Thursday after 14:00', THU_PM, 'outside_hours'], ['Nowruz', NOWRUZ, 'holiday']]) {
  r = await careRun(c, { at })
  check(`schedule: ${name} sends nothing (${why})`, r.sent === 0 && r.why === why, JSON.stringify(r))
}
check('schedule: nothing was recorded by the closed windows', (await kvGet('care:C6:7101:' + a1)) === null)

// rules: bought / ticket / too young / non-test are skipped; a plain test account is asked
const bought = await invoice(7102, 30)
await invoice(7102, 40, 'سرویس 10 گیگ', 'active')
const withTicket = await invoice(7103, 30)
await db.run(sql`INSERT INTO support_message (Tracking, idsupport, iduser, name_departman, text, result, time, status) VALUES ('T1', '0', '7103', 'x', 'hi', '', '2026-01-01 00:00:00', 'Unseen')`)
const young = await invoice(7104, 5)
calls.length = 0
r = await careRun(c, { at: NOON })
check('one message: the plain test account only', r.sent === 1 && texts().length === 1 && texts()[0][1].chat_id === '7101', JSON.stringify(texts().map(([, p]) => p.chat_id)))
const msg = texts()[0]?.[1]
check('tone: «درود», never «سلام»', /^درود/.test(String(msg?.text)) && !/سلام/.test(String(msg?.text)))
check('message has the five answers incl. opt-out', ['care6_good_', 'care6_slow_', 'care6_fail_', 'care6_net_', 'care6_stop_'].every((k) => JSON.stringify(msg?.reply_markup).includes(k + a1)))
check('no discount or urgency in the first message', !/تخفیف|فرصت|آخرین/.test(String(msg?.text)))
check('bought before: skipped', JSON.parse(await kvGet(`care:C6:7102:${bought}`)).reason === 'bought')
check('open support ticket: skipped', JSON.parse(await kvGet(`care:C6:7103:${withTicket}`)).reason === 'ticket')
check('test younger than 23 h: not touched', (await kvGet(`care:C6:7104:${young}`)) === null)

// once per case, ever
calls.length = 0
r = await careRun(c, { at: NOON + 3600 })
check('a second run sends nothing for the same case', r.sent === 0 && texts().length === 0)

// weekly cap: a second test account of the same person two days later is not asked again
const cap1 = await invoice(7105, 30)
const cap2 = await invoice(7105, 28)
calls.length = 0
r = await careRun(c, { at: NOON + 7200 })
check('weekly cap: one message to a person, the other case is skipped', texts().filter(([, p]) => p.chat_id === '7105').length === 1 && JSON.parse(await kvGet(`care:C6:7105:${cap2}`)).reason === 'cap', JSON.stringify(await kvGet(`care:C6:7105:${cap2}`)))

// answers
const cb = (from, data, mid = 5) => handleUpdate({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'q' + Math.random(), from: { id: from, first_name: 'Ali', is_bot: false }, chat_instance: '1', data, message: { message_id: mid, chat: { id: from, type: 'private' }, date: 1, text: 'x' } } })
calls.length = 0
await cb(7101, 'care6_slow_' + a1)
const edit = calls.find(([m]) => /editmessagetext/i.test(m))
check('answer «کند بود»: practical guidance (app, ping test, tunnel) and a support button', !!edit && /Happ|v2rayTun/.test(String(edit[1].text)) && /پینگ/.test(String(edit[1].text)) && JSON.stringify(edit[1].reply_markup).includes('supportbtns'), JSON.stringify(edit))
check('the answer is recorded', JSON.parse(await kvGet(`care:C6:7101:${a1}`)).reason === 'slow')
calls.length = 0
await cb(7101, 'care6_good_' + a1)
check('answering twice is not counted twice', !calls.some(([m]) => /editmessagetext/i.test(m)) && JSON.parse(await kvGet(`care:C6:7101:${a1}`)).reason === 'slow')
const g = await invoice(7106, 30)
await careRun(c, { at: NOON + 9000 })
calls.length = 0
await cb(7106, 'care6_good_' + g)
const ed2 = calls.find(([m]) => /editmessagetext/i.test(m))
check('answer «خوب بود»: the plans button, no pressure', !!ed2 && JSON.stringify(ed2[1].reply_markup).includes('"buy"') && !/تخفیف/.test(String(ed2[1].text)))

// opt-out lasts 60 days
await cb(7106, 'care6_stop_' + g)
const later = await invoice(7106, 30, TEST, 'active', NOON + 9000)
await careRun(c, { at: NOON + 9100 })
check('«دیگر پیام نده»: recorded for 60 days and honoured', Number(await kvGet('care:optout:7106')) > NOON + 50 * DAY && JSON.parse(await kvGet(`care:C6:7106:${later}`)).reason === 'optout')

// daily cap
await kvSet('care:max_day', '1')
const d2a = await invoice(7101, 30, TEST, 'active', NOON + 10 * DAY), d2b = await invoice(7102, 30, TEST, 'active', NOON + 10 * DAY)
await db.run(sql`DELETE FROM invoice WHERE id_user = '7102' AND name_product != ${TEST}`)
await kvSet('care:optout:7101', '0'); await kvSet('care:last:7101', '0'); await kvSet('care:last:7102', '0')
calls.length = 0
r = await careRun(c, { at: NOON + 10 * DAY })
check('daily cap holds (max_day = 1: one message, the next waits for tomorrow)', r.sent === 1 && texts().length === 1 && [(await kvGet(`care:C6:7101:${d2a}`)), (await kvGet(`care:C6:7102:${d2b}`))].filter((v) => v !== null).length === 1, JSON.stringify(r))

// sales-psychology hours: bands, personal hour, lunch avoided
await kvSet('care:bands', JSON.stringify({ C6: [[10, 12], [18.5, 20.5]] })); await kvSet('care:avoid', JSON.stringify([[13, 15]]))
const T0 = base + 20 * DAY // a Friday+… far enough: use a Saturday
const SAT = base + 28 * DAY // Saturday again (4 weeks later)
const H = (h) => SAT + h * 3600
await kvSet('care:max_day', '100')
for (const u of [7101, 7102, 7103, 7104, 7105, 7106]) { await kvSet('care:last:' + u, '0'); await kvSet('care:optout:' + u, '0'); await db.run(sql`DELETE FROM support_message WHERE iduser = ${String(u)}`) }
await db.run(sql`DELETE FROM invoice WHERE id_user IN ('7101','7102','7103','7104','7105','7106') AND name_product != ${TEST}`)
// A took the test at 11:00 Tehran two days before, B at 16:45, C at 06:00
const mk = (uid, hourTaken, daysAgo) => invoice(uid, 0, TEST, 'active', SAT - daysAgo * DAY + hourTaken * 3600)
const iA = await mk(7101, 11, 2), iB = await mk(7102, 16.75, 2), iC = await mk(7104, 6, 2)
calls.length = 0
r = await careRun(c, { at: H(13.5) })
check('lunch (13–15): nobody is written to', r.sent === 0 && r.why === 'avoid_hours', JSON.stringify(r))
calls.length = 0
r = await careRun(c, { at: H(16.7) })
check('outside the bands: only the person whose own hour it is (16:45) gets it', r.sent === 1 && texts().length === 1 && texts()[0][1].chat_id === '7102', JSON.stringify(texts().map(([, p]) => p.chat_id)))
calls.length = 0
r = await careRun(c, { at: H(10.5) })
check('inside a band (10–12): everyone due may be written to', r.sent === 2 && texts().map(([, p]) => p.chat_id).sort().join() === '7101,7104', JSON.stringify(texts().map(([, p]) => p.chat_id)))

// preview and the admin's sample message
await db.run(sql`INSERT OR IGNORE INTO admin (id_admin, rule) VALUES ('5550001', 'administrator')`)
await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'home' WHERE id = '5550001'`)
const say = (text) => handleUpdate({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, from: { id: 5550001, first_name: 'Admin', is_bot: false }, chat: { id: 5550001, type: 'private' }, date: 1, text } })
const sent0 = (await careStats(c)).sent
calls.length = 0
await say('/care test')
const sample = texts().find(([, p]) => /care6_good_999999999/.test(JSON.stringify(p.reply_markup ?? {})))
check('/care test: the admin gets the real message with working buttons', !!sample && sample[1].chat_id === '5550001' && /^درود/.test(String(sample[1].text)))
calls.length = 0
await cb(5550001, 'care6_slow_999999999')
check('/care test: answering shows the guidance but records nothing', calls.some(([m]) => /editmessagetext/i.test(m)) && (await kvGet('care:C6:5550001:999999999')) === null && (await careStats(c)).reasons.slow === 1 && (await careStats(c)).sent === sent0)
const wait = await invoice(7105, 30, TEST, 'active', SAT + 3600)
calls.length = 0
await say('/care preview')
check('/care preview: counts and the reasons, sends nothing to customers', /پیش‌نمایش C6/.test(String(texts().at(-1)?.[1]?.text)) && /مجاز برای پیام/.test(String(texts().at(-1)?.[1]?.text)) && texts().every(([, p]) => p.chat_id === '5550001'), String(texts().at(-1)?.[1]?.text))
check('/care preview: nothing was recorded for the waiting case', (await kvGet(`care:C6:7105:${wait}`)) === null)

// ---- C10: registered 24–72 h ago, never took a test
await kvSet('care:on:C10', '1'); await kvSet('care:bands', JSON.stringify({ C6: [[10, 12]], C10: [[0, 24]] })); await kvSet('care:avoid', '[]')
const AT = base + 35 * DAY + 19 * 3600 // a Saturday evening
for (const u of [7101, 7102, 7103, 7104, 7105, 7106]) { await kvSet('care:last:' + u, '0'); await kvSet('care:optout:' + u, '0'); await db.run(sql`DELETE FROM support_message WHERE iduser = ${String(u)}`); await db.run(sql`DELETE FROM invoice WHERE id_user = ${String(u)}`); await db.run(sql`DELETE FROM Payment_report WHERE id_user = ${String(u)}`) }
const reg = (u, hoursAgo) => db.run(sql`UPDATE user SET register = ${String(AT - hoursAgo * 3600)}, User_Status = 'Active', last_message_time = '0' WHERE id = ${String(u)}`)
await reg(7101, 30); await reg(7102, 30); await reg(7103, 30); await reg(7104, 10); await reg(7105, 100); await reg(7106, 30)
await invoice(7102, 20, TEST, 'active', AT)     // already tested
await db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method) VALUES ('7106', 'pp1', '2026/01/01 00:00:00', '1000', 'paid', 'x')`)
await db.run(sql`INSERT INTO support_message (Tracking, idsupport, iduser, name_departman, text, result, time, status) VALUES ('T2', '0', '7103', 'x', 'hi', '', '2026-01-01 00:00:00', 'Unseen')`)
calls.length = 0
r = await careRun(c, { at: AT })
const to = texts().map(([, p]) => p.chat_id)
check('C10: only the person who registered 24–72 h ago and never tested is written to', r.sent === 1 && to.join() === '7101', JSON.stringify({ r, to }))
const t10 = texts()[0]?.[1]
check('C10 message: «درود», helps first, free test button, a way out', /^درود/.test(String(t10?.text)) && !/سلام|تخفیف|آخرین/.test(String(t10?.text)) && JSON.stringify(t10?.reply_markup).includes('usertestbtn') && JSON.stringify(t10?.reply_markup).includes('care10_stop_0'))
check('C10: paid / ticket are skipped; tested, too-new and too-old are never candidates', (await kvGet('care:C10:7102:0')) === null && JSON.parse(await kvGet('care:C10:7106:0')).reason === 'paid' && JSON.parse(await kvGet('care:C10:7103:0')).reason === 'ticket' && (await kvGet('care:C10:7104:0')) === null && (await kvGet('care:C10:7105:0')) === null)
calls.length = 0; r = await careRun(c, { at: AT + 3600 })
check('C10: once per person', texts().length === 0)
await cb(7101, 'care10_no_0')
check('C10 «not now»: recorded, nothing for 30 days', JSON.parse(await kvGet('care:C10:7101:0')).reason === 'no' && Number(await kvGet('care:optout:7101')) > Date.now() / 1000 + 25 * DAY)
const s10 = await careStats(c, 'C10')
check('C10 stats', s10.sent === 1 && s10.answered === 1 && s10.reasons.no === 1 && s10.skipped.paid === 1 && s10.skipped.ticket === 1)
calls.length = 0; await say('/care test C10')
check('/care test C10 sends the sample to the admin', texts().some(([, p]) => p.chat_id === '5550001' && /هنوز اتصال آزمایشی/.test(String(p.text))))
calls.length = 0; await say('/care preview C10')
check('/care preview C10', /پیش‌نمایش C10/.test(String(texts().at(-1)?.[1]?.text)))

// ---- T1: the running test ends in 1 day / in an hour (20 min for a 1 h test)
await kvSet('care:on:T1', '1')
for (const u of [7101, 7102, 7103, 7104, 7105, 7106]) { await kvSet('care:last:' + u, String(Math.floor(Date.now() / 1000))); await kvSet('care:optout:' + u, '0'); await db.run(sql`DELETE FROM support_message WHERE iduser = ${String(u)}`); await db.run(sql`DELETE FROM invoice WHERE id_user = ${String(u)}`); await db.run(sql`DELETE FROM Payment_report WHERE id_user = ${String(u)}`); await db.run(sql`UPDATE user SET last_message_time = '0', User_Status = 'Active' WHERE id = ${String(u)}`) }
const TT = base + 42 * DAY + 12 * 3600 // a test created at Saturday noon
const longTest = async (uid, hours, created = TT) => { const id = ++inv; await db.run(sql`INSERT INTO invoice (id_invoice, id_user, username, Service_location, time_sell, name_product, price_product, Volume, Service_time, Status) VALUES (${String(id)}, ${String(uid)}, ${'u' + id}, 'x', ${String(created)}, ${TEST}, '0', '100', ${String(hours)}, 'active')`); return String(id) }
const L = await longTest(7101, 48), S = await longTest(7102, 1), BOUGHT = await longTest(7103, 48)
await invoice(7103, 0, 'سرویس 10 گیگ', 'active', TT)
calls.length = 0
r = await careRun(c, { at: TT + 10 * 3600 })
check('T1: too early (10 h into a 48 h test): nothing', texts().length === 0)
r = await careRun(c, { at: TT + 25 * 3600 })
const d1 = texts().filter(([, p]) => p.chat_id === '7101')
check('T1 «1 day before»: sent to the person with the running 48 h test, buy button first', d1.length === 1 && /یک روز دیگر تمام/.test(String(d1[0][1].text)) && JSON.parse(JSON.stringify(d1[0][1].reply_markup)).inline_keyboard[0][0].callback_data === 'buy', JSON.stringify(texts().map(([, p]) => [p.chat_id, p.text])))
check('C6 is not sent while the long test is still running', !texts().some(([, p]) => /تست پیچا برای شما تمام شد/.test(String(p.text)) && p.chat_id === '7101'))
check('T1: not to someone who already bought, nor for the 1 h test at that time', !texts().some(([, p]) => p.chat_id === '7103' || p.chat_id === '7102'))
check('T1: not subject to the weekly cap (they had a care message today)', d1.length === 1)
calls.length = 0
r = await careRun(c, { at: TT + 26 * 3600 }); check('T1: once per touch', texts().length === 0)
calls.length = 0
r = await careRun(c, { at: TT + 47 * 3600 })
check('T1 «1 hour before»: a second message for the same test', texts().filter(([, p]) => p.chat_id === '7101').length === 1 && /کمی دیگر تمام/.test(String(texts().find(([, p]) => p.chat_id === '7101')?.[1]?.text)))
calls.length = 0
r = await careRun(c, { at: TT + 40 * 60 })
check('T1: a 1 h test is reminded 20 minutes before the end (not 1 day, not at once)', texts().filter(([, p]) => p.chat_id === '7102').length === 1, JSON.stringify(texts().map(([, p]) => p.chat_id)))
// the night: no message even in the window
const NIGHT = base + 50 * DAY + 3 * 3600
const N = await longTest(7104, 1, NIGHT - 40 * 60)
calls.length = 0; await careRun(c, { at: NIGHT })
check('T1: not at night (03:00)', texts().filter(([, p]) => p.chat_id === '7104').length === 0)
// the first-purchase gift is only promised when switched on
await kvSet('care:firstgift_gb', '10')
const G = await longTest(7105, 48)
calls.length = 0; await careRun(c, { at: TT + 25 * 3600 })
check('T1: the gift line appears only when care:firstgift_gb is set', /۱۰|10 گیگ هدیه/.test(String(texts().find(([, p]) => p.chat_id === '7105')?.[1]?.text)))
await kvSet('care:firstgift_gb', '0')
await cb(7101, 'caret1_stop_0')
check('T1 «دیگر پیام نده» records a 60-day opt-out', Number(await kvGet('care:optout:7101')) > Date.now() / 1000 + 50 * DAY)

// numbers for the admin
const s = await careStats(c)
check('stats: sent, answered and reasons', s.sent >= 3 && s.answered >= 2 && Object.keys(s.byHour).length >= 1 && s.reasons.slow === 1 && s.reasons.good === 1 && s.optouts === 1 && s.skipped.bought >= 1, JSON.stringify(s))

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
