// promo_lib.php (the part that changes products) + dashboard/promo_api.php. The state lives in kv 'storage:promo.json'.
import { qAll, qRun } from './qb.js'
import { kvGet, kvSet, kvDel } from '../db.js'
import { promoState, promoNum } from '../catalog.js'
import { PanelError, fail, now, latinDigits, str } from './util.js'

export function promoPrice(price, pct, step = 1000, mode = 'down') {
  step = Math.max(1, step)
  const q = (price * (100 - pct)) / 100 / step
  const n = mode === 'up' ? Math.ceil(q) : mode === 'nearest' ? Math.sign(q) * Math.round(Math.abs(q)) : Math.floor(q)
  return Math.trunc(Math.max(step, n * step))
}

export async function promoBuild(productIds, type, value, roundStep = 1000, roundMode = 'down') {
  const ids = [...new Set((productIds || []).map((x) => parseInt(x) || 0))]
  if (!ids.length || value <= 0 || !['percent', 'bonus_gb'].includes(type) || (type === 'percent' && value >= 100)) return []
  const rows = await qAll(`SELECT id, name_product, price_product, Volume_constraint, agent, category FROM product WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY CAST(Volume_constraint AS REAL), id`, ids)
  const out = []
  for (const p of rows) {
    const price = parseInt(p.price_product) || 0
    const gb = parseFloat(p.Volume_constraint) || 0
    const it = { id: Number(p.id), name: str(p.name_product), category: str(p.category), agent: str(p.agent) || 'f', old_price: price, new_price: price, old_gb: gb, new_gb: gb }
    if (type === 'percent') {
      if (price <= 0) continue
      it.new_price = promoPrice(price, value, roundStep, roundMode)
      if (it.new_price >= price) continue
    } else {
      if (gb <= 0) continue
      it.new_gb = gb + value
    }
    out.push(it)
  }
  return out
}

export async function promoStart(items, type, value, endsAt, title) {
  if (await promoState()) throw new PanelError('یک تخفیف در حال اجراست؛ اول آن را تمام کنید', 409)
  if (!items.length) throw new PanelError('هیچ محصولی انتخاب نشده یا تخفیف روی محصولات انتخابی اثری ندارد', 409)
  if (endsAt <= now()) throw new PanelError('زمان پایان باید در آینده باشد', 409)
  await kvSet('storage:promo.json', JSON.stringify({ title, type, value, started_at: now(), ends_at: endsAt, items }))
  for (const it of items) await qRun('UPDATE product SET price_product = ?, Volume_constraint = ? WHERE id = ?', [String(it.new_price), promoNum(it.new_gb), it.id])
  return items
}

/** puts the original values back: [restored, names left alone because an admin changed them meanwhile] */
export async function promoEnd() {
  const s = await promoState()
  if (!s) return [0, []]
  let restored = 0
  const skipped = []
  for (const it of s.items) {
    const r = await qRun('UPDATE product SET price_product = ?, Volume_constraint = ? WHERE id = ? AND CAST(price_product AS INTEGER) = ? AND CAST(Volume_constraint AS REAL) = ?', [String(it.old_price), promoNum(it.old_gb), it.id, Number(it.new_price), Number(it.new_gb)])
    if (Number(r.rowsAffected ?? 0)) restored++
    else skipped.push(it.name)
  }
  await kvDel('storage:promo.json')
  return [restored, skipped]
}

/** on every update: an expired promotion is ended (one kv read when none runs) */
export async function promoAutoEnd() {
  if (!(await kvGet('storage:promo.json'))) return
  const s = await promoState()
  if (s && now() >= (parseInt(s.ends_at) || 0)) await promoEnd()
}

// ---------------------------------------------------------------- panel routes
async function products() {
  const rows = await qAll('SELECT id, name_product, category, Volume_constraint, Service_time, price_product, agent, status_product FROM product ORDER BY category, CAST(Volume_constraint AS REAL), id', [])
  return rows.map((p) => ({ id: Number(p.id), name: str(p.name_product), category: str(p.category) || 'بدون دسته', gb: parseFloat(p.Volume_constraint) || 0, days: parseInt(p.Service_time) || 0, price: parseInt(p.price_product) || 0, agent: str(p.agent) || 'f', active: (str(p.status_product) || 'active') === 'active' }))
}

async function items(b) {
  const round = parseInt(b.round ?? 1000)
  if (![1, 1000, 5000, 10000, 50000].includes(round)) fail('رند کردن نامعتبر است', 422)
  const mode = ['down', 'nearest', 'up'].includes(b.round_mode ?? 'down') ? (b.round_mode ?? 'down') : 'down'
  const type = b.type === 'bonus_gb' ? 'bonus_gb' : 'percent'
  const value = parseFloat(latinDigits(str(b.value ?? 0)).replace(/[٫/]/g, '.')) || 0
  if (value <= 0 || (type === 'percent' && value >= 90)) fail(type === 'percent' ? 'درصد تخفیف باید بین ۱ تا ۸۹ باشد' : 'مقدار گیگ هدیه نامعتبر است', 422)
  return [await promoBuild(Array.isArray(b.ids) ? b.ids : [], type, value, round, mode), type, value]
}

export async function route(r, q, b) {
  const bot = str(await kvGet('config:usernamebot')).replace(/^@+/, '')
  switch (r) {
    case 'promo_state': {
      const s = await promoState()
      return { ok: true, products: await products(), active: s && now() < (parseInt(s.ends_at) || 0) ? s : null, bot }
    }
    case 'promo_preview': { const [its] = await items(b); return { ok: true, items: its } }
    case 'promo_start': {
      const [its, type, value] = await items(b)
      const hours = parseInt(b.hours ?? 0) || 0
      if (hours < 1 || hours > 24 * 31) fail('مدت تخفیف باید بین ۱ ساعت تا ۳۱ روز باشد', 422)
      await promoAutoEnd()
      await promoStart(its, type, value, now() + hours * 3600, [...str(b.title ?? 'تخفیف ویژه').trim()].slice(0, 80).join('') || 'تخفیف ویژه')
      return { ok: true, active: await promoState() }
    }
    case 'promo_end': { const [n, skipped] = await promoEnd(); return { ok: true, restored: n, skipped } }
  }
  fail('مسیر پیدا نشد', 404)
}
