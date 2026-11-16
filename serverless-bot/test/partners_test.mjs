// Partners: the volume, the tier, automatic upgrade/downgrade with its two-month rule, locks, notices, simulation, the panel routes.
//   node --no-warnings --import ./register.mjs partners_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const P = await import('../tgcloud/lib/partners.js')
const ep = (await import('../tgcloud/endpoints/panel.js')).default
const T = Math.floor(Date.now() / 1000), DAY = 86400
const tehran = (t) => new Date((t + 12600) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/')
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const mk = async (id, o = {}) => db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, pricediscount, Balance, expire, register) VALUES (${id}, ${'p' + id}, ${o.agent ?? 'n'}, ${String(o.pct ?? 0)}, '0', ${String(o.expire ?? 0)}, ${String(T - 90 * DAY)})`)
const inv = async (user, gb, o = {}) => db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Volume, price_product, Status, name_product, Service_location) VALUES (${user}, ${'i' + Math.random().toString(36).slice(2, 9)}, ${'u' + Math.random().toString(36).slice(2, 6)}, ${String(o.at ?? T - 3 * DAY)}, ${String(gb)}, ${String(o.price ?? 100000)}, ${o.status ?? 'active'}, ${o.name ?? 'پلن'}, 'p')`)
const ren = async (user, gb, at = T - 2 * DAY) => db.run(sql`INSERT INTO service_other (id_user, username, value, time, price, type, status) VALUES (${user}, 'x', ${JSON.stringify({ volumebuy: String(gb) })}, ${tehran(at)}, '50000', 'extend_user', 'paid')`)
const pctOf = async (id) => Number((await db.get(sql`SELECT pricediscount FROM user WHERE id = ${id}`)).pricediscount)

// 1) the volume
await mk('9101'); await inv('9101', 60); await inv('9101', 30, { name: 'تست رایگان' }); await inv('9101', 40, { status: 'unpaid' }); await inv('9101', 25, { at: T - 45 * DAY }); await ren('9101', 50)
const v = await P.volume30('9101')
check('the volume counts new services and renewals, not tests, unpaid or older than 30 days', v.gb === 110 && v.orders === 2, JSON.stringify(v))

// 2) the list
const list = await P.partnersList()
const p1 = list.find((x) => x.id === '9101')
check('the list shows the earned tier and the way to the next', p1.earned === 'bronze' && p1.toNext === 390 && p1.nextName === 'نقره', JSON.stringify(p1))

// 3) decisions
const tiers = await P.tiersGet()
check('upgrade is decided when the volume reaches a step', P.decide({ level: 'n', pct: 10, gb30: 110, locked: false, below: 0 }, tiers).action === 'up')
check('the same tier: nothing', P.decide({ level: 'n', pct: 15, gb30: 110, locked: false, below: 0 }, tiers).action === 'none')
check('below the threshold the first time: only a warning', P.decide({ level: 'n', pct: 20, gb30: 110, locked: false, below: 0 }, tiers).action === 'warn')
check('after two months below: downgrade', P.decide({ level: 'n', pct: 20, gb30: 110, locked: false, below: 1 }, tiers).action === 'down')
check('credit partners, locked and expired are never touched', ['n2'].every((l) => P.decide({ level: l, pct: 0, gb30: 9000, locked: false, below: 0 }, tiers).action === 'none') && P.decide({ level: 'n', pct: 0, gb30: 9000, locked: true, below: 0 }, tiers).action === 'none' && P.decide({ level: 'n', pct: 0, gb30: 9000, locked: false, expired: true, below: 0 }, tiers).action === 'none')

// 4) SIMULATION changes and says nothing
await mk('9102', { pct: 10 }); await inv('9102', 700)
calls.length = 0
const sim = await P.partnersRun({})
check('simulation: the plan is reported', sim.live === false && sim.changes.some((c) => c.id === '9102' && c.action === 'up' && c.to === 20), JSON.stringify(sim.changes))
check('simulation: no price changed and nobody was messaged', (await pctOf('9102')) === 10 && !calls.some(([m]) => /sendmessage/i.test(m)))

