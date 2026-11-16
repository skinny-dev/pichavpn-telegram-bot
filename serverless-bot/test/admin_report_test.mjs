// The seven CLI diagnostics live in ONE endpoint (the platform allows 100 modules per app). Each tool must still work; none may be reachable from the Mini App.
//   node --no-warnings --import ./register.mjs admin_report_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db } from 'sdk'
import { sql } from 'sdk/db'
import fs from 'node:fs'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const h = (await import('../tgcloud/endpoints/admin_report.js')).default
check('a Mini App call is refused', await h({ tool: 'diag' }, { initData: { user: { id: 1 } } }).then(() => false, () => true))
const list = await h({}, {})
check('without a tool it lists the tools', Array.isArray(list.tools) && list.tools.length === 9, JSON.stringify(list))
await db.run(sql`DELETE FROM PaySetting WHERE NamePay IN ('tetraminator_api_key')`)
const run = async (tool, extra = {}) => h({ tool, ...extra }, {})
const diag = await run('diag'); check('diag: runtime, db speed, cron, gateways, mode', diag.runtime && diag.db_ms && diag.cron && diag.gateways && 'mode' in diag, Object.keys(diag).join())
const act = await run('activity'); check('activity: per-day counts and the last times', Object.keys(act.days).length === 8 && act.last && act.cron, Object.keys(act).join())
const pays = await run('payments'); check('payments: last payments, relay, cron, health, settings', pays.last_payments.length > 0 && pays.relay && pays.cron && pays.settings && Array.isArray(pays.waiting_rows), Object.keys(pays).join())
const tet = await run('tetra'); check('tetra: config and orders', tet.config && Array.isArray(tet.orders) && typeof tet.how_to_read === 'string', Object.keys(tet).join())
const srv = await run('servers'); check('servers: the catalog', Array.isArray(srv.servers) && srv.best, Object.keys(srv).join())
const sup = await run('support_export', { limit: 3 }); check('support_export runs', sup && typeof sup === 'object', JSON.stringify(sup).slice(0, 80))
const ch = await run('channel_stats'); check('channel_stats runs', ch && typeof ch === 'object', JSON.stringify(ch).slice(0, 80))
await db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Service_time, Volume, price_product, Status, name_product, Service_location) VALUES ('9301', 'cust1', 'svc9301', ${String(Math.floor(Date.now() / 1000) - 86400)}, '3', '10', '60000', 'active', 'پلن ۳ روزه', 'nopanel')`)
const cu = await run('customer', { user: '9301' }); check('customer: services with the plan days, the changes and the payments', cu.found === false && cu.services.length === 1 && cu.services[0].plan_days === 3 && cu.services[0].service === 'svc9301' && Array.isArray(cu.changes) && Array.isArray(cu.payments), JSON.stringify(cu).slice(0, 200))
check('customer without an id explains the usage', (await run('customer', {})).usage.includes('customer'))
const n = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? n(d + '/' + e.name) : [e.name]))
check('the app stays under the 100-module limit with room to spare', n(new URL('../tgcloud', import.meta.url).pathname).length <= 96, String(n(new URL('../tgcloud', import.meta.url).pathname).length))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
