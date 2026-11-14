// The server catalog from the panels (CLI only):  npx tgcloud run endpoints/admin_servers '{"sync":true}'
// Prints names / country / kind only — never addresses, ports' hosts, keys or user ids.
import { EndpointError } from 'sdk'
import { syncHosts, catalogGet, rankFor, USE_SERVICES } from '../lib/servers.js'

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const synced = input?.sync ? await syncHosts() : null
  const cat = await catalogGet()
  const best = {}
  for (const u of Object.keys(USE_SERVICES)) best[u] = (await rankFor(u)).slice(0, 3).map((x) => `${x.name} ${x.score}`)
  return { synced, servers: cat.map((s) => ({ name: s.name, country: s.country, kind: s.kind, security: s.security })), best }
}
