// The table routes of dashboard/api.php: schema, list/export, update, create, delete, import, tree, stats, overview.
import { one, all, run, sql } from '../db.js'
import { jdate } from '../fmt.js'
import { qAll, qOne, qRun, qVal, Q } from './qb.js'
import { PanelError, fail, now, latinDigits, sqlite, likeEscape, str, randomHex12 } from './util.js'
import { resources } from './resources.js'
import { statsPeriod, statsCollect, statsOverall, statsReport, accKindGroup, accExpenseKinds, accParseDateTime, accFormatDateTime } from './stats.js'
import { tehranDate } from '../bot.js'

const MAX_EXPORT = 200000
const MAX_IMPORT = 5000

async function res(name) {
  const all = await resources()
  if (!all[name]) fail('منبع نامعتبر است', 404)
  return { ...all[name], name }
}
const colOf = (r, key) => r.cols.find((c) => c.key === key) || null
const cx = (r, c) => (c.expr ? `(${sqlite(c.expr)})` : r.alias ? `\`${r.alias}\`.\`${c.key}\`` : `\`${c.key}\``)

function value(col, v) {
  const label = col.label
  if (v === null || v === undefined) v = ''
  switch (col.type) {
    case 'int': {
      const s = latinDigits(String(v).trim()).replace(/[,٬ ]/g, '')
      if (s === '') return 0
      if (!/^-?\d{1,15}$/.test(s)) throw new PanelError(`«${label}» باید عدد باشد`, 422)
      return parseInt(s, 10)
    }
    case 'dt': {
      const ts = accParseDateTime(v)
      if (ts === null) throw new PanelError(`«${label}» را به‌صورت 1405/07/14 15:30 (یا خالی = الان) بنویسید`, 422)
      return ts
    }
    case 'enum': {
      const s = String(v)
      if (!Object.prototype.hasOwnProperty.call(col.options || {}, s)) throw new PanelError(`مقدار «${label}» نامعتبر است`, 422)
      return s
    }
    default: {
      const s = String(v)
      if ([...s].length > 2000) throw new PanelError(`«${label}» بیش از حد طولانی است`, 422)
      return s
    }
  }
}

function formatDt(r, rows) {
  const dt = r.cols.filter((c) => c.type === 'dt').map((c) => c.key)
  for (const row of rows) for (const k of dt) if (row[k] !== undefined && row[k] !== null && row[k] !== '') row[k] = accFormatDateTime(Number(row[k]))
  return rows
}

async function logBalance(userId, oldB, newB) {
  const diff = newB - oldB
  if (diff === 0) return
  await run(sql`INSERT INTO Payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES (${userId}, ${randomHex12()}, ${tehranDate()}, ${Math.abs(diff)}, 'paid', ${diff > 0 ? 'add balance by admin' : 'low balance by admin'}, 'none')`)
}

/** update one cell (checks, side effects). dry = validate only. */
export async function updateCell(r, id, field, v, dry = false) {
  const col = colOf(r, field)
  if (!col || !col.edit) fail('این ستون قابل ویرایش نیست', 403)
  let val = value(col, v)
  const row = await qOne(`SELECT * FROM \`${r.table}\` WHERE \`${r.pk}\` = ?`, [String(id)])
  if (!row) fail('ردیف پیدا نشد', 404)
  if (r.name === 'users' && field === 'Balance' && !dry) await logBalance(String(id), parseInt(row.Balance) || 0, val)
  if (r.name === 'categories' && field === 'remark') {
    val = String(val).trim()
    if (val === '') fail('نام دسته نمی‌تواند خالی باشد', 422)
    if (Number(await qVal('SELECT COUNT(*) FROM category WHERE remark = ? AND id != ?', [val, String(id)])) > 0) fail('دسته‌ای با این نام وجود دارد', 422)
    if (!dry) await qRun('UPDATE product SET category = ? WHERE category = ?', [val, row.remark])
  }
  if (r.name === 'products' && field === 'name_product') {
    val = String(val).trim()
    if (val === '') fail('نام محصول نمی‌تواند خالی باشد', 422)
  }
  if (!dry) await qRun(`UPDATE \`${r.table}\` SET \`${field}\` = ? WHERE \`${r.pk}\` = ?`, [val, String(id)])
  return val
}

