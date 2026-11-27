// The Tetraminator gateway fee (12%): booked as «کارمزد درگاه و بانک» in the ledger and in the dashboard stats; other methods untouched; changeable; idempotent.
//   node --no-warnings --import ./register.mjs fees_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
await import('../tgcloud/lib/bot.js')
const { finSyncLegacy } = await import('../tgcloud/lib/panelapi/finance/legacy.js')
const { statsCollect, gatewayFeePct } = await import('../tgcloud/lib/panelapi/stats.js')
const AR = (await import('../tgcloud/endpoints/admin_report.js')).default
const nowT = Math.floor(Date.now() / 1000)
const tehran = (t) => new Date((t + 12600) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/')
await db.run(sql`DELETE FROM Payment_report`); await db.run(sql`DELETE FROM fin_journal_lines`); await db.run(sql`DELETE FROM fin_journal`); await db.run(sql`DELETE FROM expenses`); await db.run(sql`DELETE FROM capital_entries`)
await db.run(sql`DELETE FROM kv WHERE key LIKE 'accounting:fee_pct:%'`); await db.run(sql`DELETE FROM fin_settings WHERE k = 'legacy_fee_applied'`)
const pay = (id, price, method, st = 'paid') => db.run(sql`INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES ('8801', ${id}, ${tehran(nowT - 3600)}, ${String(price)}, ${st}, ${method}, 'none')`)
await pay('t1', 100000, 'tetraminator'); await pay('t2', 250000, 'tetraminator'); await pay('v1', 100000, 'variza'); await pay('t3', 90000, 'tetraminator', 'Unpaid')
check('default fee for Tetraminator is 12%, other gateways 0', (await gatewayFeePct('tetraminator')) === 12 && (await gatewayFeePct('variza')) === 0)
const entries = async () => db.all(sql`SELECT j.source_id sid, j.status st, a.system_key sk, l.debit d, l.credit c FROM fin_journal j JOIN fin_journal_lines l ON l.entry_id = j.id JOIN fin_accounts a ON a.id = l.account_id WHERE j.source_type = 'legacy_payment' AND j.status = 'posted' ORDER BY j.id, l.id`)
const sum = (rows, key, f) => rows.filter((r) => r.sk === key && f(r)).reduce((a, r) => a + (Number(r.d) || 0) + (Number(r.c) || 0), 0)
const st1 = await finSyncLegacy()
let E = await entries()
check('ledger: the sync posted without issues', st1.issues.length === 0, JSON.stringify(st1.issues))
check('ledger: fee = 12% of the two paid Tetraminator payments (350000 × 12% = 42000) on «exp_fee»', sum(E, 'exp_fee', () => true) === 42000, JSON.stringify(E))
check('ledger: the gateway account receives the NET (88%) of Tetraminator and the FULL amount of Variza', sum(E, 'gateway', (r) => r.d > 0) === 308000 + 100000, JSON.stringify(E.filter((r) => r.sk === 'gateway')))
check('ledger: revenue is the GROSS (what the customer paid), fee not netted out of revenue', sum(E, 'revenue_sales', (r) => r.c > 0) === 450000)
check('ledger: every entry balances', Object.values(E.reduce((a, r) => { (a[r.sid] ||= [0, 0]); a[r.sid][0] += Number(r.d) || 0; a[r.sid][1] += Number(r.c) || 0; return a }, {})).every(([d, c]) => d === c))
check('ledger: an unpaid Tetraminator payment is not booked', !E.some((r) => r.sid === 'p' + (1e9)) && E.map((r) => r.sid).filter((x, i, a) => a.indexOf(x) === i).length === 3)
const again = await finSyncLegacy()
check('ledger: a second sync changes nothing', again.reposted === 0 && (await entries()).length === E.length)

// the percent changes: old payments are re-posted once
await AR({ tool: 'fees', tetraminator: 10 }, {})
const st2 = await finSyncLegacy(); E = await entries()
check('changing to 10%: the old payments are re-posted (fee 35000)', st2.reposted >= 2 && sum(E, 'exp_fee', () => true) === 35000, `${st2.reposted} ${sum(E, 'exp_fee', () => true)}`)
await AR({ tool: 'fees', tetraminator: 0 }, {})
await finSyncLegacy(); E = await entries()
check('0% = no fee: the gateway gets the full amount again', sum(E, 'exp_fee', () => true) === 0 && sum(E, 'gateway', (r) => r.d > 0) === 450000)
await AR({ tool: 'fees', tetraminator: 12 }, {})
const st3 = await finSyncLegacy(); E = await entries(); if (st3.issues.length) console.log('ISSUES', JSON.stringify(st3.issues).slice(0, 300))
check('back to 12%: 42000 again', sum(E, 'exp_fee', () => true) === 42000)

// the dashboard stats
const s = await statsCollect(nowT - 86400, nowT + 60)
check('stats: the fee is an expense of kind «fee» (opex): 12% of 350000', s.by_kind.fee.s === 42000 && s.by_kind.fee.c === 2, JSON.stringify(s.by_kind.fee))
check('stats: revenue stays gross (450000 customer payments) and net profit is reduced by the fee', s.revenue >= 450000 && s.opex_sum >= 42000, `${s.revenue} ${s.opex_sum}`)

// the CLI tool
const f = await AR({ tool: 'fees' }, {})
check('fees tool: percent and the 30-day numbers', f.tetraminator.fee_percent === 12 && f.tetraminator.paid_payments === 2 && f.tetraminator.gross_toman === 350000 && f.tetraminator.fee_toman === 42000 && f.tetraminator.net_after_fee_toman === 308000, JSON.stringify(f.tetraminator))
check('fees tool: a bad percent is refused', !!(await AR({ tool: 'fees', tetraminator: 150 }, {})).error && (await gatewayFeePct('tetraminator')) === 12)
check('fees tool: a Mini App call is refused', await AR({ tool: 'fees' }, { initData: { user: { id: 1 } } }).then(() => false, () => true))
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)
