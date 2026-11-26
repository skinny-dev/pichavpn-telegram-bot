// Renewal UX (from a real screen recording): the list names each service, «next/previous» exist only when there is another page,
// a customer with ONE live service goes straight to its renewal options, and the funnel counters count.
//   node --no-warnings --import ./register.mjs renew_ux_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { handleUpdate } = await import('../tgcloud/lib/bot.js')
const kv = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
const nowT = Math.floor(Date.now() / 1000)
const mkUser = (id) => db.run(sql`INSERT OR REPLACE INTO user (id, step, User_Status, Balance, roll_Status, joinchannel, verify, agent, username, pagenumber) VALUES (${String(id)}, 'home', 'Active', '0', 1, 'active', '1', 'f', ${'u' + id}, 1)`)
const inv = (user, n, status = 'active') => db.run(sql`INSERT OR REPLACE INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product, price_product, Service_location) VALUES (${String(user)}, ${'rx' + user + '-' + n}, ${'svc' + user + '_' + n}, ${String(nowT - n)}, ${status}, '۴۰ گیگ ۳۰ روزه', '100000', 'nowhere')`)
let uid = 7000
const msg = (from, text) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: from, first_name: 'A', is_bot: false }, chat: { id: from, type: 'private' }, date: 1, text } })
const cb = (from, data) => handleUpdate({ update_id: ++uid, callback_query: { id: 'q' + uid, from: { id: from, first_name: 'A', username: 'a' + from, is_bot: false }, chat_instance: '1', data, message: { message_id: 9, chat: { id: from, type: 'private' }, date: 1 } } })
const lastKb = () => { const m = [...calls].reverse().find(([k, p]) => /sendmessage|editmessagetext/i.test(k) && p.reply_markup && /inline_keyboard/.test(typeof p.reply_markup === 'string' ? p.reply_markup : JSON.stringify(p.reply_markup))); if (!m) return null; const rm = typeof m[1].reply_markup === 'string' ? JSON.parse(m[1].reply_markup) : m[1].reply_markup; return rm.inline_keyboard }
const btns = () => (lastKb() || []).flat().map((b) => b.callback_data)
await db.run(sql`DELETE FROM kv WHERE key LIKE 'funnel:%'`)
const T = (await import('../tgcloud/lib/texts.js'))
const label = '♻️ تمدید سرویس'

// 3 live services + 1 ended one that must NOT count
await mkUser(7601); for (const n of [1, 2, 3]) await inv(7601, n); await inv(7601, 4, 'removed')
calls.length = 0; await msg(7601, label)
const kb1 = lastKb()
check('3 services: one button per service, named with the plan', kb1 && kb1.filter((r) => /^extend_/.test(r[0].callback_data)).length === 3 && /svc7601_1 · /.test(kb1[0][0].text), JSON.stringify(kb1))
check('a single page: NO «next» / «previous»', !btns().some((d) => /page_extends/.test(d)), btns().join())
check('…and the back button is there', btns().includes('backuser'))

// 25 services: two pages, only the right arrows
await mkUser(7602); for (let n = 1; n <= 25; n++) await inv(7602, n)
calls.length = 0; await msg(7602, label)
check('25 services: page 1 has «next» and no «previous»', btns().includes('next_page_extends') && !btns().includes('previous_page_extends') && btns().filter((d) => /^extend_/.test(d)).length === 20, btns().join())
calls.length = 0; await cb(7602, 'next_page_extends')
check('page 2: the other 5, «previous» and no «next»', btns().includes('previous_page_extends') && !btns().includes('next_page_extends') && btns().filter((d) => /^extend_/.test(d)).length === 5, btns().join())

// ONE live service (plus old invoices that are not live): straight to its renewal options, no list
await mkUser(7603); await inv(7603, 1); for (const n of [2, 3, 4, 5]) await inv(7603, n, 'removed')
calls.length = 0; await msg(7603, label)
check('one live service: no list of one is shown', !btns().some((d) => /^extend_/.test(d)) || calls.some(([k, p]) => /sendmessage/i.test(k) && !/سرویس خود را جهت تمدید انتخاب نمایید/.test(String(p.text))), btns().join())
check('…the list text is not sent', !calls.some(([, p]) => /سرویس خود را جهت تمدید انتخاب نمایید/.test(String(p.text ?? ''))))

// nobody to renew
await mkUser(7604); calls.length = 0; await msg(7604, label)
check('no live service: the «nothing to renew» message', calls.some(([k]) => /sendmessage/i.test(k)))

const d = new Date(Date.now() + 12600000).toISOString().slice(0, 10).replace(/-/g, '')
check('funnel counters: opens counted', Number(await kv(`funnel:${d}:renew_open`)) >= 4, String(await kv(`funnel:${d}:renew_open`)))
check('funnel counters: list shown / list skipped / page counted', Number(await kv(`funnel:${d}:renew_list`)) >= 2 && Number(await kv(`funnel:${d}:renew_skip_list`)) === 1 && Number(await kv(`funnel:${d}:renew_page`)) === 1)
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)