// 5) LIVE: upgrade at once, with a respectful notice
await kvSet('partners:mode', 'live')
calls.length = 0
const live = await P.partnersRun({})
check('live: the partner is upgraded', (await pctOf('9102')) === 20 && (await pctOf('9101')) === 15, `${await pctOf('9102')}/${await pctOf('9101')}`)
const msgs = calls.filter(([m]) => /sendmessage/i.test(m)).map(([, p]) => ({ to: String(p.chat_id), text: String(p.text) }))
check('the notice goes to that partner, starts with «درود», names the tier', msgs.some((m) => m.to === '9102' && m.text.startsWith('درود') && m.text.includes('نقره') && !m.text.includes('سلام')), JSON.stringify(msgs.map((m) => m.to)))
check('the change is in the log', (await P.logGet()).some((e) => e.id === '9102' && e.action === 'up'))
check('a second run changes nothing more', (await P.partnersRun({})).changes.length === 0)

// 6) the two-month rule
await mk('9103', { pct: 25 }); await inv('9103', 120) // earns bronze (15) but holds gold (25)
calls.length = 0
const m1 = await P.partnersRun({ at: T })
check('month 1 below: a warning, the price stays', (await pctOf('9103')) === 25 && m1.changes.some((c) => c.id === '9103' && c.action === 'warn'))
check('the warning is a message with the way to keep the tier', calls.some(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === '9103' && /درود/.test(String(p.text))))
const again = await P.partnersRun({ at: T + 2 * DAY })
check('the same month does not count twice', (await pctOf('9103')) === 25 && JSON.parse((await db.get(sql`SELECT value FROM kv WHERE key = 'partner:below'`)).value)['9103'] === 1, JSON.stringify(again.changes))
await inv('9103', 120, { at: T + 33 * DAY - 3 * DAY })
const m2 = await P.partnersRun({ at: T + 33 * DAY })
check('month 2 below: the price comes down one step to the earned tier', (await pctOf('9103')) === 15 && m2.changes.some((c) => c.id === '9103' && c.action === 'down'), `${await pctOf('9103')} ${JSON.stringify(m2.changes)}`)
// recovery resets the counter
await mk('9104', { pct: 20 }); await inv('9104', 120)
await P.partnersRun({ at: T + 70 * DAY }) // below once
await inv('9104', 600, { at: T + 98 * DAY })
await P.partnersRun({ at: T + 100 * DAY })
check('back above the threshold: the counter resets and the price stays', (await pctOf('9104')) === 20 && !JSON.parse((await db.get(sql`SELECT value FROM kv WHERE key = 'partner:below'`)).value)['9104'])

// 7) manual price + lock + the other protections
await mk('9105', { pct: 10 }); await inv('9105', 900)
await P.partnerSet('9105', { pct: 12 })
await P.partnersRun({})
check('the automation does not override a locked partner', (await pctOf('9105')) === 12)
await P.partnerSet('9105', { lock: false }); await P.partnersRun({})
check('unlocked: the automation takes over again', (await pctOf('9105')) === 20)
let err = ''; try { await P.partnerSet('9105', { pct: 55 }) } catch (e) { err = e.message }
check('a price deeper than the cap is refused', /بین ۰ و 40|۴۰/.test(err) || err.length > 0, err)
err = ''; try { await P.partnerSet('1', { pct: 5 }) } catch (e) { err = e.message }
check('a user who is not a partner is refused', err.includes('همکار'))
await mk('9106', { agent: 'n2', pct: 0 }); await inv('9106', 9000); await P.partnersRun({})
check('a credit partner is never changed', (await pctOf('9106')) === 0)
await mk('9107', { pct: 0, expire: T - DAY }); await inv('9107', 9000); await P.partnersRun({})
check('a partner whose agent expiry has passed is not changed', (await pctOf('9107')) === 0)

// 8) tiers editor
check('tiers must grow and start from 0 GB', P.tiersValidate([{ name: 'a', gb: 5, pct: 10 }, { name: 'b', gb: 10, pct: 12 }]) !== '' && P.tiersValidate([{ name: 'a', gb: 0, pct: 10 }, { name: 'b', gb: 0, pct: 12 }]) !== '' && P.tiersValidate([{ name: 'a', gb: 0, pct: 10 }, { name: 'b', gb: 10, pct: 50 }]) !== '')
check('good tiers are accepted', P.tiersValidate([{ name: 'a', gb: 0, pct: 10 }, { name: 'b', gb: 10, pct: 20 }]) === '')

