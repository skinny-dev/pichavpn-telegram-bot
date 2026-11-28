// Keeping the partner price honest and the partner informed: minimum sales per 30 days (warning first), extra free tests at approval,
// the weekly «customers to renew» summary (Saturday) and the monthly report (1st of the Jalali month).
//   node --no-warnings --import ./register.mjs partner_keep_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
await import('../tgcloud/lib/bot.js')
const P = await import('../tgcloud/lib/partners.js')
const H = await import('../tgcloud/lib/partnerhub.js')
const kv = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const DAY = 86400, nowT = Math.floor(Date.now() / 1000)
await db.run(sql`DELETE FROM kv WHERE key LIKE 'partner:%' OR key = 'partners:mode'`)
await db.run(sql`DELETE FROM Requestagent`)
const mk = (id, agent = 'n', pct = 10, extra = {}) => db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, pricediscount, Balance, step, User_Status, limit_usertest, expire) VALUES (${String(id)}, ${'k' + id}, ${agent}, ${String(pct)}, '0', 'home', 'Active', '1', ${extra.expire ?? null})`)
const sell = (id, gb, daysAgo = 5) => db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product, price_product, Volume, Service_time) VALUES (${String(id)}, ${'iv' + id + gb + daysAgo + Math.random()}, 'x', ${String(nowT - daysAgo * DAY)}, 'active', 'p', '100000', ${String(gb)}, '30')`)
const to = (id) => calls.filter(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === String(id)).map(([, p]) => String(p.text))

// ---- 1) the minimum-sales rule (default 20 GB / 30 days, 30 days grace, 7 days warning)
check('defaults: 20 GB, 30 days grace, 7 days warning, 3 extra tests', JSON.stringify(await P.rulesGet()) === JSON.stringify({ minGb: 20, graceDays: 30, warnDays: 7, tests: 3 }))
await mk(9701); await kvSet('partner:since:9701', String(nowT - 40 * DAY))    // new partner, past the grace, sold nothing
await mk(9702); await kvSet('partner:since:9702', String(nowT - 40 * DAY)); await sell(9702, 30)      // sold 30 GB: fine
await mk(9703); await kvSet('partner:since:9703', String(nowT - 10 * DAY))    // still in the grace period
await mk(9704)                                                                  // an old partner of ours: no start day, never touched
await mk(9705, 'n', 10, { expire: nowT + 30 * DAY }); await kvSet('partner:since:9705', String(nowT - 40 * DAY)) // a trial partner: ends by itself
await mk(9706, 'n2', 0); await kvSet('partner:since:9706', String(nowT - 40 * DAY)) // a credit partner: not subject
const run1 = await P.partnersRun({ dry: true })
const acts = (r) => Object.fromEntries(r.changes.filter((c) => ['minwarn', 'minend', 'clear'].includes(c.action)).map((c) => [c.id, c.action]))
check('dry run / simulation: it says who would be warned, and changes nothing', acts(run1)['9701'] === 'minwarn' && Object.keys(acts(run1)).length === 1 && !(await kv('partner:minwarn:9701')), JSON.stringify(acts(run1)))
await kvSet('partners:mode', 'live')
calls.length = 0
const run2 = await P.partnersRun({ at: nowT })
check('live: only the partner below the minimum is warned (not: enough sales, grace, no start day, trial, credit)', JSON.stringify(acts(run2)) === JSON.stringify({ 9701: 'minwarn' }), JSON.stringify(acts(run2)))
check('…the warning says the numbers and the days left, calmly', to(9701).some((t) => /حداقل ۲۰ گیگ/.test(t) && /۷ روز/.test(t)), JSON.stringify(to(9701)))
check('…still a partner with his price after the warning', (await db.get(sql`SELECT agent, pricediscount FROM user WHERE id = '9701'`)).agent === 'n')
calls.length = 0; await P.partnersRun({ at: nowT + 2 * DAY })
check('a second pass within the warning period changes nothing and sends nothing', to(9701).length === 0 && (await db.get(sql`SELECT agent FROM user WHERE id = '9701'`)).agent === 'n')
await db.run(sql`INSERT INTO Requestagent (id, username, time, Description, status, type) VALUES ('9701', 'k9701', '1', 'x', 'accept', 'n')`)
calls.length = 0; const run3 = await P.partnersRun({ at: nowT + 8 * DAY })
const u1 = await db.get(sql`SELECT agent, pricediscount FROM user WHERE id = '9701'`)
check('after the warning period and still below: the price goes back to the ordinary one (customer, 0%)', u1.agent === 'f' && Number(u1.pricediscount) === 0 && acts(run3)['9701'] === 'minend', JSON.stringify([u1, acts(run3)]))
check('…he is told respectfully and that he can apply again; his old request is cleared so he can', to(9701).some((t) => /قیمت همکار فعلاً به قیمت عادی برگشت/.test(t) && /دوباره/.test(t)) && !(await db.get(sql`SELECT 1 AS x FROM Requestagent WHERE id = '9701'`)))
// recovery
await mk(9707); await kvSet('partner:since:9707', String(nowT - 40 * DAY)); await kvSet('partner:minwarn:9707', String(nowT - 3 * DAY)); await sell(9707, 25)
const run4 = await P.partnersRun({ at: nowT })
check('a warned partner who sells enough in time is cleared (no downgrade)', acts(run4)['9707'] === 'clear' && !(await kv('partner:minwarn:9707')) && (await db.get(sql`SELECT agent FROM user WHERE id = '9707'`)).agent === 'n')
await P.rulesSet({ minGb: 0 }); await mk(9708); await kvSet('partner:since:9708', String(nowT - 90 * DAY))
check('minimum 0 = the rule is off', acts(await P.partnersRun({ at: nowT }))['9708'] === undefined)
await P.rulesSet({ minGb: 20 })

