// The memory of what we told each customer: no repeated lessons, ignored topics fall silent, offers rest, tired people get less.
//   node --no-warnings --import ./register.mjs memory_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const M = await import('../tgcloud/lib/memory.js')
const { systemContext } = await import('../tgcloud/lib/bot.js')
const { pulseTick, PULSE_LIBRARY } = await import('../tgcloud/lib/pulse.js')
const { careRun } = await import('../tgcloud/lib/care.js')
const c = await systemContext()
const DAY = 86400, T0 = Date.UTC(2026, 10, 14, 6, 0) / 1000
const kvGet = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const tip = { topic: 'ping_test', kind: 'tip' }, offer = { topic: 'test_invite', kind: 'offer' }, action = { topic: 'fit', kind: 'action' }

// 1) a lesson is told at most twice, never within 3 weeks
const u1 = '7501'
check('a new person may get a lesson', (await M.memAllow(u1, tip, T0)).ok)
await M.memSent(u1, tip, T0)
check('the same lesson is not repeated within a month', (await M.memAllow(u1, tip, T0 + 10 * DAY)).why === 'too_soon')
check('after a month it may be told a second time', (await M.memAllow(u1, tip, T0 + 31 * DAY)).ok)
await M.memClick(u1, 'other_topic', T0 + 1) // an unrelated tap does not matter
await M.memSent(u1, tip, T0 + 31 * DAY)
check('a lesson is never told a third time', (await M.memAllow(u1, tip, T0 + 60 * DAY)).why === 'told_enough' || (await M.memAllow(u1, tip, T0 + 60 * DAY)).why === 'muted')

// 2) a tap means «they know it»: no more lessons on that topic, but actions stay available
const u2 = '7502'
await M.memSent(u2, tip, T0); await M.memClick(u2, 'ping_test', T0 + 100)
check('a tapped lesson is considered learned', (await M.memAllow(u2, tip, T0 + 40 * DAY)).why === 'learned')
await M.memSent(u2, action, T0)
check('an action (fit, renew, vote) may be offered again after the gap', (await M.memAllow(u2, action, T0 + 30 * DAY)).ok)

// 3) ignored twice with no tap ever → the topic is silent for 60 days
const u3 = '7503'
await M.memSent(u3, tip, T0)
await M.memSettle(u3, T0 + 3 * DAY)                    // first: ignored (48 h passed)
await M.memSent(u3, tip, T0 + 25 * DAY)
await M.memSettle(u3, T0 + 28 * DAY)                   // second ignored
const m3 = await M.memGet(u3)
check('two ignored messages on a topic mute it for 60 days', (m3.muted.ping_test || 0) > T0 + 28 * DAY + 50 * DAY, JSON.stringify(m3.muted))
check('the muted topic is refused', (await M.memAllow(u3, tip, T0 + 40 * DAY)).why === 'muted')
check('another topic is still fine', (await M.memAllow(u3, { topic: 'security', kind: 'tip' }, T0 + 40 * DAY)).ok)

// 4) offers: two ignored → no offers for 45 days
const u4 = '7504'
await M.memSent(u4, offer, T0); await M.memSettle(u4, T0 + 3 * DAY)
await M.memSent(u4, { topic: 'offer_two', kind: 'offer' }, T0 + 30 * DAY); await M.memSettle(u4, T0 + 33 * DAY)
check('two ignored offers: no offer for 45 days (any topic)', (await M.memAllow(u4, { topic: 'offer_three', kind: 'offer' }, T0 + 40 * DAY)).why === 'offer_paused')
check('…but lessons are not blocked by that', (await M.memAllow(u4, { topic: 'security', kind: 'tip' }, T0 + 40 * DAY)).ok)
check('…and after 45 days offers may come back', (await M.memAllow(u4, { topic: 'offer_three', kind: 'offer' }, T0 + 80 * DAY)).ok)

// 5) fatigue: five ignored in a row; an answer resets
const u5 = '7505'
for (let i = 0; i < 5; i++) { await M.memSent(u5, { topic: 't' + i, kind: 'tip' }, T0 + i * 4 * DAY); await M.memSettle(u5, T0 + i * 4 * DAY + 3 * DAY) }
await M.memSettle(u5, T0 + 40 * DAY)
check('five ignored messages in a row make a person «tired»', await M.memTired(u5, T0 + 40 * DAY))
await M.memClick(u5, 't9', T0 + 41 * DAY)
check('one tap clears the tiredness', !(await M.memTired(u5, T0 + 41 * DAY)))

// 6) the pulse really uses it
await db.run(sql`UPDATE user SET User_Status = 'Blocked'`)
for (const id of ['7510', '7511']) { await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, Balance) VALUES (${id}, 'home', 'Active', '0')`); await db.run(sql`UPDATE user SET User_Status = 'Active', joinchannel = 'active', roll_Status = 1, step = 'home', last_message_time = '0' WHERE id = ${id}`) }
await kvSet('pulse:on', '1'); await kvSet('pulse:mode', 'all')
const SAT = Date.UTC(2026, 10, 14, 0, 0) / 1000 - 12600
const sent = () => calls.filter(([m]) => m.toLowerCase() === 'sendmessage')
const seenIds = []
for (let d = 0; d < 6; d++) {
  await db.run(sql`DELETE FROM kv WHERE key LIKE 'pulse:s:%'`)
  calls.length = 0
  await pulseTick(c, { at: SAT + d * DAY + 9.5 * 3600, BATCH: 20 })   // Saturday 14 Nov … (Thu/Fri slots differ; the first days are working days)
  for (const [, p] of sent()) if (String(p.chat_id) === '7510') seenIds.push(String(p.text).slice(0, 25))
}
check('pulse: the same lesson text is never sent twice to a person (6 mornings)', new Set(seenIds).size === seenIds.length && seenIds.length >= 1, JSON.stringify(seenIds))
const mem10 = await M.memGet('7510')
check('pulse: what was sent is remembered (topics and a pending message)', Object.keys(mem10.topics).length >= 1 && !!mem10.pending)

// 7) cross-system: the pulse told them about the free test → the care invitation (C10) does not repeat it
await kvSet('care:on:C10', '1'); await kvSet('care:bands', JSON.stringify({ C10: [[0, 24]] })); await kvSet('care:avoid', '[]')
await M.memSent('7511', { topic: 'test_invite', kind: 'offer' }, SAT + 5 * DAY)   // the pulse e6 went out
await db.run(sql`UPDATE user SET register = ${String(SAT + 6 * DAY - 30 * 3600)}, last_message_time = '0' WHERE id = '7511'`)
await db.run(sql`DELETE FROM invoice WHERE id_user = '7511'`)
calls.length = 0
await careRun(c, { at: SAT + 6 * DAY + 12 * 3600 - 0 })
check('care C10 does not repeat the free-test invitation the pulse already sent', !sent().some(([, p]) => String(p.chat_id) === '7511'), JSON.stringify(sent().map(([, p]) => p.chat_id)))
// 8) the library carries a topic and a kind everywhere
check('every library item has a topic and a kind', PULSE_LIBRARY.every((i) => i.topic && ['tip', 'action', 'offer'].includes(i.kind)))
const st = await M.memStats(['ping_test', 'security'])
check('aggregate numbers by topic', Array.isArray(st) && st.every((x) => 'rate' in x))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
