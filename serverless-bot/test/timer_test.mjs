// node --no-warnings --import ./register.mjs timer_test.mjs   — the isolate may have no timers: nothing may throw because of that
import { sleep, withTimeout, abortAfter, hasTimers } from '../tgcloud/lib/timer.js'
let fail = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++ }
ok(hasTimers(), 'timers present here')
ok((await withTimeout(Promise.resolve(7), 1000)) === 7, 'withTimeout passes a fast result')
let e; try { await withTimeout(new Promise(() => {}), 30) } catch (x) { e = x }
ok(e?.message === 'timeout', 'withTimeout times out a stuck call')
const saved = globalThis.setTimeout
globalThis.setTimeout = undefined // the isolate
ok(!hasTimers(), 'simulated: no timers')
ok((await sleep(5000)) === undefined, 'sleep returns at once without timers (no ReferenceError)')
ok((await withTimeout(Promise.resolve('x'), 10)) === 'x', 'withTimeout falls back to the plain promise')
globalThis.setTimeout = saved
ok(typeof abortAfter(100) === 'object', 'abortAfter returns an options object')
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