// ---- 2) extra free tests at approval (once)
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status, limit_usertest) VALUES ('9710', 'k9710', 'f', '0', 'home', 'Active', '1')`)
await db.run(sql`INSERT OR REPLACE INTO Requestagent (id, username, time, Description, status, type) VALUES ('9710', 'k9710', ${String(nowT)}, 'x', 'waiting', 'None')`)
await db.run(sql`INSERT OR IGNORE INTO referral_links (id, name, code, active, created_at) VALUES (9991, 'm', 'keepmk', 1, 1)`); await db.run(sql`INSERT OR IGNORE INTO referral_signups (link_id, user_id, created_at) VALUES (9991, '9710', 1)`)
calls.length = 0; await P.requestDecide('9710', 'accept')
check('approval adds 3 free tests (1 → 4)', Number((await db.get(sql`SELECT limit_usertest AS n FROM user WHERE id = '9710'`)).n) === 4)
check('…and the approval message says so, and states the minimum-sales rule up front', to(9710).some((t) => /۳ تست اضافه/.test(t) && /حداقل ۲۰ گیگ/.test(t)), JSON.stringify(to(9710)).slice(0, 300))
check('the start day is recorded (the rule counts from it)', Number(await kv('partner:since:9710')) >= nowT - 5)
check('the tests are given only once per partner', (await P.grantTests('9710')) === 0 && Number((await db.get(sql`SELECT limit_usertest AS n FROM user WHERE id = '9710'`)).n) === 4)
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, User_Status, limit_usertest) VALUES ('9711', 'k9711', 'f', '0', 'home', 'Active', '0')`)
calls.length = 0; const inv = await P.partnerInvite('9711')
check('a direct invitation also gives the start day and the extra tests', inv.ok && Number((await db.get(sql`SELECT limit_usertest AS n FROM user WHERE id = '9711'`)).n) === 3 && Number(await kv('partner:since:9711')) > 0)

