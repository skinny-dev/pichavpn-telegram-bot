// Load an export folder (php scripts/serverless_export.php) into the local test database — the same rows the import puts in.
import fs from 'node:fs'
import path from 'node:path'
import * as schema from '../tgcloud/schema.js'
import { migrate } from 'sdk/db'
import handler from '../tgcloud/endpoints/admin_import.js'

export async function seed(dir) {
  migrate(schema)
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson'))) {
    const rows = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    await handler({ table: f.replace('.ndjson', ''), rows, wipe: true }, {})
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await seed(process.argv[2])
  const { db } = await import('sdk')
  const { sql } = await import('sdk/db')
  for (const t of ['user', 'invoice', 'product', 'texts', 'marzban_panel']) console.log(t, (await db.get(sql`${sql.raw(`SELECT count(*) AS n FROM "${t}"`)}`)).n)
  try { await handler({ table: 'user', rows: [] }, { initData: { user: { id: 1 } } }); console.log('❌ mini app call allowed') } catch (e) { console.log('✅ mini app call refused:', e.message) }
}
