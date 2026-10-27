// End to end: the PHP relay (pasarguard/pay_relay) receives a signed Variza webhook and a bank SMS, the bot pulls
// them and pays (wallet top-ups). Also: a bad signature and a wrong forwarder token are refused by the bot.
//   node --import ./register.mjs relay_test.mjs <export dir>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'))
const KEY = 'k'.repeat(32)
fs.writeFileSync(path.join(dir, 'conf.php'), `<?php\nconst RELAY_KEY = '${KEY}';\nconst RELAY_DIR = '${dir}';\n`)
const php = spawn('php', ['-S', '127.0.0.1:8140', path.resolve('../../pasarguard/pay_relay/index.php')], { env: { ...process.env, PICHA_RELAY_CONF: path.join(dir, 'conf.php') }, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 600))
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
try {
  await seed(process.argv[2])
  const tehran = (t) => { const d = new Date((t + 12600) * 1000); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` }
  const now = Math.floor(Date.now() / 1000)
  for (const [k, v] of [['variza_webhook_secret', 'sec-123'], ['sms_webhook_token', 'tok0123456789abcdef'], ['smsautoconfirm', 'onsms'], ['chashbackvariza', '0'], ['chashbackcart', '0']]) {
    await db.run(sql`DELETE FROM PaySetting WHERE NamePay = ${k}`)
    await db.run(sql`INSERT INTO PaySetting (NamePay, ValuePay) VALUES (${k}, ${v})`)
  }
  await db.run(sql`UPDATE user SET Balance = '1000' WHERE id = '1001'`)
  await db.run(sql`UPDATE user SET Balance = '2000' WHERE id = '1002'`)
  await db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice, dec_not_confirmed) VALUES ('1001', 'vz1', ${tehran(now)}, '50000', 'Unpaid', 'variza', '0|0', 'SLUG-1')`)
  await db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES ('1002', 'cc1', ${tehran(now)}, '30123', 'Unpaid', 'cart to cart', '0|0')`)
  await db.run(sql`INSERT INTO kv (key, value, updated_at) VALUES ('config:pay_relay_url', 'http://127.0.0.1:8140', 0), ('config:pay_relay_key', ${KEY}, 0)`)

  const post = (p, body, headers = {}) => fetch('http://127.0.0.1:8140' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
  const vbody = JSON.stringify({ event: 'payment.paid', slug: 'SLUG-1', amount: 50000 })
  const sig = crypto.createHmac('sha256', 'sec-123').update(vbody).digest('hex')
  check('relay takes the Variza webhook', (await post('/variza', vbody, { 'X-Webhook-Signature': 'sha256=' + sig })).status === 200)
  await post('/variza', JSON.stringify({ event: 'payment.paid', slug: 'SLUG-1', amount: 999999 }), { 'X-Webhook-Signature': 'sha256=bad' })
  await post('/sms', JSON.stringify({ wrongtoken0123456_blu: 'بلو\nواریز پول\n301,230 ریال' }))
  check('relay takes the SMS', (await post('/sms', JSON.stringify({ tok0123456789abcdef_blu: 'بلو\nواریز پول\nمبلغ 301,230 ریال به حساب شما نشست\nموجودی: 5,000,000 ریال' }))).status === 200)
  check('pull without the key is refused', (await fetch('http://127.0.0.1:8140/pull')).status === 401)

  const { handleUpdate } = await import('../tgcloud/lib/bot.js')
  await handleUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1001, first_name: 'Ali', username: 'ali', is_bot: false }, chat: { id: 1001, type: 'private' }, date: 1, text: '/start' } })
  const bal = async (id) => Number((await db.get(sql`SELECT Balance FROM user WHERE id = ${id}`)).Balance)
  const status = async (id) => (await db.get(sql`SELECT payment_Status FROM Payment_report WHERE id_order = ${id}`)).payment_Status
  check('Variza order paid', (await status('vz1')) === 'paid', await status('vz1'))
  check('Variza top-up credited once', (await bal('1001')) === 51000, String(await bal('1001')))
  check('SMS matched the card-to-card order', (await status('cc1')) === 'paid', await status('cc1'))
  check('SMS top-up credited', (await bal('1002')) === 32123, String(await bal('1002')))
  check('customers told', calls.filter(([m, p]) => m.toLowerCase() === 'sendmessage' && /واریز گردید/.test(String(p.text))).length === 2)
  // a second pull: nothing is paid twice
  await db.run(sql`UPDATE kv SET value = '0' WHERE key = 'relay:last_pull'`)
  await handleUpdate({ update_id: 2, message: { message_id: 2, from: { id: 1001, first_name: 'Ali', username: 'ali', is_bot: false }, chat: { id: 1001, type: 'private' }, date: 1, text: '/start' } })
  check('second pull pays nothing again', (await bal('1001')) === 51000 && (await bal('1002')) === 32123)
} finally {
  php.kill()
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
