// Telegram formatting helpers and the plain-text fallback.   node --no-warnings --import ./register.mjs tgfmt_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls, replies, BotApiError } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const F = await import('../tgcloud/lib/tgfmt.js')
check('escapes everything it wraps', F.b('a<b>&') === '<b>a&lt;b&gt;&amp;</b>' && F.quote('<x>') === '<blockquote>&lt;x&gt;</blockquote>')
check('expandable quote', F.expandable('جزئیات') === '<blockquote expandable>جزئیات</blockquote>')
check('hashtags: spaces and half-spaces become underscores, punctuation goes', F.tag('آموزش اتصال') === '#آموزش_اتصال' && F.tag('می‌خواهم') === '#می_خواهم' && F.tag('  جمعه سیاه! ') === '#جمعه_سیاه')
check('at most three tags, no duplicates', F.tags(['آموزش', 'اتصال', 'آموزش', 'امنیت', 'وضعیت']) === '#آموزش #اتصال #امنیت')
check('a link only for http(s) or tg://', F.link('x', 'https://t.me/a') === '<a href="https://t.me/a">x</a>' && F.link('x', 'javascript:alert(1)') === 'x')
check('post link: public channel + id only', F.postLink('@picha_news', 42) === 'https://t.me/picha_news/42' && F.postLink('a', 1) === '' && F.postLink('picha_news', 'x') === '')
const msg = F.fmtMsg({ title: 'وضعیت امروز', body: 'همه چیز عادی است.', tip: 'اشتراک را به‌روزرسانی کنید.', details: 'قدم ۱ …\nقدم ۲ …', tags: ['وضعیت', 'اتصال'], link: ['آموزش کامل', 'https://t.me/picha_news/42'] })
check('house style: bold title, body, quote tip, expandable details, link, hashtags last', msg.startsWith('<b>وضعیت امروز</b>') && msg.includes('<blockquote>اشتراک') && msg.includes('<blockquote expandable>') && msg.includes('<a href=') && msg.trim().endsWith('#وضعیت #اتصال'), msg)
check('stripHtml gives the plain twin', F.stripHtml(msg).includes('اشتراک را به‌روزرسانی کنید.') && !/<|>/.test(F.stripHtml(msg)))
// fallback
let n = 0, last = null
const send = async (p) => { n++; last = p; return n === 1 ? { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } : { ok: true } }
const r = await F.richOrPlain(send, { chat_id: 1, text: F.quote('سلام') })
check('a 400 formatting error is retried as plain text', r.ok && n === 2 && !last.parse_mode && last.text === 'سلام')
n = 0
const r2 = await F.richOrPlain(async (p) => { n++; return { ok: false, error_code: 403, description: 'blocked' } }, { chat_id: 1, text: 'x' })
check('a 403 is not retried (the person blocked the bot)', r2.ok === false && n === 1)
// the pulse uses it
const { systemContext } = await import('../tgcloud/lib/bot.js')
const { pulseTick } = await import('../tgcloud/lib/pulse.js')
const c = await systemContext()
await db.run(sql`UPDATE user SET User_Status = 'Blocked'`)
await db.run(sql`INSERT OR IGNORE INTO user (id, step, User_Status, Balance) VALUES ('7601', 'home', 'Active', '0')`)
await db.run(sql`UPDATE user SET User_Status = 'Active', joinchannel = 'active', roll_Status = 1, step = 'home', last_message_time = '0' WHERE id = '7601'`)
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
await kvSet('pulse:on', '1'); await kvSet('pulse:mode', 'all')
const SAT = Date.UTC(2026, 10, 14, 0, 0) / 1000 - 12600
calls.length = 0
await pulseTick(c, { at: SAT + 9.5 * 3600, BATCH: 5 })
const first = calls.filter(([m]) => m.toLowerCase() === 'sendmessage').find(([, p]) => String(p.chat_id) === '7601')?.[1]
check('pulse: a lesson is sent with the tip in a quote block, silently', !!first && first.parse_mode === 'HTML' && /<blockquote>/.test(first.text) && first.disable_notification === true, JSON.stringify(first))
// an API that refuses the quote: the person still gets the message, plain, and it is not counted as a block
await db.run(sql`DELETE FROM kv WHERE key LIKE 'pulse:s:%' OR key LIKE 'pulse:seen:%' OR key LIKE 'mem:%'`)
replies.sendmessage = (p) => { if (String(p.chat_id) === '7601' && /<blockquote/.test(String(p.text))) throw new BotApiError(400, "Bad Request: can't parse entities: unsupported start tag", 'sendmessage') }
calls.length = 0
const r3 = await pulseTick(c, { at: SAT + 1 * 86400 + 9.5 * 3600, BATCH: 5 })
const both = calls.filter(([m]) => m.toLowerCase() === 'sendmessage').filter(([, p]) => String(p.chat_id) === '7601').map(([, p]) => p)
check('pulse: when the quote is refused the same message goes out as plain text, and it is not a «block»', both.length === 2 && !both[1].parse_mode && !/<blockquote/.test(both[1].text) && r3.blocked === 0 && r3.sent === 1, JSON.stringify({ r3, n: both.length }))
delete replies.sendmessage
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
