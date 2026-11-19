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
check('without a tool it lists the tools', Array.isArray(list.tools) && list.tools.length === 14, JSON.stringify(list))
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
const pr = await run('partner_ready'); check('partner_ready: a verdict, checks and the price list', typeof pr.verdict === 'string' && pr.checks.length >= 6 && Array.isArray(pr.partner_prices) && pr.products_by_agent, JSON.stringify(pr).slice(0, 200))
const cs = await run('costs', { eur_rate: 100000 })
check('costs: VPN servers €29.80 + the Iranian server 980,000 + 30 TB of traffic at 450 toman/GB = the monthly cost and the cost per GB', cs.monthly_toman.vpn_servers_eur === 2980000 && cs.monthly_toman.iran_server === 980000 && cs.monthly_toman.traffic === 13500000 && cs.monthly_toman.total === 17460000 && cs.cost_per_gb.new === 582 && cs.cost_per_gb.parts.traffic === 450, JSON.stringify(cs.monthly_toman) + JSON.stringify(cs.cost_per_gb))
check('costs: 900 active users, 300 at peak: GB and cost per user, load per server', cs.people_and_load.gb_per_active_user === 33.3 && cs.people_and_load.cost_per_active_user_toman === 19400 && cs.people_and_load.users_online_per_vpn_server_at_peak === 60 && cs.people_and_load.average_mbps_all_servers === 93, JSON.stringify(cs.people_and_load))
check('costs: a margin for every plan and partner tier, platinum is the lowest', cs.margin_pct_by_plan_and_tier.length === 8 && cs.margin_pct_by_plan_and_tier.every((r) => r.partner_30pct < r.partner_10pct && r.partner_10pct < r.customer))
check('costs: a preview writes nothing', (await db.get(sql`SELECT value FROM kv WHERE key = 'events:cost_gb'`)) == null)
const ca = await run('costs', { eur_rate: 100000, apply: true })
check('costs: apply stores it', ca.applied === 'events:cost_gb = 582' && (await db.get(sql`SELECT value FROM kv WHERE key = 'events:cost_gb'`)).value === '582')
check('costs: without a rate it asks for one', (await run('costs', {})).error.includes('eur_rate'))
const n = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? n(d + '/' + e.name) : [e.name]))
check('the app stays under the 100-module limit with room to spare', n(new URL('../tgcloud', import.meta.url).pathname).length <= 96, String(n(new URL('../tgcloud', import.meta.url).pathname).length))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
