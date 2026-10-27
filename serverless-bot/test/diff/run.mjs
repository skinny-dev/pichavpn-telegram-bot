// Differential test: the same updates through the PHP bot (real code, MySQL, fake Telegram) and the JS bot
// (test bench, SQLite seeded from the same data); every Bot API call is compared.
//   node --no-warnings --import ../register.mjs run.mjs scenarios/start.mjs [--show]
// Needs (see setup.sh): MySQL with the test seed, `php -S` on 8099 serving PHP_ROOT, tgmock.php on 8136.
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { calls, setNextMessageId } from 'sdk'

const PHP_ROOT = process.env.PHP_ROOT
const LOG = process.env.TGMOCK_LOG || path.resolve('calls.jsonl')
const scenarioFile = process.argv[2]
const show = process.argv.includes('--show')
const { default: scenario } = await import(path.resolve(scenarioFile))

// 1) same starting data on both sides
execSync(`bash ${path.resolve('reset.sh')}`, { stdio: 'inherit' })
for (const q of scenario.sql ?? []) execSync(`mysql --default-character-set=utf8mb4 mirza`, { input: q })
const exportDir = path.join(path.dirname(LOG), 'export')
execSync(`cd ${PHP_ROOT} && php scripts/serverless_export.php --out=${exportDir}`, { stdio: 'ignore' })

// 2) PHP
fs.writeFileSync(LOG, ''); fs.writeFileSync(LOG + '.n', '0')
const key = JSON.parse(fs.readFileSync(path.join(PHP_ROOT, 'storage/serverless.json'), 'utf8')).main_key
const updates = scenario.updates
for (const u of updates) {
  await fetch('http://127.0.0.1:8099/serverless_relay.php', { method: 'POST', headers: { 'X-Picha-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(u) })
  await settle()
}
const phpCalls = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

// 3) JS
const { seed } = await import('../seed.mjs')
await seed(exportDir)
if (scenario.prepareJs) await scenario.prepareJs()
setNextMessageId(5000)
const { handleUpdate } = await import('../../tgcloud/lib/bot.js')
for (const u of updates) await handleUpdate(u)
const jsCalls = calls.splice(0).map(([m, p]) => ({ m: m.toLowerCase(), p }))

// 4) compare
const norm = (c) => JSON.stringify(normalize({ m: c.m, p: c.p }))
// a message sent to every admin: the admins' order is whatever the database returns, so sort such runs by chat_id
function sortFanout(list) {
  const out = [...list]
  const key = (c) => { const { chat_id, ...rest } = c.p || {}; return c.m + JSON.stringify(normalize(rest)) }
  for (let i = 0; i < out.length; ) {
    let j = i + 1
    while (j < out.length && key(out[j]) === key(out[i])) j++
    if (j - i > 1) out.splice(i, j - i, ...out.slice(i, j).sort((a, b) => String(a.p.chat_id).localeCompare(String(b.p.chat_id))))
    i = j
  }
  return out
}
phpCalls.splice(0, phpCalls.length, ...sortFanout(phpCalls))
jsCalls.splice(0, jsCalls.length, ...sortFanout(jsCalls))
let bad = 0
const n = Math.max(phpCalls.length, jsCalls.length)
for (let i = 0; i < n; i++) {
  const a = phpCalls[i] ? norm(phpCalls[i]) : '(none)', b = jsCalls[i] ? norm(jsCalls[i]) : '(none)'
  if (a !== b) {
    bad++
    console.log(`\n✗ call ${i + 1}\n  PHP: ${a.slice(0, 1500)}\n  JS : ${b.slice(0, 1500)}`)
  } else if (show) console.log(`✓ ${a.slice(0, 300)}`)
}
console.log(`\n${scenarioFile}: ${n - bad}/${n} calls identical` + (bad ? ` — ${bad} different` : ' ✅'))
process.exit(bad ? 1 : 0)

async function settle() {
  let last = -1
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 120))
    const s = fs.statSync(LOG).size
    if (s === last) return
    last = s
  }
}
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v).sort()) {
      let x = v[k]
      if (x && typeof x === 'object' && x.bytes && 'name' in x) continue // an uploaded file: PHP's goes in $_FILES, not in the log
      if (x === false) x = '' // PHP posts false as an empty field
      if (x === null || x === undefined || x === '') continue
      if (k === 'parse_mode') x = String(x).toLowerCase()
      o[k] = normalize(x)
    }
    return o
  }
  if (typeof v === 'number' || typeof v === 'boolean') v = String(v === true ? 1 : v === false ? '' : v)
  if (typeof v === 'string') return v.replace(/\b1[789]\d{8}\b/g, '<TS>').replace(/\b[0-9a-f]{12}\b/g, '<HEX>')
    .replace(/[۰-۹]{2}:[۰-۹]{2}:[۰-۹]{2}/g, '<TIME>') // clock times the fake panel derives from "now"
  return v
}
