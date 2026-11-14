// Daily pulse: slots, own-slot assignment, silent sending, once per slot, controls, collisions with care, brake.
//   node --no-warnings --import ./register.mjs pulse_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls, replies, BotApiError } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { systemContext, handleUpdate } = await import('../tgcloud/lib/bot.js')
const { pulseTick, pulseSlotNow, pulseStats, PULSE_LIBRARY } = await import('../tgcloud/lib/pulse.js')
const c = await systemContext()
const DAY = 86400
const SAT = Date.UTC(2026, 10, 14, 0, 0) / 1000 - 12600 // Saturday 14 Nov 2026, 00:00 Tehran
const at = (dayOffset, h) => SAT + dayOffset * DAY + h * 3600
const kvGet = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const sent = () => calls.filter(([m]) => m.toLowerCase() === 'sendmessage')
const to = () => sent().map(([, p]) => String(p.chat_id)).sort()

// only my test people are active
await db.run(sql`UPDATE user SET User_Status = 'Blocked'`)
const U = { morning: '7301', noon: '7302', night: '7303', never: '7304', blocker: '7305' }
for (const id of Object.values(U)) await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, Balance) VALUES (${id}, 'home', 'Active', '0')`)
const usedAt = (id, h) => db.run(sql`UPDATE user SET User_Status = 'Active', joinchannel = 'active', roll_Status = 1, step = 'home', last_message_time = ${String(at(-3, h))} WHERE id = ${id}`)
await usedAt(U.morning, 9); await usedAt(U.noon, 13); await usedAt(U.night, 20); await usedAt(U.blocker, 9)
await db.run(sql`UPDATE user SET User_Status = 'Active', joinchannel = 'active', roll_Status = 1, step = 'home', last_message_time = '0' WHERE id = ${U.never}`)
await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, Balance) VALUES ('5550001', 'home', 'Active', '0')`)
await db.run(sql`INSERT OR IGNORE INTO admin (id_admin, rule) VALUES ('5550001', 'administrator')`)
await db.run(sql`UPDATE user SET User_Status = 'Active', joinchannel = 'active', roll_Status = 1, step = 'home', last_message_time = ${String(at(-3, 9))} WHERE id = '5550001'`)

// slots
check('slots: Sat 09:30 morning, 12:30 noon, 20:00 night, 11:00 none, 14:00 none', (await pulseSlotNow(at(0, 9.5))) === 'morning' && (await pulseSlotNow(at(0, 12.5))) === 'noon' && (await pulseSlotNow(at(0, 20))) === 'night' && (await pulseSlotNow(at(0, 11))) === null && (await pulseSlotNow(at(0, 14))) === null)
check('slots: Thursday has no night slot, Friday only a light morning at 11:30', (await pulseSlotNow(at(5, 20))) === null && (await pulseSlotNow(at(6, 10))) !== 'morning' && (await pulseSlotNow(at(6, 11.5))) === 'morning' && (await pulseSlotNow(at(6, 20))) === null)
check('slots: a holiday (Nowruz 1406) has none', (await pulseSlotNow(Date.UTC(2027, 2, 21, 6, 30) / 1000)) === null)

// off by default
let r = await pulseTick(c, { at: at(0, 9.5) })
check('off by default', r.reason === 'off')
await kvSet('pulse:on', '1')
calls.length = 0; r = await pulseTick(c, { at: at(0, 9.5), BATCH: 50 })
check('rollout «admins» (default): only the administrator gets it', to().join() === '5550001', to().join())
const m1 = sent()[0]?.[1]
check('it is sent SILENTLY (no sound) with «درود», a useful button and the frequency control', m1?.disable_notification === true && /درود/.test(String(m1?.text)) && !/سلام/.test(String(m1?.text)) && JSON.stringify(m1?.reply_markup).includes('pu_freq_menu') && JSON.stringify(m1?.reply_markup).includes('pu_'))

// everyone: own slot
await kvSet('pulse:mode', 'all')
calls.length = 0; r = await pulseTick(c, { at: at(1, 9.5), BATCH: 50 }) // Sunday morning
check('morning: people whose own slot is morning (incl. never-seen); not the noon/night people', to().includes(U.morning) && to().includes(U.never) && !to().includes(U.noon) && !to().includes(U.night), to().join())
calls.length = 0; r = await pulseTick(c, { at: at(1, 10), BATCH: 50 })
check('once per slot per day: a second tick sends nothing', sent().length === 0)
calls.length = 0; r = await pulseTick(c, { at: at(1, 12.5), BATCH: 50 }) // Sunday noon
check('noon: only the noon person (nobody has engaged yet)', to().join() === U.noon, to().join())
calls.length = 0; r = await pulseTick(c, { at: at(1, 20), BATCH: 50 })
check('night: only the night person', to().join() === U.night, to().join())

// engagement: a click opens extra slots and is counted; the real action still runs
const cb = (from, data) => handleUpdate({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'q' + Math.random(), from: { id: Number(from), first_name: 'Ali', is_bot: false }, chat_instance: '1', data, message: { message_id: 9, chat: { id: Number(from), type: 'private' }, date: 1, text: 'x' } } })
calls.length = 0
await cb(U.morning, 'pu_support_m1')
check('a pulse button is counted as engagement and then does its normal job (support)', Number(await kvGet('pulse:eng:' + U.morning)) > 0 && Number(await kvGet('pulse:n:click:m1')) === 1 && calls.length > 0)
calls.length = 0; await pulseTick(c, { at: at(2, 12.5), BATCH: 50 }) // Monday noon
check('an engaged person also gets the noon slot (not only their own)', to().includes(U.morning) && to().includes(U.noon), to().join())

