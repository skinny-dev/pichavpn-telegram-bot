// Is the bot recording? (CLI only)  npx tgcloud run endpoints/admin_activity '{}'
// Counts only — per day for the last 8 days (Tehran): new users, invoices, payment reports by status. No names, ids or amounts of people.
import { EndpointError } from 'sdk'
import { all, one, sql, kvGet } from '../lib/db.js'

const p2 = (n) => String(n).padStart(2, '0')
const tehranDay = (t) => { const d = new Date((t + 12600) * 1000); return `${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}` }
const tehranStamp = (t) => { const d = new Date((t + 12600) * 1000); return `${tehranDay(t)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` }

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const now = Math.floor(Date.now() / 1000)
  const days = Array.from({ length: 8 }, (_, i) => tehranDay(now - i * 86400))
  const out = { now_tehran: tehranStamp(now), mode: await kvGet('config:mode'), days: {} }
  for (const d of days) out.days[d] = { users: 0, invoices: 0, payments: {} }
  const since = now - 9 * 86400
  for (const r of await all(sql`SELECT CAST(register AS INTEGER) AS t FROM user WHERE CAST(register AS INTEGER) > ${since}`)) { const k = tehranDay(r.t); if (out.days[k]) out.days[k].users++ }
  for (const r of await all(sql`SELECT CAST(time_sell AS INTEGER) AS t FROM invoice WHERE CAST(time_sell AS INTEGER) > ${since}`)) { const k = tehranDay(r.t); if (out.days[k]) out.days[k].invoices++ }
  for (const r of await all(sql`SELECT substr(time, 1, 10) AS d, payment_Status AS s, COUNT(*) AS n FROM Payment_report WHERE substr(time, 1, 10) >= ${days[days.length - 1]} GROUP BY 1, 2`)) { if (out.days[r.d]) out.days[r.d].payments[r.s || '?'] = r.n }
  const last = async (q) => { const t = Number((await one(q))?.t ?? 0); return t ? tehranStamp(t) : null }
  out.last = {
    user: await last(sql`SELECT MAX(CAST(register AS INTEGER)) AS t FROM user`),
    invoice: await last(sql`SELECT MAX(CAST(time_sell AS INTEGER)) AS t FROM invoice`),
    last_message_from_any_user: await last(sql`SELECT MAX(CAST(last_message_time AS INTEGER)) AS t FROM user`),
  }
  out.cron = {}
  for (const k of ['relay', 'notifications', 'care', 'pulse', 'studio']) { const v = Number(await kvGet('cron:' + k)); out.cron[k] = v ? tehranStamp(v) : null }
  return out
}
