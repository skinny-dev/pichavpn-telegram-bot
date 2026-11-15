// Event routes of the Mini App (event_*): see lib/events.js and docs/EVENTS.md.
import { kvSet } from '../db.js'
import { fail } from './util.js'
import * as E from '../events.js'

const EDITABLE = ['draft', 'approved', 'cancelled']
async function view(list) {
  const out = []
  for (const e of list) out.push({ ...e, check: ['draft', 'approved'].includes(e.status) ? await E.check(e, list) : { errors: [], warnings: [] } })
  return out
}

export async function route(name, q, b) {
  const list = await E.eventsGet()
  switch (name) {
    case 'event_state': return {
      ok: true, now: Math.floor(Date.now() / 1000), mode: await E.modeGet(), cost: await E.costPerGb(), maxPercent: E.MAX_PERCENT, gapDays: E.MIN_GAP_DAYS, noticeDays: E.MIN_NOTICE_DAYS,
      types: Object.fromEntries(Object.entries(E.TYPES).map(([k, v]) => [k, v.label])), statuses: E.STATUS_LABEL, products: await E.productsGet(),
      events: (await view(list)).sort((a, c) => (a.startsAt || 9e12) - (c.startsAt || 9e12)),
    }
    case 'event_preview': {
      const e = E.normalize(b.event || {}, list.find((x) => x.id === (b.event || {}).id) || {})
      return { ok: true, ...(await E.check(e, list, { approving: !!b.approve })), impact: await E.impact(e) }
    }
    case 'event_save': {
      const i = list.findIndex((x) => x.id === (b.event || {}).id)
      if (i >= 0 && !EDITABLE.includes(list[i].status)) fail('رویدادی که اجرا شده یا تمام شده را نمی‌شود ویرایش کرد', 409)
      const e = E.normalize(b.event || {}, i >= 0 ? list[i] : {})
      e.status = 'draft'
      if (b.approve) {
        const r = await E.check(e, list, { approving: true })
        if (r.errors.length) fail(r.errors[0], 409, { errors: r.errors })
        e.status = 'approved'
      }
      if (i >= 0) list[i] = e; else list.push(e)
      await E.eventsSet(list)
      return { ok: true, event: e }
    }
    case 'event_status': {
      const e = list.find((x) => x.id === b.id)
      if (!e) fail('رویداد پیدا نشد', 404)
      if (b.status === 'stop') { if (!['running', 'simulated', 'approved'].includes(e.status)) fail('این رویداد در حال اجرا نیست', 409); await E.stopNow(e); if (e.status !== 'ended') e.status = 'ended' }
      else if (b.status === 'cancelled') { if (!['draft', 'approved'].includes(e.status)) fail('فقط پیش‌نویس یا تأییدشده را می‌شود لغو کرد؛ اجراشده را «توقف» کنید', 409); e.status = 'cancelled' }
      else fail('وضعیت نامعتبر', 400)
      await E.eventsSet(list)
      return { ok: true }
    }
    case 'event_delete': {
      const e = list.find((x) => x.id === b.id)
      if (e && !['draft', 'cancelled', 'ended', 'failed'].includes(e.status)) fail('رویداد فعال را حذف نکنید؛ اول توقف یا لغو', 409)
      await E.eventsSet(list.filter((x) => x.id !== b.id))
      return { ok: true }
    }
    case 'event_mode': {
      if (b.mode !== 'sim' && b.mode !== 'live') fail('حالت نامعتبر', 400)
      if (b.mode === 'live' && !b.confirm) fail('تأیید لازم است', 409)
      await kvSet('events:mode', b.mode)
      return { ok: true, mode: b.mode }
    }
    case 'event_posts': {
      const e = list.find((x) => x.id === b.id)
      if (!e) fail('رویداد پیدا نشد', 404)
      return { ok: true, created: await E.makePosts(e) }
    }
  }
  fail('مسیر نامعتبر است', 404)
}
