// The server catalog and the system's own «best server for what» choice.   node --no-warnings --import ./register.mjs servers_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const S = await import('../tgcloud/lib/servers.js')
const { handleUpdate } = await import('../tgcloud/lib/bot.js')
const kvGet = async (k) => (await db.get(sql`SELECT value FROM kv WHERE key = ${k}`))?.value ?? null
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)

// the remarks as they come from the panel (real naming): tunnels have the Iran flag, direct servers the cloud, info entries are skipped
const R = (flagsAndText) => S.parseRemark(flagsAndText)
check('remark: «🇩🇪 🇮🇷 تونل آلمان» = Germany tunnel', JSON.stringify(R('🇩🇪 🇮🇷 تونل آلمان')) === JSON.stringify({ country: 'DE', kind: 'tunnel', name: 'تونل آلمان' }), JSON.stringify(R('🇩🇪 🇮🇷 تونل آلمان')))
check('remark: «🇳🇱 ☁️ هلند» = Netherlands direct', JSON.stringify(R('🇳🇱 ☁️ هلند')) === JSON.stringify({ country: 'NL', kind: 'direct', name: 'هلند' }), JSON.stringify(R('🇳🇱 ☁️ هلند')))
check('remark: Poland, Finland, USA tunnels and direct', ['🇵🇱 🇮🇷 تونل لهستان', '🇫🇮 🇮🇷 تونل فنلاند', '🇺🇸 🇮🇷 تونل آمریکا', '🇵🇱 ☁️ لهستان', '🇫🇮 ☁️ فنلاند', '🇺🇸 ☁️ آمریکا'].every((x) => R(x) && R(x).country.length === 2))
check('remark: the info entry «✅ ⌛ ∞ 📊 ∞» is not a server', R('✅ ⌛ ∞ 📊  ∞') === null)

// a catalog (from the panel) and probes (from the exit servers)
const cat = [
  ['DE', 'tunnel', 'تونل آلمان'], ['DE', 'direct', 'آلمان'], ['NL', 'tunnel', 'تونل هلند'], ['NL', 'direct', 'هلند'],
  ['PL', 'tunnel', 'تونل لهستان'], ['PL', 'direct', 'لهستان'], ['FI', 'tunnel', 'تونل فنلاند'], ['FI', 'direct', 'فنلاند'], ['US', 'tunnel', 'تونل آمریکا'], ['US', 'direct', 'آمریکا'],
].map(([country, kind, name], i) => ({ id: i + 1, country, kind, name, security: country === 'PL' && kind === 'direct' ? 'none' : 'reality', port: 51140, panel: 'Picha-1' }))
await kvSet('servers:catalog', JSON.stringify(cat)); await kvSet('servers:synced', String(Math.floor(Date.now() / 1000)))
check('no data yet: nothing is recommended (no invented advice)', (await S.recommendText('ai')) === null && (await S.rankFor('ai')).length === 0)
await S.storeProbe({ country: 'FI', node: 'fi', results: { claude: 'ok', chatgpt: 'ok', youtube: 'ok', instagram: 'ok', telegram: 'ok', google: 'ok', github: 'ok', netflix: 'blocked' } })
await S.storeProbe(JSON.stringify({ country: 'DE', results: { claude: 'blocked', chatgpt: 'ok', youtube: 'ok', instagram: 'ok', telegram: 'ok', google: 'ok', github: 'ok' } }))
await S.storeProbe({ country: 'PL', results: { claude: 'ok', chatgpt: 'blocked', youtube: 'ok' } })
check('a malformed probe is refused', (await S.storeProbe({ country: 'germany', results: {} })) === false)
let ai = await S.rankFor('ai')
check('AI: Finland (both reachable) ranks above Germany (Claude blocked)', ai[0].country === 'FI' && ai.findIndex((x) => x.country === 'DE') > ai.findIndex((x) => x.country === 'FI'), JSON.stringify(ai.map((x) => [x.country, x.kind, x.score])))
check('a server without any data is not recommended (NL, US)', !ai.some((x) => x.country === 'NL' || x.country === 'US'))
check('an unencrypted server is penalised (Poland direct)', ai.find((x) => x.country === 'PL' && x.kind === 'direct').score < ai.find((x) => x.country === 'PL' && x.kind === 'tunnel').score)
const stream = await S.rankFor('stream')
check('streaming: Finland loses points for Netflix being blocked', stream.find((x) => x.country === 'FI').score < ai.find((x) => x.country === 'FI').score)
const txt = await S.recommendText('ai')
check('the text names the best two servers and says it is the system\'s own choice, not a promise', /تونل فنلاند|فنلاند/.test(txt) && /پیشنهاد سیستم/.test(txt) && /ممکن است روی هر اپراتور فرق کند/.test(txt), txt)