// controls
await cb(U.noon, 'pu_freq_off')
calls.length = 0; await pulseTick(c, { at: at(3, 12.5), BATCH: 50 })
check('«خاموش»: nothing more for that person', !to().includes(U.noon) && (await kvGet('pulse:freq:' + U.noon)) === 'off')
await kvSet('pulse:freq:' + U.night, 'weekly')
calls.length = 0; await pulseTick(c, { at: at(3, 20), BATCH: 50 }); check('«هفتگی»: not on a Tuesday', !to().includes(U.night))
await kvSet('pulse:freq:' + U.morning, 'weekly')
calls.length = 0; await pulseTick(c, { at: at(7, 9.5), BATCH: 50 }) // the next Saturday morning
check('«هفتگی»: Saturday morning yes', to().includes(U.morning))

// the same item is not sent twice; a care message the same day replaces the pulse
await kvSet(`care:sentto:${Math.floor((at(8, 9.5) + 12600) / DAY)}:${U.never}`, '1')
calls.length = 0; await pulseTick(c, { at: at(8, 9.5), BATCH: 50 })
check('a care message today replaces the pulse for that person', !to().includes(U.never))
const seen = JSON.parse(await kvGet('pulse:seen:' + U.never) || '[]')
check('the library is not repeated before it has been seen', new Set(seen).size === seen.length && seen.length >= 1)

// today's inputs
await cb('5550001', 'pu_freq_daily')
const say = (text) => handleUpdate({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, from: { id: 5550001, first_name: 'A', is_bot: false }, chat: { id: 5550001, type: 'private' }, date: 1, text } })
const realNow = Math.floor(Date.now() / 1000)
await say('/today update on')
const dk = Math.floor((realNow + 12600) / DAY)
check('/today update on is stored', JSON.parse(await kvGet('pulse:today:' + dk)).update === true)
await db.run(sql`UPDATE user SET last_message_time = ${String(realNow - 3 * DAY)} WHERE id = ${U.never}`)
await kvSet('pulse:eng:' + U.never, '0')
// emulate the day: we call the engine at a morning of that real Tehran day
const todayMorning = (Math.floor((realNow + 12600) / DAY) * DAY - 12600) + 9.5 * 3600
await kvSet('pulse:today:' + dk, JSON.stringify({ update: true }))
await db.run(sql`DELETE FROM kv WHERE key LIKE 'pulse:s:%'`)
calls.length = 0; await pulseTick(c, { at: todayMorning, BATCH: 50 })
const upd = sent().find(([, p]) => /به‌روزرسانی/.test(String(p.text)))
check('«today: update» makes the morning message ask for a subscription update (if today is a working day)', !!upd || (await pulseSlotNow(todayMorning)) === null)
await kvSet('pulse:today:' + dk, JSON.stringify({ best: 'تانل فنلاند' }))
await db.run(sql`DELETE FROM kv WHERE key LIKE 'pulse:s:%'`)
calls.length = 0; await pulseTick(c, { at: todayMorning, BATCH: 50 })
check('«today: best» tells the best server', sent().some(([, p]) => /تانل فنلاند/.test(String(p.text))) || (await pulseSlotNow(todayMorning)) === null)

// blocks: a person who blocked the bot is switched off, counted, and the brake trips at > 2 %
replies.sendmessage = (p) => { if (String(p.chat_id) === U.blocker) throw new BotApiError(403, 'Forbidden: bot was blocked by the user', 'sendmessage') }
await db.run(sql`DELETE FROM kv WHERE key LIKE 'pulse:s:%'`); await kvSet('pulse:today:' + dk, '{}')
await kvSet('pulse:mode', 'all'); await db.run(sql`UPDATE user SET last_message_time = ${String(at(-3, 9))} WHERE id = ${U.blocker}`)
r = await pulseTick(c, { at: at(14, 9.5), BATCH: 50 }) // Saturday
check('a person who blocked the bot is switched off for good', (await kvGet('pulse:freq:' + U.blocker)) === 'off' && r.blocked >= 1, JSON.stringify(r))
delete replies.sendmessage
const d = Math.floor((at(14, 9.5) + 12600) / DAY)
await kvSet(`pulse:n:${d}:sent`, '300'); await kvSet(`pulse:n:${d}:blocked`, '20')
await db.run(sql`DELETE FROM kv WHERE key LIKE 'pulse:s:%'`)
await pulseTick(c, { at: at(14, 9.6), BATCH: 1 })
check('the brake trips when more than 2 % of a week blocked the bot', !!(await kvGet('pulse:paused')))
calls.length = 0; r = await pulseTick(c, { at: at(14, 9.7), BATCH: 50 })
check('while paused nothing is sent', r.reason === 'paused' && sent().length === 0)
const st = await pulseStats(at(14, 9.5))
check('stats answer', st.on === true && Array.isArray(st.items))
check('the library is complete (18 messages, 6 per slot) and never says «سلام»', PULSE_LIBRARY.length === 18 && ['morning', 'noon', 'night'].every((s) => PULSE_LIBRARY.filter((i) => i.slot === s).length === 6) && PULSE_LIBRARY.every((i) => !/سلام/.test(i.text) && !/تخفیف|فقط تا/.test(i.text)))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
