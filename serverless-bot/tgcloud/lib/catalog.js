// Product / category / duration keyboards (keyboard.php), product order (sortProductRows), promotions
// (promo_lib.php), custom-service price (custom_price.php) and savedata() — the same results as the PHP bot.
import { one, all, run, sql, kvGet } from './db.js'
import { catalogLabel, emojiConfig } from './emoji.js'
import { numberFormat, intval, J, time } from './php.js'
import { phpRound } from './fmt.js'
import { shop } from './bot.js'

const num = (v) => (v !== null && v !== '' && !Number.isNaN(Number(v)) && String(v).trim() !== '' ? Number(v) : 0)
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

// ---------------------------------------------------------------- savedata
/** savedata("clear" | "save", field, value) on user.Processing_value (a JSON object) */
export async function savedata(c, type, field, value) {
  let data = {}
  if (type === 'save') {
    const u = await one(sql`SELECT Processing_value FROM user WHERE id = ${c.from_id}`)
    const d = parse(String(u?.Processing_value ?? ''))
    data = d && typeof d === 'object' && !Array.isArray(d) ? d : {}
  }
  data[field] = value
  const s = JSON.stringify(data)
  await run(sql`UPDATE user SET Processing_value = ${s} WHERE id = ${c.from_id}`)
  if (c.user) c.user.Processing_value = s
}
export function userData(c) {
  const d = parse(String(c.user?.Processing_value ?? ''))
  return d && typeof d === 'object' ? d : {}
}

// ---------------------------------------------------------------- product order
const SORT_MODES = ['volume_asc', 'volume_desc', 'price_asc', 'price_desc', 'manual']
export async function productSortMode() {
  const v = await shop('product_sort')
  return SORT_MODES.includes(v) ? v : 'volume_asc'
}
const cmpArr = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1 } return 0 }
export async function sortProductRows(rows, mode = null) {
  mode = mode ?? (await productSortMode())
  const vol = (r) => (num(r.Volume_constraint) > 0 ? num(r.Volume_constraint) : Infinity)
  const days = (r) => (num(r.Service_time) > 0 ? num(r.Service_time) : Infinity)
  const price = (r) => num(r.price_product)
  const manual = (r) => (intval(r.sort_order) > 0 ? intval(r.sort_order) : Number.MAX_SAFE_INTEGER)
  const desc = (x) => (x === Infinity ? Infinity : -x)
  const key = (r) => {
    const id = intval(r.id)
    switch (mode) {
      case 'volume_desc': return [desc(vol(r)), days(r), price(r), id]
      case 'price_asc': return [price(r), vol(r), days(r), id]
      case 'price_desc': return [-price(r), vol(r), days(r), id]
      case 'manual': return [manual(r), vol(r), days(r), price(r), id]
      default: return [vol(r), days(r), price(r), id]
    }
  }
  return [...rows].map((r) => [key(r), r]).sort((a, b) => cmpArr(a[0], b[0])).map((x) => x[1])
}

// ---------------------------------------------------------------- categories
export const categoryOffKey = (remark) => String(remark ?? '').trim().toLowerCase()
export async function soldOutCategoryKeys() {
  return (await all(sql`SELECT remark FROM category WHERE status = 'disable'`)).map((r) => categoryOffKey(r.remark))
}

