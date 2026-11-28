// Marketers: how many people each one brought (and how many became partners). Counts now; the percent is added later on the campaign.
//   node --no-warnings --import ./register.mjs marketer_report_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
await import('../tgcloud/lib/bot.js')
const AR = (await import('../tgcloud/endpoints/admin_report.js')).default
await db.run(sql`DELETE FROM referral_signups`); await db.run(sql`DELETE FROM referral_links`); await db.run(sql`DELETE FROM Requestagent`)
await db.run(sql`DELETE FROM kv WHERE key = 'config:usernamebot'`); await db.run(sql`INSERT INTO kv (key, value, updated_at) VALUES ('config:usernamebot', '@pichanet_bot', 0)`)
const link = async (name, code, pays = 0, pct = null) => (await db.run(sql`INSERT INTO referral_links (name, platform, code, active, created_at, pays_commission, commission_percent) VALUES (${name}, 'telegram', ${code}, 1, 1, ${pays}, ${pct})`)).lastInsertRowid
const ali = await link('علی', 'ali'), sara = await link('سارا', 'sara', 1, 10)
const user = (id, agent = 'f') => db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status) VALUES (${String(id)}, ${'u' + id}, ${agent}, '0', 'home', 'Active')`)
const signup = (l, id, t) => db.run(sql`INSERT INTO referral_signups (link_id, user_id, created_at) VALUES (${l}, ${String(id)}, ${t})`)
const request = (id, status) => db.run(sql`INSERT INTO Requestagent (id, username, time, Description, status, type) VALUES (${String(id)}, 'x', '1', 'd', ${status}, 'None')`)
for (const id of [1, 2, 3, 4, 5, 6]) await user(id)
await user(3, 'n'); await user(4, 'n')
// ali brought 9100001..9100005, sara brought 9100006..9100008 (a person can belong to ONE marketer: the first link he used)
for (const id of [1, 2, 3, 4, 5]) await signup(ali, 9100000 + id, 10 + id)
for (const id of [1, 2, 3, 4, 5]) await user(9100000 + id)
await user(9100003, 'n'); await user(9100004, 'n')
for (const id of [9100006, 9100007, 9100008]) { await signup(sara, id, 99); await user(id) }
await request(9100001, 'waiting'); await request(9100002, 'reject'); await request(9100003, 'accept'); await request(9100004, 'accept'); await request(9100006, 'accept'); await user(9100006, 'n')
// one of ali's people bought
await db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product, price_product, Volume, Service_time) VALUES ('9100002', 'm1', 'svc', '1', 'active', 'p', '200000', '40', '30')`)
await db.run(sql`INSERT INTO service_other (id_user, username, value, type, time, price, output, status) VALUES ('9100002', 'svc', '40', 'extend_user', '2026/11/20 10:00:00', '100000', '', 'paid')`)
const r = await AR({ tool: 'marketers' }, {})
const by = Object.fromEntries(r.marketers.map((m) => [m.code, m]))
check('each marketer has a partner link and a customer link', by.ali.partner_link === 'https://t.me/pichanet_bot?start=ag_ali' && by.ali.customer_link === 'https://t.me/pichanet_bot?start=ali', JSON.stringify(by.ali))
check('brought = everyone who started through his link', by.ali.brought === 5 && by.sara.brought === 3, `${by.ali.brought} ${by.sara.brought}`)
check('partnership requests: waiting 1, rejected 1, accepted 2 for ali (4 requests)', by.ali.partner_requests === 4 && by.ali.waiting === 1 && by.ali.approved === 2, JSON.stringify(by.ali))
check('sara: 1 request, accepted', by.sara.partner_requests === 1 && by.sara.approved === 1, JSON.stringify(by.sara))
check('a person already attached to ali cannot be taken over by sara', await signup(sara, 9100001, 200).then(() => false, () => true))
check('partners now (really n / n2)', by.ali.partners_now === 2 && by.sara.partners_now === 1, `${by.ali.partners_now} ${by.sara.partners_now}`)
check('buyers and revenue come from the invoices of the people he brought', by.ali.buyers === 1 && by.ali.revenue_toman === 300000 && by.ali.of_which_renewals_toman === 100000)
check('no percent yet = no commission; once pays_commission + percent are set the same report fills it in', by.ali.commission_percent === 0 && by.ali.commission_toman === 0 && by.sara.commission_percent === 10)
await db.run(sql`UPDATE referral_links SET pays_commission = 1, commission_percent = 15 WHERE code = 'ali'`)
const r2 = await AR({ tool: 'marketers' }, {})
check('later: 15% of 300000 (a purchase + a renewal) = 45000 commission for ali, nothing paid yet so all due', r2.marketers.find((m) => m.code === 'ali').commission_toman === 45000 && r2.marketers.find((m) => m.code === 'ali').due_toman === 45000)
check('totals', r2.totals.brought === 8 && r2.totals.revenue_toman === 300000, JSON.stringify(r2.totals))
check('a Mini App call is refused', await AR({ tool: 'marketers' }, { initData: { user: { id: 1 } } }).then(() => false, () => true))
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)
