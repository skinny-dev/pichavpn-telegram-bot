// node --no-warnings --import ./register.mjs hash_test.mjs — the pure SHA-256/SHA-1/HMAC equal node:crypto, and work without crypto.subtle
import crypto from 'node:crypto'
import { sha256Hex, sha1Hex, hmacSha256Hex } from '../tgcloud/lib/hash.js'
let fail = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++ }
const cases = ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(200), 'سلام دنیا 🍉 {"event":"payment.paid","slug":"abc","amount":60000}']
const savedC = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
const run = async (label) => {
  let all = true
  for (const c of cases) {
    if ((await sha256Hex(c)) !== crypto.createHash('sha256').update(c).digest('hex')) all = false
    if ((await sha1Hex(c)) !== crypto.createHash('sha1').update(c).digest('hex')) all = false
    for (const k of ['k', 'secret-key', 'K'.repeat(64), 'K'.repeat(100)]) if ((await hmacSha256Hex(k, c)) !== crypto.createHmac('sha256', k).update(c).digest('hex')) all = false
  }
  ok(all, label)
}
await run('with crypto.subtle: all equal node:crypto')
Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
await run('WITHOUT crypto.subtle (pure code): all equal node:crypto')
if (savedC) Object.defineProperty(globalThis, 'crypto', savedC)
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
