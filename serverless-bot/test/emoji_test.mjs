// Premium emoji everywhere: plain (no parse mode) messages become premium too, HTML ones stay, a Telegram block can be lifted, the audit lists emoji without an id.
//   node --no-warnings --import ./register.mjs emoji_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls, replies, BotApiError } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
await import('../tgcloud/lib/bot.js')
const { sendmessage, telegram } = await import('../tgcloud/lib/tg.js')
const E = await import('../tgcloud/lib/emoji.js')
const h = (await import('../tgcloud/endpoints/admin_report.js')).default
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
await kvSet('storage:premium_emoji.json', JSON.stringify({ enabled: true, buttons: true, reply_buttons: true, catalog: true, map: { '✔': '5000000000000000001', '⭐': '5000000000000000002', '🔥': '5000000000000000003' } }))
E.resetEmojiCache()
const last = () => calls[calls.length - 1][1]

calls.length = 0; await sendmessage('7001', 'درود ✅ تست', null, 'HTML')
check('an HTML message: the emoji (and its alias ✅→✔) become premium', /<tg-emoji emoji-id="5000000000000000001">✅<\/tg-emoji>/.test(last().text))
calls.length = 0; await sendmessage('7001', 'درود ⭐ بدون حالت', null)
check('a message with NO parse mode becomes premium too (sent as HTML)', /<tg-emoji emoji-id="5000000000000000002">⭐<\/tg-emoji>/.test(last().text) && String(last().parse_mode).toLowerCase() === 'html', JSON.stringify(last()))
calls.length = 0; await sendmessage('7001', 'a < b & c > d ⭐ <b>x</b>', null)
check('plain text is escaped, so it reads exactly the same (no tag is ever interpreted)', last().text.includes('a &lt; b &amp; c &gt; d') && last().text.includes('&lt;b&gt;x&lt;/b&gt;'), last().text)
calls.length = 0; await sendmessage('7001', 'متن ساده بدون اموجی <b>', null)
check('a plain message without a mapped emoji is untouched (no parse mode added)', last().text === 'متن ساده بدون اموجی <b>' && last().parse_mode === undefined, JSON.stringify(last()))
calls.length = 0; await telegram('sendmessage', { chat_id: '7001', text: '⭐ *bold*', parse_mode: 'MarkdownV2' })
check('Markdown messages are left alone', last().text === '⭐ *bold*' && last().parse_mode === 'MarkdownV2', JSON.stringify(last()))
calls.length = 0; await telegram('sendphoto', { chat_id: '7001', photo: 'x', caption: 'عکس 🔥' })
check('a photo caption without a parse mode becomes premium too', /<tg-emoji emoji-id="5000000000000000003">🔥<\/tg-emoji>/.test(last().caption), JSON.stringify(last()))
calls.length = 0; await telegram('answercallbackquery', { callback_query_id: '1', text: '⭐ ok' })
check('a callback answer is never touched (Telegram does not allow it)', last().text === '⭐ ok')

// Telegram refuses custom emoji → block for 6 hours, then the audit says so and unblock lifts it
replies.sendmessage = (p) => { if (/tg-emoji/.test(String(p.text))) throw new BotApiError(400, 'Bad Request: DOCUMENT_INVALID custom emoji', 'sendMessage'); return { message_id: 1, chat: { id: 1 } } }
await sendmessage('7001', 'درود ⭐', null, 'HTML')
const a1 = await h({ tool: 'emoji' }, {})
check('after a refusal the audit shows the block', /YES/.test(a1.blocked_by_telegram), JSON.stringify(a1.blocked_by_telegram))
delete replies.sendmessage
const a2 = await h({ tool: 'emoji', unblock: true }, {})
check('unblock lifts it', a2.blocked_by_telegram === 'no' && a2.unblocked === true, JSON.stringify(a2.blocked_by_telegram))
calls.length = 0; await sendmessage('7001', 'درود ⭐', null, 'HTML')
check('premium emoji flow again right after the unblock', /<tg-emoji/.test(last().text))

// the audit
check('the audit shows the config', a2.config.enabled === true && a2.config.mapped_emoji >= 3 && a2.config.inline_button_icons === true)
check('the audit lists emoji the bot uses that still have no premium id', a2.texts.strings_scanned > 500 && a2.texts.without_premium_id > 0 && a2.add_these_to_the_map.length > 0 && a2.add_these_to_the_map[0].uses >= a2.add_these_to_the_map.at(-1).uses, JSON.stringify(a2.texts))
check('the probe sends a real test to the first administrator', (await h({ tool: 'emoji', probe: true }, {})).probe.sent === true)
check('a Mini App call is refused', await h({ tool: 'emoji' }, { initData: { user: { id: 1 } } }).then(() => false, () => true))
// import a pack straight from Telegram (no PHP server needed): ON, the map, the icons you name, and the cache refreshes by itself
await kvSet('storage:premium_emoji.json', 'null'); E.resetEmojiCache()
replies.getStickerSet = (p) => (p.name === 'NewsEmoji' ? { name: 'NewsEmoji', stickers: [{ emoji: '🔥', custom_emoji_id: '5111111111111111111' }, { emoji: '⭐', custom_emoji_id: '5222222222222222222' }, { emoji: '✔️', custom_emoji_id: '5333333333333333333' }, { emoji: '🛍', custom_emoji_id: '5444444444444444444' }, { emoji: '🔥', custom_emoji_id: '5999999999999999999' }, { emoji: 'x', is_x: 1 }] } : (() => { throw new BotApiError(400, 'Bad Request: STICKERSET_INVALID', 'getStickerSet') })())
const im = await h({ tool: 'emoji', import: 'https://t.me/addemoji/NewsEmoji', buttons: true, reply: true, catalog: true }, {})
check('import: the pack is read, its emoji are in the map, premium is ON with the icons asked for', im.import[0].emoji_in_pack === 5 && im.import[0].added === 4 && im.saved.enabled === true && im.saved.buttons && im.saved.reply_buttons && im.saved.catalog && im.saved.emoji_in_map === 4, JSON.stringify(im.import) + JSON.stringify(im.saved))
check('import: the first emoji of a kind wins (a pack can repeat one)', JSON.parse((await db.get(sql`SELECT value FROM kv WHERE key = 'storage:premium_emoji.json'`)).value).map['🔥'] === '5111111111111111111')
calls.length = 0; await sendmessage('7002', 'درود 🔥 ✅ 🛒', null)
check('right after the import a message is premium (🔥, the alias ✅→✔ and 🛒→🛍), even without a parse mode', (last().text.match(/tg-emoji/g) || []).length >= 6, last().text)
const bad = await h({ tool: 'emoji', import: 'NoSuchPack' }, {})
check('an unknown pack is reported, nothing is broken', bad.import[0].error && /STICKERSET_INVALID/.test(bad.import[0].error) && bad.saved.enabled === true)
const off = await h({ tool: 'emoji', on: false }, {})
check('"on":false turns it off', off.saved.enabled === false && off.config.enabled === false)
await h({ tool: 'emoji', on: true }, {})
// a change made by another copy of the bot is seen within a minute (no restart)
await kvSet('storage:premium_emoji.json', JSON.stringify({ enabled: false, map: { '🔥': '5111111111111111111' } }))
const realNow = Date.now; Date.now = () => realNow() + 61000
calls.length = 0; await sendmessage('7002', 'درود 🔥', null, 'HTML')
Date.now = realNow
check('the config cache refreshes by itself after a minute', !/tg-emoji/.test(last().text), last().text)
delete replies.getStickerSet
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
