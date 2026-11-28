// Partner (agent) requests in the native bot: accept, reject (fee refunded exactly once), type, expiry — all administrator-only.
//   node --no-warnings --import ./register.mjs agent_request_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { systemContext } = await import('../tgcloud/lib/bot.js')
const { adminAgentRoutes } = await import('../tgcloud/lib/admin/payments.js')
const c0 = await systemContext()
const ADMIN = '99001'
await db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, step, Processing_value) VALUES (${ADMIN}, 'adm', 'f', '0', 'home', '')`)
await db.run(sql`UPDATE setting SET agentreqprice = '50000'`)
const mkUser = (id) => db.run(sql`INSERT OR REPLACE INTO user (id, username, agent, Balance, expire) VALUES (${id}, ${'u' + id}, 'f', '0', NULL)`)
const mkReq = (id, status = 'waiting') => db.run(sql`INSERT OR REPLACE INTO Requestagent (id, username, time, Description, status, type) VALUES (${id}, ${'u' + id}, '1', 'یک موبایل‌فروشی در تهران', ${status}, 'None')`)
const ctx = async (datain, text = '', rule = 'administrator') => {
  const c = { ...(await systemContext()), from_id: ADMIN, message_id: 77, callback_query_id: 'cb', datain, text, adminRow: { rule } }
  c.user = await db.get(sql`SELECT * FROM user WHERE id = ${ADMIN}`)
  return c
}
const go = async (c) => { for (const r of adminAgentRoutes) if (await r(c)) return true; return false }
const user = (id) => db.get(sql`SELECT agent, Balance, expire FROM user WHERE id = ${id}`)
const req = (id) => db.get(sql`SELECT status, type FROM Requestagent WHERE id = ${id}`)

const refer = async (id) => { await db.run(sql`INSERT OR IGNORE INTO referral_links (id, name, code, active, created_at) VALUES (9990, 'm', 'tstmk', 1, 1)`); await db.run(sql`INSERT OR IGNORE INTO referral_signups (link_id, user_id, created_at) VALUES (9990, ${String(id)}, 1)`) } // came through a marketer: the first tier at once
// accept
await mkUser('8101'); await mkReq('8101'); await refer('8101')
calls.length = 0
check('accept is handled', await go(await ctx('addagentrequest_8101')))
check('the first tier (10%) is given with the approval', Number((await db.get(sql`SELECT pricediscount FROM user WHERE id = '8101'`)).pricediscount) === 10)
check('the user becomes a partner (n), the request is accepted, no expiry', (await user('8101')).agent === 'n' && (await req('8101')).status === 'accept' && (await req('8101')).type === 'n' && (await user('8101')).expire === null)
check('the new partner is told, the administrator gets the type and expiry buttons', calls.some(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === '8101') && JSON.stringify(calls).includes('setagenttype_n2_8101') && JSON.stringify(calls).includes('expireset_8101'))
calls.length = 0
check('a second tap on accept does nothing more', await go(await ctx('addagentrequest_8101')) && !calls.some(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === '8101'))

// type
check('the type can be changed to the advanced (credit) level', await go(await ctx('setagenttype_n2_8101')) && (await user('8101')).agent === 'n2' && (await req('8101')).type === 'n2')
await go(await ctx('setagenttype_n_8101'))

// expiry: ask, then type the days
const e1 = await ctx('expireset_8101'); await go(e1)
const e2 = await ctx('', '30'); e2.user = await db.get(sql`SELECT * FROM user WHERE id = ${ADMIN}`)
check('the expiry flow asks for days', e1.user.step !== undefined && e2.user.step === 'gettime_expire_agent' && e2.user.Processing_value === '8101', JSON.stringify(e2.user))
const before = Math.floor(Date.now() / 1000)
await go(e2)
const ex = Number((await user('8101')).expire)
check('30 days from now is saved as the partner\'s expiry', ex >= before + 30 * 86400 - 5 && ex <= before + 30 * 86400 + 60, String(ex))
const bad = await ctx('', 'abc'); bad.user = { ...bad.user, step: 'gettime_expire_agent' }; calls.length = 0
check('a non-number is refused and nothing changes', await go(bad) && Number((await user('8101')).expire) === ex)

// reject: the fee comes back exactly once
await mkUser('8102'); await mkReq('8102')
check('reject is handled', await go(await ctx('rejectrequesta_8102')))
check('the request fee (50,000) is refunded and the user stays a normal customer', Number((await user('8102')).Balance) === 50000 && (await user('8102')).agent === 'f' && (await req('8102')).status === 'reject')
await go(await ctx('rejectrequesta_8102'))
check('a second tap does NOT refund again (the PHP bot did)', Number((await user('8102')).Balance) === 50000)
await mkUser('8103'); await mkReq('8103')
await go(await ctx('addagentrequest_8103'))
await go(await ctx('rejectrequesta_8103'))
check('rejecting an already accepted request refunds nothing and changes nothing', Number((await user('8103')).Balance) === 0 && (await user('8103')).agent === 'n' && (await req('8103')).status === 'accept')

// guards
await mkUser('8104'); await mkReq('8104')
check('a non-administrator cannot approve (the tap is not handled)', (await go(await ctx('addagentrequest_8104', '', 'support'))) === false && (await user('8104')).agent === 'f')
check('an unknown request is answered, not crashed', await go(await ctx('addagentrequest_999999')))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
