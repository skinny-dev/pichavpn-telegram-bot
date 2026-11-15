// A renewal never ends the service earlier than it already ends; the renewals tool shows what happened to a customer's days.
//   node --no-warnings --import ./register.mjs extend_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { neverShorten } = await import('../tgcloud/lib/panel.js')
const now = 1_800_000_000, D = 86400
check('10 days left + a 3-day plan (reset method): the 10 days stay', neverShorten(now + 3 * D, now + 10 * D, now) === now + 10 * D)
check('10 days left + a 30-day plan: the plan wins (reset semantics unchanged)', neverShorten(now + 30 * D, now + 10 * D, now) === now + 30 * D)
check('a plan with no time limit stays unlimited', neverShorten(0, now + 10 * D, now) === 0)
check('an expired service is not touched', neverShorten(now + 3 * D, now - 5 * D, now) === now + 3 * D)
check('a service with no end date (unlimited) gets the plan as it is', neverShorten(now + 3 * D, 0, now) === now + 3 * D)

const h = (await import('../tgcloud/endpoints/admin_report.js')).default
const T = Math.floor(Date.now() / 1000)
const tehran = (t) => new Date((t + 12600) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/')
await db.run(sql`INSERT INTO service_other (id_user, username, value, time, price, type, status) VALUES ('9201', 'abcdef', ${JSON.stringify({ volumebuy: '10', Service_time: '3', oldtime: T + 10 * D, oldvolume: 1 })}, ${tehran(T)}, '60000', 'extend_user', 'paid')`)
const r = await h({ tool: 'renewals', user: '9201' }, {})
check('the renewals tool shows the days the customer had left and the days the plan gave', r.user_renewals.length === 1 && r.user_renewals[0].days_left_before >= 9.9 && r.user_renewals[0].days_left_before <= 10.1 && r.user_renewals[0].plan_days === 3, JSON.stringify(r.user_renewals))
check('without a user it explains the usage', (await h({ tool: 'renewals' }, {})).usage.includes('renewals'))
check('a Mini App call is refused', await h({ tool: 'renewals', user: '9201' }, { initData: { user: { id: 1 } } }).then(() => false, () => true))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