async function insertRow(r, row, dry = false) {
  const data = { ...(r.defaults || {}) }
  for (const c of r.cols) {
    if (!c.edit || !(c.key in row)) {
      if (c.req && !(c.key in row)) throw new PanelError(`«${c.label}» الزامی است`, 422)
      continue
    }
    data[c.key] = value(c, row[c.key])
    if (c.req && String(data[c.key]).trim() === '') throw new PanelError(`«${c.label}» الزامی است`, 422)
  }
  if (r.autots && data[r.autots] === undefined) data[r.autots] = now()
  if (r.name === 'products') {
    data.name_product = String(data.name_product).trim()
    if (Number(await qVal('SELECT COUNT(*) FROM product WHERE name_product = ?', [data.name_product])) > 0) throw new PanelError('محصولی با این نام وجود دارد', 422)
    data.code_product = randomHex12().slice(0, 4)
  }
  if (r.name === 'categories') {
    data.remark = String(data.remark).trim()
    if (Number(await qVal('SELECT COUNT(*) FROM category WHERE remark = ?', [data.remark])) > 0) throw new PanelError('دسته‌ای با این نام وجود دارد', 422)
  }
  if (['products', 'categories'].includes(r.name) && !('sort_order' in row)) data.sort_order = Number(await qVal(`SELECT COALESCE(MAX(CAST(sort_order AS INTEGER)), 0) + 1 FROM \`${r.table}\``, []))
  if (dry) return ''
  const names = Object.keys(data)
  const x = await qRun(`INSERT INTO \`${r.table}\` (\`${names.join('`,`')}\`) VALUES (${names.map(() => '?').join(',')})`, Object.values(data))
  return String(x.lastInsertRowid ?? '')
}

export async function schema() {
  const out = {}
  for (const [name, r] of Object.entries(await resources())) {
    out[name] = { title: r.title, pk: r.pk, create: r.create, delete: r.delete, import: r.import, cols: r.cols.map((c) => { const { expr, ...rest } = c; return rest }) }
  }
  return { ok: true, resources: out }
}

