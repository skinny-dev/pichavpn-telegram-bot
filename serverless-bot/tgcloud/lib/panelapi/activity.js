// activity.php: monthly heatmap data, one value per Jalali day.
import { qAll } from './qb.js'
import { statsTs, jd } from './stats.js'
import { jdate } from '../fmt.js'
import { jalaliToGregorian } from '../sms.js'
import { now, latinDigits, sqlite } from './util.js'

const NON_CASH = "'add balance by admin','low balance by admin','wallet','cost','capital_injection','cost_migrated','capital_migrated'"
const dayStart = (jy, jm, jdd) => { const [gy, gm, gd] = jalaliToGregorian(jy, jm, jdd); return Date.UTC(gy, gm - 1, gd) / 1000 - 12600 }
const roundHalf = (x) => Math.sign(x) * Math.round(Math.abs(x))

export async function activity(q) {
  let jy, jm
  const m = /^(\d{4})[/-](\d{1,2})$/.exec(latinDigits(String(q.month ?? '')))
  if (m && +m[2] >= 1 && +m[2] <= 12) { jy = +m[1]; jm = +m[2] } else [jy, jm] = jd('Y/n', now()).split('/').map(Number)
  const start = dayStart(jy, jm, 1)
  const next = jm === 12 ? dayStart(jy + 1, 1, 1) : dayStart(jy, jm + 1, 1)
  const days = Math.round((next - start) / 86400)
  const end = start + days * 86400 - 1
  const byDay = async (tsExpr, from, where, value = 'COUNT(*)') => {
    const out = new Array(days).fill(0)
    for (const r of await qAll(sqlite(`SELECT CAST((${tsExpr} - ${start}) / 86400 AS INTEGER) d, ${value} v FROM ${from} WHERE ${where} AND ${tsExpr} BETWEEN ? AND ? GROUP BY d`), [start, end])) {
      const i = Number(r.d)
      if (i >= 0 && i < days) out[i] = Number(r.v)
    }
    return out
  }
  const tsInv = 'CAST(i.time_sell AS INTEGER)'
  const sale = sqlite("CAST(i.price_product AS SIGNED) > 0 AND LOWER(i.Status) NOT IN ('unpaid','expire','unsuccessful','reject') AND i.name_product NOT LIKE '%تست%'")
  const tsPay = statsTs('time'), tsSo = statsTs('time')
  const renew = "type IN ('extend_user','extend_user_by_admin') AND LOWER(status) = 'paid'"
  const s = {}
  s.revenue = await byDay(tsPay, 'Payment_report', `payment_Status = 'paid' AND Payment_Method NOT IN (${NON_CASH})`, 'SUM(CAST(price AS SIGNED))')
  s.orders = await byDay(tsInv, 'invoice i', sale)
  s.orders_sum = await byDay(tsInv, 'invoice i', sale, 'SUM(CAST(i.price_product AS SIGNED))')
  s.renew = await byDay(tsSo, 'service_other', renew)
  s.renew_sum = await byDay(tsSo, 'service_other', renew, 'SUM(CAST(price AS SIGNED))')
  s.new_users = await byDay('CAST(register AS INTEGER)', 'user', "register != '' AND register NOT GLOB '*[^0-9]*'")
  s.tests = await byDay(tsInv, 'invoice i', "i.name_product LIKE '%تست%'")
  const exp = await byDay(tsPay, 'Payment_report', "Payment_Method = 'cost'", 'SUM(CAST(price AS SIGNED))')
  ;(await byDay('created_at', 'expenses', "COALESCE(NULLIF(kind,''),'general') <> 'dividend'", 'SUM(amount)')).forEach((v, i) => { exp[i] += v })
  ;(await byDay('txn_date', 'fin_txn', `status = 'posted' AND (type = 'expense' OR (type = 'purchase' AND meta LIKE '%"expense":true%'))`, 'SUM(total)')).forEach((v, i) => { exp[i] += v })
  s.expenses = exp
  s.support = await byDay(statsTs('time'), 'support_message', '1=1')
  s.net = s.revenue.map((r, i) => r - s.expenses[i])
  const today = now()
  const list = []
  for (let i = 0; i < days; i++) {
    const ts = start + i * 86400 + 43200
    list.push({ day: i + 1, weekday: Number(jdate('w', ts, true)), future: start + i * 86400 > today })
  }
  const series = Object.fromEntries(Object.entries(s).map(([k, a]) => [k, a.map(roundHalf)]))
  const totals = Object.fromEntries(Object.entries(s).map(([k, a]) => [k, a.reduce((x, y) => x + y, 0)]))
  return { ok: true, year: jy, month: jm, title: jdate('F Y', start + 43200), days: list, series, totals }
}