// ---------------------------------------------------------------- promotions
const PROMO_QUOTE_TTL = 3600
let promoCache = null
export async function promoState() {
  const s = parse((await kvGet('storage:promo.json')) || 'null')
  return s && typeof s === 'object' ? s : null
}
async function promoById() {
  if (promoCache && promoCache.at === time()) return promoCache.map
  const map = {}
  const s = await promoState()
  if (s && time() < intval(s.ends_at) && Array.isArray(s.items)) for (const it of s.items) map[intval(it.id)] = { ...it, type: s.type, value: s.value }
  promoCache = { at: time(), map }
  return map
}
export async function promoItem(productId) { return (await promoById())[intval(productId)] ?? null }
export const promoStrike = (s) => String(s).replace(/(\S)/gu, '$1̶')
export const promoLtr = (s) => '⁦' + s + '⁩'
export function promoNum(v) { return (Number(v) || 0).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') }
export async function promoEmoji(type) {
  const cand = type === 'percent' ? ['🏷', '🛍', '💸', '🤑', '🔖', '💰', '🔥'] : ['🎁', '🎉', '🎀', '🔥']
  const map = (await emojiConfig()).map || {}
  for (const e of cand) if (map[e] !== undefined) return e
  return cand[0]
}
export function promoStripPrice(name) {
  const out = String(name).replace(/\s*[—–\-|]?\s*[\d,٬۰-۹]{3,}\s*(?:هزار\s*)?(?:تومان|تومن)/gu, '').trim()
  return out || name
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
export async function promoButtonLabel(product, label) {
  const it = await promoItem(product.id ?? 0)
  if (!it) return label
  label = label.replace(/^\s*(?:(?:<tg-emoji\b[^>]*>.*?<\/tg-emoji>|\p{Extended_Pictographic}️?)\s*)+/u, '')
  let base = promoStripPrice(label)
  if (it.type === 'percent') return (await promoEmoji('percent')) + ' ' + base + ' — ' + promoLtr(promoStrike(numberFormat(it.old_price))) + ' ' + promoLtr(numberFormat(it.new_price)) + ' تومان'
  const old = promoNum(it.old_gb)
  const bonus = promoNum(Number(it.new_gb) - Number(it.old_gb))
  let count = 0
  base = base.replace(new RegExp('(?<![\\d.])' + reEsc(old) + '(\\s*گیگ)', 'u'), (m, g1) => { count++; return promoNum(it.new_gb) + g1 + ' (+' + bonus + ' هدیه)' })
  if (!count) base += ' (+' + bonus + ' گیگ هدیه)'
  return (await promoEmoji('bonus_gb')) + ' ' + base + ' — ' + promoLtr(numberFormat(it.new_price)) + ' تومان'
}
export async function promoInvoiceParts(product, finalPrice) {
  const it = await promoItem(product.id ?? 0)
  if (!it) return null
  const name = promoStripPrice(String(product.name_product ?? ''))
  if (it.type === 'percent') return { name: (await promoEmoji('percent')) + ' ' + name, price: '<s>' + numberFormat(it.old_price) + '</s> ' + numberFormat(Number(finalPrice)) }
  return { name: (await promoEmoji('bonus_gb')) + ' ' + name + ' (+' + promoNum(Number(it.new_gb) - Number(it.old_gb)) + ' گیگ هدیه)', price: numberFormat(Number(finalPrice)) }
}
export async function promoQuote(product) {
  const it = await promoItem(product.id ?? 0)
  if (!it) return null
  return { code: String(product.code_product ?? ''), price: intval(it.new_price), gb: Number(it.new_gb), at: time() }
}
export function promoApplyQuote(product, quote, now = time()) {
  if (!quote || typeof quote !== 'object' || quote.code !== String(product.code_product ?? '') || now - intval(quote.at) > PROMO_QUOTE_TTL) return product
  const p = { ...product }
  if (intval(quote.price) > 0 && intval(quote.price) < intval(p.price_product)) p.price_product = intval(quote.price)
  if (Number(quote.gb) > Number(p.Volume_constraint)) p.Volume_constraint = quote.gb
  return p
}

// ---------------------------------------------------------------- keyboards
/** KeyboardProduct(): rows = the product rows the PHP query returned */
export async function keyboardProduct(c, location, rows, pricediscount, datakeyboard, statuscustom = false, backuser = 'backuser', valuetow = null, customvolume = 'customsellvolume') {
  const T = c.T
  const kb = { inline_keyboard: [] }
  const showPrice = await shop('statusshowprice')
  const tail = valuetow != null ? `-${valuetow}` : ''
  let countorder = null
  const soldOut = await soldOutCategoryKeys()
  for (const r0 of await sortProductRows(rows)) {
    const r = { ...r0 }
    const hide = parse(r.hide_panel)
    if (Array.isArray(hide) && hide.map(String).includes(String(location))) continue
    if (r.one_buy_status === '1' || r.one_buy_status === 1) {
      if (countorder === null) countorder = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE Status != 'Unpaid' AND id_user = ${c.from_id}`)).n)
      if (countorder !== 0) continue
    }
    if (intval(pricediscount) !== 0) r.price_product = num(r.price_product) - (num(r.price_product) * num(pricediscount)) / 100
    const namekeyboard = r.name_product + ' - ' + numberFormat(r.price_product) + T.common.labels.toman
    if (showPrice === 'onshowprice') r.name_product = namekeyboard
    if ((r.status_product === 'disable' || soldOut.includes(categoryOffKey(r.category))) && datakeyboard.startsWith('prodcutservice')) {
      kb.inline_keyboard.push([{ text: r.name_product + ' | ' + T.keyboard.productSoldOut, callback_data: 'productsoldout' }])
      continue
    }
    kb.inline_keyboard.push([{ text: await promoButtonLabel(r, await catalogLabel('product', r, r.name_product)), callback_data: `${datakeyboard}${r.code_product}${tail}` }])
  }
  if (statuscustom) kb.inline_keyboard.push([{ text: T.users.customSellVolume.title, callback_data: customvolume }])
  kb.inline_keyboard.push([{ text: T.users.status.backinfo, callback_data: backuser }])
  return J(kb)
}

/** KeyboardCategory(); productWhere is only ever "" or "AND one_buy_status = '0'" */
export async function keyboardCategory(c, location, agent, backuser = 'backuser', prefix = 'categorynames_', oneBuyOnly = false) {
  const T = c.T
  const rows = oneBuyOnly
    ? await all(sql`SELECT category, COUNT(*) AS c FROM product WHERE (Location = ${location} OR Location = '/all') AND agent = ${agent} AND one_buy_status = '0' GROUP BY category`)
    : await all(sql`SELECT category, COUNT(*) AS c FROM product WHERE (Location = ${location} OR Location = '/all') AND agent = ${agent} GROUP BY category`)
  const counts = {}
  for (const r of rows) { const k = categoryOffKey(r.category); counts[k] = (counts[k] ?? 0) + Number(r.c) }
  const cats = await all(sql`SELECT * FROM category ORDER BY (CAST(sort_order AS INTEGER) <= 0), CAST(sort_order AS INTEGER), id`)
  const soldOut = await soldOutCategoryKeys()
  const kb = { inline_keyboard: [] }
  for (const row of cats) {
    if (!counts[categoryOffKey(row.remark)]) continue
    const label = await catalogLabel('category', row, row.remark)
    if (soldOut.includes(categoryOffKey(row.remark))) { kb.inline_keyboard.push([{ text: label + ' | ' + (T.keyboard.productSoldOut || '🔴 ناموجود'), callback_data: 'categorysoldout' }]); continue }
    kb.inline_keyboard.push([{ text: label, callback_data: prefix + row.id }])
  }
  kb.inline_keyboard.push([{ text: T.keyboard.backToPreviousMenu, callback_data: backuser }])
  return J(kb)
}

/** keyboardRowsBeforeBack() */
export function rowsBeforeBack(json, rows) {
  const kb = JSON.parse(json)
  const back = kb.inline_keyboard.pop()
  kb.inline_keyboard.push(...rows, back)
  return J(kb)
}

const DURATIONS = [['1', '1day'], ['7', '7day'], ['31', '1'], ['30', '1'], ['61', '2'], ['60', '2'], ['91', '3'], ['90', '3'], ['121', '4'], ['120', '4'], ['181', '6'], ['180', '6'], ['365', '365'], ['0', 'byVolume']]
/** keyboardTimeCategory() */
export async function keyboardTimeCategory(c, namePanel, agent, cb = 'producttime_', back = 'backuser', custom = false, extendBtn = false) {
  const T = c.T
  const have = new Set((await all(sql`SELECT Service_time FROM product WHERE (Location = ${namePanel} OR Location = '/all') AND agent = ${agent}`)).map((r) => String(r.Service_time ?? '')))
  // in_array("1", $list) is loose: "01" or " 1" would match too; the stored values are plain numbers
  const has = (v) => [...have].some((h) => h === v || (h.trim() !== '' && !Number.isNaN(Number(h)) && Number(h) === Number(v)))
  const kb = { inline_keyboard: [] }
  for (const [v, k] of DURATIONS) if (has(v)) kb.inline_keyboard.push([{ text: T.common.duration[k], callback_data: `${cb}${v}` }])
  if (extendBtn) kb.inline_keyboard.push([{ text: T.keyboard.renewCurrentPlan, callback_data: 'exntedagei' }])
  if (custom) kb.inline_keyboard.push([{ text: T.users.customSellVolume.title, callback_data: 'customsellvolume' }])
  kb.inline_keyboard.push([{ text: T.users.status.backinfo, callback_data: back }])
  return J(kb)
}

// ---------------------------------------------------------------- custom service price (custom_price.php)
async function customPriceConfig() {
  let cfg = parse((await kvGet('storage:custom_price.json')) || 'null')
  cfg = cfg && typeof cfg === 'object' ? cfg : {}
  const mp = cfg.month_pct
  return {
    mode: (cfg.mode ?? 'plans') === 'flat' ? 'flat' : 'plans',
    step: Math.max(1, intval(cfg.step ?? 5000)),
    month_pct: mp !== undefined && mp !== null && !Number.isNaN(Number(mp)) && String(mp).trim() !== '' ? Math.max(0, Number(mp)) : null,
  }
}
export function agentValue(json, agent) {
  const d = typeof json === 'object' && json !== null ? json : parse(String(json ?? ''))
  return d && typeof d === 'object' && d[agent] !== undefined && d[agent] !== null && String(d[agent]).trim() !== '' && !Number.isNaN(Number(d[agent])) ? Number(d[agent]) : 0
}
async function customPricePlans(panelName, agent) {
  const rows = await all(sql`SELECT id, price_product, Volume_constraint, Service_time FROM product WHERE (Location = ${panelName} OR Location = '/all') AND agent = ${agent} AND one_buy_status = '0'`)
  const orig = {}
  const s = await promoState()
  if (s) for (const it of s.items ?? []) orig[intval(it.id)] = it
  const out = []
  for (const p of rows) {
    let price = num(p.price_product), gb = num(p.Volume_constraint)
    if (orig[intval(p.id)]) { price = num(orig[intval(p.id)].old_price); gb = num(orig[intval(p.id)].old_gb) }
    const days = intval(p.Service_time)
    if (price > 0 && gb > 0 && days > 0) out.push([gb, days, price])
  }
  return out
}
function curve(pts, gb) {
  const n = pts.length
  if (gb <= pts[0][0]) return (gb * pts[0][1]) / pts[0][0]
  if (gb >= pts[n - 1][0]) return (gb * pts[n - 1][1]) / pts[n - 1][0]
  for (let i = 1; i < n; i++) if (gb <= pts[i][0]) { const [g0, p0] = pts[i - 1], [g1, p1] = pts[i]; return p0 + ((p1 - p0) * (gb - g0)) / (g1 - g0) }
  return pts[n - 1][1]
}
function points(raw) {
  const by = new Map()
  for (const [gb, price] of raw) { const k = String(gb); if (!by.has(k)) by.set(k, []); by.get(k).push(price) }
  const pts = [...by].map(([g, ps]) => [Number(g), ps.reduce((a, b) => a + b, 0) / ps.length]).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < pts.length; i++) pts[i][1] = Math.max(pts[i][1], pts[i - 1][1])
  return pts
}
function median(v) { v = [...v].sort((a, b) => a - b); const n = v.length; return n % 2 ? v[Math.floor(n / 2)] : (v[n / 2 - 1] + v[n / 2]) / 2 }
const timeFactor = (m, days) => Math.max(0.8, 1 + (m.month * (days - m.base)) / 30)
function priceModel(plans, monthPct) {
  if (!plans.length) return null
  const cnt = new Map()
  for (const p of plans) cnt.set(p[1], (cnt.get(p[1]) ?? 0) + 1)
  // arsort + array_key_first: the most common duration; PHP's sort is stable, ties keep first-seen order
  const base = cnt.has(30) ? 30 : [...cnt].sort((a, b) => b[1] - a[1])[0][0]
  const basePts = points(plans.filter((p) => p[1] === base).map((p) => [p[0], p[2]]))
  let month
  if (monthPct !== null) month = monthPct / 100
  else {
    let rates = []; const allR = []
    for (const [gb, days, price] of plans) {
      if (days > base) {
        const r = (price / curve(basePts, gb) - 1) / ((days - base) / 30)
        allR.push(r)
        if (gb >= basePts[0][0] && gb <= basePts[basePts.length - 1][0]) rates.push(r)
      }
    }
    rates = rates.length ? rates : allR
    month = rates.length ? Math.min(1, Math.max(0, median(rates))) : 0.1
  }
  const model = { base, month, points: [] }
  const lo = basePts[0][0], hi = basePts[basePts.length - 1][0]
  const pts = plans.filter((p) => p[1] === base).map((p) => [p[0], p[2]])
  for (const [gb, days, price] of plans) if (days !== base && (gb < lo || gb > hi)) pts.push([gb, price / timeFactor(model, days)])
  model.points = points(pts)
  model.plans = plans
  return model
}
function modelPrice(model, gb, days, step) {
  let price = curve(model.points, gb) * timeFactor(model, days)
  price = Math.trunc(Math.max(step, phpRound(price / step) * step))
  for (const [pg, pd, pp] of model.plans) if (pg >= gb && pd >= days && pp < price) price = Math.trunc(pp)
  return price
}
async function panelModel(c, panel, agent) {
  const cfg = await customPriceConfig()
  if (cfg.mode === 'flat' || !panel || !panel.name_panel) return null
  c._priceModels = c._priceModels || {}
  const k = panel.name_panel + '\0' + agent
  if (!(k in c._priceModels)) c._priceModels[k] = priceModel(await customPricePlans(panel.name_panel, agent), cfg.month_pct)
  return c._priceModels[k]
}
/** customPlanPrice($panel, $agent, $gb, $days) */
export async function customPlanPrice(c, panel, agent, gb, days) {
  panel = panel && typeof panel === 'object' ? panel : {}
  agent = String(agent || 'f')
  gb = Math.max(0, num(gb))
  days = Math.max(0, intval(days))
  const model = await panelModel(c, panel, agent)
  if (model) return modelPrice(model, gb, days, (await customPriceConfig()).step)
  return Math.trunc(phpRound(gb * agentValue(panel.pricecustomvolume, agent) + days * agentValue(panel.pricecustomtime, agent)))
}
/** customPricePrompt($fmt, $panel, $agent, $kind, $flatValue, ...$rest) */
export async function customPricePrompt(c, fmt, panel, agent, kind, flatValue, ...rest) {
  const { sprintf } = await import('./php.js')
  const model = await panelModel(c, panel && typeof panel === 'object' ? panel : {}, String(agent || 'f'))
  if (!model) return sprintf(fmt, flatValue, ...rest)
  const step = (await customPriceConfig()).step
  let hint
  if (kind === 'volume') {
    hint = 'قیمت مطابق تعرفه پلن‌ها (' + model.base + ' روزه): ' + [10, 25, 50, 100].map((g) => g + ' گیگ ' + numberFormat(modelPrice(model, g, model.base, step))).join(' | ') + ' تومان'
  } else {
    hint = model.month > 0 ? 'هر ماه بیشتر از ' + model.base + ' روز، حدود ' + phpRound(model.month * 100) + '٪ به قیمت اضافه می‌شود؛ قیمت نهایی در پیش‌فاکتور' : 'قیمت نهایی در پیش‌فاکتور نمایش داده می‌شود'
  }
  const lines = String(fmt).split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('%s')) {
      const m = /^[^\p{L}\p{N}%]*/u.exec(lines[i])
      lines[i] = (m ? m[0] : '').replace(/\s+$/, '') + ' ' + hint.replace(/%/g, '%%')
      break
    }
  }
  return sprintf(lines.join('\n'), ...rest)
}

// ---------------------------------------------------------------- balance
/** deductBalance(): never below 0 (n2 agents: down to -maxbuyagent, or no limit) */
export async function deductBalance(user, amount) {
  amount = Number(amount)
  if (!(amount > 0)) return true
  const min = user.agent === 'n2' ? (intval(user.maxbuyagent) !== 0 ? -intval(user.maxbuyagent) : null) : 0
  const r = min === null
    ? await run(sql`UPDATE user SET Balance = Balance - ${amount} WHERE id = ${user.id}`)
    : await run(sql`UPDATE user SET Balance = Balance - ${amount} WHERE id = ${user.id} AND Balance - ${amount} >= ${min} + 0`)
  return changes(r) === 1
}
export async function addBalance(userId, amount) {
  amount = Number(amount)
  if (!(amount > 0)) return
  await run(sql`UPDATE user SET Balance = Balance + ${amount} WHERE id = ${userId}`)
}
export const changes = (r) => Number(r?.rowsAffected ?? r?.changes ?? r?.meta?.changes ?? 0)

/** $step_payment of keyboard.php (the payment methods offered when the wallet is short) */
export async function stepPaymentKb(c) {
  const T = c.T
  const rows = await all(sql`SELECT NamePay, ValuePay FROM PaySetting`)
  const pay = (name, def = null) => { const r = rows.find((x) => String(x.NamePay ?? '').trim().toLowerCase() === name.toLowerCase()); return r ? r.ValuePay : def }
  const users = c.usersBefore || {}
  let kb = []
  if (pay('Cartstatus') === 'oncard' && intval(users.cardpayment) === 1) {
    kb.push(pay('Cartstatuspv') === 'oncardpv' ? [{ text: T.textbot.cartToCart, url: `https://t.me/${pay('CartDirect') ?? ''}` }] : [{ text: T.textbot.cartToCart, callback_data: 'cart_to_offline' }])
  }
  const paid = Number((await one(sql`SELECT COUNT(*) AS n FROM Payment_report WHERE id_user = ${c.from_id} AND payment_Status = 'paid'`)).n)
  if (paid === 0 && pay('checkpaycartfirst') === 'onpayverify') kb = []
  const set = (v) => { const s = String(v ?? '').trim(); return s !== '' && s !== '0' }
  const paused = (g) => Number(pay(g + '_pause_until', 0)) > Math.floor(Date.now() / 1000)
  const priority = [] // the three main ways to pay come first: online payment, automatic card-to-card, Telegram Stars
  if (pay('nowpaymentstatus') === 'onnowpayment') kb.push([{ text: T.textbot.nowPayment, callback_data: 'plisio' }])
  if (pay('statusnowpayment') === '1') kb.push([{ text: T.textbot.cryptoPayment, callback_data: 'nowpayment' }])
  if (pay('digistatus') === 'ondigi') kb.push([{ text: T.textbot.nowPaymentTron, callback_data: 'digitaltron' }])
  if (pay('statusSwapWallet') === 'onSwapinoBot') kb.push([{ text: T.textbot.iranPay2, callback_data: 'iranpay1' }])
  if (pay('statustarnado') === 'onternado') kb.push([{ text: T.textbot.iranPay3, callback_data: 'iranpay2' }])
  // iranpay4 (abangateway) needs its endpoint on the PHP server: not offered here
  if (pay('statusiranpay3') === 'oniranpay3' && paid >= 2) kb.push([{ text: T.textbot.iranPay1, callback_data: 'iranpay3' }])
  if (pay('statusaqayepardakht') === 'onaqayepardakht') kb.push([{ text: T.textbot.aqayePardakht, callback_data: 'aqayepardakht' }])
  if (pay('zarinpalstatus') === 'onzarinpal') kb.push([{ text: T.textbot.zarinPal, callback_data: 'zarinpal' }])
  if (pay('variza_status', 'offvariza') === 'onvariza' && set(pay('variza_api_token', '')) && set(pay('variza_webhook_secret', '')) && !paused('variza')) priority[1] = [{ text: T.textbot.variza, callback_data: 'variza' }]
  if (pay('tetraminator_status', 'offtetraminator') === 'ontetraminator' && set(pay('tetraminator_api_key', '')) && !paused('tetraminator')) priority[0] = [{ text: T.textbot.tetraminator || '💳 پرداخت آنلاین', callback_data: 'tetraminator' }]
  if (pay('paymentstatussnotverify') === 'onverifypay') kb.push([{ text: T.textbot.paymentNotVerify, callback_data: 'paymentnotverify' }])
  // Paychi (own card-to-card service) sits next to Variza until it is trusted enough to replace it
  if (pay('paychi_status', 'offpaychi') === 'onpaychi' && set(pay('paychi_api_key', '')) && set(pay('paychi_base_url', '')) && !paused('paychi')) priority[2] = [{ text: T.textbot.paychi || '💳 کارت به کارت (پیچی)', callback_data: 'paychi' }]
  if (intval(pay('statusstar')) === 1) priority[3] = [{ text: T.textbot.starTelegram, callback_data: 'startelegrams' }]
  kb = [...priority.filter(Boolean), ...kb]
  kb.push([{ text: T.keyboard.closeList, callback_data: 'colselist' }])
  return J({ inline_keyboard: kb })
}
