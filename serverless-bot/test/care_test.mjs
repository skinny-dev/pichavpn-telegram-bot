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

// numbers for the admin
const s = await careStats(c)
check('stats: sent, answered and reasons', s.sent >= 3 && s.answered >= 2 && s.reasons.slow === 1 && s.reasons.good === 1 && s.optouts === 1 && s.skipped.bought === 1, JSON.stringify(s))

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
