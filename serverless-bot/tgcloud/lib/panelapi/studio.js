// Studio routes of the Mini App (studio_*): calendar, posts, test sends, settings. See lib/studio.js and docs/STUDIO.md.
import { kvSet } from '../db.js'
import { InputFile } from 'sdk'
import { b64ToBytes } from '../b64.js'
import { telegram, emojiUnblock } from '../tg.js'
import { emojiImport, emojiProbe, emojiState, DEFAULT_PACK } from '../emoji.js'
import { fail, str } from './util.js'
import { MODES, KINDS, CTA, DEFAULT_CTA, lint, normalize, postsGet, postsSet, libGet, settingsGet, occasionsBetween, seedDrafts, sendTest, tehranParts, publishNow, channelCheck } from '../studio.js'

const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const day = 86400

async function state(q) {
  const t = Math.floor(Date.now() / 1000)
  const from = str(q.from) || iso(t - 14 * day), to = str(q.to) || iso(t + 200 * day)
  const posts = (await postsGet()).sort((a, b) => (a.when || 9e12) - (b.when || 9e12))
  return {
    ok: true, now: t, from, to, settings: await settingsGet(), lib: Object.keys(await libGet()),
    occasions: occasionsBetween(from, to), kinds: KINDS, cta: CTA, defaultCta: DEFAULT_CTA,
    posts: posts.map((p) => ({ ...p, lint: lint(p), day: p.when ? tehranParts(p.when).jymd : '' })),
  }
}

async function save(b) {
  const list = await postsGet()
  const i = list.findIndex((p) => p.id === b.id)
  const p = normalize(b, i >= 0 ? list[i] : {})
  if (p.status === 'scheduled') { const l = lint(p); if (l.errors.length) fail(l.errors[0], 409); if (!p.when) fail('زمان ارسال را مشخص کنید', 409) }
  if (i >= 0) list[i] = p; else list.push(p)
  await postsSet(list)
  return { ok: true, post: { ...p, lint: lint(p) } }
}

async function status(b) {
  const list = await postsGet()
  const p = list.find((x) => x.id === b.id)
  if (!p) fail('پست پیدا نشد', 404)
  if (!['draft', 'scheduled', 'cancelled'].includes(b.status)) fail('وضعیت نامعتبر', 400)
  if (b.status === 'scheduled') { const l = lint(p); if (l.errors.length) fail(l.errors[0], 409); if (!p.when) fail('زمان ارسال را مشخص کنید', 409) }
  p.status = b.status
  await postsSet(list)
  return { ok: true }
}

