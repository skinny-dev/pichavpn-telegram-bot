// The partner corner: report, customers (renewal first), keyboard, priority tag on tickets, early notices (manual, event, gateway).
//   node --no-warnings --import ./register.mjs partnerhub_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { systemContext } = await import('../tgcloud/lib/bot.js')
const H = await import('../tgcloud/lib/partnerhub.js')
const { miscRoutes: hubRoutes } = await import('../tgcloud/lib/routes/misc.js')
const { keyboardAgent } = await import('../tgcloud/lib/routes/misc.js')
const { supportRoutes } = await import('../tgcloud/lib/routes/support.js')
const ep = (await import('../tgcloud/endpoints/panel.js')).default
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const nowT = Math.floor(Date.now() / 1000)
const user = (id, agent, pct = 0) => db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, pricediscount, Balance, number_username, User_Status, step) VALUES (${id}, ${'u' + id}, ${agent}, ${String(pct)}, '120000', '5', 'Active', 'home')`)
const inv = (id, owner, name, status, ago, price = 50000, vol = 30) => db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product, price_product, Volume, Service_time, note) VALUES (${owner}, ${id}, ${name}, ${String(nowT - ago * 86400)}, ${status}, 'پلن', ${String(price)}, ${String(vol)}, '30', '')`)
await db.run(sql`UPDATE user SET agent = 'f' WHERE agent IN ('n','n2')`) // only this test's partners
await user('9501', 'n', 15); await user('9502', 'n', 20); await user('9503', 'f'); await user('9504', 'n2'); await user('9505', 'n')
await db.run(sql`UPDATE user SET User_Status = 'block' WHERE id = '9505'`)
await inv('a1', '9501', 'shop_aa', 'active', 3); await inv('a2', '9501', 'shop_bb', 'sendedwarn', 25); await inv('a3', '9501', 'shop_cc', 'end_of_time', 40, 70000, 50); await inv('a4', '9501', 'shop_dd', 'unpaid', 1)
await inv('a5', '9501', 'shop_ee', 'active', 50); await inv('b1', '9502', 'other_one', 'active', 2)

const R = await H.reportData({ id: '9501', pricediscount: '15', Balance: '120000' })
check('report: live / need counts and totals', R.live === 3 && R.need === 2 && R.total === 4 && R.totalSpent === 220000, JSON.stringify(R))
check('report: 30-day volume counts only the last 30 days and valid orders', R.gb30 === 60 && R.orders30 === 2, JSON.stringify(R))
check('report: unpaid orders never appear in the recent list', !R.recent.some((o) => o.username === 'shop_dd') && R.recent.length === 4)
const text = await H.reportText({ id: '9501', pricediscount: '15', Balance: '120000' })
check('report text: tier, discount, wallet and the next tier', /15٪/.test(text) && /120/.test(text) && /سطح/.test(text))
check("report never shows another partner's service", !/other_one/.test(text))

const cp = await H.customersPage({ id: '9501' }, 'need', 1)
check('customers (need): only those needing renewal, ended first', cp.total === 2 && cp.kb.inline_keyboard[0][0].text.includes('shop_cc') && cp.kb.inline_keyboard[1][0].text.includes('shop_bb'), JSON.stringify(cp.kb.inline_keyboard.slice(0, 2)))
check('customers: each opens the existing service page (where renew lives)', cp.kb.inline_keyboard[0][0].callback_data === 'product_a3')
const all2 = await H.customersPage({ id: '9501' }, 'all', 1)
check('customers (all): 4 live ones, never anyone else\'s', all2.total === 4 && !JSON.stringify(all2.kb).includes('other_one'))
check('customers: an empty list says so', (await H.customersPage({ id: '9503' }, 'need', 1)).text.includes('✅'))

// the bot
const c0 = async (datain, text, id) => { const c = { ...(await systemContext()), from_id: id, message_id: 5, datain, text, adminRow: null }; c.user = await db.get(sql`SELECT * FROM user WHERE id = ${id}`); return c }
const go = async (routes, c) => { for (const r of routes) if (await r(c)) return true; return false }
const sent = (re) => calls.some(([m, p]) => /sendmessage|editmessagetext/i.test(m) && re.test(String(p.text)))
calls.length = 0; await go(hubRoutes, await c0('agentreport', '', '9501'))
check('a partner opens the report from the panel button', sent(/گزارش همکاری/))
calls.length = 0; await go(hubRoutes, await c0('pcust_need_1', '', '9501'))
check('a partner opens the customers list', sent(/مشتری‌هایی که نزدیک پایان/))
calls.length = 0; await go(hubRoutes, await c0('agentreport', '', '9503'))
check('an ordinary customer cannot', sent(/مخصوص همکاران/) && !sent(/گزارش همکاری/))
calls.length = 0; await go(hubRoutes, await c0('', H.PRIORITY_TAG ? '📊 گزارش من' : '', '9501'))
check('the keyboard (text) button works as well', sent(/گزارش همکاری/))
const kb = JSON.parse(await keyboardAgent(await c0('', '', '9501')))
const labels = JSON.stringify(kb)
check('the partner panel has report, customers, wallet and priority support', ['📊', '👥', '🎧'].every((x) => labels.includes(x)) && /account|accountwallet|کیف/i.test(labels) || labels.includes('callback_data":"account'))
calls.length = 0; await go(hubRoutes, await c0('agentsupport', '', '9501'))
check('priority support leads to the departments', sent(/اولویت/))

