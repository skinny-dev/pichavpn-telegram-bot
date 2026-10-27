// Query builder for the panel: SQL text with ? placeholders + a parameter list → sql`` (the sdk wants a template).
// A number parameter is sent as `(? + 0)`: the db layer binds numbers as text (the way PHP's PDO did), and SQLite
// never compares text with a number.
import { all, one, run, sql } from '../db.js'

export function Q(text, params = []) {
  const parts = String(text).split('?')
  if (parts.length - 1 !== params.length) throw new Error(`Q: ${parts.length - 1} placeholders, ${params.length} params`)
  let out = sql`${sql.raw(parts[0])}`
  params.forEach((p, i) => {
    out = typeof p === 'number' ? sql`${out}${sql.raw('(')}${p}${sql.raw(' + 0)' + parts[i + 1])}` : sql`${out}${p === undefined ? null : p}${sql.raw(parts[i + 1])}`
  })
  return out
}
export const qAll = (text, params) => all(Q(text, params))
export const qOne = async (text, params) => (await one(Q(text, params))) || null
export const qRun = (text, params) => run(Q(text, params))
export const qVal = async (text, params) => { const r = await qOne(text, params); return r ? Object.values(r)[0] : null }
/** a text column that is only digits (MySQL: col REGEXP '^[0-9]+$') */
export const isNum = (col) => `(${col} != '' AND ${col} NOT GLOB '*[^0-9]*')`
