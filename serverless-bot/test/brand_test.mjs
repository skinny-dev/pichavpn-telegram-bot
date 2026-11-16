// A partner's own name in the service names: «acme_a1b2». Off by default; tier/allow-list/credit-level eligibility; unique, never ours; the bot flow.
//   node --no-warnings --import ./register.mjs brand_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { systemContext } = await import('../tgcloud/lib/bot.js') // first: bot.js ↔ routes have a cycle that only loads in this order
const P = await import('../tgcloud/lib/partners.js')
const { generateUsername } = await import('../tgcloud/lib/service.js')
const { miscRoutes } = await import('../tgcloud/lib/routes/misc.js')
const ep = (await import('../tgcloud/endpoints/panel.js')).default
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const mk = (id, agent, pct, name = null) => db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, pricediscount, namecustom, Balance, number_username) VALUES (${id}, ${'b' + id}, ${agent}, ${String(pct)}, ${name}, '0', '5')`)
const T = (await systemContext()).T
const gen = (id, rnd = 'a1b2') => generateUsername(T, id, 'customTextRandom', 'x', rnd, '', 'pichavpn', 'none')

await mk('8401', 'n', 20, 'acmephone'); await mk('8402', 'n', 10, 'smallshop'); await mk('8403', 'n2', 0, 'creditco'); await mk('8404', 'f', 0, 'sneaky'); await mk('8405', 'n', 0, 'allowed1')
check('OFF by default: nobody gets a brand, the shop prefix is used', (await gen('8401')) === 'pichavpn_a1b2')
await kvSet('partner:brand_on', '1')
check('ON: a partner at the second tier (15%+) gets his name', (await gen('8401')) === 'acmephone_a1b2')
check('a partner below the tier does not', (await gen('8402')) === 'pichavpn_a1b2')
check('a credit partner (n2) does', (await gen('8403')) === 'creditco_a1b2')
check('an ordinary customer never does, even with a name stored', (await gen('8404')) === 'pichavpn_a1b2')
await P.partnerSet('8405', {}).catch(() => {}); await kvSet('partner:brand_ok', JSON.stringify(['8405']))
check('an administrator can allow one partner by hand', (await gen('8405')) === 'allowed1_a1b2')
await db.run(sql`UPDATE user SET namecustom = 'Bad Name!' WHERE id = '8401'`)
check('an invalid stored name falls back to the shop prefix', (await gen('8401')) === 'pichavpn_a1b2')
await db.run(sql`UPDATE user SET namecustom = 'acmephone' WHERE id = '8401'`)

// uniqueness of the generated name: a collision asks again
await db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product) VALUES ('8401', 'u1', 'acmephone_a1b2', '1', 'active', 'x')`)
const second = await gen('8401')
check('a name that already exists is not reused (a new random part)', second !== 'acmephone_a1b2' && second.startsWith('acmephone_'), second)
const sequential = await generateUsername(T, '8401', 'customTextSequential', 'x', 'zz', '', 'pichavpn', 'none')
check('the sequential method uses the brand too', sequential.startsWith('acmephone_'), sequential)

// the name rules
check('3–16 Latin letters/digits, starting with a letter', P.brandNameCheck('acme1').ok && !P.brandNameCheck('ab').ok && !P.brandNameCheck('1acme').ok && !P.brandNameCheck('acme shop').ok && !P.brandNameCheck('a_b_c').ok && !P.brandNameCheck('averyveryverylongname').ok)
check('uppercase is normalised', P.brandNameCheck('AcmePhone').name === 'acmephone')
check('our own names and generic words are refused', ['pichavpn', 'mypicha1', 'admin1', 'supportx', 'officialvpn', 'testshop', 'vpnking'].every((n) => !P.brandNameCheck(n).ok))
check('a name taken by another partner is refused', (await P.brandSet('8402', 'acmephone')).ok === false)
check('a name equal to the shop prefix of a panel is refused', await (async () => { await db.run(sql`UPDATE marzban_panel SET namecustom = 'ourshop'`); return (await P.brandSet('8402', 'ourshop')).ok === false })())
check('a free good name is saved (lower-case)', (await P.brandSet('8402', 'SmallShop2')).name === 'smallshop2' && (await db.get(sql`SELECT namecustom FROM user WHERE id = '8402'`)).namecustom === 'smallshop2')

// the bot flow
const c0 = async (datain, text, id) => { const c = { ...(await systemContext()), from_id: id, message_id: 5, datain, text, adminRow: null }; c.user = await db.get(sql`SELECT * FROM user WHERE id = ${id}`); return c }
const go = async (c) => { for (const r of miscRoutes) if (await r(c)) return true; return false }
calls.length = 0
await go(await c0('selectname', '', '8402')) // below the tier
check('a partner below the level is told how to reach it, not asked for a name', calls.some(([m, p]) => /sendmessage/i.test(m) && /سطح|گیگ/.test(String(p.text))) && (await db.get(sql`SELECT step FROM user WHERE id = '8402'`)).step !== 'selectusernamecustom')
await db.run(sql`UPDATE user SET pricediscount = '20' WHERE id = '8402'`)
calls.length = 0
await go(await c0('selectname', '', '8402'))
check('an eligible partner is asked for the name, with the example', calls.some(([m, p]) => /sendmessage/i.test(m) && /acmephone_a1b2/.test(String(p.text))))
const step2 = await c0('', 'acmephone', '8402'); step2.user = { ...step2.user, step: 'selectusernamecustom' }
calls.length = 0
await go(step2)
check('a taken name is refused with a reason and the step stays', calls.some(([, p]) => /قبلاً.*گرفته/.test(String(p.text))))
const step3 = await c0('', 'Shop8402', '8402'); step3.user = { ...step3.user, step: 'selectusernamecustom' }
calls.length = 0
await go(step3)
check('a good name is saved and confirmed with how services will look', (await db.get(sql`SELECT namecustom FROM user WHERE id = '8402'`)).namecustom === 'shop8402' && calls.some(([, p]) => /shop8402_/.test(String(p.text))))

// the panel
const call = (r, body = {}) => ep({ r, query: {}, body }, { initData: { user: { id: 99001 } } })
const st = await call('partner_state')
const row = st.body.partners.find((p) => p.id === '8401')
check('the panel shows each partner\'s brand and whether it is in use', row && row.brand === 'acmephone' && row.brandOk === true && st.body.brand.on === true, JSON.stringify(row))
check('the switch and the minimum tier can be changed from the panel', (await call('partner_brand_settings', { on: false })).body.on === false && (await call('partner_brand_settings', { on: true, minTier: 'silver' })).body.minTier === 'silver')
check('an unknown tier is refused', (await call('partner_brand_settings', { minTier: 'nope' })).status === 400)
await call('partner_brand', { id: '8402', action: 'allow' })
check('allow / disallow by hand', (await call('partner_brand_state')).body.allowed.includes('8402'))
check('clear removes the name', (await call('partner_brand', { id: '8402', action: 'clear' })).status === 200 && (await db.get(sql`SELECT namecustom FROM user WHERE id = '8402'`)).namecustom === null)
check('set by an administrator follows the same rules', (await call('partner_brand', { id: '8402', action: 'set', name: 'pichavpn' })).status === 409 && (await call('partner_brand', { id: '8402', action: 'set', name: 'goodname' })).status === 200)
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
