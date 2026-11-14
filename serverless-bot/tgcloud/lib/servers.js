// The server catalog and the «best server for what» choice, made by the system:
//   hosts   ← the PasarGuard host list of every active panel (no hostnames are stored — only remark, port, security)
//   probes  ← exit servers report which services they can reach (tools/probe_exit.sh → relay /probe → here)
//   feedback← customers say whether a recommended server worked (fit.js buttons)
// kv: servers:catalog [{id, name, country, kind, security, port, panel}] · servers:probe:<CC> {at, results, node} · servers:fb:<use>:<CC>-<kind>:ok|bad
import { one, all, sql, kvGet, kvSet } from './db.js'
import { getHosts } from './panel.js'
import { intval } from './php.js'

const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const now = () => Math.floor(Date.now() / 1000)

/** what each use needs to reach */
export const USE_SERVICES = {
  ai: ['claude', 'chatgpt'], yt: ['youtube'], ig: ['instagram'], msg: ['telegram'],
  work: ['google', 'github'], game: ['google'], stream: ['youtube', 'netflix'], other: ['google'],
}

/** «🇩🇪 🇮🇷 تونل آلمان» → {country: 'DE', kind: 'tunnel', name: 'تونل آلمان'};  «🇩🇪 ☁️ آلمان» → direct;  information entries (✅ ⌛ ∞ 📊) → null */
export function parseRemark(remark) {
  const r = String(remark ?? '')
  if (/[⌛📊∞✅]/u.test(r) && !/[\u{1F1E6}-\u{1F1FF}]{2}/u.test(r)) return null
  if (/⌛|📊/u.test(r)) return null
  const flags = [...r.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)].map((m) => [...m[0]].map((ch) => String.fromCharCode(ch.codePointAt(0) - 0x1F1E6 + 65)).join(''))
  const hasIran = flags.includes('IR')
  const exits = flags.filter((f) => f !== 'IR')
  if (!exits.length) return null
  const name = r.replace(/[\u{1F1E6}-\u{1F1FF}]{2}|☁️|☁|[\u{1F300}-\u{1FAFF}☀-➿]|️/gu, ' ').replace(/\s+/g, ' ').trim()
  return { country: exits[0], kind: hasIran ? 'tunnel' : 'direct', name: name || exits[0] }
}

/** pull the host lists of every active panel into the catalog */
export async function syncHosts() {
  const panels = await all(sql`SELECT name_panel, status FROM marzban_panel WHERE status = 'active'`)
  const catalog = []
  for (const p of panels) {
    let hosts = []
    try { hosts = await getHosts(p.name_panel) } catch { hosts = [] }
    for (const h of hosts) {
      const info = parseRemark(h.remark)
      if (!info) continue
      if (h.is_disabled === true || h.status === 'disabled') continue
      catalog.push({ id: h.id ?? null, ...info, security: String(h.security ?? 'default'), port: intval(h.port ?? 0), panel: p.name_panel })
    }
  }
  if (catalog.length) { await kvSet('servers:catalog', JSON.stringify(catalog)); await kvSet('servers:synced', String(now())) }
  return catalog.length
}
export const catalogGet = async () => parse(await kvGet('servers:catalog')) || []

/** a probe report from an exit server (relay event) */
export async function storeProbe(body) {
  const d = typeof body === 'string' ? parse(body) : body
  if (!d || !/^[A-Z]{2}$/.test(d.country ?? '') || typeof d.results !== 'object') return false
  await kvSet('servers:probe:' + d.country, JSON.stringify({ at: now(), results: d.results, node: d.node ?? '' }))
  return true
}

export async function recordFeedback(use, country, kind, ok) {
  const k = `servers:fb:${use}:${country}-${kind}:${ok ? 'ok' : 'bad'}`
  await kvSet(k, String(intval(await kvGet(k)) + 1))
}

/** ranked servers for a use: [{name, country, kind, score, why[]}] — empty when nothing is known yet */
export async function rankFor(use, at = now()) {
  const need = USE_SERVICES[use] || USE_SERVICES.other
  const cat = await catalogGet()
  const out = []
  for (const s of cat) {
    let score = 0
    const why = []
    const pr = parse(await kvGet('servers:probe:' + s.country))
    if (pr) {
      const stale = at - intval(pr.at) > 3 * 86400
      const res = need.map((svc) => pr.results?.[svc])
      const ok = res.filter((v) => v === 'ok').length
      const blocked = res.filter((v) => v === 'blocked' || v === 'down').length
      const part = need.length ? (ok / need.length) * 50 - blocked * 30 : 0
      score += stale ? part * 0.5 : part
      why.push(`آزمون خودکار ${ok}/${need.length}${stale ? ' (قدیمی)' : ''}`)
    }
    const fok = intval(await kvGet(`servers:fb:${use}:${s.country}-${s.kind}:ok`)), fbad = intval(await kvGet(`servers:fb:${use}:${s.country}-${s.kind}:bad`))
    // centred: all «worked» votes add up to about +40, all «did not» subtract up to about 40
    if (fok + fbad > 0) { score += (((fok + 1) / (fok + fbad + 2)) - 0.5) * 80; why.push(`نظر کاربران ${fok} خوب / ${fbad} بد`) }
    if (s.security === 'none') { score -= 40; why.push('بدون رمزگذاری') }
    if (!pr && fok + fbad === 0) continue // nothing known about this one: it is not recommended
    out.push({ name: s.name, country: s.country, kind: s.kind, score: Math.round(score), why })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** the text for a customer: the best two, or null when nothing is known (the caller falls back to the manual /fit text or to support) */
export async function recommendText(use) {
  const r = (await rankFor(use)).filter((x) => x.score > 0).slice(0, 2)
  if (!r.length) return null
  const at = intval(await kvGet('servers:synced'))
  return `پیشنهاد سیستم: «${r[0].name}»${r[1] ? ` و بعد «${r[1].name}»` : ''}.\nاین پیشنهاد از آزمون خودکار سرورها و نظر کاربران ساخته شده و ممکن است روی هر اپراتور فرق کند.`
}
