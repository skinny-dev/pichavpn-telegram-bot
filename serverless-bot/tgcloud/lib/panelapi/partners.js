// Partner routes of the Mini App (partner_*): see lib/partners.js and docs/PARTNER_PROGRAM.md.
import { kvSet } from '../db.js'
import { fail } from './util.js'
import * as P from '../partners.js'

export async function route(name, q, b) {
  switch (name) {
    case 'partner_state': return {
      ok: true, now: Math.floor(Date.now() / 1000), mode: await P.modeGet(), tiers: await P.tiersGet(), maxPct: P.MAX_PCT, downgradeMonths: P.DOWNGRADE_AFTER_MONTHS,
      partners: await P.partnersList(), log: (await P.logGet()).slice(0, 30),
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
