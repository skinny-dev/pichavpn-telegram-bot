// Paychi gateway end to end: a mock of the Paychi native API (node http) + the real PHP payment relay + the bot.
//   node --no-warnings --import ./register.mjs paychi_test.mjs <export dir>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }

// ---- the mock Paychi (amounts in RIAL, Bearer auth, errors {error:{code,message}})
const st = { n: 0, errCode: null, errHttp: 422, txs: {}, log: [] }
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/__set') { const id = u.searchParams.get('id'); const t = st.txs[id]; if (u.searchParams.get('status')) t.status = u.searchParams.get('status'); if (u.searchParams.get('amount')) t.amount = Number(u.searchParams.get('amount')); if (u.searchParams.get('order_id')) t.order_id = u.searchParams.get('order_id'); return send(200, {}) }
    if (req.headers.authorization !== 'Bearer pk_testkey') return send(401, { error: { code: 'unauthorized', message: 'bad key' } })
    if (req.method === 'POST' && u.pathname === '/api/v1/transactions') {
      const inb = JSON.parse(body || '{}')
      st.log.push(inb)
      if (st.errCode) return send(st.errHttp, { error: { code: st.errCode, message: 'refused' } })
      const id = 'tx_' + ++st.n + 'abc'
      st.txs[id] = { id, status: 'pending', amount: inb.amount + 7, requested_amount: inb.amount, order_id: inb.order_id, card: { number: '6037000011112222', holder: 'Test' }, payment_url: `https://pay.example.test/p/${id}`, expires_at: '2099-01-01T00:00:00Z' }
      return send(201, st.txs[id])
    }
    const m = /^\/api\/v1\/transactions\/([\w]+)$/.exec(u.pathname)
    if (m) { const t = st.txs[m[1]]; return t ? send(200, t) : send(404, { error: { code: 'not_found', message: 'x' } }) }
    send(404, {})
  })
}).listen(8151)
const ctl = (q) => fetch('http://127.0.0.1:8151/__set?' + q)

// ---- the real PHP relay
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paychi-'))
const KEY = 'k'.repeat(32)
fs.writeFileSync(path.join(dir, 'conf.php'), `<?php\nconst RELAY_KEY = '${KEY}';\nconst RELAY_DIR = '${dir}';\n`)
const php = spawn('php', ['-S', '127.0.0.1:8152', path.resolve('../../pasarguard/pay_relay/index.php')], { env: { ...process.env, PICHA_RELAY_CONF: path.join(dir, 'conf.php') }, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 600))

