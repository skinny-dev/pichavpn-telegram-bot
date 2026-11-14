// The Studio: calendar drafts follow the tone rules, CTA rules, schedule; the simulation can never reach the channel or customers.
//   node --no-warnings --import ./register.mjs studio_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db, calls } from 'sdk'
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
check('a deep link the bot does not know yet is flagged, not blocked', L({ cta: [{ key: 'tariff' }] }).warnings.length === 1 && L({ cta: [{ key: 'tariff' }] }).errors.length === 0)
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

console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
