// Working-week schedule for customer-care messages (Tehran time).  node --no-warnings --import ./register.mjs schedule_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { tehranParts, careTime, loadSchedule, DEFAULT_WINDOWS, describeSchedule } = await import('../tgcloud/lib/schedule.js')
const { handleUpdate } = await import('../tgcloud/lib/bot.js')
const at = (y, m, d, h = 12, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 1000 - 12600 // Tehran clock time

// known dates: 14 Nov 2026 = Saturday = 1405/08/23
let p = tehranParts(at(2026, 11, 14))
check('weekday and Jalali date (Sat 1405/08/23)', p.dow === 'sat' && p.jymd === '1405/08/23' && p.hour === 12, JSON.stringify(p))
check('Friday is closed', careTime(at(2026, 11, 13), { windows: DEFAULT_WINDOWS, offdays: [] }).why === 'closed_day')
check('Thursday morning open, afternoon closed', careTime(at(2026, 11, 12, 11), { windows: DEFAULT_WINDOWS, offdays: [] }).ok && careTime(at(2026, 11, 12, 15), { windows: DEFAULT_WINDOWS, offdays: [] }).why === 'outside_hours')
check('working day hours: 08:59 closed, 09:00 open, 20:59 open, 21:00 closed', !careTime(at(2026, 11, 14, 8, 59), { windows: DEFAULT_WINDOWS, offdays: [] }).ok && careTime(at(2026, 11, 14, 9, 0), { windows: DEFAULT_WINDOWS, offdays: [] }).ok && careTime(at(2026, 11, 14, 20, 59), { windows: DEFAULT_WINDOWS, offdays: [] }).ok && !careTime(at(2026, 11, 14, 21, 0), { windows: DEFAULT_WINDOWS, offdays: [] }).ok)
check('fixed holiday (1 Farvardin 1406 = 21 Mar 2027)', tehranParts(at(2027, 3, 21)).jmd === '01/01' && careTime(at(2027, 3, 21), { windows: DEFAULT_WINDOWS, offdays: [] }).why === 'holiday')
check('an added day off (full date)', careTime(at(2026, 11, 14), { windows: DEFAULT_WINDOWS, offdays: ['1405/08/23'] }).why === 'holiday')

// the administrator's commands
await db.run(sql`INSERT OR IGNORE INTO admin (id_admin, rule) VALUES ('5550001', 'administrator')`)
await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'home' WHERE id = '5550001'`)
let uid = 1
const say = (text) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: 5550001, first_name: 'A', is_bot: false }, chat: { id: 5550001, type: 'private' }, date: 1, text } })
const last = () => String(calls.filter(([m]) => m.toLowerCase() === 'sendmessage').at(-1)?.[1]?.text)
await say('/care window thu 9-13'); const s1 = await loadSchedule()
check('/care window thu 9-13 changes Thursday', JSON.stringify(s1.windows.thu) === '[9,13]' && /پنج‌شنبه: 9–13/.test(last()), last())
await say('/care window fri 10-12'); check('/care window fri 10-12 opens Friday', JSON.stringify((await loadSchedule()).windows.fri) === '[10,12]')
await say('/care window fri off'); check('/care window fri off closes it again', (await loadSchedule()).windows.fri === null)
await say('/care window all 10-20'); const s2 = await loadSchedule()
check('/care window all 10-20 sets every day', ['sat', 'wed', 'thu', 'fri'].every((d) => JSON.stringify(s2.windows[d]) === '[10,20]'))
await say('/care window sat 21-9'); check('an impossible window is refused and nothing changes', /نامعتبر/.test(last()) && JSON.stringify((await loadSchedule()).windows.sat) === '[10,20]')
await say('/care offday add 1405/09/05'); check('/care offday add', (await loadSchedule()).offdays.includes('1405/09/05'))
await say('/care offday del 1405/09/05'); check('/care offday del', !(await loadSchedule()).offdays.includes('1405/09/05'))
await say('/care schedule'); check('/care schedule lists the week', /شنبه/.test(last()) && /جمعه/.test(last()) && /نوروز/.test(last()))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