// customers' feedback moves the ranking
for (let i = 0; i < 8; i++) await S.recordFeedback('ai', 'PL', 'tunnel', true)
for (let i = 0; i < 8; i++) await S.recordFeedback('ai', 'FI', 'tunnel', false)
ai = await S.rankFor('ai')
check('eight «didn\'t work» votes drop Finland tunnel below Poland tunnel', ai.findIndex((x) => x.country === 'PL' && x.kind === 'tunnel') < ai.findIndex((x) => x.country === 'FI' && x.kind === 'tunnel'), JSON.stringify(ai.map((x) => [x.country, x.kind, x.score])))

// the customer flow
await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, Balance) VALUES ('7401', 'home', 'Active', '0')`)
await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'home' WHERE id = '7401'`)
await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, Balance) VALUES ('5550001', 'home', 'Active', '0')`)
await db.run(sql`INSERT OR IGNORE INTO admin (id_admin, rule) VALUES ('5550001', 'administrator')`)
await db.run(sql`UPDATE user SET roll_Status = 1, joinchannel = 'active', User_Status = 'Active', step = 'home' WHERE id = '5550001'`)
const cb = (from, data) => handleUpdate({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'q' + Math.random(), from: { id: Number(from), first_name: 'Ali', is_bot: false }, chat_instance: '1', data, message: { message_id: 9, chat: { id: Number(from), type: 'private' }, date: 1, text: 'x' } } })
const say = (text) => handleUpdate({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, from: { id: 5550001, first_name: 'A', is_bot: false }, chat: { id: 5550001, type: 'private' }, date: 1, text } })
const edits = () => calls.filter(([m]) => /editmessagetext/i.test(m))
calls.length = 0
await cb(7401, 'fit_ai')
const e1 = edits().at(-1)?.[1]
check('the customer gets the system\'s choice with «worked / did not work» buttons', /پیشنهاد سیستم/.test(String(e1?.text)) && JSON.stringify(e1?.reply_markup).includes('fitfb_ai_ok') && JSON.stringify(e1?.reply_markup).includes('fitfb_ai_bad'), JSON.stringify(e1))
const top = (await S.rankFor('ai')).find((x) => x.score > 0)
const okKey = `servers:fb:ai:${top.country}-${top.kind}:ok`, badKey = `servers:fb:ai:${top.country}-${top.kind}:bad`
const before = Number((await kvGet(okKey)) ?? 0)
await cb(7401, 'fitfb_ai_ok')
check('«worked» is counted for the server that was shown', Number(await kvGet(okKey)) === before + 1, okKey)
calls.length = 0
await cb(7401, 'fit_ai'); await cb(7401, 'fitfb_ai_bad')
check('«did not work» is counted and the next option is offered', Number((await kvGet(badKey)) ?? 0) >= 1 && /این را امتحان کنید/.test(String(edits().at(-1)?.[1]?.text)), String(edits().at(-1)?.[1]?.text))
// a manual text wins; with nothing known the customer goes to support
await say('/fit ai تانل هلند')
calls.length = 0; await cb(7401, 'fit_ai')
check('the administrator\'s own /fit text wins over the system\'s choice', /تانل هلند/.test(String(edits().at(-1)?.[1]?.text)) && !/پیشنهاد سیستم/.test(String(edits().at(-1)?.[1]?.text)))
calls.length = 0; await cb(7401, 'fit_game')
check('a use nobody has data for: support, nothing invented', /پشتیبانی/.test(String(edits().at(-1)?.[1]?.text)) && !/پیشنهاد سیستم/.test(String(edits().at(-1)?.[1]?.text)) || (await S.rankFor('game')).length > 0)
calls.length = 0; await say('/servers')
const adminMsg = calls.filter(([m]) => m.toLowerCase() === 'sendmessage').at(-1)?.[1]?.text
check('/servers lists servers, the probes and the choice per use, with no addresses', /فهرست سرورها/.test(String(adminMsg)) && /تونل فنلاند/.test(String(adminMsg)) && /FI:/.test(String(adminMsg)) && !/theunrealpicha|\d+\.\d+\.\d+\.\d+/.test(String(adminMsg)), String(adminMsg).slice(0, 300))
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
