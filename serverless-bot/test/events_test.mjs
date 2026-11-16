// Events: guardrails, simulation (changes nothing), live start/end for every type, posts that pass the Studio rules.
//   node --no-warnings --import ./register.mjs events_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const E = await import('../tgcloud/lib/events.js')
const S = await import('../tgcloud/lib/studio.js')
const { handle } = await import('../tgcloud/lib/panelapi/index.js')
await import('../tgcloud/lib/panelapi/modules.js')
const ADMIN = (await db.get(sql`SELECT id_admin FROM admin WHERE rule = 'administrator' LIMIT 1`)).id_admin
const call = (r, body = {}) => handle(r, {}, body, ADMIN)
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const prices = async () => JSON.stringify((await db.all(sql`SELECT id, price_product, Volume_constraint FROM product ORDER BY id`)))
const DAY = 86400, T = Math.floor(Date.now() / 1000)
const ev = (o) => ({ name: 'آزمایش', type: 'price_discount', startsAt: T + 2 * DAY, endsAt: T + 3 * DAY, params: { percent: 15 }, ...o })
const prods = await E.productsGet()
check('there are customer plans to work on', prods.filter((p) => p.price > 0 && p.gb > 0).length >= 2, String(prods.length))

// 1) guardrails
const prev = async (e, approve = true) => (await call('event_preview', { event: e, approve })).body
check('a discount above the cap is refused', (await prev(ev({ params: { percent: 25 } }))).errors.some((x) => /بین ۱ و 20/.test(x)))
const ok15 = await prev(ev())
check('15% is accepted with the impact table', ok15.errors.length === 0 && ok15.impact.length > 0 && ok15.impact.every((x) => x.now < x.old), JSON.stringify(ok15.errors))
check('an end before the start is refused', (await prev(ev({ endsAt: T + DAY }))).errors.length > 0)
check('a start in the past is refused on approval', (await prev(ev({ startsAt: T - 100, endsAt: T + DAY }))).errors.some((x) => /آینده/.test(x)))
check('a price increase needs 7 days of notice', (await prev(ev({ type: 'price_increase', params: { percent: 10 }, endsAt: 0 }))).errors.some((x) => /قبل اعلام/.test(x)))
check('a code needs a valid unique name and a limit', (await prev(ev({ type: 'code', params: { code: 'a b', percent: 20, limit: 0 } }))).errors.length >= 2)
await kvSet('events:cost_gb', '4400')
check('a margin under 10% is refused', (await prev(ev({ params: { percent: 20 } }))).errors.some((x) => /کمتر از ۱۰٪/.test(x)))
await kvSet('events:cost_gb', '1877')

// 2) save + approve, the gap rule, one promo at a time
const bf = (await call('event_save', { event: ev({ name: 'بلک‌فرایدی', group: 'bf', startsAt: T + 2 * DAY, endsAt: T + 3 * DAY, params: { percent: 20 } }), approve: true })).body.event
check('an event is saved and approved', bf.status === 'approved')
check('another offer within 30 days is refused', (await prev(ev({ name: 'دوم', startsAt: T + 10 * DAY, endsAt: T + 11 * DAY, type: 'bonus_gb', params: { gb: 5 } }))).errors.some((x) => /فاصلهٔ 30 روز/.test(x)))
check('the same group (early access + public) is allowed', (await prev(ev({ name: 'زودهنگام', group: 'bf', type: 'code', startsAt: T + 1 * DAY, endsAt: T + 2 * DAY, params: { code: 'BFEARLY', percent: 20, limit: 50, first: false } }))).errors.length === 0)
check('a price promotion at the same time is refused', (await prev(ev({ group: 'x', startsAt: T + 2 * DAY, endsAt: T + 3 * DAY }))).errors.length > 0)

// 3) SIMULATION changes nothing
const before = await prices()
const list = await E.eventsGet(); list[0].startsAt = T - 5; await E.eventsSet(list)
const t1 = await E.eventsTick()
check('simulation: the event is marked simulated', t1.status === 'simulated', JSON.stringify(t1))
check('simulation: no price changed', (await prices()) === before)
check('simulation: no promotion started', !(await E.promoState()))
check('simulation: the log says what would happen', (await E.eventsGet())[0].log.some((l) => /شبیه‌سازی/.test(l.msg)))
const l2 = await E.eventsGet(); l2[0].endsAt = T - 1; await E.eventsSet(l2)
check('simulation ends by itself', (await E.eventsTick()).status === 'ended')

// 4) LIVE: the discount starts and ends by itself and the prices come back
await call('event_mode', { mode: 'live' }); check('live needs a confirmation', (await call('event_mode', { mode: 'live' })).status === 409)
await call('event_mode', { mode: 'live', confirm: true })
const d = (await call('event_save', { event: ev({ name: 'تخفیف زنده', startsAt: T + 2 * DAY, endsAt: T + 3 * DAY, params: { percent: 15 } }), approve: true })).body.event
let l3 = await E.eventsGet(); l3.find((x) => x.id === d.id).startsAt = T - 5; l3.find((x) => x.id === d.id).endsAt = T + 3600; await E.eventsSet(l3)
const t3 = await E.eventsTick()
const during = await prices()
check('live: the event starts', t3.status === 'running', JSON.stringify(t3))
check('live: prices fell', during !== before)
check('live: the promotion is active in the bot', !!(await E.promoState()))
check('live: an administrator can stop it now', (await call('event_status', { id: d.id, status: 'stop' })).status === 200 && (await prices()) === before && !(await E.promoState()))