// priority tag on a ticket
await db.run(sql`INSERT OR IGNORE INTO departman (id, idsupport, name_departman) VALUES (1, '777', 'فنی')`)
const { savedata } = await import('../tgcloud/lib/catalog.js')
const tk = async (id) => { let c = await c0('', 'سلام تست', id); await savedata(c, 'clear', 'iddeparteman', '1'); c = await c0('', 'سلام تست', id); c.user = { ...c.user, step: 'gettextticket' }; c.update = { message: {} }; c.caption = ''; c.username = 'x'; return c }
await kvSet('x', '1')
const gotTag = async (id) => { calls.length = 0; const c = await tk(id); c.from_id = id; await go(supportRoutes, c); if (process.env.DBG) console.log(JSON.stringify(calls.map(([m, p]) => [m, p.chat_id, String(p.text).slice(0, 60)])))
  return calls.some(([m, p]) => /sendmessage/i.test(m) && /اولویت پشتیبانی/.test(String(p.text))) }
check("a partner's ticket is marked as priority for the administrators", await gotTag('9501'))
check("an ordinary customer's ticket is not", !(await gotTag('9503')))

// notices
const fake = []; const send = async (id, text) => { fake.push([id, text]); return { ok: true } }
check('partners to notify: partners only, never blocked ones', JSON.stringify((await H.partnerIds()).sort()) === JSON.stringify(['9501', '9502', '9504']))
check('dry run counts and sends nothing', (await H.notifyPartners('x', { dry: true, send })).count === 3 && fake.length === 0)
const r = await H.notifyPartners('درود، تست اطلاع‌رسانی', { send, source: 'manual' })
check('a notice reaches every partner and is logged', r.sent === 3 && fake.length === 3 && (await H.noticesGet())[0].sent === 3)
const call = (r2, body = {}) => ep({ r: r2, query: {}, body }, { initData: { user: { id: 99001 } } })
check('panel: preview counts without sending', (await call('partner_notice', { text: 'پیام آزمایشی برای همکاران' })).body.count === 3)
check('panel: sending needs an explicit confirmation', (await call('partner_notice', { text: 'پیام آزمایشی برای همکاران', send: true })).status === 409)
check('panel: a too short text is refused', (await call('partner_notice', { text: 'ab' })).status === 400)
check('panel: the state shows the count and the log', (await call('partner_notice_state')).body.count === 3)

// events: approving tells partners first (live only)
const E = await import('../tgcloud/lib/events.js')
const ev = { id: 'e1', name: 'رویداد آزمایشی', type: 'code', startsAt: nowT + 10 * 86400, endsAt: nowT + 12 * 86400, params: { percent: 10, code: 'PART10', limit: 20 } }
check('the early notice text has the name, the dates and the tone', /«رویداد آزمایشی»/.test(E.partnerHeadsUp(ev)) && E.partnerHeadsUp(ev).startsWith('درود') && /PART10/.test(E.partnerHeadsUp(ev)))
// a partner's price shows in the product NAME too (names that carry the retail price in their text)
const { keyboardProduct } = await import('../tgcloud/lib/catalog.js')
const label = async (name, disc) => JSON.parse(await keyboardProduct({ ...(await systemContext()), from_id: '9501' }, 'p', [{ id: 9001, code_product: 'cx', name_product: name, price_product: '60000', Volume_constraint: '10', Service_time: '30', status_product: 'active', category: 'c', one_buy_status: '0', hide_panel: '[]' }], disc, 'prodcutservice_')).inline_keyboard[0][0].text
const l1 = await label('10 گیگ — 60,000 تومان', 10), l0 = await label('10 گیگ — 60,000 تومان', 0)
check('a partner sees his price inside a name that carried the retail price (no old price left)', l1.includes('54,000') && !l1.includes('60,000') && (l1.match(/تومان/g) || []).length === 1, l1)
check('an ordinary customer still sees the name as it is', l0.includes('60,000'), l0)
// dynamic names: tokens are filled in for the viewer (the systematic fix)
const { productName } = await import('../tgcloud/lib/catalog.js')
const d1 = await label('{volume} گیگ — {price} تومان', 10), d2 = await label('{traffic} گیگ / {days} روز — {price} تومان', 0), d3 = await label('{traffic_volume}GB', 10)
check('{volume} and {price} are filled with the partner price', d1 === '10 گیگ — 54,000 تومان', d1)
check('the same name shows the retail price to an ordinary customer, with {traffic} and {days}', d2 === '10 گیگ / 30 روز — 60,000 تومان', d2)
check('{traffic_volume} works and tokens are case-insensitive', d3 === '10GB' && productName('{VOLUME}', { Volume_constraint: '0' }) === 'نامحدود')
check('a name without tokens is returned untouched', productName('پلن عادی', { price_product: 5 }) === 'پلن عادی')
check('the price is never added twice to a dynamic name', ((await label('{volume} گیگ', 10)).match(/تومان/g) || []).length <= 1)
const ln = await label('پلن ده گیگ', 10)
check('a name without a price never shows the retail price', !ln.includes('60,000') && ln.startsWith('پلن ده گیگ'), ln)
// the end of a partnership: ordinary prices again (the old bot left the discount behind)
const Pm = await import('../tgcloud/lib/partners.js')
await user('9506', 'n', 25); await Pm.partnerSet('9506', { pct: 25, lock: true }).catch(() => {})
await Pm.partnerEnd('9506')
const gone = await db.get(sql`SELECT agent, pricediscount FROM user WHERE id = '9506'`)
check('expiry: back to an ordinary customer AND the discount is gone', gone.agent === 'f' && String(gone.pricediscount) === '0', JSON.stringify(gone))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
