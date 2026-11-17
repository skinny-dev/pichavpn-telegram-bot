// Every button of a channel post does its REAL action: ?start=ch_<post>_<key> (and the plain words ?start=buy · usertest · test …) behave exactly like typing that command.
//   node --no-warnings --import ./register.mjs cta_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { handleUpdate, systemContext } = await import('../tgcloud/lib/bot.js')
const S = await import('../tgcloud/lib/studio.js')
const T = (await systemContext()).T
const kvGet = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
let uid = 1, nextUser = 7300
const fresh = async () => { const id = ++nextUser; await db.run(sql`INSERT OR REPLACE INTO user (id, step, User_Status, Balance, limit_usertest, roll_Status, joinchannel, verify, agent) VALUES (${String(id)}, 'home', 'Active', '0', '1', 1, 'active', '1', 'f')`); return id }
const msg = (from, text) => handleUpdate({ update_id: ++uid, message: { message_id: uid, from: { id: from, first_name: 'Ali', is_bot: false }, chat: { id: from, type: 'private' }, date: 1, text } })
const out = () => calls.filter(([m, p]) => /^(sendmessage|editmessagetext|senddice)$/i.test(m)).map(([m, p]) => String(p.text ?? p.emoji ?? '') + '|' + JSON.stringify(p.reply_markup ?? ''))
const run = async (text) => { const id = await fresh(); calls.length = 0; await msg(id, text); return out().filter((x) => !x.startsWith('undefined')).map((x) => x.replace(/[0-9a-f]{10,}/g, 'H').replace(/[0-9۰-۹]+/g, '#')) } // the user's own id / code / date differ between two test users

const PAIRS = [
  ['buy', '/buy'], ['test', '/free'], ['help', '/help'], ['tariff', T.textbot.tariffList], ['wallet', '/wallet'], ['support', '/support'],
  ['extend', T.textbot.extend], ['services', '/services'], ['ref', T.textbot.affiliates],
]
for (const [key, typed] of PAIRS) {
  const want = await run(typed), viaPost = await run('/start ch_p1_' + key)
  check(`the «${key}» button of a post = typing «${typed}»`, want.length > 0 && JSON.stringify(viaPost) === JSON.stringify(want), JSON.stringify({ viaPost, want }).slice(0, 300))
}
const plain = await run('/start test'), freeTyped = await run('/free')
check('plain: /start test does the free test (like /free)', plain.length > 0 && JSON.stringify(plain) === JSON.stringify(freeTyped), JSON.stringify(plain).slice(0, 200))
check('plain: /start buy = /buy, /start usertest = /free, /start help = /help', JSON.stringify(await run('/start buy')) === JSON.stringify(await run('/buy')) && JSON.stringify(await run('/start usertest')) === JSON.stringify(await run('/free')) && JSON.stringify(await run('/start help')) === JSON.stringify(await run('/help')))
const fit = await run('/start ch_p1_fit')
check('the «best server» button opens the use-case menu', fit.some((x) => /برای چه کاری/.test(x)), JSON.stringify(fit).slice(0, 200))
check('clicks are counted per post and button', Number(await kvGet('care:n:ch:p1:buy')) === 1 && Number(await kvGet('care:n:ch:p1:test')) === 1 && Number(await kvGet('care:n:ch:p1:fit')) === 1)
check('a button never fails when counting breaks (the action still happens)', (await run('/start ch_p1_buy')).length > 0)
// a referral code is not an action; an unknown ch_ word falls back to the start menu (nothing breaks)
const odd = await run('/start ch_p1_nothingthere')
check('an unknown button word just shows the start menu', odd.length > 0)
// the post's own buttons: deep links with the ch_ form, every start-based button is flagged as understood now
const m = S.buildMessage({ id: 'p1', cta: [{ key: 'test' }, { key: 'buy' }, { key: 'tariff' }, { key: 'support' }] }, 'pichanet_bot', {})
check('the post buttons are t.me deep links of that form', m.reply_markup.inline_keyboard.flat().every((b) => /^https:\/\/t\.me\/pichanet_bot\?start=ch_p1_(test|buy|tariff|support)$/.test(b.url)), JSON.stringify(m.reply_markup))
const two = S.buildMessage({ id: 'p1', cta: [{ key: 'test' }, { key: 'buy' }, { key: 'help' }] }, 'pichanet_bot', {}).reply_markup.inline_keyboard.flat()
check('the FIRST button is the main colour (primary), the others stay normal (secondary)', two[0].style === 'primary' && two[1].style === undefined && two[2].style === undefined, JSON.stringify(two))
check('a post with one button: that button is primary', S.buildMessage({ id: 'p2', cta: [{ key: 'buy' }] }, 'b', {}).reply_markup.inline_keyboard[0][0].style === 'primary')
check('a post whose first button is a copy-code button: it is primary too', S.buildMessage({ id: 'p3', cta: [{ key: 'code', code: 'X10' }, { key: 'buy' }] }, 'b', {}).reply_markup.inline_keyboard.flat()[0].style === 'primary')
const col = S.buildMessage({ id: 'p4', cta: [{ key: 'test', style: 'success' }, { key: 'buy', style: 'danger' }, { key: 'help', style: 'default' }, { key: 'tariff' }] }, 'b', {}).reply_markup.inline_keyboard.flat()
check('a chosen colour wins (green / red / plain), and an unchosen later button stays plain', col[0].style === 'success' && col[1].style === 'danger' && col[2].style === undefined && col[3].style === undefined, JSON.stringify(col))
check('"default" on the FIRST button turns the automatic primary off', S.buildMessage({ id: 'p5', cta: [{ key: 'buy', style: 'default' }] }, 'b', {}).reply_markup.inline_keyboard[0][0].style === undefined)
check('the colour survives saving (normalize keeps only the valid ones)', S.normalize({ cta: [{ key: 'buy', style: 'danger' }, { key: 'test', style: 'rainbow' }] }, {}).cta.map((b) => b.style).join() === 'danger,')
check('every start-based button is now marked as understood by the bot (except the server status)', Object.entries(S.CTA).filter(([k, d]) => d.start && k !== 'status').every(([, d]) => d.ready === true))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