// 5) the other types, live
const code = (await call('event_save', { event: ev({ name: 'کد', type: 'code', group: 'c', startsAt: T + 40 * DAY, endsAt: T + 41 * DAY, params: { code: 'TEST20', percent: 20, limit: 50, first: true } }), approve: true })).body.event
let l4 = await E.eventsGet(); const c = l4.find((x) => x.id === code.id); c.startsAt = T - 5; c.endsAt = T + 3600; await E.eventsSet(l4)
await E.eventsTick()
const row = await db.get(sql`SELECT * FROM DiscountSell WHERE codeDiscount = 'TEST20'`)
check('code: the row exists with the percent, the limit and first-purchase only', row && row.price === '20' && row.limitDiscount === '50' && row.usefirst === '1' && row.useuser === '1' && row.code_product === 'all')
check('code: it carries the real deadline', Number(row.time) === c.endsAt)
l4 = await E.eventsGet(); l4.find((x) => x.id === code.id).endsAt = T - 1; await E.eventsSet(l4); await E.eventsTick()
check('code: it expires by itself', Number((await db.get(sql`SELECT time FROM DiscountSell WHERE codeDiscount = 'TEST20'`)).time) < Math.floor(Date.now() / 1000))

const panels0 = JSON.stringify(await db.all(sql`SELECT name_panel, time_usertest, val_usertest FROM marzban_panel ORDER BY name_panel`))
const te = (await call('event_save', { event: ev({ name: 'تست بلندتر', type: 'test_extension', startsAt: T + 80 * DAY, endsAt: T + 83 * DAY, group: 't', params: { hours: 72, mb: 1500 } }), approve: true })).body.event
let l5 = await E.eventsGet(); const t5 = l5.find((x) => x.id === te.id); t5.startsAt = T - 5; t5.endsAt = T + 3600; await E.eventsSet(l5)
await E.eventsTick()
const ext = await db.all(sql`SELECT time_usertest, val_usertest FROM marzban_panel WHERE TestAccount = 'ONTestAccount'`)
check('test extension: the test panels now give 72 h and 1500 MB', ext.length > 0 && ext.every((x) => x.time_usertest === '72' && x.val_usertest === '1500'), JSON.stringify(ext))
l5 = await E.eventsGet(); l5.find((x) => x.id === te.id).endsAt = T - 1; await E.eventsSet(l5); await E.eventsTick()
check('test extension: restored to the old values', JSON.stringify(await db.all(sql`SELECT name_panel, time_usertest, val_usertest FROM marzban_panel ORDER BY name_panel`)) === panels0)

const pi = (await call('event_save', { event: ev({ name: 'افزایش', type: 'price_increase', group: 'p', startsAt: T + 8 * DAY, endsAt: 0, params: { percent: 10 } }), approve: true })).body.event
const pBefore = await prices()
let l6 = await E.eventsGet(); l6.find((x) => x.id === pi.id).startsAt = T - 5; await E.eventsSet(l6); await E.eventsTick()
check('price increase: prices went up (and stay)', (await prices()) !== pBefore && JSON.parse(await prices()).every((r, i) => Number(r.price_product) >= Number(JSON.parse(pBefore)[i].price_product)))
await E.eventsTick()
check('price increase: it is not reverted afterwards', (await E.eventsGet()).find((x) => x.id === pi.id).status === 'ended' && (await prices()) !== pBefore)
const fr = await call('event_save', { event: ev({ name: 'ثبات', type: 'price_freeze', group: 'f', startsAt: T + 100 * DAY, endsAt: T + 160 * DAY, params: {} }), approve: true })
check('a price freeze is accepted', fr.status === 200)
check('a price increase inside a freeze is refused', (await prev(ev({ type: 'price_increase', group: 'p2', startsAt: T + 120 * DAY, endsAt: 0, params: { percent: 5 } }))).errors.some((x) => /ثبات قیمت/.test(x)))

// 6) the posts pass the Studio rules
const full = (await call('event_save', { event: ev({ name: 'بلک‌فرایدی کامل', group: 'full', startsAt: T + 200 * DAY, endsAt: T + 201 * DAY, params: { percent: 20 } }) })).body.event
const posts = (await call('event_posts', { id: full.id })).body.created
check('four posts are made for an offer (teaser, start, last hours, thanks)', posts.length === 4, JSON.stringify(posts))
const all = await S.postsGet()
const mine = all.filter((p) => p.id.startsWith('ev-' + full.id))
check('every post passes the tone, CTA and offer rules', mine.every((p) => S.lint(p).errors.length === 0), JSON.stringify(mine.map((p) => S.lint(p).errors)))
check('the start post carries the real percent and the real deadline', /۲۰|20/.test(mine.find((p) => p.id.endsWith('start')).text) && /14\d\d\/\d\d\/\d\d \d\d:\d\d|۱۴/.test(mine.find((p) => p.id.endsWith('start')).text))
check('the posts are drafts', mine.every((p) => p.status === 'draft'))
check('a price-increase notice is made 7 days before', (await call('event_posts', { id: pi.id })).body.created.length === 2)
const noFake = mine.every((p) => !/آخرین فرصت|فقط تا امشب|فقط N/.test(p.text))
check('no fake urgency', noFake)

// 7) through the real panel entry
const ep = (await import('../tgcloud/endpoints/panel.js')).default
const st = await ep({ r: 'event_state', query: {}, body: {} }, { initData: { user: { id: Number(ADMIN) } } })
check('the panel entry serves event_state', st.status === 200 && st.body.events.length >= 5 && st.body.mode === 'live', String(st.status))
check('a stranger cannot use events', (await handle('event_state', {}, {}, '1')).status === 401)
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
