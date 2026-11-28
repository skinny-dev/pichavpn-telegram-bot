// What partners cost and bring: gifts are expenses of kind «partner» (books + stats), purchases are revenue, welcome package once, panel routes.
//   node --no-warnings --import ./register.mjs partnereco_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
await import('../tgcloud/lib/bot.js')
const Eco = await import('../tgcloud/lib/partnerhub.js')
const P = await import('../tgcloud/lib/partners.js')
const S = await import('../tgcloud/lib/panelapi/stats.js')
const ep = (await import('../tgcloud/endpoints/panel.js')).default
const nowT = Math.floor(Date.now() / 1000)
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const user = (id, agent) => db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, pricediscount, Balance, number_username, User_Status, step) VALUES (${id}, ${'p' + id}, ${agent}, '10', '0', '5', 'Active', 'home')`)
await db.run(sql`UPDATE user SET agent = 'f' WHERE agent IN ('n','n2')`)
await user('9601', 'n'); await user('9602', 'n')
await kvSet('events:cost_gb', '2000')
const exp = () => db.all(sql`SELECT * FROM expenses WHERE kind = 'partner' ORDER BY id`)

const w = await Eco.giftAdd('9601', { kind: 'wallet', amount: 400000, note: 'آشنایی با ربات' })
check('a wallet gift credits the wallet', w.ok && Number((await db.get(sql`SELECT Balance FROM user WHERE id = '9601'`)).Balance) === 400000)
check('…and is booked as an expense of kind «partner» at face value', (await exp()).length === 1 && (await exp())[0].amount === 400000 && /9601/.test((await exp())[0].description))
const g = await Eco.giftAdd('9601', { kind: 'service', gb: 20, days: 3 })
check('a free service is booked at GB × cost per GB, wallet untouched', g.ok && g.entry.cost === 40000 && Number((await db.get(sql`SELECT Balance FROM user WHERE id = '9601'`)).Balance) === 400000)
check('limits and unknown things are refused', !(await Eco.giftAdd('9601', { kind: 'wallet', amount: 9e9 })).ok && !(await Eco.giftAdd('9601', { kind: 'wallet', amount: 0 })).ok && !(await Eco.giftAdd('nobody', { kind: 'wallet', amount: 1000 })).ok && !(await Eco.giftAdd('9601', { kind: 'cash', amount: 1000 })).ok && !(await Eco.giftAdd('9601', { kind: 'service', gb: 5000 })).ok)
check('refused gifts leave no expense behind', (await exp()).length === 2)

// the books and the statistics carry the new kind
check('the expense kind exists with a label and an icon', S.accExpenseKinds().partner === 'جذب و فعال‌سازی همکاران' && S.accKindIcon('partner') === '🤝' && S.accKindGroup('partner') === 'opex')
check('the ledger bridge books it as marketing', (await import('../tgcloud/lib/panelapi/finance/legacy.js')).finLegacyKindAccount('partner') === 'exp_advertising')
check('a description is guessed as this kind', S.accGuessKind('جذب همکار: شارژ') === 'partner')

// revenue and net
await db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product, price_product, Volume, Service_time) VALUES ('9601', 'q1', 'x1', ${String(nowT - 5 * 86400)}, 'active', 'پلن', '100000', '10', '30')`)
await db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product, price_product, Volume, Service_time) VALUES ('9601', 'q2', 'x2', ${String(nowT - 90 * 86400)}, 'active', 'پلن', '50000', '5', '30')`)
const E = await Eco.economics()
const r1 = E.rows.find((r) => r.id === '9601'), r2 = E.rows.find((r) => r.id === '9602')
check('economics: revenue all-time vs 30 days, goods cost, gifts, net', r1.revenue === 150000 && r1.revenue30 === 100000 && r1.cogs === 30000 && r1.gifts === 440000 && r1.net === 150000 - 30000 - 440000, JSON.stringify(r1))
check('a partner with no gifts and no sales is listed at zero', r2 && r2.net === 0 && r2.revenue === 0)
check('totals add up', E.totals.gifts === 440000 && E.totals.revenue === 150000 && E.totals.partners >= 2 && E.totals.withSales === 1, JSON.stringify(E.totals))

// welcome package: off by default, once per partner when on
await user('9603', 'f'); await db.run(sql`INSERT OR REPLACE INTO Requestagent (id, username, time, Description, status, type) VALUES ('9603', 'p9603', '1', 'x', 'waiting', 'None')`)
const refer = async (id) => { await db.run(sql`INSERT OR IGNORE INTO referral_links (id, name, code, active, created_at) VALUES (9990, 'm', 'tstmk', 1, 1)`); await db.run(sql`INSERT OR IGNORE INTO referral_signups (link_id, user_id, created_at) VALUES (9990, ${String(id)}, 1)`) } // came through a marketer: the first tier at once
await refer('9603')
await P.requestDecide('9603', 'accept')
check('welcome package is OFF by default (nothing booked)', (await exp()).filter((x) => /9603/.test(x.description)).length === 0)
await kvSet('partner:welcome', JSON.stringify({ on: true, wallet: 200000, gb: 10, days: 3 }))
await user('9604', 'f'); await db.run(sql`INSERT OR REPLACE INTO Requestagent (id, username, time, Description, status, type) VALUES ('9604', 'p9604', '1', 'x', 'waiting', 'None')`)
calls.length = 0
await refer('9604')
await P.requestDecide('9604', 'accept')
const mine = (await exp()).filter((x) => /9604/.test(x.description))
check('ON: accepting a request books wallet + free service, credits the wallet, tells the partner', mine.length === 2 && Number((await db.get(sql`SELECT Balance FROM user WHERE id = '9604'`)).Balance) === 200000 && calls.some(([, p]) => /هدیهٔ خوشامد/.test(String(p.text))))
check('and only once per partner', (await Eco.welcomeGive('9604')) === null && (await exp()).filter((x) => /9604/.test(x.description)).length === 2)

// an invitation
await user('9610', 'f'); await db.run(sql`UPDATE user SET username = 'ShopOne' WHERE id = '9610'`)
await kvSet('partner:welcome', JSON.stringify({ on: false, wallet: 0, gb: 0, days: 0 }))
calls.length = 0
const inv1 = await P.partnerInvite('@shopone', { type: 'n', trialDays: 30 })
const iu = await db.get(sql`SELECT agent, pricediscount, expire FROM user WHERE id = '9610'`)
check('invite by @username: partner, first tier, a 30-day expiry, a respectful message', inv1.ok && iu.agent === 'n' && Number(iu.pricediscount) === 10 && Math.abs(Number(iu.expire) - (nowT + 30 * 86400)) < 60 && calls.some(([, p]) => /^درود/.test(String(p.text)) && /30 روز/.test(String(p.text))))
check('invite twice / unknown user / empty are refused with a reason', !(await P.partnerInvite('9610')).ok && !(await P.partnerInvite('999999999')).ok && !(await P.partnerInvite('')).ok)
await user('9611', 'f')
const inv2 = await P.partnerInvite('9611', { type: 'n2' })
check('invite by id as credit level, no expiry by default', inv2.ok && (await db.get(sql`SELECT agent, expire FROM user WHERE id = '9611'`)).agent === 'n2' && (await db.get(sql`SELECT expire FROM user WHERE id = '9611'`)).expire === null)
await kvSet('partner:welcome', JSON.stringify({ on: true, wallet: 150000, gb: 0, days: 0 }))
await user('9612', 'f')
check('invite also gives the welcome package when it is on', (await P.partnerInvite('9612')).gift?.length === 1 && Number((await db.get(sql`SELECT Balance FROM user WHERE id = '9612'`)).Balance) === 150000)
// the trial ends by itself: ordinary prices again
await P.partnerEnd('9610')
check('when the partnership ends the discount is gone', String((await db.get(sql`SELECT pricediscount FROM user WHERE id = '9610'`)).pricediscount) === '0')

// the panel
const call = (r, body = {}) => ep({ r, query: {}, body }, { initData: { user: { id: 99001 } } })
check('panel: invite', (await call('partner_invite', { who: '9613' })).status === 409 && (await user('9613', 'f'), (await call('partner_invite', { who: '9613', trialDays: 14 })).status === 200))
check('panel: economics', (await call('partner_econ')).body.rows.length >= 3)
check('panel: a gift needs confirmation', (await call('partner_gift', { id: '9602', kind: 'wallet', amount: 100000 })).status === 409)
check('panel: a confirmed gift is booked', (await call('partner_gift', { id: '9602', kind: 'wallet', amount: 100000, confirm: true })).status === 200 && Number((await db.get(sql`SELECT Balance FROM user WHERE id = '9602'`)).Balance) === 100000)
check('panel: a bad gift is refused with a reason', (await call('partner_gift', { id: '9602', kind: 'wallet', amount: -5, confirm: true })).status === 422)
check('panel: the welcome package is saved with limits', (await call('partner_welcome', { on: true, wallet: 9e9, gb: 5, days: 2 })).body.welcome.wallet === 2000000)
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
