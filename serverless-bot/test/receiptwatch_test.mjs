// Receipts waiting for a person: ONE digest to the administrators (daytime only), older than 2 h, each order once per 24 h, nothing changed, no customer messaged.
//   node --no-warnings --import ./register.mjs receiptwatch_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
await import('../tgcloud/lib/bot.js')
const { receiptWatch } = await import('../tgcloud/lib/cron.js')
const { tehranParts } = await import('../tgcloud/lib/schedule.js')
const kvGet = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
const nowT = Math.floor(Date.now() / 1000)
const tehran = (t) => new Date((t + 12600) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/')
await db.run(sql`DELETE FROM Payment_report`); await db.run(sql`DELETE FROM kv WHERE key LIKE 'rw:%' OR key = 'receiptwatch:on'`)
await db.run(sql`DELETE FROM admin`); await db.run(sql`INSERT INTO admin (id_admin, rule) VALUES ('5550001', 'administrator'), ('5550002', 'support')`)
const order = (id, ageH, st, inv = 'getconfigafterpay|svc') => db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES ('7701', ${id}, ${tehran(nowT - ageH * 3600)}, '60000', ${st}, 'variza', ${inv})`)
await order('w-young', 1, 'waiting'); await order('w-old', 30, 'waiting'); await order('w-renew', 5, 'waiting', 'getextenduser|svc'); await order('w-paid', 40, 'paid'); await order('w-unpaid', 40, 'Unpaid')
const day = tehranParts(nowT).hour >= 9 && tehranParts(nowT).hour < 22
const digests = () => calls.filter(([m, p]) => /sendmessage/i.test(m) && /منتظر تصمیم/.test(String(p.text)))
calls.length = 0; await receiptWatch()
if (day) {
  check('daytime: ONE digest, to the administrator only', digests().length === 1 && String(digests()[0][1].chat_id) === '5550001', JSON.stringify(digests().map((d) => d[1].chat_id)))
  const txt = String(digests()[0][1].text)
  check('lists the old and the 5-hour renewal receipts, not the 1-hour one, not paid/unpaid', /w-old/.test(txt) && /w-renew/.test(txt) && !/w-young|w-paid|w-unpaid/.test(txt) && /2 رسید/.test(txt.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || /۲ رسید/.test(txt), txt)
  check('the oldest is listed first', txt.indexOf('w-old') < txt.indexOf('w-renew'))
  check('each listed order is remembered', !!(await kvGet('rw:w-old')) && !!(await kvGet('rw:w-renew')) && !(await kvGet('rw:w-young')))
  calls.length = 0; await receiptWatch()
  check('a second run within 24 h says nothing again', digests().length === 0)
  await db.run(sql`DELETE FROM kv WHERE key LIKE 'rw:%'`); await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('receiptwatch:on', '0', 0)`)
  calls.length = 0; await receiptWatch()
  check('switched off (receiptwatch:on = 0): silent', digests().length === 0)
} else console.log('SKIP daytime checks (it is night in Tehran: the job is silent by design)')
check('no customer message is ever sent by this job', !calls.some(([, p]) => String(p.chat_id) === '7701'))
check('the waiting rows themselves are untouched', Number((await db.get(sql`SELECT COUNT(*) AS n FROM Payment_report WHERE payment_Status = 'waiting'`)).n) === 3)
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)
