// Diagnostics from the CLI only (`npx tgcloud run endpoints/admin_diag '{}'`): how fast is the database from here, can this cloud reach
// the VPN panels, what is the cron state. Prints panel HOSTS only (never usernames, passwords or tokens).
import { EndpointError, fetch } from 'sdk'
import { one, all, sql, kvGet } from '../lib/db.js'

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const t0 = Date.now()
  const out = { db_ms: {}, panels: [], cron: {} }
  const q = async (label, f) => { const s = Date.now(); try { await f() ; out.db_ms[label] = Date.now() - s } catch (e) { out.db_ms[label] = 'ERR ' + String(e?.message ?? e).slice(0, 80) } }
  await q('one_query', () => one(sql`SELECT 1 AS x`))
  await q('ten_queries_in_a_row', async () => { for (let i = 0; i < 10; i++) await one(sql`SELECT 1 AS x`) })
  await q('count_user', () => one(sql`SELECT COUNT(*) AS n FROM user`))
  await q('all_products', () => all(sql`SELECT * FROM product`))
  await q('all_texts', () => all(sql`SELECT * FROM texts`))
  let panels = []
  try { panels = await all(sql`SELECT name_panel, status, url_panel FROM marzban_panel`) } catch (e) { out.panels_error = String(e?.message ?? e).slice(0, 80) }
  for (const p of panels) {
    let host = '?'
    try { host = new URL(p.url_panel).host } catch { /* keep ? */ }
    const s = Date.now()
    let result
    try {
      const opt = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(8000) } : {}
      const res = await fetch(String(p.url_panel).replace(/\/+$/, '') + '/api/system', { method: 'GET', ...opt })
      result = 'reachable: HTTP ' + res.status // any HTTP answer (even 401/404) means the network path works
    } catch (e) { result = 'NOT reachable: ' + String(e?.message ?? e).slice(0, 80) }
    out.panels.push({ name: p.name_panel, status: p.status, host, result, ms: Date.now() - s })
  }
  for (const k of ['lock', 'payment_expire', 'tetraminator', 'relay', 'notifications', 'statusday', 'on_hold', 'alert_balance']) {
    try { out.cron[k] = (await kvGet('cron:' + k)) ?? null } catch { out.cron[k] = 'ERR' }
  }
  try { out.mode = await kvGet('config:mode') } catch { out.mode = 'ERR' }
  out.total_ms = Date.now() - t0
  return out
}
