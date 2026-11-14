// Tetraminator gateway end to end: a mock of api.tetraminator.com (node http) + the real PHP payment relay + the bot.
//   node --no-warnings --import ./register.mjs tetraminator_test.mjs <export dir>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }

// ---- the mock gateway
const st = { n: 0, fail: 0, failCode: 500, html: false, gateway: false, drop: [], pays: {}, log: [] }
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/__set') { const id = u.searchParams.get('pay_id'); st.pays[id] = { ...(st.pays[id] || { amount: 0 }), status: u.searchParams.get('status') ?? st.pays[id]?.status, ...(u.searchParams.get('amount') ? { amount: Number(u.searchParams.get('amount')) } : {}) }; return send(200, {}) }
    if (req.headers['x-api-key'] !== 'testkey') return send(401, { status: false })
    if (req.method === 'POST' && u.pathname === '/v1/invoice/create') {
      const inb = JSON.parse(body || '{}')
      st.log.push(inb)
      if (st.fail > 0) { st.fail--; if (st.html) { res.writeHead(st.failCode, { 'Content-Type': 'text/html' }); return res.end('<html>Connection timed out</html>') } return send(st.failCode, { status: false }) }
      if (st.hang) return // never answers
      const id = 'pay' + ++st.n + 'abc'
      st.pays[id] = { status: 'pending', amount: Number(inb.price) }
      const out = { status: true, pay_id: id, url: `https://tetraminator.com/invoice/${id}`, payment_link: `https://t.me/tetraminator_bot?start=pay_${id}`, mini_app_link: `https://t.me/tetraminator_bot/pay?startapp=${id}` }
      if (st.gateway) out.gateway_link = `https://tetraminator.com/gateway/${id}`
      return send(201, out)
    }
    const m = /^\/v1\/payment\/inquiry\/(\w+)$/.exec(u.pathname)
    if (m) { const p = st.pays[m[1]]; if (!p) return send(404, { status: false }); if (st.inqFail) return send(500, {}); return send(200, { status: true, payment_status: p.status, pay_id: m[1], amount: p.amount }) }
    send(404, {})
  })
}).listen(8141)
const ctl = (q) => fetch('http://127.0.0.1:8141/__set?' + q)

// ---- the real PHP relay
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tetra-'))
const KEY = 'k'.repeat(32)
fs.writeFileSync(path.join(dir, 'conf.php'), `<?php\nconst RELAY_KEY = '${KEY}';\nconst RELAY_DIR = '${dir}';\n`)
const php = spawn('php', ['-S', '127.0.0.1:8142', path.resolve('../../pasarguard/pay_relay/index.php')], { env: { ...process.env, PICHA_RELAY_CONF: path.join(dir, 'conf.php') }, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 600))

