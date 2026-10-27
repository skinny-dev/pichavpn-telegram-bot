// The lazy cron: volume / time warnings, a removed ended service, an expired unpaid payment, an ended test account.
//   node --import ./register.mjs cron_test.mjs <export dir>     (the fake panel on 127.0.0.1:8111 must be up)
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
await db.run(sql`UPDATE marzban_panel SET status = 'active', type = 'marzban', version_panel = '1', url_panel = 'http://127.0.0.1:8111'`)
await db.run(sql`UPDATE setting SET cron_status = ${JSON.stringify({ volume: true, day: true, remove: true, remove_volume: false })}, volumewarn = '50', daywarn = '30', removedayc = '0'`)
const panel = (await db.get(sql`SELECT name_panel FROM marzban_panel LIMIT 1`)).name_panel
await db.run(sql`DELETE FROM invoice`)
await db.run(sql`INSERT INTO invoice (id_invoice, id_user, username, Service_location, time_sell, name_product, price_product, Volume, Service_time, Status, notifctions)
  VALUES ('w1', '1001', 'm101', ${panel}, '1', '۳۰ گیگ', '65000', '30', '30', 'active', '{"volume":false,"time":false}')`)
await db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice, message_id) VALUES ('1001', 'old1', '2020/01/01 10:00:00', '50000', 'Unpaid', 'cart to cart', '0|0', '77')`)
await db.run(sql`UPDATE user SET status_cron = '1' WHERE id = '1001'`)
const { handleUpdate } = await import('../tgcloud/lib/bot.js')
const tick = async (job) => {
  await db.run(sql`DELETE FROM kv WHERE key LIKE 'cron:%'`)
  // every other job ran just now: only `job` is due
  for (const j of ['notifications', 'configtest', 'payment_expire', 'alert_balance', 'on_hold', 'statusday', 'optimize_order', 'expireagent']) if (j !== job) await db.run(sql`INSERT INTO kv (key, value, updated_at) VALUES (${'cron:' + j}, ${String(Math.floor(Date.now() / 1000))}, 0)`)
  calls.length = 0
  await handleUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1002, first_name: 'S', username: 'sara', is_bot: false }, chat: { id: 1002, type: 'private' }, date: 1, text: '/start' } })
}
await tick('notifications')
const toAli = calls.filter(([m, p]) => m.toLowerCase() === 'sendmessage' && String(p.chat_id) === '1001').map(([, p]) => String(p.text))
check('volume warning sent', toAli.some((t) => t.includes('m101') && /حجم/.test(t)), JSON.stringify(toAli))
check('time warning sent', toAli.length >= 2)
const n = JSON.parse((await db.get(sql`SELECT notifctions FROM invoice WHERE id_invoice = 'w1'`)).notifctions)
check('both marked as sent', n.volume === true && n.time === true, JSON.stringify(n))
await db.run(sql`UPDATE invoice SET time_cron = NULL`)
await tick('notifications')
check('not sent twice', calls.filter(([m, p]) => m.toLowerCase() === 'sendmessage' && String(p.chat_id) === '1001').length === 0)
await tick('payment_expire')
check('old unpaid payment expired', (await db.get(sql`SELECT payment_Status FROM Payment_report WHERE id_order = 'old1'`)).payment_Status === 'expire')
check('its message deleted', calls.some(([m, p]) => m.toLowerCase() === 'deletemessage' && String(p.message_id) === '77'))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
