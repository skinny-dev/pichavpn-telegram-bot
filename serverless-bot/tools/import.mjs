// Import the PHP bot's export (php scripts/serverless_export.php) into the Serverless bot's database.
//   cd serverless-bot && node tools/import.mjs /root/picha-export            # all tables (each emptied first)
//   node tools/import.mjs /root/picha-export user invoice                    # only these
// Uses `npx tgcloud run` (your CLI login), in batches.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = process.argv[2]
const only = process.argv.slice(3)
if (!dir || !fs.existsSync(dir)) { console.error('usage: node tools/import.mjs EXPORT_DIR [table…]'); process.exit(1) }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson')).filter((f) => !only.length || only.includes(f.replace('.ndjson', '')))
const MAX = 60_000 // bytes of rows per call (command-line limit)
let total = 0
for (const f of files) {
  const table = f.replace('.ndjson', '')
  const rows = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  let batch = [], size = 0, first = true, done = 0
  const flush = () => {
    if (!batch.length && !first) return
    const args = JSON.stringify({ table, rows: batch, wipe: first })
    const r = spawnSync('npx', ['tgcloud', 'run', 'endpoints/admin_import', args], { encoding: 'utf8' })
    if (r.status !== 0 || !/imported/.test(r.stdout)) { console.error(`❌ ${table}:`, (r.stderr || r.stdout).slice(-800)); process.exit(1) }
    done += batch.length; batch = []; size = 0; first = false
    process.stdout.write(`\r${table}: ${done}/${rows.length}   `)
  }
  for (const row of rows) {
    const s = JSON.stringify(row).length
    if (size + s > MAX && batch.length) flush()
    batch.push(row); size += s
  }
  flush()
  total += done
  console.log(`\r✅ ${table}: ${done}            `)
}
console.log(`\nجمع: ${total} ردیف`)