try {
  await seed(process.argv[2])
  const setPay = async (k, v) => { await db.run(sql`DELETE FROM PaySetting WHERE NamePay = ${k}`); await db.run(sql`INSERT INTO PaySetting (NamePay, ValuePay) VALUES (${k}, ${v})`) }
  for (const [k, v] of [['tetraminator_status', 'ontetraminator'], ['tetraminator_api_key', 'testkey'], ['tetraminator_base_url', 'http://127.0.0.1:8141/v1'], ['minbalancetetraminator', '50000'], ['maxbalancetetraminator', '10000000'], ['chashbacktetraminator', '0'], ['tetraminator_link_mode', 'gateway'], ['tetraminator_timeout_ms', '700']]) await setPay(k, v)
  await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('config:pay_relay_url', 'http://127.0.0.1:8142', 0), ('config:pay_relay_key', ${KEY}, 0)`)
  const tehran = (t) => { const d = new Date((t + 12600) * 1000); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` }
  const now = Math.floor(Date.now() / 1000)
  const order = (id, user, price, payId, status = 'Unpaid', method = 'tetraminator', ageSec = 30) => db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice, dec_not_confirmed) VALUES (${user}, ${id}, ${tehran(now - ageSec)}, ${price}, ${status}, ${method}, '0|0', ${payId})`)
  const status = async (id) => (await db.get(sql`SELECT payment_Status FROM Payment_report WHERE id_order = ${id}`)).payment_Status
  const bal = async (id) => Number((await db.get(sql`SELECT Balance FROM user WHERE id = ${id}`)).Balance)
  const { createPayTetraminator, tetraInquiry, tetraSettle, tetraPickLink } = await import('../tgcloud/lib/tetraminator.js')
  const { gatewayPaused, gatewayPause, varizaLimitReached, gatewayOutageSeconds } = await import('../tgcloud/lib/gatepause.js')
  const { stepPaymentKb } = await import('../tgcloud/lib/catalog.js')
  const c0 = { domain: 'bot.example.com' }

  // ---- invoice creation
  let r = await createPayTetraminator(c0, 144000, 'ordaa11111')
  check('create: pay_id + the shop default url (no website gateway active)', r.pay_id === 'pay1abc' && r.pay_url === 'https://tetraminator.com/invoice/pay1abc', JSON.stringify(r))
  check('create: callback goes through the payment relay with our order id', st.log[0].callback_url === 'http://127.0.0.1:8142/tetraminator?order_id=ordaa11111' && st.log[0].price === 144000, JSON.stringify(st.log[0]))
  st.gateway = true
  check('create: the Shaparak gateway_link first when it is active', (await createPayTetraminator(c0, 60000, 'ordbb11111')).pay_url.includes('/gateway/'))
  st.gateway = false
  await setPay('tetraminator_link_mode', 'bot')
  check('link mode bot', (await createPayTetraminator(c0, 60000, 'ordcc11111')).pay_url.includes('t.me/tetraminator_bot?start=pay_'))
  await setPay('tetraminator_link_mode', 'gateway')
  check('pick: plain http links are never used', tetraPickLink({ url: 'http://x', payment_link: 'https://t.me/x' }) === 'https://t.me/x' && tetraPickLink({ url: 'http://x' }) === '')
  st.fail = 1; st.failCode = 500
  let before = st.log.length
  r = await createPayTetraminator(c0, 60000, 'orddd11111')
  check('create: one 500 is retried, the second try succeeds', !!r.pay_url && st.log.length === before + 2)
  st.fail = 5; st.failCode = 522; st.html = true; before = st.log.length
  r = await createPayTetraminator(c0, 60000, 'ordee11111')
  check('create: Cloudflare 522 (HTML) = error with http_code 522 after 2 tries', !r.pay_url && r.http_code === 522 && r.error === 'invalid json' && st.log.length === before + 2, JSON.stringify(r))
  st.fail = 0; st.html = false; st.hang = true; before = st.log.length
  const t0 = Date.now()
  r = await createPayTetraminator(c0, 60000, 'ordff11111')
  check('create: a gateway that never answers is given up on quickly (timeout), not waited for', !r.pay_url && r.http_code === 0 && Date.now() - t0 < 4000 && st.log.length === before + 2, `${Date.now() - t0} ms ${JSON.stringify(r)}`)
  st.hang = false
  st.fail = 1; st.failCode = 400; before = st.log.length
  r = await createPayTetraminator(c0, 1000, 'ordgg11111')
  check('create: 400 is final, no retry', r.http_code === 400 && st.log.length === before + 1)
  await setPay('tetraminator_api_key', 'wrong'); r = await createPayTetraminator(c0, 60000, 'ordhh11111')
  check('create: wrong key -> 401', r.http_code === 401)
  await setPay('tetraminator_api_key', '0'); r = await createPayTetraminator(c0, 60000, 'ordii11111')
  check('create: no key set -> clear error', r.error === 'tetraminator_api_key not set')
  await setPay('tetraminator_api_key', 'testkey')

  // ---- inquiry + settle
  await ctl('pay_id=pay1abc&status=pending&amount=144000')
  check('inquiry: pending is not paid', !(await tetraInquiry('pay1abc')).paid)
  await ctl('pay_id=pay1abc&status=paid&amount=144000')
  const iq = await tetraInquiry('pay1abc'); check('inquiry: paid + amount', iq.ok && iq.paid && iq.amount === 144000)
  check('inquiry: unknown pay_id is not "paid"', !(await tetraInquiry('nope123')).paid)
  let delivered = []
  const deliver = async (id) => { delivered.push(id) }
  await ctl('pay_id=paySA&status=pending&amount=60000'); await order('sA', '7001', '60000', 'paySA')
  let s = await tetraSettle(await db.get(sql`SELECT * FROM Payment_report WHERE id_order = 'sA'`), deliver)
  check('settle: not paid yet -> nothing delivered, order stays open', s.result === 'unpaid' && delivered.length === 0 && (await status('sA')) === 'Unpaid')
  await ctl('pay_id=paySA&status=paid&amount=60000')
  const rowA = await db.get(sql`SELECT * FROM Payment_report WHERE id_order = 'sA'`)
  s = await tetraSettle(rowA, deliver)
  check('settle: paid -> delivered once, order paid', s.result === 'paid' && delivered.join() === 'sA' && (await status('sA')) === 'paid')
  s = await tetraSettle(rowA, deliver) // a stale copy of the row: two requests racing
  check('settle: a racing request with a stale row is stopped by the claim', s.result === 'already' && delivered.length === 1)
  await ctl('pay_id=paySB&status=paid&amount=50000'); await order('sB', '7001', '144000', 'paySB')
  s = await tetraSettle(await db.get(sql`SELECT * FROM Payment_report WHERE id_order = 'sB'`), deliver)
  check('settle: paid amount below the bill -> not credited', s.result === 'amount_mismatch' && (await status('sB')) === 'Unpaid' && delivered.length === 1)
  st.inqFail = true; await ctl('pay_id=paySC&status=paid&amount=60000'); await order('sC', '7001', '60000', 'paySC')
  s = await tetraSettle(await db.get(sql`SELECT * FROM Payment_report WHERE id_order = 'sC'`), deliver)
  check('settle: gateway not answering -> error, order untouched (can be retried)', s.result === 'error' && (await status('sC')) === 'Unpaid')
  st.inqFail = false
  await order('sD', '7001', '60000', 'paySA', 'Unpaid', 'variza')
  check('settle: other gateways\' orders are never touched', (await tetraSettle(await db.get(sql`SELECT * FROM Payment_report WHERE id_order = 'sD'`), deliver)).result === 'error' && (await status('sD')) === 'Unpaid')
  s = await (async () => { await ctl('pay_id=paySE&status=paid&amount=60000'); await order('sE', '7001', '60000', 'paySE'); return tetraSettle(await db.get(sql`SELECT * FROM Payment_report WHERE id_order = 'sE'`), async () => { throw new Error('panel down') }) })()
  check('settle: delivery exception -> reported, order stays paid (no double delivery on retry)', s.result === 'delivery_failed' && (await status('sE')) === 'paid')

  // ---- the pause helpers
  check('pause: starts not paused', !(await gatewayPaused('tetraminator')))
  await gatewayPause('tetraminator', 600); check('pause: paused after gatewayPause', await gatewayPaused('tetraminator'))
  await gatewayPause('tetraminator', -5); check('pause: ends by itself', !(await gatewayPaused('tetraminator')))
  const msg = 'به دلیل محدودیت اشتراک فعلی، امکان ساخت لینک پرداخت جدید وجود ندارد.'
  check('variza limit: recognised (decoded and raw JSON text)', varizaLimitReached({ http_code: 422, decoded: { message: msg } }) && varizaLimitReached({ http_code: 422, raw: JSON.stringify({ message: msg }) }))
  check('variza limit: another 422 / a 500 do not count', !varizaLimitReached({ http_code: 422, decoded: { message: 'amount' } }) && !varizaLimitReached({ http_code: 500, decoded: { message: msg } }) && !varizaLimitReached(null))
  check('outage seconds: 522 / timeout -> 600, 401 -> 1800, 400 / success -> 0', gatewayOutageSeconds({ error: 'x', http_code: 522 }) === 600 && gatewayOutageSeconds({ error: 'x', http_code: 0 }) === 600 && gatewayOutageSeconds({ error: 'x', http_code: 401 }) === 1800 && gatewayOutageSeconds({ error: 'x', http_code: 400 }) === 0 && gatewayOutageSeconds({ pay_url: 'u' }) === 0)

  check('variza unreachable (DNS / timeout from the server) -> 10 minute pause', gatewayOutageSeconds({ error: 'fetch: Could not resolve host: variza.ir' }) === 600 && gatewayOutageSeconds({ error: 'relay: 500' }) === 600)
  // ---- the payment menu: online payment, automatic card-to-card, Stars, then the rest; paused ones hidden
  const T = { textbot: { cartToCart: 'CARD', variza: 'AUTO', tetraminator: 'ONLINE', starTelegram: 'STARS', zarinPal: 'ZARIN' }, keyboard: { closeList: 'CLOSE' } }
  const menu = async (extra = {}) => {
    for (const [k, v] of Object.entries({ Cartstatus: 'oncard', Cartstatuspv: 'offcardpv', variza_status: 'onvariza', variza_api_token: 'x', variza_webhook_secret: 'y', statusstar: '1', zarinpalstatus: 'onzarinpal', checkpaycartfirst: 'offpayverify', nowpaymentstatus: 'offnowpayment', statusnowpayment: '0', digistatus: 'offdigi', statusSwapWallet: 'offnSolutions', statustarnado: 'offternado', statusiranpay3: 'offiranpay3', statusaqayepardakht: 'offaqayepardakht', paymentstatussnotverify: 'offverifypay', ...extra })) await setPay(k, v)
    return JSON.parse(await stepPaymentKb({ T, from_id: '7001', usersBefore: { cardpayment: 1 } })).inline_keyboard.map((r) => r[0].text)
  }
  check('menu: ONLINE, AUTO, STARS first, then the rest, close last', (await menu()).join() === 'ONLINE,AUTO,STARS,CARD,ZARIN,CLOSE', (await menu()).join())
  await gatewayPause('tetraminator', 300)
  check('menu: a paused gateway is hidden, the others stay', (await menu()).join() === 'AUTO,STARS,CARD,ZARIN,CLOSE')
  await gatewayPause('tetraminator', -5); await gatewayPause('variza', 300)
  check('menu: Variza paused', (await menu()).join() === 'ONLINE,STARS,CARD,ZARIN,CLOSE')
  await gatewayPause('variza', -5)
  check('menu: no key -> no online payment', !(await menu({ tetraminator_api_key: '0' })).includes('ONLINE'))
  await setPay('tetraminator_api_key', 'testkey')

  // ---- the bot: a customer pays online, the callback comes through the relay
  const { handleUpdate } = await import('../tgcloud/lib/bot.js')
  await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('cron:off', '1', 0)`)
  let uid = 1
  const user = { first_name: 'Ali', username: 'ali', is_bot: false }
  const msgU = (from, text) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: from, ...user }, chat: { id: from, type: 'private' }, date: 1, text } })
  const cb = (from, data) => handleUpdate({ update_id: ++uid, callback_query: { id: 'q' + uid, from: { id: from, ...user }, chat_instance: '1', data, message: { message_id: 777, chat: { id: from, type: 'private' }, date: 1, text: 'x' } } })
  const texts = () => calls.filter(([m]) => m.toLowerCase() === 'sendmessage')
  await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'get_step_payment', Processing_value = '60000', Processing_value_one = '0', Processing_value_tow = '0', Processing_value_four = '0' WHERE id = '7001'`)
  await db.run(sql`UPDATE user SET Balance = '1000' WHERE id = '7001'`)
  calls.length = 0
  await cb(7001, 'tetraminator')
  const inv = await db.get(sql`SELECT * FROM Payment_report WHERE id_user = '7001' AND Payment_Method = 'tetraminator' ORDER BY rowid DESC LIMIT 1`)
  check('bot: a Tetraminator order is created with the gateway pay_id', !!inv && inv.payment_Status === 'Unpaid' && String(inv.dec_not_confirmed).startsWith('pay') && Number(inv.price) === 60000, JSON.stringify(inv))
  const invMsg = texts().find(([, p]) => /فاکتور پرداخت ایجاد شد/.test(String(p.text)))
  check('bot: the customer gets the invoice with a pay link and the check button', !!invMsg && JSON.stringify(invMsg[1].reply_markup).includes('checktetra-' + inv.id_order) && /https:\/\/tetraminator\.com\//.test(JSON.stringify(invMsg[1].reply_markup)) && /۶۰ دقیقه/.test(String(invMsg[1].text)))
  // the gateway reports the payment: the relay queues the callback, the next update pays
  await ctl(`pay_id=${inv.dec_not_confirmed}&status=paid&amount=60000`)
  check('relay: takes the callback', (await fetch(`http://127.0.0.1:8142/tetraminator?order_id=${inv.id_order}`)).status === 200)
  check('relay: refuses a callback without a valid order id', (await fetch('http://127.0.0.1:8142/tetraminator?order_id=x')).status === 400)
  await db.run(sql`UPDATE kv SET value = '0' WHERE key = 'relay:last_pull'`)
  await msgU(7001, '/start')
  check('bot: the callback was verified by an inquiry and the order is paid', (await status(inv.id_order)) === 'paid', await status(inv.id_order))
  check('bot: the wallet was credited once (60,000)', (await bal('7001')) === 61000, String(await bal('7001')))
  await db.run(sql`UPDATE kv SET value = '0' WHERE key = 'relay:last_pull'`)
  await fetch(`http://127.0.0.1:8142/tetraminator?order_id=${inv.id_order}`)
  await msgU(7001, '/start')
  check('bot: a repeated callback pays nothing again', (await bal('7001')) === 61000)

  // the «I paid» button with the callback lost
  await order('btn1', '7002', '60000', 'payBT1'); await ctl('pay_id=payBT1&status=pending&amount=60000')
  await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'home', Balance = '0' WHERE id = '7002'`)
  calls.length = 0
  await cb(7002, 'checktetra-btn1')
  check('button: not paid yet -> an alert, nothing changes', calls.some(([m, p]) => m === 'answerCallbackQuery' && p.show_alert && /هنوز پرداختی/.test(String(p.text))) && (await status('btn1')) === 'Unpaid')
  await ctl('pay_id=payBT1&status=paid&amount=60000')
  await cb(7002, 'checktetra-btn1')
  check('button: paid -> credited', (await status('btn1')) === 'paid' && (await bal('7002')) === 60000, String(await bal('7002')))
  await cb(7003, 'checktetra-btn1')
  check('button: another customer cannot use it', (await bal('7003')) === Number((await db.get(sql`SELECT Balance FROM user WHERE id = '7003'`)).Balance))

  // the lazy cron picks up a paid order whose callback never came
  await order('rec1', '7004', '60000', 'payRC1', 'Unpaid', 'tetraminator', 120); await ctl('pay_id=payRC1&status=paid&amount=60000')
  await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'home', Balance = '0' WHERE id = '7004'`)
  await db.run(sql`DELETE FROM kv WHERE key = 'cron:off'`)
  for (const j of ['broadcast', 'paychi', 'notifications', 'configtest', 'payment_expire', 'alert_balance', 'on_hold', 'statusday', 'optimize_order', 'expireagent', 'care', 'pulse', 'servers']) await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${'cron:' + j}, ${String(now)}, 0)`)
  await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('cron:tetraminator', '0', 0), ('cron:lock', '0', 0)`)
  await msgU(7004, '/start')
  check('cron: an open order the gateway reports paid is credited without any callback', (await status('rec1')) === 'paid' && (await bal('7004')) === 60000, `${await status('rec1')} ${await bal('7004')}`)
  await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('cron:off', '1', 0)`)

  // the gateway is down: the customer gets the other methods at once and the button is hidden
  await db.run(sql`UPDATE user SET step = 'get_step_payment', Processing_value = '60000' WHERE id = '7001'`)
  st.fail = 5; st.failCode = 522; st.html = true; st.hang = false
  calls.length = 0
  await cb(7001, 'tetraminator')
  const off = texts().find(([, p]) => /موقتاً در دسترس نیست/.test(String(p.text)))
  check('down: the customer is told and gets the menu without the online payment', !!off && !JSON.stringify(off[1].reply_markup).includes('"tetraminator"') && JSON.stringify(off[1].reply_markup).includes('colselist'), JSON.stringify(texts().map(([, p]) => p.text)))
  check('down: the gateway is paused for 10 minutes', await gatewayPaused('tetraminator'))
  check('down: the customer is still at the payment step (can pick another method)', (await db.get(sql`SELECT step FROM user WHERE id = '7001'`)).step === 'get_step_payment')
  await gatewayPause('tetraminator', -5); st.fail = 0; st.html = false

  // ---- the admin's manual approval of a duplicate
  await order('dup1', '7005', '144000', 'payDP1', 'paid', 'tetraminator', 60)
  await order('dup2', '7005', '144000', 'payDP2', 'Unpaid', 'tetraminator', 20)
  await order('dup3', '7005', '144000', 'payDP3', 'Unpaid', 'variza', 20)
  calls.length = 0
  await cb(5550001, 'Confirm_pay_dup2')
  check('admin: approving a duplicate of a paid order of the same gateway is refused', (await status('dup2')) === 'Unpaid' && calls.some(([m, p]) => m === 'answerCallbackQuery' && /احتمالاً تکراری/.test(String(p.text))), JSON.stringify(calls.filter(([m]) => m === 'answerCallbackQuery')))
  await cb(5550001, 'Confirm_pay_dup3')
  check('admin: another gateway\'s order is not blocked by it', (await status('dup3')) === 'paid', await status('dup3'))
} finally {
  php.kill(); mock.close(); fs.rmSync(dir, { recursive: true, force: true })
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
