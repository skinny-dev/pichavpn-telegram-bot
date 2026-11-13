// Change ONE panel's address from the CLI only (`npx tgcloud run endpoints/admin_panel_url '{"name":"…","url":"https://panel.example.com"}'`).
// The Serverless platform lets `fetch` use only the standard ports (80/443), so a panel on :8000 etc. must be reached through a 443 address.
// Only https on the default port is accepted; credentials and everything else in the row stay as they are.
import { EndpointError } from 'sdk'
import { one, run, sql } from '../lib/db.js'

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const { name, url } = input || {}
  if (!name || !url) throw new EndpointError('name and url are required', { code: 'ARGS' })
  let u
  try { u = new URL(String(url)) } catch { throw new EndpointError('not a valid URL', { code: 'URL' }) }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) throw new EndpointError('only https on the default port (443), no credentials in the URL', { code: 'URL' })
  const clean = u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, ''))
  const row = await one(sql`SELECT name_panel, url_panel FROM marzban_panel WHERE name_panel = ${String(name)}`)
  if (!row) throw new EndpointError('no panel with that name', { code: 'PANEL' })
  await run(sql`UPDATE marzban_panel SET url_panel = ${clean} WHERE name_panel = ${String(name)}`)
  return { panel: row.name_panel, was_port: (String(row.url_panel).match(/:(\d+)(\/|$)/) || [])[1] ?? 'none', now: clean }
}
