// Partner routes of the Mini App (partner_*): see lib/partners.js and docs/PARTNER_PROGRAM.md.
import { kvSet, run, sql } from '../db.js'
import { fail } from './util.js'
import * as P from '../partners.js'
import { notifyPartners, noticesGet } from '../partnerhub.js'

export async function route(name, q, b) {
  switch (name) {
    case 'partner_state': return {
      ok: true, now: Math.floor(Date.now() / 1000), mode: await P.modeGet(), tiers: await P.tiersGet(), maxPct: P.MAX_PCT, downgradeMonths: P.DOWNGRADE_AFTER_MONTHS,
      partners: await P.partnersList(), brand: await P.brandSettings(), log: (await P.logGet()).slice(0, 30),
    }
    case 'partner_brand_state': return { ok: true, ...(await P.brandSettings()), allowed: await P.brandAllowed(), tiers: await P.tiersGet() }
    case 'partner_brand_settings': {
      if ('on' in b) await kvSet('partner:brand_on', b.on ? '1' : '0')
      if ('minTier' in b) { const t = (await P.tiersGet()).find((x) => x.id === String(b.minTier)); if (!t) fail('پلهٔ نامعتبر', 400); await kvSet('partner:brand_min', t.id) }
      return { ok: true, ...(await P.brandSettings()) }
    }
    case 'partner_brand': {
      const id = String(b.id)
      if (b.action === 'clear') { await run(sql`UPDATE user SET namecustom = NULL WHERE id = ${id}`); return { ok: true } }
      if (b.action === 'allow' || b.action === 'disallow') { const l = (await P.brandAllowed()).filter((x) => x !== id); if (b.action === 'allow') l.push(id); await kvSet('partner:brand_ok', JSON.stringify(l)); return { ok: true } }
      if (b.action === 'set') { const r = await P.brandSet(id, b.name); if (!r.ok) fail(r.error, 409); return { ok: true, name: r.name } }
      fail('عمل نامعتبر', 400)
      break
    }
    case 'partner_notice_state': return { ok: true, mode: await P.modeGet(), count: (await notifyPartners('', { dry: true })).count, notices: await noticesGet() }
    case 'partner_notice': {
      const text = String(b.text ?? '').trim()
      if (text.length < 5 || text.length > 1500) fail('متن پیام ۵ تا ۱۵۰۰ نویسه باشد', 400)
      if (!b.send) return { ok: true, ...(await notifyPartners(text, { dry: true })) }
      if (!b.confirm) fail('تأیید ارسال لازم است', 409)
      return await notifyPartners(text, { source: 'manual' })
    }
    case 'partner_requests': return { ok: true, requests: await P.requestsList(), welcome_pct: await P.welcomePct() }
    case 'partner_request': {
      if (!['accept', 'reject'].includes(b.decision)) fail('تصمیم نامعتبر', 400)
      const r = await P.requestDecide(String(b.id), b.decision, { type: b.type === 'n2' ? 'n2' : 'n' })
      if (!r.ok) fail(r.error, 404)
      return r
    }
    case 'partner_set': {
      try { await P.partnerSet(String(b.id), { pct: b.pct === undefined || b.pct === '' ? undefined : Number(b.pct), lock: b.lock, level: b.level }) } catch (e) { fail(String(e.message), 409) }
      return { ok: true }
    }
    case 'partner_tiers': {
      try { return { ok: true, tiers: await P.tiersSet(b.tiers) } } catch (e) { fail(String(e.message), 422) }
      break
    }
    case 'partner_mode': {
      if (b.mode !== 'sim' && b.mode !== 'live') fail('حالت نامعتبر', 400)
      if (b.mode === 'live' && !b.confirm) fail('تأیید لازم است', 409)
      await kvSet('partners:mode', b.mode)
      return { ok: true, mode: b.mode }
    }
    case 'partner_run': {
      if (!b.dry && (await P.modeGet()) !== 'live') fail('اجرای واقعی فقط در حالت زنده ممکن است؛ «پیش‌نمایش» را بزنید', 409)
      return { ok: true, ...(await P.partnersRun({ dry: !!b.dry })) }
    }
  }
  fail('مسیر نامعتبر است', 404)
}
