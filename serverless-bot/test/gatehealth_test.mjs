// Gateway health: a gateway found disconnected has no button; it returns by itself; no flapping; stale news never hides anything.
//   node --no-warnings --import ./register.mjs gatehealth_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const H = await import('../tgcloud/lib/gatehealth.js')
const { gatewayDownSet } = await import('../tgcloud/lib/gatepause.js')
const { stepPaymentKb } = await import('../tgcloud/lib/catalog.js')
const { systemContext } = await import('../tgcloud/lib/bot.js')
const { adminGatewayRoutes } = await import('../tgcloud/lib/admin/gateways.js')
const setPay = async (k, v) => { await db.run(sql`DELETE FROM PaySetting WHERE NamePay = ${k}`); await db.run(sql`INSERT INTO PaySetting (NamePay, ValuePay) VALUES (${k}, ${v})`) }
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
for (const [k, v] of Object.entries({ variza_status: 'onvariza', variza_api_token: 't', variza_webhook_secret: 's', paychi_status: 'onpaychi', paychi_api_key: 'k', paychi_base_url: 'https://paychi.example', tetraminator_status: 'offtetraminator', Cartstatus: 'oncard', Cartstatuspv: 'offcardpv' })) await setPay(k, v)
await kvSet('config:pay_relay_url', 'https://relay.example')
await db.run(sql`DELETE FROM card_number`)
await db.run(sql`INSERT INTO card_number (cardnumber, namecard) VALUES ('6037991111111111', 'ali')`)
const c = await systemContext(); c.from_id = '7001'; c.usersBefore = { cardpayment: 1 }
const buttons = async () => JSON.parse(await stepPaymentKb(c)).inline_keyboard.flat().map((b) => b.callback_data)
let up = { relay: true, paychi: true, variza: true }
const probes = { reach: async (url) => { const key = url.startsWith('https://relay.example') ? 'relay' : url.startsWith('https://paychi') ? 'paychi' : 'variza'; return up[key] ? { ok: true } : { ok: false, reason: key + ' down' } }, tetra: async () => ({ ok: true }) }
const sent = []; const notify = async (t) => { sent.push(t) }

check('no health data yet: every gateway button is shown (fail-open)', (await buttons()).includes('variza') && (await buttons()).includes('paychi'))
await H.gateHealthRun(notify, probes)
check('all healthy: buttons shown, nobody is told', (await buttons()).includes('variza') && (await buttons()).includes('paychi') && sent.length === 0)

up.relay = false
await H.gateHealthRun(notify, probes)
check('one failed check does not hide (no flapping)', (await buttons()).includes('variza') && sent.length === 0)
await H.gateHealthRun(notify, probes)
const b2 = await buttons()
check('two failed checks in a row hide the gateways that depend on the relay', !b2.includes('variza') && !b2.includes('paychi'), JSON.stringify(b2))
check('the administrators are told once per gateway, with the reason', sent.length === 2 && sent.every((x) => x.startsWith('🔴') && /relay/.test(x)), JSON.stringify(sent))
await H.gateHealthRun(notify, probes)
check('no repeated notification while it stays down', sent.length === 2)
check('card to card stays (it does not depend on the relay)', b2.includes('cart_to_offline'))

up.relay = true
await H.gateHealthRun(notify, probes)
const b3 = await buttons()
check('the first good check brings them back', b3.includes('variza') && b3.includes('paychi'))
check('and the administrators are told', sent.length === 4 && sent.slice(2).every((x) => x.startsWith('🟢')))

up.paychi = false; await H.gateHealthRun(notify, probes); await H.gateHealthRun(notify, probes)
const b4 = await buttons()
check('only the gateway that is down disappears', !b4.includes('paychi') && b4.includes('variza'))

// stale news never hides anything
const st = JSON.parse((await db.get(sql`SELECT value FROM kv WHERE key = 'gate:health'`)).value)
st.paychi.at -= 5000; await kvSet('gate:health', JSON.stringify(st))
check('a stale «down» (the checker stopped) counts as healthy', (await buttons()).includes('paychi') && !(await gatewayDownSet()).has('paychi'))

// a gateway that is switched off is not checked
await setPay('paychi_status', 'offpaychi'); up.paychi = true
const s2 = await H.gateHealthRun(notify, probes)
check('a gateway switched off has no health entry', !('paychi' in s2))

// the old menu on a customer's screen
up.relay = false; await H.gateHealthRun(notify, probes); await H.gateHealthRun(notify, probes)
const { payRoutes } = await import('../tgcloud/lib/routes/pay.js')
c.user = { ...(c.user || {}), id: '7001', step: 'get_step_payment', Processing_value: '100000', agent: 'f' }; c.datain = 'variza'; c.message_id = 5; c.text = ''
calls.length = 0
let handled = false; for (const r of payRoutes) { if (await r(c)) { handled = true; break } }
check('tapping a gateway that has gone down gives the menu of the others, no link', handled && calls.some(([m, p]) => /sendmessage/i.test(m) && /موقتاً|دسترس/.test(String(p.text))) && !calls.some(([m, p]) => /وصل نیست|linkpayments/.test(JSON.stringify(p))), JSON.stringify(calls.map((x) => x[0])))
check('and it does not start a pause of its own', (await db.all(sql`SELECT * FROM PaySetting WHERE NamePay = 'variza_pause_until'`)).length === 0)

// the card
await db.run(sql`DELETE FROM card_number`)
check('no card to pay to: no card-to-card button', !(await buttons()).includes('cart_to_offline'))
await db.run(sql`INSERT INTO card_number (cardnumber, namecard) VALUES ('6037991111111111', 'ali')`)
check('with a card the button is back', (await buttons()).includes('cart_to_offline'))

// the admin view
c.adminRow = { rule: 'administrator' }; c.text = '/gateways'; c.datain = ''; calls.length = 0
for (const r of adminGatewayRoutes) if (await r(c)) break
const view = calls.map(([, p]) => String(p.text ?? '')).join('\n')
check('the admin view shows the connection state and a check-now button', /وصل نیست|وصل است/.test(view) && JSON.stringify(calls).includes('gw_check'), view.slice(0, 150))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
