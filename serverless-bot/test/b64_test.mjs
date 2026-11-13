// node --no-warnings --import ./register.mjs b64_test.mjs — base64/UTF-8 helpers equal the platform ones, and work when atob/btoa/TextDecoder are missing
import { bytesToB64, b64ToBytes, atobSafe, btoaSafe, utf8Decode } from '../tgcloud/lib/b64.js'
let fail = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++ }
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
let allOk = true
for (let n = 0; n < 60; n++) { const a = Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256)); if (bytesToB64(a) !== Buffer.from(a).toString('base64') || !same(b64ToBytes(Buffer.from(a).toString('base64')), a)) allOk = false }
ok(allOk, 'encode/decode equal Buffer for lengths 0..59')
const fa = 'سلام دنیا ۱۲۳ 🍉 pichavpn'
ok(utf8Decode(new TextEncoder().encode(fa)) === fa, 'utf8Decode round-trips Persian + emoji')
ok(b64ToBytes('  aGVs\nbG8= ').length === 5, 'whitespace ignored')
let e; try { b64ToBytes('a$b') } catch (x) { e = x }
ok(!!e, 'invalid base64 throws')
const sv = { atob: globalThis.atob, btoa: globalThis.btoa, TextDecoder: globalThis.TextDecoder }
globalThis.atob = undefined; globalThis.btoa = undefined; globalThis.TextDecoder = undefined
ok(btoaSafe('hello') === 'aGVsbG8=' && atobSafe('aGVsbG8=') === 'hello', 'btoaSafe/atobSafe work without the globals')
ok(utf8Decode(new TextEncoder().encode(fa)) === fa, 'utf8Decode works without TextDecoder')
ok(utf8Decode(Uint8Array.from([0xff, 0x41])) === '�A', 'invalid UTF-8 → U+FFFD')
Object.assign(globalThis, sv)
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