export async function route(name, q, body, admin) {
  switch (name) {
    case 'studio_state': return state(q)
    case 'studio_save': return save(body)
    case 'studio_status': return status(body)
    case 'studio_delete': { await postsSet((await postsGet()).filter((p) => p.id !== body.id)); return { ok: true } }
    case 'studio_upload': { // the picture goes to Telegram (to the administrator's own chat); its file_id is what the post keeps — no library
      const f = body.file
      if (!f || !f.data) fail('تصویری انتخاب نشده است', 400)
      const mime = String(f.mime || '')
      if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mime)) fail('فقط تصویر PNG، JPG یا WEBP', 415)
      if (Math.floor((String(f.data).length * 3) / 4) > 5 * 1024 * 1024) fail('حجم تصویر باید کمتر از ۵ مگابایت باشد', 413)
      let bytes
      try { bytes = b64ToBytes(String(f.data)) } catch { fail('فایل تصویر خراب است', 400) }
      const ext = /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpg'
      const r = await telegram('sendphoto', { chat_id: admin.id_admin, photo: new InputFile(bytes, 'post.' + ext, { type: mime }), caption: '🖼 تصویر پست ذخیره شد (فقط برای شما)' })
      if (r.ok === false) fail('تلگرام تصویر را نپذیرفت: ' + String(r.description ?? ''), 502)
      const sizes = r.result?.photo
      const id = Array.isArray(sizes) && sizes.length ? sizes[sizes.length - 1].file_id : ''
      if (!id) fail('شناسهٔ تصویر از تلگرام نیامد', 502)
      return { ok: true, image: id }
    }
    case 'studio_emoji_state': return { ok: true, ...(await emojiState()) }
    case 'studio_emoji_apply': { // «make everything premium»: the pack (default NewsEmoji) → the map, premium ON, button icons + bottom menu + catalog labels ON
      if (!body.confirm) fail('تأیید لازم است', 409)
      const r = await emojiImport(telegram, { packs: [str(body.pack) || DEFAULT_PACK], on: body.on === undefined ? true : !!body.on, buttons: body.buttons === undefined ? true : !!body.buttons, reply: body.reply === undefined ? true : !!body.reply, catalog: body.catalog === undefined ? true : !!body.catalog })
      await emojiUnblock()
      if (r.import[0]?.error) fail('پک خوانده نشد: ' + r.import[0].error, 502)
      return { ok: true, ...r, state: await emojiState() }
    }
    case 'studio_emoji_set': { // switches only (no pack): on / buttons / reply / catalog / unblock
      const r = await emojiImport(telegram, { on: 'on' in body ? !!body.on : undefined, buttons: 'buttons' in body ? !!body.buttons : undefined, reply: 'reply' in body ? !!body.reply : undefined, catalog: 'catalog' in body ? !!body.catalog : undefined })
      if (body.unblock) await emojiUnblock()
      return { ok: true, ...r, state: await emojiState() }
    }
    case 'studio_emoji_probe': return { ok: true, ...(await emojiProbe(telegram, admin.id_admin)) }
    case 'studio_send_now': {
      if (!body.confirm) fail('تأیید ارسال لازم است', 409)
      const r = await publishNow(String(body.id))
      if (!r.ok) fail(r.error, 404)
      return r
    }
    case 'studio_channel_check': {
      const st = await settingsGet(), chat = body.which === 'test' ? st.testChannel : st.channel
      if (!chat) fail('کانال ثبت نشده است', 409)
      return { ok: true, ...(await channelCheck(chat)) }
    }
    case 'studio_test': {
      const p = normalize(body.post || {}, {})
      const l = lint(p)
      const r = await sendTest(p, admin.id_admin)
      return { ok: true, sent: r.sent, missingImage: r.missingImage, lint: l }
    }
    case 'studio_seed': { const n = await seedDrafts(str(body.from) || iso(Date.now() / 1000), str(body.to) || iso(Date.now() / 1000 + 120 * day)); return { ok: true, created: n } }
    case 'studio_settings': {
      const chan = (v) => { const c = str(v).trim(); if (c && !/^(@[A-Za-z][A-Za-z0-9_]{4,31}|-100\d{5,})$/.test(c)) fail('نام کانال (@name) یا شناسهٔ عددی (‎-100…) نامعتبر است', 400); return c }
      const cur = await settingsGet()
      const channel = 'channel' in body ? chan(body.channel) : cur.channel, testChannel = 'testChannel' in body ? chan(body.testChannel) : cur.testChannel
      if (channel && channel === testChannel) fail('کانال تست باید غیر از کانال اصلی باشد', 409)
      let mode = cur.mode
      if ('mode' in body) mode = MODES.includes(body.mode) ? body.mode : fail('حالت نامعتبر', 400)
      else if ('live' in body) mode = body.live ? 'live' : 'sim'
      if (mode === 'live' && !channel) fail('اول کانال اصلی را ثبت کنید', 409)
      if (mode === 'test' && !testChannel) fail('اول کانال تست را ثبت کنید', 409)
      await kvSet('studio:channel', channel); await kvSet('studio:test_channel', testChannel); await kvSet('studio:mode', mode)
      return { ok: true, settings: await settingsGet() }
    }
    case 'studio_lib_set': { const n = str(body.name).trim(), v = str(body.value).trim(); if (!/^[A-Za-z0-9_-]{1,40}$/.test(n) || !v) fail('نام (لاتین) و مقدار (file_id یا لینک https) لازم است', 400); const lib = await libGet(); lib[n] = v; await kvSet('studio:lib', JSON.stringify(lib)); return { ok: true } }
    case 'studio_lib_delete': { const lib = await libGet(); delete lib[str(body.name)]; await kvSet('studio:lib', JSON.stringify(lib)); return { ok: true } }
    case 'studio_import': {
      // drafts written elsewhere (a Claude session): always imported as drafts, never scheduled. With startDate (+ time) each post gets a PLANNED day (one a day, in order)
      // — still a draft until a person approves it.
      const list = await postsGet(), out = []
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(body.startDate)) ? str(body.startDate) : '', hm = /^([01]\d|2[0-3]):[0-5]\d$/.test(str(body.time)) ? str(body.time) : '09:00'
      const replace = (Array.isArray(body.replace) ? body.replace : []).map(String)
      let day = 0
      for (const raw of (Array.isArray(body.posts) ? body.posts : []).slice(0, 50)) {
        const p = normalize({ ...raw, status: 'draft', auto: true, ...('toChannel' in body ? { toChannel: !!body.toChannel } : {}), ...('toBot' in body ? { toBot: !!body.toBot } : {}) }, {}) // the import box can set the audience for all of them
        const at = list.findIndex((x) => x.id === p.id)
        if (at >= 0 && !(replace.includes(p.id) && list[at].status === 'draft')) continue // an existing post is only replaced when you NAME it in `replace` and it is still a draft (a scheduled or sent one is never touched)
        if (date) { const [y, m, d] = date.split('-').map(Number), [H, M] = hm.split(':').map(Number); p.when = Math.floor(Date.UTC(y, m - 1, d + day, H, M) / 1000) - 12600; day++ } // Tehran = UTC+3:30
        if (at >= 0) list[at] = p; else list.push(p)
        out.push({ id: p.id, title: p.title, when: p.when, lint: lint(p), replaced: at >= 0 || undefined })
      }
      await postsSet(list)
      return { ok: true, imported: out.length, posts: out }
    }
    case 'studio_approve_all': { // one confirmed click for a batch of drafts that have a future time and pass the rules
      if (!body.confirm) fail('تأیید لازم است', 409)
      const list = await postsGet(), done = [], skipped = []
      const t = Math.floor(Date.now() / 1000)
      for (const id of (Array.isArray(body.ids) ? body.ids : []).map(String)) {
        const p = list.find((x) => x.id === id)
        if (!p) { skipped.push({ id, why: 'پیدا نشد' }); continue }
        if (p.status !== 'draft') { skipped.push({ id, why: 'پیش‌نویس نیست' }); continue }
        if (!p.when || p.when <= t) { skipped.push({ id, why: 'زمان آینده ندارد' }); continue }
        const l = lint(p)
        if (l.errors.length) { skipped.push({ id, why: l.errors[0] }); continue }
        p.status = 'scheduled'; done.push(id)
      }
      await postsSet(list)
      return { ok: true, scheduled: done.length, skipped }
    }
    default: fail('مسیر نامعتبر است', 404)
  }
}

