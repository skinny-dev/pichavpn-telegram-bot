// Import the PHP bot's export (php scripts/serverless_export.php) into the Serverless bot's database.
//   cd serverless-bot && node tools/import.mjs /root/picha-export            # all tables (each emptied first)
//   node tools/import.mjs /root/picha-export user invoice                    # only these
//   One big table in parallel (the fastest way to copy `user`):
//     node tools/import.mjs DIR user --wipe-only                      # empties the table once
//     for k in 0 1 2 3 4 5; do node tools/import.mjs DIR user --nowipe --slice=$k/6 & done; wait
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
const WIPE_ONLY = process.argv.includes('--wipe-only')
const NOWIPE = process.argv.includes('--nowipe') || process.argv.some((a) => a.startsWith('--slice='))
const sliceArg = (process.argv.find((a) => a.startsWith('--slice=')) || '').slice(8).split('/').map(Number) // k/n: this process copies every n-th row, starting at k
const SLICE = sliceArg.length === 2 && sliceArg[1] > 0 && sliceArg[0] >= 0 && sliceArg[0] < sliceArg[1] ? sliceArg : null
const only = flag === 'hot' ? HOT : only0
if (!dir || !fs.existsSync(dir)) { console.error('usage: node tools/import.mjs EXPORT_DIR [--cold | --hot | table…]'); process.exit(1) }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson')).filter((f) => { const t = f.replace('.ndjson', ''); return flag === 'cold' ? !HOT.includes(t) : !only.length || only.includes(t) })
const MAX = Number(process.env.IMPORT_MAX || 60_000) // bytes of rows per call (command-line limit; small = each call stays well inside the run-time limit)
const MAX_ROWS = Number(process.env.IMPORT_ROWS || 120)
let total = 0
for (const f of files) {
  const table = f.replace('.ndjson', '')
  let rows = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  if (SLICE) rows = rows.filter((_, i) => i % SLICE[1] === SLICE[0])
  if (WIPE_ONLY) rows = []
  let batch = [], size = 0, first = !NOWIPE, done = 0
  const flush = () => {
    if (!batch.length && !first) return
    const args = JSON.stringify({ table, rows: batch, wipe: first })
    let r
    for (let attempt = 1; attempt <= 10; attempt++) { // a slow call is simply tried again (rows are REPLACEd, so a repeat is harmless)
      r = spawnSync('npx', ['tgcloud', 'run', 'endpoints/admin_import', args], { encoding: 'utf8' })
      if (r.status === 0 && /imported/.test(r.stdout)) break
      if (attempt === 10) { const msg = ((r.stderr || '') + '\n' + (r.stdout || '')).split('\n').filter((l) => !l.startsWith('> admin_import(')).join('\n').trim() // the echoed call holds customer rows: never print it
      console.error(`\n❌ ${table} (${done}/${rows.length}): ${msg.slice(0, 600) || '(no message)'}`); process.exit(1) }
      const m = /retry after (\d+)/.exec((r.stderr || '') + (r.stdout || '')) // the platform limits calls per second: wait as long as it says
      spawnSync('sleep', [String(Math.max(attempt * 2, m ? Number(m[1]) + 1 : 0))])
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
