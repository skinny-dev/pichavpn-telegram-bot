// «بهترین سرور برای کارم»: menu, recommendations, fallback to support, admin /fit, deep link ?start=fit
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { handleUpdate } = await import('../tgcloud/lib/bot.js')
const kvGet = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, Balance) VALUES ('7201', 'home', 'Active', '0')`)
await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'home' WHERE id = '7201'`)
await db.run(sql`INSERT OR IGNORE INTO admin (id_admin, rule) VALUES ('5550001', 'administrator')`)
await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'home' WHERE id = '5550001'`)
let uid = 1
const msg = (from, text) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: from, first_name: 'Ali', is_bot: false }, chat: { id: from, type: 'private' }, date: 1, text } })
const cb = (from, data) => handleUpdate({ update_id: ++uid, callback_query: { id: 'q' + uid, from: { id: from, first_name: 'Ali', is_bot: false }, chat_instance: '1', data, message: { message_id: 9, chat: { id: from, type: 'private' }, date: 1, text: 'x' } } })
const sent = () => calls.filter(([m]) => m.toLowerCase() === 'sendmessage')
const edits = () => calls.filter(([m]) => /editmessagetext/i.test(m))

calls.length = 0
await msg(7201, '/start fit')
check('deep link ?start=fit opens the use-case menu', sent().some(([, p]) => /برای چه کاری/.test(String(p.text)) && JSON.stringify(p.reply_markup).includes('fit_ai')), JSON.stringify(sent().map(([, p]) => p.text)))
calls.length = 0
await cb(7201, 'fit_ai')
check('no recommendation set: the customer is handed to support, not told something invented', edits().some(([, p]) => /پشتیبانی/.test(String(p.text)) && JSON.stringify(p.reply_markup).includes('supportbtns') && !/سرور هلند/.test(String(p.text))))
check('the request is counted (content demand)', Number(await kvGet('care:n:fit:ai')) === 1)
calls.length = 0
await msg(5550001, '/fit ai تانل فنلاند یا سرور هلند')
check('/fit sets a recommendation', (await kvGet('fit:ai')) === 'تانل فنلاند یا سرور هلند')
await cb(7201, 'fit_ai')
check('with a recommendation: it is shown with the support way out', edits().some(([, p]) => /تانل فنلاند/.test(String(p.text)) && JSON.stringify(p.reply_markup).includes('supportbtns')))
calls.length = 0
await msg(5550001, '/fit')
check('/fit lists every use with its recommendation and the demand', sent().some(([, p]) => /هوش مصنوعی/.test(String(p.text)) && /تانل فنلاند/.test(String(p.text)) && /یوتیوب/.test(String(p.text))))
await msg(7201, '/fit ai سرور بد')
check('a customer cannot set it', (await kvGet('fit:ai')) === 'تانل فنلاند یا سرور هلند')
await msg(5550001, '/fit ai off')
check('/fit ai off clears it', (await kvGet('fit:ai')) === null)
await cb(7201, 'fit_menu')
check('«کار دیگر» goes back to the menu', edits().some(([, p]) => /برای چه کاری/.test(String(p.text))))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
