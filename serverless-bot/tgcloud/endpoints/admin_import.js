// Data import from the PHP bot (tools/import.mjs). Only from the CLI: `npx tgcloud run endpoints/admin_import …`
// has no Mini App init data, a call from a Mini App always has it — so a Mini App can never reach this.
import { EndpointError } from 'sdk'
import { insert, run, sql, TABLES } from '../lib/db.js'

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const { table, rows, wipe } = input || {}
  if (!TABLES[table]) throw new EndpointError('unknown table: ' + table, { code: 'TABLE' })
  // kv also holds what only this bot knows (the mode, the payment relay, cron times, the panel address): an import adds and updates, never wipes those
  const own = /^(config:(mode|pay_relay_url|pay_relay_key|panel_url)|relay:|cron:|broadcast:|log:)/
  if (wipe && table !== 'kv') await run(sql`${sql.raw(`DELETE FROM "${table}"`)}`)
  let n = 0
  for (const r of rows || []) {
    if (table === 'kv' && own.test(String(r.key ?? ''))) continue
    await insert(table, r, 'REPLACE')
    n++
  }
  return { table, imported: n }
}
