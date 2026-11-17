// /sendall: the admin writes a message, it reaches everyone in batches; cancel stops it.
//   node --no-warnings --import ./register.mjs broadcast_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('cron:off', '1', 0)`)
for (let i = 0; i < 60; i++) await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, agent, Balance, lang) VALUES (${String(8000 + i)}, 'home', ${i === 5 ? 'block' : 'Active'}, 'f', '0', 'fa')`)
const { handleUpdate } = await import('../tgcloud/lib/bot.js')
let uid = 1
const msg = (from, text, extra = {}) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: from, first_name: 'A', username: 'a', is_bot: false }, chat: { id: from, type: 'private' }, date: 1, text, ...extra } })
const cb = (from, data) => handleUpdate({ update_id: ++uid, callback_query: { id: 'q' + uid, from: { id: from, first_name: 'A', username: 'a' }, chat_instance: '1', data, message: { message_id: 777, chat: { id: from, type: 'private' }, date: 1, text: 'x' } } })
const sent = (text) => calls.filter(([m, p]) => m.toLowerCase() === 'sendmessage' && String(p.text) === text)
await msg(5550001, '/sendall')
const total = Number((await db.get(sql`SELECT COUNT(*) AS n FROM user WHERE User_Status != 'block'`)).n)
await msg(5550001, 'سلام به همه')
calls.length = 0
await msg(5550001, '1')
check('one run sends as many batches as fit in the time budget (a run used to send only 25: thousands of users took hours)', sent('سلام به همه').length === total && !sent('سلام به همه').some(([, p]) => String(p.chat_id) === '8005'), `${sent('سلام به همه').length}/${total}`)
check('it has the buy button', JSON.stringify(sent('سلام به همه')[0]?.[1].reply_markup).includes('"buy"'))
check('the job finished', !(await db.get(sql`SELECT value FROM kv WHERE key = 'broadcast:job'`)))
check('admin told it is done', calls.some(([m, p]) => m.toLowerCase() === 'sendmessage' && String(p.chat_id) === '5550001' && /✅ \d+ · ❌ \d+/.test(String(p.text))))
// a zero budget = exactly one batch of 25 per call (the safety valve), and it continues from where it stopped
const { broadcastStart, broadcastTick } = await import('../tgcloud/lib/broadcast.js')
const { systemContext } = await import('../tgcloud/lib/bot.js')
const cc = { ...(await systemContext()), from_id: '5550001' }
await broadcastStart(cc, { type: 'text', text: 'بودجه صفر' }, 0)
calls.length = 0
const more1 = await broadcastTick(cc, true, 0)
check('budget 0: one batch of 25 and the job stays', more1 === true && sent('بودجه صفر').length === 25 && !!(await db.get(sql`SELECT value FROM kv WHERE key = 'broadcast:job'`)))
await broadcastTick(cc, true, 0); await broadcastTick(cc, true, 0); await broadcastTick(cc, true, 0)
check('…and the next calls carry on without sending anyone twice', sent('بودجه صفر').length === total && new Set(sent('بودجه صفر').map(([, p]) => p.chat_id)).size === total)
await msg(5550001, '/sendall'); await msg(5550001, 'دومی'); await msg(5550001, '0')
await cb(5550001, 'cancel_sendmessage')
check('cancel removes the job', !(await db.get(sql`SELECT value FROM kv WHERE key = 'broadcast:job'`)))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