// 9) the panel entry
const call = (r, body = {}) => ep({ r, query: {}, body }, { initData: { user: { id: 99001 } } })
const st = await call('partner_state')
check('the panel serves partner_state with partners, tiers and the mode', st.status === 200 && st.body.partners.length >= 6 && st.body.tiers.length === 5 && st.body.mode === 'live', String(st.status))
check('the live run needs live mode', (await (async () => { await kvSet('partners:mode', 'sim'); return call('partner_run', { dry: false }) })()).status === 409)
check('the preview always works', (await call('partner_run', { dry: true })).status === 200)
check('live mode needs a confirmation', (await call('partner_mode', { mode: 'live' })).status === 409 && (await call('partner_mode', { mode: 'live', confirm: true })).status === 200)
check('tiers can be saved through the panel and a bad one is refused', (await call('partner_tiers', { tiers: [{ name: 'a', gb: 0, pct: 10 }, { name: 'b', gb: 50, pct: 18 }] })).status === 200 && (await call('partner_tiers', { tiers: [{ name: 'a', gb: 3, pct: 10 }, { name: 'b', gb: 50, pct: 18 }] })).status === 422)
check('a stranger cannot use partner routes', (await ep({ r: 'partner_state', query: {}, body: {} }, { initData: { user: { id: 1 } } })).status === 401)

// 10) partner requests from the panel: the list, accept (with the first tier), reject (refund once)
await db.run(sql`UPDATE setting SET agentreqprice = '50000'`)
const mkR = async (id, bal = '0', pct = '0') => { await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, pricediscount, expire) VALUES (${id}, ${'q' + id}, 'f', ${bal}, ${pct}, NULL)`); await db.run(sql`INSERT OR REPLACE INTO Requestagent (id, username, time, Description, status, type) VALUES (${id}, ${'q' + id}, ${String(T)}, 'موبایل‌فروشی در تهران', 'waiting', 'None')`) }
await mkR('8201'); await mkR('8202'); await mkR('8203', '0', '15'); await mkR('8204')
const rq = await call('partner_requests')
check('the panel lists the waiting requests with the first-tier percent', rq.status === 200 && rq.body.requests.filter((r) => ['8201', '8202', '8203', '8204'].includes(r.id)).length === 4 && rq.body.welcome_pct === 10, JSON.stringify(rq.body).slice(0, 120))
calls.length = 0
const ac = await call('partner_request', { id: '8201', decision: 'accept' })
const u1 = await db.get(sql`SELECT agent, pricediscount FROM user WHERE id = '8201'`)
check('accept: the user is a partner and gets the first tier (10%)', ac.status === 200 && u1.agent === 'n' && Number(u1.pricediscount) === 10, JSON.stringify(u1))
check('the partner is told, respectfully (starts with «درود»)', calls.some(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === '8201' && String(p.text).startsWith('درود') && /تأیید شد/.test(String(p.text))))
calls.length = 0
const ac2 = await call('partner_request', { id: '8201', decision: 'accept' })
check('a second accept changes nothing and sends nothing', ac2.body.already === true && !calls.some(([m]) => /sendmessage/i.test(m)))
await call('partner_request', { id: '8203', decision: 'accept' })
check('a partner who already has a hand-set discount keeps it', Number((await db.get(sql`SELECT pricediscount FROM user WHERE id = '8203'`)).pricediscount) === 15)
await call('partner_request', { id: '8204', decision: 'accept', type: 'n2' })
check('the credit level can be chosen at accept', (await db.get(sql`SELECT agent FROM user WHERE id = '8204'`)).agent === 'n2')
const rj = await call('partner_request', { id: '8202', decision: 'reject' })
check('reject refunds the request fee once', rj.body.refunded === 50000 && Number((await db.get(sql`SELECT Balance FROM user WHERE id = '8202'`)).Balance) === 50000)
await call('partner_request', { id: '8202', decision: 'reject' })
check('a second reject refunds nothing more', Number((await db.get(sql`SELECT Balance FROM user WHERE id = '8202'`)).Balance) === 50000)
check('a bad decision is refused', (await call('partner_request', { id: '8202', decision: 'maybe' })).status === 400)
check('an unknown request is a 404', (await call('partner_request', { id: '1', decision: 'accept' })).status === 404)
check('decided requests leave the waiting list', !(await call('partner_requests')).body.requests.some((r) => ['8201', '8202', '8203', '8204'].includes(r.id)))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