try {
  await seed(process.argv[2])
  const setPay = async (k, v) => { await db.run(sql`DELETE FROM PaySetting WHERE NamePay = ${k}`); await db.run(sql`INSERT INTO PaySetting (NamePay, ValuePay) VALUES (${k}, ${v})`) }
  for (const [k, v] of [['paychi_status', 'onpaychi'], ['paychi_api_key', 'pk_testkey'], ['paychi_base_url', 'http://127.0.0.1:8151'], ['minbalancepaychi', '20000'], ['maxbalancepaychi', '10000000'], ['chashbackpaychi', '0'], ['paychi_webhook_secret', 'whsec'], ['paychi_timeout_ms', '700']]) await setPay(k, v)
  await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('config:pay_relay_url', 'http://127.0.0.1:8152', 0), ('config:pay_relay_key', ${KEY}, 0)`)
  const tehran = (t) => { const d = new Date((t + 12600) * 1000); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` }
  const now = Math.floor(Date.now() / 1000)
  const order = (id, user, price, payId, status = 'Unpaid', method = 'paychi', ageSec = 30) => db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice, dec_not_confirmed) VALUES (${user}, ${id}, ${tehran(now - ageSec)}, ${price}, ${status}, ${method}, '0|0', ${payId})`)
  const status = async (id) => (await db.get(sql`SELECT payment_Status FROM Payment_report WHERE id_order = ${id}`)).payment_Status
  const bal = async (id) => Number((await db.get(sql`SELECT Balance FROM user WHERE id = ${id}`)).Balance)
  const { gatewayPaused, gatewayPause } = await import('../tgcloud/lib/gatepause.js')
  const { handleUpdate } = await import('../tgcloud/lib/bot.js')
  await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('cron:off', '1', 0)`)
  let uid = 1
  const user = { first_name: 'Ali', username: 'ali', is_bot: false }
  const msgU = (from, text) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: from, ...user }, chat: { id: from, type: 'private' }, date: 1, text } })
  const cb = (from, data) => handleUpdate({ update_id: ++uid, callback_query: { id: 'q' + uid, from: { id: from, ...user }, chat_instance: '1', data, message: { message_id: 777, chat: { id: from, type: 'private' }, date: 1, text: 'x' } } })
  const texts = () => calls.filter(([m]) => m.toLowerCase() === 'sendmessage')
  const readyUser = (id, val = '60000', bal0 = '0') => db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'get_step_payment', Processing_value = ${val}, Processing_value_one = '0', Processing_value_tow = '0', Processing_value_four = '0', Balance = ${bal0} WHERE id = ${id}`)
  const sign = (body, secret = 'whsec') => { const t = String(Math.floor(Date.now() / 1000)); return `t=${t},v1=${crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex')}` }
  const hook = (orderId, body, headers = {}) => fetch(`http://127.0.0.1:8152/paychi?order_id=${orderId}`, { method: 'POST', body, headers })
  const pull = () => db.run(sql`UPDATE kv SET value = '0' WHERE key = 'relay:last_pull'`)

  // ---- the customer starts a Paychi payment
  await readyUser('7001', '60000', '1000')
  calls.length = 0
  await cb(7001, 'paychi')
  const inv = await db.get(sql`SELECT * FROM Payment_report WHERE id_user = '7001' AND Payment_Method = 'paychi' ORDER BY rowid DESC LIMIT 1`)
  check('bot: a Paychi order is created with the transaction id', !!inv && inv.payment_Status === 'Unpaid' && String(inv.dec_not_confirmed).startsWith('tx_') && Number(inv.price) === 60000, JSON.stringify(inv))
  check('api: the amount sent is in RIAL (toman x 10) with our order id and a callback via the relay', st.log[0]?.amount === 600000 && st.log[0]?.order_id === inv?.id_order && /\/paychi\?order_id=/.test(String(st.log[0]?.callback_url)), JSON.stringify(st.log[0]))
  const msg = texts().find(([, p]) => /پرداخت|فاکتور/.test(String(p.text)) && JSON.stringify(p.reply_markup ?? {}).includes('checkpaychi-'))
  check('bot: the customer gets the pay link and the check button', !!msg && JSON.stringify(msg[1].reply_markup).includes('checkpaychi-' + inv.id_order) && JSON.stringify(msg[1].reply_markup).includes('https://pay.example.test/p/'), JSON.stringify(texts().map(([, p]) => p.text)))
  check('bot: the exact unique amount (rial) is shown', /600[,٬]?007|۶۰۰[,٬]?۰۰۷/.test(String(msg?.[1]?.text)), String(msg?.[1]?.text))

  // ---- the webhook comes through the relay
  await ctl(`id=${inv.dec_not_confirmed}&status=paid`)
  const body = JSON.stringify({ event: 'transaction.paid', data: { order_id: inv.id_order } })
  check('relay: refuses a bad order id', (await hook('x', body)).status === 400)
  // a forged signature is ignored
  await hook(inv.id_order, body, { 'X-Paychi-Signature': sign(body, 'wrong') })
  await pull(); await msgU(7001, '/start')
  check('bot: a forged signature pays nothing', (await status(inv.id_order)) === 'Unpaid', await status(inv.id_order))
  await hook(inv.id_order, body, { 'X-Paychi-Signature': sign(body) })
  await pull(); await msgU(7001, '/start')
  check('bot: a signed webhook is verified by an inquiry and the order is paid', (await status(inv.id_order)) === 'paid', await status(inv.id_order))
  check('bot: the wallet was credited once (60,000)', (await bal('7001')) === 61000, String(await bal('7001')))
  await hook(inv.id_order, body, { 'X-Paychi-Signature': sign(body) })
  await pull(); await msgU(7001, '/start')
  check('bot: a repeated webhook pays nothing again', (await bal('7001')) === 61000)

  // ---- «I paid» button, callback lost
  await order('btn1', '7002', '60000', 'tx_BT1')
  st.txs.tx_BT1 = { id: 'tx_BT1', status: 'pending', amount: 600003, requested_amount: 600000, order_id: 'btn1' }
  await readyUser('7002'); await db.run(sql`UPDATE user SET step = 'home' WHERE id = '7002'`)
  calls.length = 0
  await cb(7002, 'checkpaychi-btn1')
  check('button: not paid yet -> an alert, nothing changes', calls.some(([m, p]) => m === 'answerCallbackQuery' && p.show_alert) && (await status('btn1')) === 'Unpaid', JSON.stringify(calls.filter(([m]) => m === 'answerCallbackQuery')))
  await ctl('id=tx_BT1&status=paid')
  const b3 = Number((await db.get(sql`SELECT Balance FROM user WHERE id = '7003'`))?.Balance ?? 0)
  await cb(7003, 'checkpaychi-btn1')
  check('button: another customer cannot use it', (await status('btn1')) === 'Unpaid' && Number((await db.get(sql`SELECT Balance FROM user WHERE id = '7003'`))?.Balance ?? 0) === b3)
  await cb(7002, 'checkpaychi-btn1')
  check('button: paid -> credited', (await status('btn1')) === 'paid' && (await bal('7002')) === 60000, String(await bal('7002')))

  // ---- safety: a transaction of another order, and an underpayment, never pay
  await order('mis1', '7006', '60000', 'tx_MIS1')
  st.txs.tx_MIS1 = { id: 'tx_MIS1', status: 'paid', amount: 600001, requested_amount: 600000, order_id: 'someoneelse' }
  await order('low1', '7006', '60000', 'tx_LOW1')
  st.txs.tx_LOW1 = { id: 'tx_LOW1', status: 'paid', amount: 300000, requested_amount: 300000, order_id: 'low1' }
  await readyUser('7006'); await db.run(sql`UPDATE user SET step = 'home' WHERE id = '7006'`)
  await cb(7006, 'checkpaychi-mis1'); await cb(7006, 'checkpaychi-low1')
  check('safety: a transaction that belongs to another order is refused', (await status('mis1')) === 'Unpaid' && (await bal('7006')) === 0)
  check('safety: a transaction for less than the bill is refused', (await status('low1')) === 'Unpaid' && (await bal('7006')) === 0)

  // ---- the lazy cron picks up a paid order whose webhook never came
  await order('rec1', '7004', '60000', 'tx_RC1', 'Unpaid', 'paychi', 120)
  st.txs.tx_RC1 = { id: 'tx_RC1', status: 'paid', amount: 600002, requested_amount: 600000, order_id: 'rec1' }
  await readyUser('7004'); await db.run(sql`UPDATE user SET step = 'home' WHERE id = '7004'`)
  await db.run(sql`DELETE FROM kv WHERE key = 'cron:off'`)
  for (const j of ['broadcast', 'tetraminator', 'notifications', 'configtest', 'payment_expire', 'alert_balance', 'on_hold', 'statusday', 'optimize_order', 'expireagent']) await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${'cron:' + j}, ${String(now)}, 0)`)
  await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('cron:paychi', '0', 0), ('cron:lock', '0', 0)`)
  await msgU(7004, '/start')
  check('cron: an open order Paychi reports paid is credited without any webhook', (await status('rec1')) === 'paid' && (await bal('7004')) === 60000, `${await status('rec1')} ${await bal('7004')}`)
  await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('cron:off', '1', 0)`)

  // ---- Paychi refuses (no card / limit): the customer gets the menu, the gateway rests
  await readyUser('7001', '60000')
  st.errCode = 'card_limit_reached'; st.errHttp = 422
  calls.length = 0
  await cb(7001, 'paychi')
  const off = texts().find(([, p]) => /موقتاً در دسترس نیست/.test(String(p.text)))
  check('refused: the customer is told and gets the menu without the Paychi button', !!off && !JSON.stringify(off[1].reply_markup).includes('"paychi"'), JSON.stringify(texts().map(([, p]) => p.text)))
  check('refused: the gateway is paused', await gatewayPaused('paychi'))
  check('refused: the customer is still at the payment step', (await db.get(sql`SELECT step FROM user WHERE id = '7001'`)).step === 'get_step_payment')
  await gatewayPause('paychi', -5); st.errCode = null

  // ---- a wrong key is a 401: shown as unavailable, paused longer
  await setPay('paychi_api_key', 'pk_wrong')
  calls.length = 0
  await cb(7001, 'paychi')
  check('401: the customer is not left hanging', texts().some(([, p]) => /موقتاً در دسترس نیست/.test(String(p.text))))
  await gatewayPause('paychi', -5); await setPay('paychi_api_key', 'pk_testkey')

  // ---- the admin's manual approval of a duplicate
  await order('dup1', '7005', '144000', 'tx_DP1', 'paid', 'paychi', 60)
  await order('dup2', '7005', '144000', 'tx_DP2', 'Unpaid', 'paychi', 20)
  calls.length = 0
  await cb(5550001, 'Confirm_pay_dup2')
  check('admin: approving a duplicate of a paid order of the same gateway is refused', (await status('dup2')) === 'Unpaid' && calls.some(([m, p]) => m === 'answerCallbackQuery' && /احتمالاً تکراری/.test(String(p.text))), JSON.stringify(calls.filter(([m]) => m === 'answerCallbackQuery')))
} finally {
  php.kill(); mock.close(); fs.rmSync(dir, { recursive: true, force: true })
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
