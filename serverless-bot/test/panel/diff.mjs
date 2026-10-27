// Panel API differential test: dashboard/api.php (PHP + MySQL, over HTTP) against lib/panelapi (SQLite).
//   node --no-warnings --import ../register.mjs diff.mjs <export-dir> [cases-file]   (PHP at PANEL_URL, default http://127.0.0.1:8099/dashboard/api.php)
import { seed } from '../seed.mjs'
import { handle } from '../../tgcloud/lib/panelapi/index.js'
import '../../tgcloud/lib/panelapi/modules.js'

const URL_ = process.env.PANEL_URL || 'http://127.0.0.1:8099/dashboard/api.php'
const USER = process.env.PANEL_USER || 'ptest', PASS = process.env.PANEL_PASS || 'pt-test-1', TG = process.env.PANEL_TG || '99001'
await seed(process.argv[2])

let cookie = '', csrf = ''
async function login() {
  const r = await fetch(URL_ + '?r=login', { method: 'POST', body: JSON.stringify({ username: USER, password: PASS }) })
  cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
  csrf = (await r.json()).csrf
}
await login()
function qs(route, q) {
  const p = new URLSearchParams({ r: route })
  for (const [k, v] of Object.entries(q || {})) {
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'object') for (const [fk, fv] of Object.entries(v)) { if (fv !== '' && fv != null) p.set(`${k}[${fk}]`, String(fv)) }
    else p.set(k, String(v))
  }
  return p
}
async function php(route, q, body) {
  const hasBody = body !== undefined
  const r = await fetch(`${URL_}?${qs(route, q)}`, { method: hasBody ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(hasBody ? { 'X-CSRF-Token': csrf } : {}) }, body: hasBody ? JSON.stringify(body) : undefined })
  let j = null
  try { j = await r.json() } catch { j = { _nonjson: true } }
  return { status: r.status, body: j }
}
const MASK = process.env.PANEL_MASK ? new RegExp(process.env.PANEL_MASK, 'g') : null
function norm(v) {
  if (Array.isArray(v)) return v.map(norm)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v
  return typeof n === 'number' ? String(Math.round(n * 100) / 100) : (MASK ? String(n).replace(MASK, '<M>') : n)
}
let bad = 0, total = 0
export async function compare(name, route, q, body, opts = {}) {
  total++
  const [a, b] = [await php(route, q, body), await handle(route, q, body, TG)]
  let A = norm(a.body), B = norm(b.body)
  if (opts.pick) { A = opts.pick(A); B = opts.pick(B) }
  const sa = JSON.stringify(A), sb = JSON.stringify(B)
  if (a.status !== b.status || sa !== sb) {
    bad++
    console.log(`❌ ${name}  (php ${a.status} / js ${b.status})`)
    let i = 0
    while (i < sa.length && sa[i] === sb[i]) i++
    console.log('   php:', sa.slice(Math.max(0, i - 80), i + 160))
    console.log('   js :', sb.slice(Math.max(0, i - 80), i + 160))
  } else if (process.env.VERBOSE) console.log('✅', name)
}
export const done = () => { console.log(bad ? `❌ ${bad}/${total} differ` : `✅ all ${total} identical`); process.exit(bad ? 1 : 0) }
export { php }

const cases = await import(process.argv[3] || './cases/core.mjs')
await cases.default({ compare, php, handle, TG })
done()
