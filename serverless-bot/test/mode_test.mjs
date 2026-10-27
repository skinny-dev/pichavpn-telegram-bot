// relay / native / maint switching with /mode.   node --no-warnings --import ./register.mjs mode_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql, migrate } from 'sdk/db'
import * as schema from '../tgcloud/schema.js'
import config from '../tgcloud/lib/config.js'
import { dispatch, currentMode } from '../tgcloud/lib/mode.js'

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
migrate(schema)
config.admin_ids.push('5550001')
let uid = 1
const msg = (from, text) => ({ update_id: ++uid, message: { message_id: uid, from: { id: from, first_name: 'A', username: 'a', is_bot: false }, chat: { id: from, type: 'private' }, date: 1, text } })
const texts = () => calls.filter(([m]) => m.toLowerCase() === 'sendmessage').map(([, p]) => String(p.text))
check('a deployment without a PHP server starts native', (await currentMode()) === 'native')
await dispatch(msg(5550001, '/mode native'))
check('native refused while the database is empty', texts().some((t) => t.includes('هنوز پر نشده')), JSON.stringify(texts()))
await seed(process.argv[2])
calls.length = 0
await dispatch(msg(5550001, '/mode maint'))
check('maint set', (await currentMode()) === 'maint')
calls.length = 0
await dispatch(msg(1001, 'سلام'))
check('in maint a customer is told to wait', texts().some((t) => t.includes('به‌روزرسانی')))
await dispatch(msg(5550001, '/mode native'))
check('native set once the data is there', (await currentMode()) === 'native')
calls.length = 0
await dispatch(msg(1001, '/start'))
check('native: the bot answers', texts().length > 0)
calls.length = 0
await dispatch(msg(1001, '/mode relay'))
check('a customer cannot use /mode', (await currentMode()) === 'native')
await dispatch(msg(5550001, '/mode relay'))
check('relay refused without a PHP server address', (await currentMode()) === 'native')
await dispatch(msg(5550001, '/mode'))
check('status shown', texts().some((t) => t.includes('حالت ربات')))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
