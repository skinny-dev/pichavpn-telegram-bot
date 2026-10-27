// Data import from the PHP bot (tools/import.mjs). Only from the CLI: `npx tgcloud run endpoints/admin_import …`
// has no Mini App init data, a call from a Mini App always has it — so a Mini App can never reach this.
import { EndpointError } from 'sdk'
import { insert, run, sql, TABLES } from '../lib/db.js'

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const { table, rows, wipe } = input || {}
  if (!TABLES[table]) throw new EndpointError('unknown table: ' + table, { code: 'TABLE' })
  if (wipe) await run(sql`${sql.raw(`DELETE FROM "${table}"`)}`)
  let n = 0
  for (const r of rows || []) {
    await insert(table, r, 'REPLACE')
    n++
  }
  return { table, imported: n }
}
