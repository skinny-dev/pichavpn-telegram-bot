// Anonymised support conversations for designing the AI support agent (CLI only):
//   npx tgcloud run endpoints/admin_support_export '{"limit":60}'
// Shows customer text → the answer a human gave, with numbers / links / @names / ids blanked. Nothing identifies a customer.
import { EndpointError } from 'sdk'
import { all, sql } from '../lib/db.js'

const clean = (v) => String(v ?? '')
  .replace(/https?:\/\/\S+/gi, '<لینک>')
  .replace(/(vless|vmess|trojan|ss):\/\/\S+/gi, '<کانفیگ>')
  .replace(/@[A-Za-z0-9_]{3,}/g, '@<نام>')
  .replace(/\b09\d{9}\b/g, '<تلفن>')
  .replace(/\b\d{16}\b/g, '<کارت>')
  .replace(/[0-9۰-۹٠-٩]{6,}/g, '<عدد>')
  .replace(/\s+/g, ' ').trim().slice(0, 400)

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const limit = Math.min(Math.max(parseInt(input?.limit) || 40, 1), 150)
  const rows = await all(sql`SELECT name_departman AS dept, text, result, status FROM support_message WHERE text IS NOT NULL AND text <> '' ORDER BY id DESC LIMIT ${limit * 3}`)
  const answered = rows.filter((r) => String(r.result ?? '').trim() !== '' && r.result !== '0').slice(0, limit)
  const depts = {}
  for (const r of rows) depts[r.dept] = (depts[r.dept] ?? 0) + 1
  return { scanned: rows.length, answered: answered.length, by_department: depts, samples: answered.map((r) => ({ dept: r.dept, q: clean(r.text), a: clean(r.result) })) }
}
