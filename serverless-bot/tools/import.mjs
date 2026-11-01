// Import the PHP bot's export (php scripts/serverless_export.php) into the Serverless bot's database.
//   cd serverless-bot && node tools/import.mjs /root/picha-export            # all tables (each emptied first)
//   node tools/import.mjs /root/picha-export user invoice                    # only these
// Uses `npx tgcloud run` (your CLI login), in batches.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = process.argv[2]
// --hot: what changes all day (the last copy, in the short stop); --cold: everything else (can be copied days before)
const HOT = ['user', 'invoice', 'Payment_report', 'service_other', 'support_message', 'expenses', 'capital_entries', 'Giftcodeconsumed', 'DiscountSell', 'cancel_service', 'reagent_report', 'Requestagent', 'sms_inbox',
  'referral_links', 'referral_signups', 'referral_payouts', 'affiliates', 'fin_accounts', 'fin_alloc', 'fin_assets', 'fin_audit', 'fin_docs', 'fin_journal', 'fin_journal_lines', 'fin_loans', 'fin_ownership', 'fin_parties', 'fin_settings', 'fin_taxes', 'fin_txn', 'kv']
const flag = process.argv.includes('--hot') ? 'hot' : process.argv.includes('--cold') ? 'cold' : ''
const only0 = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const only = flag === 'hot' ? HOT : only0
if (!dir || !fs.existsSync(dir)) { console.error('usage: node tools/import.mjs EXPORT_DIR [--cold | --hot | table…]'); process.exit(1) }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson')).filter((f) => { const t = f.replace('.ndjson', ''); return flag === 'cold' ? !HOT.includes(t) : !only.length || only.includes(t) })
const MAX = Number(process.env.IMPORT_MAX || 20_000) // bytes of rows per call (command-line limit; small = each call stays well inside the run-time limit)
const MAX_ROWS = 40
let total = 0
for (const f of files) {
  const table = f.replace('.ndjson', '')
  const rows = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  let batch = [], size = 0, first = true, done = 0
  const flush = () => {
    if (!batch.length && !first) return
    const args = JSON.stringify({ table, rows: batch, wipe: first })
    let r
    for (let attempt = 1; attempt <= 4; attempt++) { // a slow call is simply tried again (rows are REPLACEd, so a repeat is harmless)
      r = spawnSync('npx', ['tgcloud', 'run', 'endpoints/admin_import', args], { encoding: 'utf8' })
      if (r.status === 0 && /imported/.test(r.stdout)) break
      if (attempt === 4) { console.error(`\n❌ ${table} (${done}/${rows.length}):`, ((r.stderr || '') + (r.stdout || '')).slice(-800)); process.exit(1) }
      spawnSync('sleep', [String(attempt * 2)])
    }
    done += batch.length; batch = []; size = 0; first = false
    process.stdout.write(`\r${table}: ${done}/${rows.length}   `)
  }
  for (const row of rows) {
    const s = JSON.stringify(row).length
    if ((size + s > MAX || batch.length >= MAX_ROWS) && batch.length) flush()
    batch.push(row); size += s
  }
  flush()
  total += done
  console.log(`\r✅ ${table}: ${done}            `)
}
console.log(`\nجمع: ${total} ردیف`)