export async function list(route, q) {
  const r = await res(String(q.res ?? ''))
  const from = r.from || `\`${r.table}\``
  const pkSql = r.alias ? `\`${r.alias}\`.\`${r.pk}\`` : `\`${r.pk}\``
  const where = [], params = []
  const text = String(q.q ?? '').trim()
  if (text !== '') {
    const like = []
    for (const s of r.search) {
      const sc = colOf(r, s)
      like.push((sc ? cx(r, sc) : `\`${s}\``) + " LIKE ? ESCAPE '\\'")
      params.push('%' + likeEscape(text) + '%')
    }
    where.push('(' + like.join(' OR ') + ')')
  }
  if (r.datecol && q.range) {
    const rg = String(q.range)
    let pr
    if (['today', 'yesterday', 'month', 'lastmonth'].includes(rg)) pr = statsPeriod(rg)
    else if (rg === '7d' || rg === '30d') pr = { start: now() - (rg === '7d' ? 7 : 30) * 86400, end: now() }
    else fail('بازه نامعتبر است', 422)
    where.push('CAST(' + cx(r, colOf(r, r.datecol)) + ' AS INTEGER) BETWEEN ? AND ?')
    params.push(Number(pr.start), Number(pr.end))
  }
  const groupKey = r.summary ? 'sgrp' : null
  const whereNoGroup = [...where], paramsNoGroup = [...params]
  for (const [fk, fv] of Object.entries(q.f || {})) {
    const col = colOf(r, String(fk))
    if (col && fv !== '' && fv != null) {
      const c = cx(r, col)
      const saleStatus = ['status', 'status_product'].includes(col.key) && col.options && 'active' in col.options
      where.push(saleStatus ? `COALESCE(NULLIF(${c},''),'active') = ?` : `${c} = ?`)
      params.push(String(fv))
      if (col.key !== groupKey) { whereNoGroup.push(where[where.length - 1]); paramsNoGroup.push(String(fv)) }
    }
  }
  let sortKey = String(q.sort ?? r.order)
  let sortCol = colOf(r, sortKey)
  if (!sortCol) { sortKey = r.order; sortCol = colOf(r, sortKey) }
  const dir = String(q.dir ?? r.dir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  const sortSql = cx(r, sortCol)
  const orderExpr = ['int', 'ts', 'dt'].includes(sortCol.type) ? `CAST(${sortSql} AS INTEGER)` : `${sortSql} COLLATE NOCASE`
  const names = r.cols.map((c) => {
    const x = cx(r, c)
    const saleStatus = ['status', 'status_product'].includes(c.key) && c.options && 'active' in c.options
    return saleStatus ? `COALESCE(NULLIF(${x},''),'active') AS \`${c.key}\`` : `${x} AS \`${c.key}\``
  }).join(',')
  const wsql = where.length ? ' WHERE ' + where.join(' AND ') : ''
  if (route === 'export') {
    const rows = await qAll(`SELECT ${names} FROM ${from}${wsql} ORDER BY ${orderExpr} ${dir}, ${pkSql} LIMIT ${MAX_EXPORT}`, params)
    return { ok: true, rows: formatDt(r, rows) }
  }
  const per = Math.max(1, Math.min(200, parseInt(q.per ?? 50) || 50))
  const page = Math.max(1, parseInt(q.page ?? 1) || 1)
  const total = Number(await qVal(`SELECT COUNT(*) FROM ${from}${wsql}`, params))
  const rows = await qAll(`SELECT ${names} FROM ${from}${wsql} ORDER BY ${orderExpr} ${dir}, ${pkSql} LIMIT ${per} OFFSET ${(page - 1) * per}`, params)
  const out = { ok: true, rows: formatDt(r, rows), total, page, per }
  if (r.summary) {
    const priceSql = cx(r, colOf(r, 'price_product'))
    const sum = Number(await qVal(`SELECT COALESCE(SUM(CAST(${priceSql} AS INTEGER)),0) FROM ${from}${wsql}`, params))
    const groupSql = cx(r, colOf(r, 'sgrp'))
    const byGroup = {}
    for (const g of await qAll(`SELECT ${groupSql} AS g, COUNT(*) AS c, COALESCE(SUM(CAST(${priceSql} AS INTEGER)),0) AS s FROM ${from}${whereNoGroup.length ? ' WHERE ' + whereNoGroup.join(' AND ') : ''} GROUP BY g`, paramsNoGroup)) {
      byGroup[g.g] = { count: Number(g.c), sum: Number(g.s) }
    }
    out.summary = { sum, groups: Object.keys(byGroup).length ? byGroup : [] }
  }
  return out
}

export async function update(b) {
  const r = await res(String(b.res ?? ''))
  await updateCell(r, String(b.id ?? ''), String(b.field ?? ''), b.value ?? '')
  const row = await qOne(`SELECT \`${String(b.field)}\` AS v FROM \`${r.table}\` WHERE \`${r.pk}\` = ?`, [String(b.id)])
  return { ok: true, value: row ? row.v : null }
}

export async function create(b) {
  const r = await res(String(b.res ?? ''))
  if (!r.create) fail('افزودن مجاز نیست', 403)
  return { ok: true, id: await insertRow(r, b.row || {}) }
}

export async function remove(b) {
  const r = await res(String(b.res ?? ''))
  if (!r.delete) fail('حذف مجاز نیست', 403)
  const id = String(b.id ?? '')
  if (r.name === 'categories') {
    const remark = await qVal('SELECT remark FROM category WHERE id = ?', [id])
    if (remark !== null && Number(await qVal('SELECT COUNT(*) FROM product WHERE category = ?', [remark])) > 0) fail('ابتدا محصولات این دسته را به دسته دیگری منتقل کنید', 409)
  }
  await qRun(`DELETE FROM \`${r.table}\` WHERE \`${r.pk}\` = ?`, [id])
  return { ok: true }
}

export async function importRows(b) {
  const r = await res(String(b.res ?? ''))
  if (!r.import) fail('درون‌ریزی برای این بخش مجاز نیست', 403)
  const rows = Array.isArray(b.rows) ? b.rows : []
  if (rows.length > MAX_IMPORT) fail(`حداکثر ${MAX_IMPORT} ردیف در هر بار قابل درون‌ریزی است`, 413)
  const dry = !!b.dry
  const stats = { inserted: 0, updated: 0, skipped: 0 }
  const errors = []
  // all rows are checked first; nothing is written unless every row is fine (or partial is set)
  const plan = []
  for (let i = 0; i < rows.length; i++) {
    const line = i + 1
    const row = rows[i] && typeof rows[i] === 'object' ? rows[i] : {}
    try {
      const pkv = row[r.pk] !== undefined && row[r.pk] !== null ? String(row[r.pk]).trim() : ''
      const exists = pkv !== '' && Number(await qVal(`SELECT COUNT(*) FROM \`${r.table}\` WHERE \`${r.pk}\` = ?`, [pkv])) > 0
      if (exists) {
        const changes = []
        for (const [k, v] of Object.entries(row)) {
          const col = colOf(r, String(k))
          if (col && col.edit) {
            const cur = await qVal(`SELECT \`${k}\` FROM \`${r.table}\` WHERE \`${r.pk}\` = ?`, [pkv])
            if (str(cur) !== String(value(col, v))) { await updateCell(r, pkv, String(k), v, true); changes.push([k, v]) }
          }
        }
        plan.push({ kind: 'update', pkv, changes })
        stats[changes.length ? 'updated' : 'skipped']++
      } else if (r.create) {
        await insertRow(r, row, true)
        plan.push({ kind: 'insert', row })
        stats.inserted++
      } else {
        stats.skipped++
        errors.push({ line, error: 'ردیف در پایگاه داده وجود ندارد' })
      }
    } catch (e) {
      if (!(e instanceof PanelError)) throw e
      errors.push({ line, error: e.message })
      stats.skipped++
    }
  }
  if (dry || (errors.length && !b.partial)) return { ok: !errors.length, applied: false, dry, ...stats, errors: errors.slice(0, 50), _status: errors.length && !dry ? 422 : 200 }
  for (const p of plan) {
    if (p.kind === 'insert') await insertRow(r, p.row)
    else for (const [k, v] of p.changes) await updateCell(r, p.pkv, String(k), v)
  }
  return { ok: true, applied: true, ...stats, errors: errors.slice(0, 50) }
}

export async function tree() {
  const cats = await qAll('SELECT id, remark, CAST(sort_order AS INTEGER) AS sort_order FROM category ORDER BY CAST(sort_order AS INTEGER), id', [])
  const prods = await qAll('SELECT id, name_product, price_product, Volume_constraint, Service_time, Location, category, agent, CAST(sort_order AS INTEGER) AS sort_order FROM product ORDER BY CAST(sort_order AS INTEGER), id', [])
  const byCat = new Map()
  for (const p of prods) { const k = String(p.category ?? ''); if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(p) }
  const out = []
  for (const c of cats) { out.push({ ...c, products: byCat.get(c.remark) ?? [] }); byCat.delete(c.remark) }
  return { ok: true, categories: out, uncategorized: [...byCat.values()].flat() }
}

export async function treeSave(b) {
  let pos = 0
  const cats = Array.isArray(b.categories) ? b.categories : []
  for (const c of cats) if ((await qVal('SELECT remark FROM category WHERE id = ?', [parseInt(c.id) || 0])) === null) fail('دسته نامعتبر است', 422)
  for (let ci = 0; ci < cats.length; ci++) {
    const c = cats[ci], cid = parseInt(c.id) || 0
    const remark = await qVal('SELECT remark FROM category WHERE id = ?', [cid])
    await qRun('UPDATE category SET sort_order = ? WHERE id = ?', [ci + 1, cid])
    for (const pid of c.products || []) await qRun('UPDATE product SET category = ?, sort_order = ? WHERE id = ?', [remark, ++pos, parseInt(pid) || 0])
  }
  for (const pid of b.uncategorized || []) await qRun('UPDATE product SET category = ?, sort_order = ? WHERE id = ?', ['', ++pos, parseInt(pid) || 0])
  return { ok: true }
}

export async function stats(q) {
  const period = String(q.period ?? 'today')
  if (!['all', 'hour', 'today', 'yesterday', 'month', 'lastmonth'].includes(period)) fail('بازه نامعتبر است', 422)
  const p = statsPeriod(period)
  const d = await statsCollect(p.start, p.end)
  const allD = period === 'all' ? d : await statsCollect(0, now())
  const kinds = Object.entries(accExpenseKinds()).map(([k, l]) => ({ key: k, label: l, group: accKindGroup(k) }))
  return { ok: true, period, title: p.title, start: p.start, end: p.end, data: d, all: allD, overall: period === 'all' ? await statsOverall() : null, kinds, text: (await statsReport(period)).replace(/<[^>]*>/g, '') }
}

export async function overview() {
  const today = await statsCollect(statsPeriod('today').start, now())
  const month = await statsCollect(statsPeriod('month').start, now())
  const users = Number(await qVal('SELECT COUNT(*) FROM user', []))
  const balance = Number(await qVal('SELECT COALESCE(SUM(CAST(Balance AS INTEGER)),0) FROM user', []))
  const active = Number(await qVal("SELECT COUNT(*) FROM invoice WHERE Status IN ('active','send_on_hold','sendedwarn')", []))
  const pending = Number(await qVal("SELECT COUNT(*) FROM Payment_report WHERE payment_Status = 'waiting'", []))
  const today0 = statsPeriod('today').start
  const since = today0 - 29 * 86400
  const days = new Map()
  const dayKey = (t) => new Date((t + 12600) * 1000).toISOString().slice(0, 10)
  for (let i = 0; i < 30; i++) days.set(dayKey(since + i * 86400), { orders: 0, revenue: 0 })
  for (const r of await qAll("SELECT time_sell, price_product FROM invoice WHERE CAST(time_sell AS INTEGER) >= ? AND Status != 'Unpaid' AND name_product != 'سرویس تست'", [since])) {
    const k = dayKey(Number(r.time_sell))
    const d = days.get(k)
    if (d) { d.orders++; d.revenue += parseInt(r.price_product) || 0 }
  }
  const series = [...days].map(([k, v]) => ({ date: k, jdate: jdate('m/d', Date.parse(k + 'T00:00:00Z') / 1000 - 12600, true), ...v }))
  const recent = await qAll('SELECT id_invoice, username, name_product, price_product, time_sell, Status FROM invoice ORDER BY CAST(time_sell AS INTEGER) DESC LIMIT 8', [])
  return { ok: true, today, month, users, balance, active_services: active, pending_payments: pending, series, recent }
}