// ---- 3) the weekly summary (Saturday 10:00–13:00 Tehran) and the monthly report (1st of the Jalali month)
await db.run(sql`UPDATE user SET agent = 'f' WHERE agent IN ('n', 'n2') AND id NOT IN ('9720', '9721')`) // only our two test partners from here on (the seed has real ones)
await db.run(sql`DELETE FROM kv WHERE key LIKE 'partner:dg:%'`)
await mk(9720); await sell(9720, 40, 3); await db.run(sql`INSERT INTO invoice (id_user, id_invoice, username, time_sell, Status, name_product, price_product, Volume, Service_time) VALUES ('9720', 'need1', 'x1', ${String(nowT - 29 * DAY)}, 'end_of_time', 'p', '100000', '40', '30')`)
await mk(9721); await sell(9721, 40, 3)          // a partner with nobody to renew
const realNow = Date.now
const at = (iso) => { Date.now = () => Date.parse(iso) }
const sent = []; const send = async (id, text, kb) => { sent.push([String(id), String(text), JSON.stringify(kb ?? '')]); return { ok: true } }
const only = (id) => sent.filter((x) => x[0] === String(id))
at('2026-11-28T07:00:00Z') // Saturday 10:30 Tehran
await kvSet('partners:mode', 'sim')
check('simulation mode: no digest is sent', (await H.partnerDigestTick(send)).skipped === 'off' && sent.length === 0)
await kvSet('partners:mode', 'live')
const w = await H.partnerDigestTick(send)
check('Saturday 10:30, live: the partner with customers to renew gets the weekly summary with the button', only(9720).length === 1 && /۱ مشتری|1 مشتری/.test(only(9720)[0][1]) && /pcust_need_1/.test(only(9720)[0][2]), JSON.stringify(only(9720)))
check('…a partner with nobody to renew gets nothing (no noise)', only(9721).length === 0)
await H.partnerDigestTick(send)
check('…once per week: a second run says nothing again', only(9720).length === 1)
at('2026-11-28T10:30:00Z') // 14:00 Tehran
await db.run(sql`DELETE FROM kv WHERE key LIKE 'partner:dg:%'`)
check('outside 10:00–13:00 nothing is sent', (await H.partnerDigestTick(send)).skipped === 'time')
at('2026-11-26T07:00:00Z') // Thursday
check('on a weekday that is not Saturday or the 1st: nothing', (await H.partnerDigestTick(send)).skipped === 'day')
sent.length = 0
at('2026-11-22T07:00:00Z') // Sunday 1 Azar 1405, 10:30 Tehran
const mo = await H.partnerDigestTick(send)
check('the 1st of the Jalali month: the monthly report (the report text + buttons) goes to partners with activity', only(9720).length === 1 && /گزارش ماهانه/.test(only(9720)[0][1]) && /گزارش همکاری شما/.test(only(9720)[0][1]) && /pcust_need_1/.test(only(9720)[0][2]) && mo.monthly >= 2, JSON.stringify(mo))
Date.now = realNow
await kvSet('partner:digest', '0')
check('the digest can be switched off (kv partner:digest = 0)', (await H.partnerDigestTick(send)).skipped === 'off')

// ---- 4) the CLI settings
const AR = (await import('../tgcloud/endpoints/admin_report.js')).default
await db.run(sql`DELETE FROM kv WHERE key = 'partner:digest'`)
const pr = await AR({ tool: 'partner_rules', min_gb: 30, grace_days: 14, warn_days: 5, tests: 2 }, {})
check('partner_rules sets and shows the keep-the-price rules', pr.stored_rules.minGb === 30 && pr.keep_the_price.min_gb_per_30_days === 30 && pr.keep_the_price.grace_days_after_approval === 14 && pr.keep_the_price.extra_free_tests_at_approval === 2, JSON.stringify(pr.keep_the_price))
check('a nonsense value is refused', !!(await AR({ tool: 'partner_rules', min_gb: -5 }, {})).error)
await P.rulesSet({ minGb: 20, graceDays: 30, warnDays: 7, tests: 3 })
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)
