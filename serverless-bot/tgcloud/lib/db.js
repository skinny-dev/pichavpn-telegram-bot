// Database helpers. Raw SQL with sql`` everywhere (the same queries the PHP bot ran), values always as parameters.
import { db } from 'sdk'
import { sql as sdkSql } from 'sdk/db'
import COLUMNS from './columns.js'
import { phpFloat } from './fmt.js'

/**
 * sql`` with every number bound as text, the way PHP's PDO sends values: a number written into a TEXT column is
 * then stored as "101", not "101.0". SQLite still does the math (Balance - '300'); a bound value compared with a
 * computed number needs `+ 0` (text is never equal to a number in SQLite).
 */
const bindable = (v) => (typeof v === 'number' && Number.isFinite(v) ? phpFloat(v) : v)
export function sql(strings, ...values) { return sdkSql(strings, ...values.map(bindable)) }
sql.raw = (s) => sdkSql.raw(s)
export const one = (q) => db.get(q)
export const all = (q) => db.all(q)
export const run = (q) => db.run(q)

/** table name → its columns (generated with schema.js); identifiers in dynamic SQL must come from here */
export const TABLES = COLUMNS

const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"'

/** INSERT (OR REPLACE / OR IGNORE) of a plain object; unknown columns are dropped. */
export async function insert(table, row, mode = '') {
  const cols = knownCols(table, Object.keys(row))
  if (!cols.length) return { rowsAffected: 0 }
  const vals = cols.map((c) => row[c])
  const q = sql.raw(`INSERT ${mode ? 'OR ' + mode + ' ' : ''}INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (`)
  return run(sql`${q}${joinParams(vals)}${sql.raw(')')}`)
}

/** UPDATE table SET … WHERE whereCol = whereVal */
export async function update(table, set, whereCol, whereVal) {
  const cols = knownCols(table, Object.keys(set))
  if (!cols.length) return { rowsAffected: 0 }
  let q = sql.raw(`UPDATE ${ident(table)} SET `)
  let first = true
  let out = sql`${q}`
  for (const c of cols) {
    out = sql`${out}${sql.raw((first ? '' : ', ') + ident(c) + ' = ')}${set[c]}`
    first = false
  }
  return run(sql`${out}${sql.raw(' WHERE ' + ident(knownCols(table, [whereCol])[0]) + ' = ')}${whereVal}`)
}

function knownCols(table, cols) {
  const known = TABLES[table]
  if (!known) throw new Error('unknown table ' + table)
  return cols.filter((c) => known.includes(c))
}
function joinParams(vals) {
  return vals.reduce((acc, v, i) => (i === 0 ? sql`${v}` : sql`${acc}, ${v}`), sql``)
}

// ---- kv (small state)
export async function kvGet(key) {
  const r = await one(sql`SELECT value FROM kv WHERE key = ${key}`)
  return r ? r.value : null
}
export async function kvSet(key, value) {
  await run(sql`INSERT INTO kv (key, value, updated_at) VALUES (${key}, ${value}, ${Math.floor(Date.now() / 1000)})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
}
export async function kvDel(key) {
  await run(sql`DELETE FROM kv WHERE key = ${key}`)
}
