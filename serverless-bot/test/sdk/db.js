// Local stand-in for Telegram Serverless `sdk/db`: tables become SQLite DDL (node:sqlite), raw sql`` queries run as is.
import { DatabaseSync } from 'node:sqlite'

export const sqlite = new DatabaseSync(process.env.TGC_DB || ':memory:')
const col = (type) => (name, opts) => {
  const c = { name, type, pk: false, ai: false, unique: false }
  const api = {
    _c: c,
    primaryKey(o) { c.pk = true; c.ai = !!o?.autoIncrement; return api },
    unique() { c.unique = true; return api },
    notNull() { return api }, default() { return api }, references() { throw new Error('no FK') },
  }
  return api
}
export const integer = col('INTEGER'), text = col('TEXT'), real = col('REAL'), blob = col('BLOB'), numeric = col('NUMERIC')
export const boolean = col('INTEGER'), json = col('TEXT')
const ix = (unique) => (name) => ({ on: (...cols) => ({ name, unique, cols }) })
export const index = ix(false), uniqueIndex = ix(true)
export function table(name, cols, cb) {
  const t = { _table: name, _cols: {} }
  for (const [k, v] of Object.entries(cols)) t[k] = t._cols[k] = v._c
  t._idx = cb ? Object.values(cb(t)) : []
  return t
}
export function ddl(t) {
  const cols = Object.values(t._cols).map((c) => `"${c.name}" ${c.type}${c.pk ? ' PRIMARY KEY' : ''}${c.ai ? ' AUTOINCREMENT' : ''}${c.unique ? ' UNIQUE' : ''}`)
  const out = [`CREATE TABLE IF NOT EXISTS "${t._table}" (${cols.join(', ')})`]
  for (const i of t._idx) out.push(`CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${i.name}" ON "${t._table}" (${i.cols.map((c) => `"${c.name}"`).join(', ')})`)
  return out
}
export function migrate(schema) {
  for (const t of Object.values(schema)) if (t && t._table) for (const s of ddl(t)) sqlite.exec(s)
}

export function sql(strings, ...values) {
  let text = strings[0]
  const params = []
  values.forEach((v, i) => {
    if (v && v._sql) { text += v.text; params.push(...v.params) } else if (v && v._raw !== undefined) { text += v._raw } else { text += '?'; params.push(norm(v)) }
    text += strings[i + 1]
  })
  return { _sql: true, text, params }
}
sql.raw = (s) => ({ _raw: s })
sql.join = (parts, sep) => parts.reduce((a, p, i) => (i ? sql`${a}${sql.raw(sep)}${p}` : p), sql``)
const norm = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)
const plain = (r) => (r ? { ...r } : null)
const prep = (q) => (q._sql ? [q.text, q.params] : [q, []])
export const db = {
  async all(q) { const [t, p] = prep(q); return sqlite.prepare(t).all(...p).map(plain) },
  async get(q) { const [t, p] = prep(q); return plain(sqlite.prepare(t).get(...p)) },
  async values(q) { const [t, p] = prep(q); return sqlite.prepare(t).all(...p).map((r) => Object.values(r)) },
  async run(q) { const [t, p] = prep(q); const r = sqlite.prepare(t).run(...p); return { rowsAffected: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid), rows: [] } },
}
export default { ...db, sql, table, integer, text, real, index, uniqueIndex }
