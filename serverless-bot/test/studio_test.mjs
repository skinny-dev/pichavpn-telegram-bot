// The Studio: calendar drafts follow the tone rules, CTA rules, schedule; the simulation can never reach the channel or customers.
//   node --no-warnings --import ./register.mjs studio_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls, replies, BotApiError } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const S = await import('../tgcloud/lib/studio.js')
const { handle } = await import('../tgcloud/lib/panelapi/index.js')
await import('../tgcloud/lib/panelapi/modules.js')
const { tehranParts } = await import('../tgcloud/lib/schedule.js')
const kvSet = (k, v) => db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (${k}, ${v}, 0)`)
const ADMIN = (await db.get(sql`SELECT id_admin FROM admin WHERE rule = 'administrator' LIMIT 1`))?.id_admin
check('there is an administrator to test with', !!ADMIN)
await kvSet('config:usernamebot', '@pichanet_bot')
const call = (r, body = {}, q = {}) => handle(r, q, body, ADMIN)

// 1) the calendar
const st = (await call('studio_state', {}, { from: '2026-11-01', to: '2027-03-31' })).body
check('the calendar lists occasions with dates', st.occasions.length > 8 && st.occasions.some((o) => o.id === 'yalda' && o.date === '2026-12-21'))
check('no religious occasion in the calendar', !st.occasions.some((o) => /محرم|عاشورا|رمضان|غدیر|قمری/.test(o.title)))

// 2) every draft obeys the rules
const created = (await call('studio_seed', { from: '2026-11-01', to: '2027-12-31' })).body.created
const posts = (await call('studio_state', {}, { from: '2026-11-01', to: '2027-12-31' })).body.posts
check('a draft per occasion', created >= 25 && posts.length === created, `${created}/${posts.length}`)
const bad = posts.filter((p) => p.lint.errors.length)
check('every draft passes the tone and CTA rules', bad.length === 0, bad.map((p) => p.id + ': ' + p.lint.errors[0]).join(' | '))
check('drafts start with «درود», never «سلام»', posts.every((p) => /^درود/.test(p.text)))
check('drafts are drafts (an administrator approves them)', posts.every((p) => p.status === 'draft'))
check('no draft has a discount number or urgency', posts.every((p) => !/٪|%|درصد|فقط تا|آخرین فرصت/.test(p.text)))
check('every draft has 1–2 CTA buttons', posts.every((p) => p.cta.length >= 1 && p.cta.length <= 2))
check('the main CTA of a greeting is the free test', posts.filter((p) => p.kind === 'greeting').every((p) => p.cta[0].key === 'test'))
const yalda = posts.find((p) => p.id === 'o-yalda-1405')
check('Yalda: evening of 30 Azar, with the banner name', tehranParts(yalda.when).jymd === '1405/09/30' && tehranParts(yalda.when).hour >= 18 && yalda.image === 'yalda-wide', JSON.stringify(tehranParts(yalda.when)))
const bf = posts.find((p) => p.id === 'o-blackfriday-1405')
check('Black Friday: marked as needing a real campaign, no offer in the text', /تصمیم/.test(bf.note) && !/٪|تخفیف \d/.test(bf.text))
check('no post is planned on a closed day in the evening', posts.every((p) => { const t = tehranParts(p.when); return t.dow !== 'fri' || t.hour <= 12 }))

// 3) the lint catches what a person might write
const L = (o) => S.lint({ kind: 'tip', text: 'درود. متن خوب', cta: [{ key: 'test' }], ...o })
check('سلام is refused', L({ text: 'سلام دوستان' }).errors.length === 1)
check('fake urgency is refused', L({ text: 'درود. فقط تا امشب!' }).errors.length === 1)
check('the cringe tone is refused', L({ text: 'درود. نیاو نیاو' }).errors.length === 1)
check('lunar / religious wording is refused', L({ text: 'درود. ماه رمضان' }).errors.length === 1)
check('a discount number outside an offer is refused', L({ text: 'درود. ۲۰٪ تخفیف' }).errors.length === 1)
check('a real offer may carry a number (a warning if no deadline)', L({ kind: 'offer', text: 'درود. ۲۰٪ تخفیف' }).errors.length === 0 && L({ kind: 'offer', text: 'درود. ۲۰٪ تخفیف' }).warnings.length === 1)
check('no CTA / five CTA are refused', L({ cta: [] }).errors.length === 1 && L({ cta: ['buy', 'test', 'help', 'fit', 'ref'].map((key) => ({ key })) }).errors.length === 1)
check('a deep link the bot does not know yet is flagged, not blocked', L({ cta: [{ key: 'status' }] }).warnings.length === 1 && L({ cta: [{ key: 'status' }] }).errors.length === 0)
check('a caption over 1024 characters with an image is refused', S.lint({ kind: 'tip', text: 'درود. ' + 'ا'.repeat(1100), image: 'x', cta: [{ key: 'test' }] }).errors.length === 1)

// 4) the message
const msg = S.buildMessage({ id: 'p1', text: 'درود', image: 'yalda-wide', cta: [{ key: 'test' }, { key: 'buy' }, { key: 'code', code: 'YALDA' }, { key: 'share' }] }, 'pichanet_bot', { 'yalda-wide': 'FILEID' })
const btns = msg.reply_markup.inline_keyboard.flat()
check('the buttons carry the post id and the CTA in the deep link', btns[0].url === 'https://t.me/pichanet_bot?start=ch_p1_usertest' || btns[0].url.startsWith('https://t.me/pichanet_bot?start=ch_p1_'), btns[0].url)
check('copy and share buttons are real', btns.some((b) => b.copy_text?.text === 'YALDA') && btns.some((b) => /t\.me\/share\/url/.test(b.url || '')))
check('the library name resolves to the file id', msg.photo === 'FILEID' && !msg.missingImage)
check('an unknown image is reported', S.buildMessage({ id: 'p', text: 'x', image: 'nope', cta: [] }, 'b', {}).missingImage)

// 5) save + approve
const saved = (await call('studio_save', { title: 'آزمایش', kind: 'tip', text: 'درود. نکتهٔ امروز.', cta: [{ key: 'test' }], audience: 'channel', when: Math.floor(Date.now() / 1000) - 5 })).body.post
check('a hand-written post is saved as a draft', saved.status === 'draft' && saved.lint.errors.length === 0)
check('a post with an error cannot be scheduled', (await call('studio_save', { ...saved, text: 'سلام', status: 'scheduled' })).status === 409)
check('a clean post can be scheduled', (await call('studio_status', { id: saved.id, status: 'scheduled' })).status === 200)

// 6) SIMULATION: nothing reaches the channel or customers
await kvSet('studio:channel', '@pichanet_chan')
calls.length = 0
const t = await S.studioTick()
const to = calls.map(([, p]) => String(p.chat_id ?? ''))
check('a due post is only simulated while live is off', t.mode === 'simulated', JSON.stringify(t))
check('the simulation goes only to administrators', calls.length > 0 && to.every((x) => x !== '@pichanet_chan' && x !== ''), JSON.stringify(to))
check('the message is marked as a simulation', calls.some((c) => /شبیه‌سازی/.test(JSON.stringify(c))))
check('the post is marked simulated, not sent', (await S.postsGet()).find((p) => p.id === saved.id).status === 'simulated')
const test = (await call('studio_test', { post: { text: 'درود', cta: [{ key: 'test' }] } })).body
check('a test send goes to the composing administrator', test.sent.length === 1 && test.sent[0].chat_id === String(ADMIN))

// 7) going live is a separate, explicit switch and needs a channel
check('the channel name is validated', (await call('studio_settings', { channel: 'not a channel' })).status === 400)
await call('studio_settings', { channel: '' })
check('live without a channel is refused', (await call('studio_settings', { mode: 'live' })).status === 409)
check('test without a test channel is refused', (await call('studio_settings', { mode: 'test' })).status === 409)
check('the test channel must differ from the real one', (await call('studio_settings', { channel: '@pichanet_chan', testChannel: '@pichanet_chan' })).status === 409)
// TEST mode: the test channel gets it, the real channel does not
await call('studio_settings', { channel: '@pichanet_chan', testChannel: '@pichanet_test', mode: 'test' })
await call('studio_save', { id: 'tst1', title: 'تست', kind: 'tip', text: 'درود. نکته.', cta: [{ key: 'test' }], audience: 'channel', when: Math.floor(Date.now() / 1000) - 5, status: 'scheduled' })
calls.length = 0
const t3 = await S.studioTick()
check('test mode posts to the test channel only', t3.mode === 'tested' && JSON.stringify(calls).includes('@pichanet_test') && !JSON.stringify(calls).includes('@pichanet_chan'), JSON.stringify(t3))
await call('studio_settings', { mode: 'live' })
await call('studio_save', { id: 'live1', title: 'زنده', kind: 'tip', text: 'درود. نکته.', cta: [{ key: 'test' }], audience: 'channel', when: Math.floor(Date.now() / 1000) - 5, status: 'scheduled' })
calls.length = 0
const t2 = await S.studioTick()
check('only when live is on does a post go to the channel', t2.mode === 'sent' && JSON.stringify(calls).includes('@pichanet_chan') && !/شبیه‌سازی/.test(JSON.stringify(calls)), JSON.stringify(t2))
await call('studio_settings', { mode: 'sim' })

// 8) import from a Claude session: always drafts
const imp = (await call('studio_import', { posts: [{ id: 'imp1', title: 'خبر', kind: 'news', text: 'درود. خبر.', cta: [{ key: 'test' }], status: 'scheduled' }] })).body
check('imported posts are drafts, never scheduled', imp.imported === 1 && (await S.postsGet()).find((p) => p.id === 'imp1').status === 'draft')
check('a support-only admin cannot use the studio', (await handle('studio_state', {}, {}, '1')).status === 401)

// 9) why does a post not reach the channel? the check says, and «send now» does not wait for the schedule
await call('studio_settings', { channel: '@pichanet_chan', testChannel: '@pichanet_test', mode: 'live' })
replies.getChat = () => ({ title: 'کانال پیچا', type: 'channel' })
replies.getChatMember = () => ({ status: 'administrator', can_post_messages: true })
const c1 = (await call('studio_channel_check', { which: 'main' })).body
check('channel check: reachable, the bot is an admin who can post', c1.ok === true && c1.title === 'کانال پیچا' && c1.botStatus === 'administrator', JSON.stringify(c1))
replies.getChatMember = () => ({ status: 'member' })
const c2 = (await call('studio_channel_check', { which: 'main' })).body
check('channel check: a bot that is not an admin is told so, in plain words', c2.ok === false && /ادمین/.test(c2.error), JSON.stringify(c2))
replies.getChatMember = () => ({ status: 'administrator', can_post_messages: false })
check('channel check: an admin without the post right is told so', /اجازه/.test((await call('studio_channel_check', { which: 'main' })).body.error))
replies.getChat = () => { throw new BotApiError(400, 'Bad Request: chat not found', 'getChat') }
check('channel check: a wrong name says the channel was not found', /پیدا نشد/.test((await call('studio_channel_check', { which: 'main' })).body.error))
delete replies.getChat; delete replies.getChatMember
// send now: works without waiting, needs confirmation, and a Telegram failure is shown instead of vanishing
await call('studio_save', { id: 'now1', title: 'الان', kind: 'tip', text: 'درود. نکته.', cta: [{ key: 'test' }], audience: 'channel', when: Math.floor(Date.now() / 1000) + 3 * 3600, status: 'scheduled' })
check('send now needs confirmation', (await call('studio_send_now', { id: 'now1' })).status === 409)
calls.length = 0
const sn = (await call('studio_send_now', { id: 'now1', confirm: true })).body
check('send now goes to the live channel at once, even when the schedule is hours away', sn.mode === 'sent' && JSON.stringify(calls).includes('@pichanet_chan') && (await S.postsGet()).find((p) => p.id === 'now1').status === 'sent', JSON.stringify(sn))
check('a sent post cannot be sent again', (await call('studio_send_now', { id: 'now1', confirm: true })).status === 404)
await call('studio_save', { id: 'now2', title: 'خطا', kind: 'tip', text: 'درود. نکته.', cta: [{ key: 'test' }], audience: 'channel', when: Math.floor(Date.now() / 1000) + 3600, status: 'scheduled' })
replies.sendmessage = () => { throw new BotApiError(403, 'Forbidden: bot is not a member of the channel chat', 'sendMessage') }
const bad2 = (await call('studio_send_now', { id: 'now2', confirm: true })).body
const p2 = (await S.postsGet()).find((p) => p.id === 'now2')
check('a Telegram failure is reported with its reason and the post goes back to a draft with a note', bad2.result?.[0]?.ok === false && /not a member/.test(bad2.result[0].error) && p2.status === 'draft' && /not a member/.test(p2.note), JSON.stringify({ bad2, note: p2.note }))
delete replies.sendmessage
await call('studio_settings', { mode: 'sim' })

// 11) the audience is two ticks: the channel and / or every user of the bot
const nz = (o) => S.normalize(o, {})
check('audience: two ticks decide it (both / channel / bot / admins only), and the old single word still works', nz({ toChannel: true, toBot: true }).audience === 'both' && nz({ toChannel: true, toBot: false }).audience === 'channel' && nz({ toChannel: false, toBot: true }).audience === 'bot' && nz({ toChannel: false, toBot: false }).audience === 'admins' && nz({ audience: 'admins' }).toChannel === false && nz({ audience: 'channel' }).toBot === false && nz({}).toChannel === true && S.wantsBot({ audience: 'both' }) && S.wantsChannel({ audience: 'both' }))
const mkPost = (id, o) => call('studio_save', { id, title: id, kind: 'tip', text: 'درود. نکته.', cta: [{ key: 'test' }], when: Math.floor(Date.now() / 1000) + 3600, status: 'scheduled', ...o })
const jobNow = async () => (await db.get(sql`SELECT value FROM kv WHERE key = 'broadcast:job'`))?.value
await db.run(sql`INSERT OR IGNORE INTO user (id, username, agent, User_Status, step, Balance) VALUES ('7101', 'a1', 'f', 'Active', 'home', '0'), ('7102', 'a2', 'f', 'Active', 'home', '0'), ('7103', 'a3', 'f', 'block', 'home', '0')`)
await db.run(sql`DELETE FROM kv WHERE key = 'broadcast:job'`)
await call('studio_settings', { channel: '@pichanet_chan', testChannel: '@pichanet_test', mode: 'sim' })
await mkPost('b1', { toChannel: false, toBot: true })
await call('studio_send_now', { id: 'b1', confirm: true })
check('simulation: a post for the bot starts NO broadcast (the users are never reached)', (await jobNow()) === undefined)
await call('studio_settings', { mode: 'test' })
await mkPost('b2', { toChannel: true, toBot: true })
calls.length = 0
const tb = (await call('studio_send_now', { id: 'b2', confirm: true })).body
check('test mode: the test channel gets it, the users do not', tb.mode === 'tested' && JSON.stringify(calls).includes('@pichanet_test') && (await jobNow()) === undefined, JSON.stringify(tb))
await call('studio_settings', { mode: 'live' })
await mkPost('b3', { toChannel: false, toBot: true, cta: [{ key: 'test' }, { key: 'buy' }] })
calls.length = 0
const lb = (await call('studio_send_now', { id: 'b3', confirm: true })).body
const job = JSON.parse(await jobNow() || 'null')
check('live, bot only: ONE broadcast job to every active user (blocked ones left out), nothing to the channel', lb.mode === 'sent' && job && job.total === (await db.get(sql`SELECT COUNT(*) AS n FROM user WHERE User_Status != 'block'`)).n && !JSON.stringify(calls).includes('@pichanet_chan') && job.type === 'text' && /درود/.test(job.text), JSON.stringify(lb))
check('…with the post buttons on the message', job.markup && JSON.parse(job.markup).inline_keyboard.flat().length === 2)
await mkPost('b4', { toChannel: true, toBot: true })
calls.length = 0
const busy = (await call('studio_send_now', { id: 'b4', confirm: true })).body
const p4 = (await S.postsGet()).find((p) => p.id === 'b4')
check('live, both, while a broadcast is still running: the channel part goes, the post stays a draft with a plain note (send again later)', JSON.stringify(calls).includes('@pichanet_chan') && p4.status === 'draft' && /ارسال همگانی/.test(p4.note), JSON.stringify(p4))
await db.run(sql`DELETE FROM kv WHERE key = 'broadcast:job'`)
await mkPost('b5', { toChannel: true, toBot: true })
calls.length = 0
const both = (await call('studio_send_now', { id: 'b5', confirm: true })).body
check('live, both: the channel gets it AND the broadcast job is created', both.mode === 'sent' && JSON.stringify(calls).includes('@pichanet_chan') && !!(await jobNow()), JSON.stringify(both))
// the job really delivers to the users through the existing broadcast, with the premium layer
const { broadcastTick } = await import('../tgcloud/lib/broadcast.js')
const { systemContext } = await import('../tgcloud/lib/bot.js')
calls.length = 0
for (let i = 0; i < 40 && (await jobNow()); i++) await broadcastTick({ ...(await systemContext()), from_id: '7004' }, true) // 25 users per batch
check('the broadcast sends the post to the active users', ['7101', '7102'].every((id) => calls.some(([m, p]) => /sendmessage/i.test(m) && String(p.chat_id) === id)) && !calls.some(([, p]) => String(p.chat_id) === '7103'))
await db.run(sql`DELETE FROM kv WHERE key = 'broadcast:job'`)
await call('studio_settings', { mode: 'sim' })

// 10) the picture: straight to Telegram, the post keeps the file_id (no library)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64')
replies.sendphoto = (p) => ({ message_id: 9, chat: { id: Number(p.chat_id) }, photo: [{ file_id: 'SMALL_' + 'x'.repeat(40), width: 90, height: 90 }, { file_id: 'BIGFILEID_' + 'a'.repeat(50), width: 1280, height: 1280 }] })
calls.length = 0
const up = await call('studio_upload', { file: { name: 'a.png', mime: 'image/png', data: png } })
check('upload: the picture is sent to the administrator and the LARGEST size file_id comes back', up.status === 200 && up.body.image.startsWith('BIGFILEID_') && calls.some(([m, p]) => /sendphoto/i.test(m) && String(p.chat_id) === String(ADMIN)), JSON.stringify(up.body))
check('upload: no picture / a non-image / a huge file are refused', (await call('studio_upload', {})).status === 400 && (await call('studio_upload', { file: { name: 'a.pdf', mime: 'application/pdf', data: png } })).status === 415 && (await call('studio_upload', { file: { name: 'a.png', mime: 'image/png', data: 'A'.repeat(7 * 1024 * 1024) } })).status === 413)
check('upload: a Telegram refusal is shown', await (async () => { replies.sendphoto = () => { throw new BotApiError(400, 'Bad Request: wrong file', 'sendPhoto') }; const r = await call('studio_upload', { file: { name: 'a.png', mime: 'image/png', data: png } }); delete replies.sendphoto; return r.status === 502 && /wrong file/.test(JSON.stringify(r.body)) })())
await call('studio_settings', { channel: '@pichanet_chan', testChannel: '@pichanet_test', mode: 'live' })
await call('studio_save', { id: 'img1', title: 'عکس', kind: 'tip', text: 'درود. نکته.', image: up.body.image, cta: [{ key: 'test' }], audience: 'channel', when: Math.floor(Date.now() / 1000) + 3600, status: 'scheduled' })
calls.length = 0
const sn2 = (await call('studio_send_now', { id: 'img1', confirm: true })).body
check('a post whose image is a file_id is sent as a PHOTO to the channel', sn2.mode === 'sent' && calls.some(([m, p]) => /sendphoto/i.test(m) && p.photo === up.body.image && String(p.chat_id) === '@pichanet_chan'), JSON.stringify(calls.map(([m]) => m)))
check('…and it is not reported as a missing image', !(await S.postsGet()).find((p) => p.id === 'img1').note)
await call('studio_settings', { mode: 'sim' })
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
