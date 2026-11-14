// Studio routes of the Mini App (studio_*): calendar, posts, test sends, settings. See lib/studio.js and docs/STUDIO.md.
import { kvSet } from '../db.js'
import { fail, str } from './util.js'
import { MODES, KINDS, CTA, DEFAULT_CTA, lint, normalize, postsGet, postsSet, libGet, settingsGet, occasionsBetween, seedDrafts, sendTest, tehranParts } from '../studio.js'

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
      // drafts written elsewhere (a Claude session): always imported as drafts, never scheduled
      const list = await postsGet(), out = []
      for (const raw of (Array.isArray(body.posts) ? body.posts : []).slice(0, 50)) {
        const p = normalize({ ...raw, status: 'draft', auto: true }, {})
        if (list.some((x) => x.id === p.id)) continue
        list.push(p); out.push({ id: p.id, lint: lint(p) })
      }
      await postsSet(list)
      return { ok: true, imported: out.length, posts: out }
    }
    default: fail('مسیر نامعتبر است', 404)
  }
}

