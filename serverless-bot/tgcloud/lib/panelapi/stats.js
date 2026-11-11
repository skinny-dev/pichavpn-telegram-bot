// stats_report.php on SQLite: period statistics, the accounting numbers and the Farsi text report.
import { jdate, phpRound } from '../fmt.js'
import { jalaliToGregorian } from '../sms.js'
import { numberFormat } from '../php.js'
import { qAll, qOne, qVal, isNum } from './qb.js'

const TEHRAN = 12600
const now = () => Math.floor(Date.now() / 1000)
export const jd = (f, ts) => jdate(f, ts, true)

export function statsPeriod(key, at = null) {
  at = at || now()
  const today0 = Math.floor((at + TEHRAN) / 86400) * 86400 - TEHRAN
  const [jy, jm] = jd('Y/n', at).split('/').map(Number)
  const monthStart = (y, m) => { const [gy, gm, gd] = jalaliToGregorian(y, m, 1); return Date.UTC(gy, gm - 1, gd) / 1000 - TEHRAN }
  const cur = monthStart(jy, jm)
  const [py, pm] = jm === 1 ? [jy - 1, 12] : [jy, jm - 1]
  switch (key) {
    case 'hour': return { title: 'آمار ۱ ساعت گذشته', start: at - 3600, end: at }
    case 'today': return { title: 'آمار روز فعلی', start: today0, end: at }
    case 'yesterday': return { title: 'آمار روز گذشته', start: today0 - 86400, end: today0 - 1 }
    case 'month': return { title: 'آمار ماه فعلی', start: cur, end: at }
    case 'lastmonth': return { title: 'آمار ماه گذشته', start: monthStart(py, pm), end: cur - 1 }
    default: return { title: 'آمار کلی ربات', start: 0, end: at }
  }
}

/** a column holding unix seconds or 'YYYY/MM/DD HH:MM:SS' (Tehran) → unix seconds */
export const statsTs = (col) => `(CASE WHEN ${isNum(col)} THEN CAST(${col} AS INTEGER) ELSE CAST(strftime('%s', replace(${col}, '/', '-')) AS INTEGER) - ${TEHRAN} END)`

const NON_CASH = "'add balance by admin','low balance by admin','wallet','cost','capital_injection','cost_migrated','capital_migrated'"
const ADMIN_SALE = "'manual invoice','add order by admin','extend by admin'"
const BAD_INVOICE = "('unpaid','expire','unsuccessful','reject')"

export const accExpenseKinds = () => ({
  purchase: 'خرید (بهای تمام‌شده)', salary: 'حقوق و دستمزد', advertising: 'تبلیغات', server: 'سرور و زیرساخت', tools: 'نرم‌افزار و ابزار',
  fee: 'کارمزد درگاه و بانک', tax: 'مالیات و عوارض', general: 'سایر هزینه‌ها', dividend: 'سود سهام / برداشت شرکا',
})
const KIND_RULES = {
  dividend: ['سهام', 'سهم شریک', 'سهم ', 'سود شریک', 'برداشت شریک', 'برداشت شخصی', 'تقسیم سود', 'dividend'],
  salary: ['حقوق', 'دستمزد', 'پشتیبان', 'کارمند', 'اپراتور', 'پاداش', 'salary'],
  advertising: ['تبلیغ', 'کمپین', 'اینستا', 'تلگرام ادز', 'ادز', 'بنر', 'اینفلوئنسر', 'اسپانسر', 'کلیک', 'ads', 'campaign'],
  tax: ['مالیات', 'عوارض', 'tax'],
  fee: ['کارمزد', 'درگاه', 'بانک', 'کارت', 'fee'],
  server: ['سرور', 'دامنه', 'هاست', 'vps', 'ssl', 'کلودفلر', 'cloudflare', 'آی‌پی', 'ایپی', 'ip ', 'دیتاسنتر', 'server', 'domain'],
  tools: ['ابزار', 'نرم‌افزار', 'نرم افزار', 'اشتراک ابزار', 'لایسنس', 'اپلیکیشن', 'اپ ', 'پریمیوم', 'premium', 'chatgpt', 'github', 'tool'],
  purchase: ['خرید', 'ترافیک', 'پنل', 'ساب', 'لایسنس vpn', 'تامین', 'تأمین', 'کانفیگ', 'حجم', 'گیگ', 'اکانت', 'purchase'],
}
export function accGuessKind(desc) {
  const d = String(desc ?? '').trim().toLowerCase()
  for (const [kind, words] of Object.entries(KIND_RULES)) for (const w of words) if (w !== '' && d.includes(w.toLowerCase())) return kind
  return null
}
export const accKindGroup = (k) => (k === 'purchase' ? 'cogs' : k === 'dividend' ? 'equity' : 'opex')
export const accKindIcon = (k) => ({ purchase: '🛒', salary: '👥', advertising: '📣', server: '🖥', tools: '🧰', fee: '🏦', tax: '🏛', general: '🧾', dividend: '🤝' })[k] ?? '🧾'

/** a date typed by a person → unix time ('' = now); Jalali or Gregorian, any digits. null = not understood */
export function accParseDateTime(input, at = null) {
  at = at ?? now()
  let s = String(input ?? '').trim()
  if (s === '') return at
  const map = { '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9, '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '٫': ':', '،': ' ' }
  s = s.replace(/[۰-۹٠-٩٫،]/g, (c) => map[c])
  if (/^\d{9,}$/.test(s)) return Number(s)
  const m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (!m) return null
  let [y, mo, d] = [+m[1], +m[2], +m[3]]
  if (y >= 1300 && y < 1700) {
    if (mo < 1 || mo > 12 || d < 1 || d > (mo <= 6 ? 31 : 30)) return null
    ;[y, mo, d] = jalaliToGregorian(y, mo, d)
  }
  const h = m[4] !== undefined && m[4] !== '' ? +m[4] : 12
  const i = m[5] !== undefined && m[5] !== '' ? +m[5] : 0
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || h > 23 || i > 59) return null
  return Date.UTC(y, mo - 1, d, h, i) / 1000 - TEHRAN
}
export const accFormatDateTime = (ts) => jd('Y/m/d H:i', Number(ts))

const N = (v) => Number(v ?? 0) || 0

/** money received by source (paid payments, cash rules as revenue); card-to-card split: confirmed by the bank SMS vs approved by an admin from a receipt */
export async function statsByMethod(start, end) {
  const rows = await qAll(`SELECT CASE WHEN Payment_Method = 'cart to cart' AND EXISTS (SELECT 1 FROM sms_inbox x WHERE x.id_order = Payment_report.id_order AND x.status = 'matched')
      THEN 'cart to cart sms' ELSE Payment_Method END m, COUNT(*) c, SUM(CAST(price AS INTEGER)) s FROM Payment_report
      WHERE payment_Status = 'paid' AND ${statsTs('time')} BETWEEN ? AND ? AND Payment_Method NOT IN (${NON_CASH}) GROUP BY m ORDER BY s DESC`, [start, end])
  return rows.map((x) => ({ m: String(x.m), c: Math.trunc(N(x.c)), s: N(x.s) }))
}

export async function statsCollect(start, end) {
  const r = {}
  const P = [start, end]
  const tsInv = 'CAST(i.time_sell AS INTEGER)'
  const isTest = "i.name_product LIKE '%تست%'"
  const sale = `CAST(i.price_product AS INTEGER) > 0 AND LOWER(i.Status) NOT IN ${BAD_INVOICE} AND NOT (${isTest})`
  const inv = `FROM invoice i LEFT JOIN user u ON u.id = i.id_user WHERE ${tsInv} BETWEEN ? AND ? AND ${sale}`
  let row = await qOne(`SELECT COUNT(*) c, SUM(CAST(i.price_product AS INTEGER)) p, SUM(CAST(i.Volume AS REAL)) v ${inv}`, P)
  r.orders = Math.trunc(N(row.c)); r.orders_sum = N(row.p); r.vol_service = N(row.v)
  row = await qOne(`SELECT SUM(CAST(i.Volume AS REAL)) v ${inv} AND i.name_product LIKE '%اضطراری%'`, P)
  r.vol_emergency = N(row.v)
  for (const [type, key] of [['n', 'agent_n'], ['n2', 'agent_n2']]) {
    row = await qOne(`SELECT COUNT(*) c, SUM(CAST(i.price_product AS INTEGER)) p ${inv} AND u.agent = '${type}'`, P)
    r[key] = Math.trunc(N(row.c)); r[key + '_sum'] = N(row.p)
  }
  row = await qOne(`SELECT COUNT(*) c, SUM(CAST(i.price_product AS INTEGER)) p,
      AVG(CASE WHEN ${isNum('u.register')} AND ${tsInv} >= CAST(u.register AS INTEGER) THEN ${tsInv} - CAST(u.register AS INTEGER) END) a,
      SUM(CASE WHEN ${isNum('u.register')} AND ${tsInv} >= CAST(u.register AS INTEGER) THEN 1 ELSE 0 END) ac
    ${inv} AND NOT EXISTS (SELECT 1 FROM invoice j WHERE j.id_user = i.id_user AND CAST(j.price_product AS INTEGER) > 0
      AND LOWER(j.Status) NOT IN ${BAD_INVOICE} AND j.name_product NOT LIKE '%تست%' AND CAST(j.time_sell AS INTEGER) < CAST(i.time_sell AS INTEGER))`, P)
  r.first = Math.trunc(N(row.c)); r.first_sum = N(row.p); r.first_avg_sec = N(row.a); r.first_avg_n = Math.trunc(N(row.ac))

  const tsSo = statsTs('time')
  for (const [types, key] of [["'extend_user','extend_user_by_admin'", 'renew'], ["'extend_user'", 'extra_placeholder']]) {
    if (key === 'extra_placeholder') {
      row = await qOne(`SELECT COUNT(*) c, SUM(CAST(price AS INTEGER)) p FROM service_other WHERE type IN ('extra_user') AND LOWER(status) = 'paid' AND ${tsSo} BETWEEN ? AND ?`, P)
      r.extra = Math.trunc(N(row.c)); r.extra_sum = N(row.p)
    } else {
      row = await qOne(`SELECT COUNT(*) c, SUM(CAST(price AS INTEGER)) p FROM service_other WHERE type IN (${types}) AND LOWER(status) = 'paid' AND ${tsSo} BETWEEN ? AND ?`, P)
      r[key] = Math.trunc(N(row.c)); r[key + '_sum'] = N(row.p)
    }
  }
  row = await qOne(`SELECT SUM(CAST(value AS REAL)) v FROM service_other WHERE type = 'extra_user' AND LOWER(status) = 'paid' AND ${tsSo} BETWEEN ? AND ?`, P)
  r.vol_extra = N(row.v)

  const tsPay = statsTs('time')
  const pay = `FROM Payment_report WHERE payment_Status = 'paid' AND ${tsPay} BETWEEN ? AND ?`
  row = await qOne(`SELECT COUNT(*) c, SUM(CAST(price AS INTEGER)) p ${pay} AND Payment_Method NOT IN (${NON_CASH},${ADMIN_SALE})`, P)
  r.wallet_in = Math.trunc(N(row.c)); r.wallet_in_sum = N(row.p)
  row = await qOne(`SELECT COUNT(*) c, SUM(CAST(price AS INTEGER)) p ${pay} AND Payment_Method IN (${ADMIN_SALE})`, P)
  r.admin_in = Math.trunc(N(row.c)); r.admin_in_sum = N(row.p)
  r.by_method = await statsByMethod(start, end)
  row = await qOne(`SELECT COUNT(DISTINCT id_user) c ${pay} AND Payment_Method NOT IN (${NON_CASH}) AND id_user IS NOT NULL AND id_user != ''`, P)
  r.payers = Math.trunc(N(row.c))
  row = await qOne(`SELECT COUNT(DISTINCT i.id_user) c ${inv}`, P)
  r.buyers = Math.trunc(N(row.c))

  // this server has no wallet_withdraw table: refunds are the «low balance by admin» payments
  row = await qOne(`SELECT COUNT(*) c, SUM(CAST(price AS INTEGER)) p ${pay} AND Payment_Method = 'low balance by admin'`, P)
  r.wallet_out = Math.trunc(N(row.c)); r.wallet_out_sum = N(row.p)

  row = await qOne(`SELECT COUNT(*) c, SUM(CAST(price AS INTEGER)) p FROM Payment_report WHERE Payment_Method = 'capital_injection' AND ${tsPay} BETWEEN ? AND ?`, P)
  r.cap = Math.trunc(N(row.c)); r.cap_sum = N(row.p)
  row = await qOne('SELECT COUNT(*) c, SUM(amount) p FROM capital_entries WHERE created_at BETWEEN ? AND ?', P)
  r.cap += Math.trunc(N(row.c)); r.cap_sum += N(row.p)

  const by = {}
  for (const k of Object.keys(accExpenseKinds())) by[k] = { c: 0, s: 0 }
  row = await qOne(`SELECT COUNT(*) c, SUM(CAST(price AS INTEGER)) p FROM Payment_report WHERE Payment_Method = 'cost' AND ${tsPay} BETWEEN ? AND ?`, P)
  by.general.c += Math.trunc(N(row.c)); by.general.s += N(row.p)
  for (const x of await qAll("SELECT COALESCE(NULLIF(kind,''),'general') k, COUNT(*) c, SUM(amount) p FROM expenses WHERE created_at BETWEEN ? AND ? GROUP BY k", P)) {
    const k = by[x.k] ? x.k : 'general'
    by[k].c += Math.trunc(N(x.c)); by[k].s += N(x.p)
  }
  const invMap = { cogs: 'purchase', exp_salary: 'salary', exp_advertising: 'advertising', exp_server: 'server', exp_tools: 'tools', exp_fee: 'fee', exp_tax: 'tax', dividends: 'dividend', drawings: 'dividend' }
  for (const x of await qAll(`SELECT t.type, a.system_key sk, COUNT(*) c, SUM(t.total) p FROM fin_txn t LEFT JOIN fin_accounts a ON a.id = t.category_account_id
      WHERE t.status = 'posted' AND t.txn_date BETWEEN ? AND ? AND (t.type IN ('expense', 'capital_out', 'distribution') OR (t.type = 'purchase' AND t.meta LIKE '%"expense":true%'))
      GROUP BY t.type, a.system_key`, P)) {
    const k = ['capital_out', 'distribution'].includes(x.type) ? 'dividend' : invMap[String(x.sk)] ?? 'general'
    by[k].c += Math.trunc(N(x.c)); by[k].s += N(x.p)
  }
  row = await qOne("SELECT COUNT(*) c, SUM(total) p FROM fin_txn WHERE status = 'posted' AND type = 'capital_in' AND txn_date BETWEEN ? AND ?", P)
  r.cap += Math.trunc(N(row.c)); r.cap_sum += N(row.p)
  r.by_kind = by
  for (const g of ['cogs', 'opex', 'equity']) { r[g] = 0; r[g + '_sum'] = 0 }
  for (const [k, v] of Object.entries(by)) { const g = accKindGroup(k); r[g] += v.c; r[g + '_sum'] += v.s }
  r.div = r.equity; r.div_sum = r.equity_sum
  r.exp = r.cogs + r.opex; r.exp_sum = r.cogs_sum + r.opex_sum
  r.exp_ads = by.advertising.c; r.exp_ads_sum = by.advertising.s

  row = await qOne(`SELECT COUNT(*) c FROM invoice i WHERE ${tsInv} BETWEEN ? AND ? AND ${isTest}`, P)
  r.tests = Math.trunc(N(row.c))
  row = await qOne(`SELECT COUNT(*) c FROM user WHERE ${isNum('register')} AND CAST(register AS INTEGER) BETWEEN ? AND ?`, P)
  r.new_users = Math.trunc(N(row.c))

  r.revenue = r.wallet_in_sum + r.admin_in_sum
  r.net_sales = r.revenue - r.wallet_out_sum
  r.gross = r.net_sales - r.cogs_sum
  r.net = r.gross - r.opex_sum
  r.retained = r.net - r.div_sum
  r.count_all = r.wallet_in + r.admin_in
  return r
}

export async function statsOverall() {
  const v = (q) => qVal(q, [])
  const sale = `CAST(price_product AS INTEGER) > 0 AND LOWER(Status) NOT IN ${BAD_INVOICE} AND name_product NOT LIKE '%تست%'`
  const o = {}
  o.users = N(await v('SELECT COUNT(*) FROM user'))
  o.balance = Math.trunc(N(await v('SELECT COALESCE(SUM(CAST(Balance AS INTEGER)),0) FROM user')))
  o.with_service = N(await v('SELECT COUNT(DISTINCT id_user) FROM invoice'))
  o.buyers = N(await v(`SELECT COUNT(DISTINCT id_user) FROM invoice WHERE ${sale}`))
  o.test_users = N(await v("SELECT COUNT(DISTINCT id_user) FROM invoice WHERE name_product LIKE '%تست%'"))
  o.test_then_buy = N(await v(`SELECT COUNT(DISTINCT t.id_user) FROM invoice t JOIN invoice p ON p.id_user = t.id_user AND p.price_product + 0 > 0 AND LOWER(p.Status) NOT IN ${BAD_INVOICE} AND p.name_product NOT LIKE '%تست%' WHERE t.name_product LIKE '%تست%'`))
  o.test_only = o.test_users - o.test_then_buy
  o.agents_n = N(await v("SELECT COUNT(*) FROM user WHERE agent = 'n'"))
  o.agents_n2 = N(await v("SELECT COUNT(*) FROM user WHERE agent = 'n2'"))
  o.panels = N(await v('SELECT COUNT(*) FROM marzban_panel'))
  o.active_services = N(await v("SELECT COUNT(*) FROM invoice WHERE CAST(price_product AS INTEGER) > 0 AND LOWER(Status) IN ('active','send_on_hold','sendedwarn')"))
  o.active_sum = Math.trunc(N(await v("SELECT COALESCE(SUM(CAST(price_product AS INTEGER)),0) FROM invoice WHERE CAST(price_product AS INTEGER) > 0 AND LOWER(Status) IN ('active','send_on_hold','sendedwarn')")))
  o.auto_users = null
  o.auto_services = null
  o.repeat_buyers = N(await v(`SELECT COUNT(*) FROM (SELECT id_user FROM (
      SELECT id_user FROM invoice WHERE ${sale}
      UNION ALL SELECT id_user FROM service_other WHERE type IN ('extend_user','extend_user_by_admin') AND LOWER(status) = 'paid') x
      GROUP BY id_user HAVING COUNT(*) >= 2) y`))
  o.methods = await qAll(`SELECT Payment_Method m, COUNT(*) c, SUM(CAST(price AS INTEGER)) s FROM Payment_report WHERE payment_Status = 'paid'
      AND Payment_Method NOT IN ('cost','capital_injection','cost_migrated','capital_migrated') GROUP BY Payment_Method ORDER BY s DESC`, [])
  const d = await statsCollect(now() - 30 * 86400, now())
  o.revenue_30d = d.revenue
  o.volume_30d = d.vol_service + d.vol_extra
  return o
}

const METHODS = {
  'cart to cart sms': '💳 کارت به کارت (خودکار، با پیامک)', 'cart to cart': '💳 کارت به کارت (رسید، تأیید ادمین)', variza: '🏦 واریزا', 'Currency Rial 1': '🏦 درگاه ریالی ۱', 'Currency Rial 2': '🏦 درگاه ریالی ۲', 'Currency Rial 3': '🏦 درگاه ریالی ۳', AbanGateway: '🏦 درگاه آبان', 'Star Telegram': '⭐ استار تلگرام', tetraminator: '🏦 تترامینیتور', 'after pay': '🧾 پرداخت بعد از دریافت',
  'manual invoice': '✍️ فاکتور دستی', 'add order by admin': '🛠 سفارش ثبت‌شده توسط ادمین', 'extend by admin': '🛠 تمدید توسط ادمین', wallet: '👛 پرداخت از کیف پول (داخلی)',
  'add balance by admin': '🎁 شارژ توسط ادمین (هدیه)', 'low balance by admin': '➖ کسر موجودی توسط ادمین', zarinpal: 'زرین‌پال', aqayepardakht: 'آقای پرداخت',
  plisio: 'Plisio', nowpayment: 'NowPayments', 'arze digital offline': 'ارز دیجیتال (دستی)',
}
export const statsMethodLabel = (m) => METHODS[m] ?? m

function statsDuration(sec) {
  sec = Math.round(sec)
  if (sec < 60) return sec + ' ثانیه'
  if (sec < 3600) return Math.trunc(sec / 60) + ' دقیقه'
  if (sec < 86400) return phpRound(sec / 3600, 1) + ' ساعت'
  const d = Math.trunc(sec / 86400), h = Math.trunc((sec % 86400) / 3600)
  return d + ' روز' + (h ? ' و ' + h + ' ساعت' : '')
}
const pct = (a, b) => (b > 0 ? phpRound((a * 100) / b, 1) : 0)
const fa = (x) => numberFormat(Math.round(Number(x) || 0))
const vol = (x) => String(Number(x).toFixed(2)).replace(/0+$/, '').replace(/\.$/, '')

export async function statsReport(key) {
  const p = statsPeriod(key)
  const d = await statsCollect(p.start, p.end)
  const all = key === 'all' ? d : await statsCollect(0, now())
  const fmt = (t) => jd('Y/m/d H:i:s', t)
  const n = fa
  const L = ['🕐 <b>' + p.title + '</b>', '']
  if (key !== 'all') L.push('⏳ بازه تایم : ' + fmt(p.start) + ' تا ' + fmt(p.end), '')
  let o = null
  if (key === 'all') {
    o = await statsOverall()
    L.push('👥 <b>کاربران</b>', '• کل کاربران : ' + n(o.users) + ' نفر', '• دارای سرویس : ' + n(o.with_service) + ' نفر',
      '• مشتری (دارای خرید) : ' + n(o.buyers) + ' نفر — ' + pct(o.buyers, o.users) + '٪ کاربران',
      '• دریافت‌کننده تست : ' + n(o.test_users) + ' نفر — ' + pct(o.test_users, o.users) + '٪ کاربران',
      '• تست بدون خرید : ' + n(o.test_only) + ' نفر · تست و سپس خرید : ' + n(o.test_then_buy) + ' نفر', '• موجودی کیف پول‌ها : ' + n(o.balance) + ' تومان', '')
  }
  L.push('💰 <b>درآمد و فروش</b>', '🛍 تعداد فروش : ' + n(d.orders) + ' عدد — ' + n(d.orders_sum) + ' تومان',
    '🆕 خرید اول : ' + n(d.first) + ' عدد — ' + n(d.first_sum) + ' تومان' + (d.orders ? ' (' + pct(d.first, d.orders) + '٪ فروش)' : ''),
    '🧲 تمدید : ' + n(d.renew) + ' عدد — ' + n(d.renew_sum) + ' تومان')
  if (d.buyers > 0 || d.payers > 0) {
    L.push('👤 مشتری‌های این بازه : ' + n(d.buyers) + ' نفر خرید کردند · ' + n(d.payers) + ' نفر پول دادند',
      '💳 میانگین پرداخت هر مشتری : ' + n(d.payers ? d.revenue / d.payers : 0) + ' تومان · میانگین هر سفارش : ' + n(d.orders ? d.orders_sum / d.orders : 0) + ' تومان · سفارش به ازای هر مشتری : ' + (d.buyers ? phpRound(d.orders / d.buyers, 2) : 0))
  }
  L.push('📦 حجم اضافه : ' + n(d.extra) + ' عدد — ' + n(d.extra_sum) + ' تومان', '🛒 خرید نمایندگان عادی : ' + n(d.agent_n) + ' عدد — ' + n(d.agent_n_sum) + ' تومان',
    '🛒 خرید نمایندگان پیشرفته : ' + n(d.agent_n2) + ' عدد — ' + n(d.agent_n2_sum) + ' تومان', '',
    '💳 <b>پول دریافتی (مبنای درآمد)</b>', '• پرداخت مشتریان (درگاه‌ها) : ' + n(d.wallet_in) + ' عدد — ' + n(d.wallet_in_sum) + ' تومان',
    '• ثبت‌شده توسط ادمین : ' + n(d.admin_in) + ' عدد — ' + n(d.admin_in_sum) + ' تومان',
    ...(d.by_method?.length ? ['', '🏦 <b>دریافتی به تفکیک منبع</b>', ...d.by_method.map((m) => '• ' + statsMethodLabel(m.m) + ' : ' + n(m.c) + ' عدد — ' + n(m.s) + ' تومان' + (d.revenue > 0 ? ' (' + pct(m.s, d.revenue) + '٪)' : ''))] : []), '',
    '📒 <b>صورت سود و زیان</b>', '• فروش (پول دریافتی) : ' + n(d.revenue) + ' تومان')
  if (d.wallet_out_sum > 0) L.push('• − بازپرداخت به مشتریان : ' + n(d.wallet_out) + ' عدد — ' + n(d.wallet_out_sum) + ' تومان')
  L.push('• − خرید (بهای تمام‌شده) : ' + n(d.cogs) + ' عدد — ' + n(d.cogs_sum) + ' تومان',
    '= <b>سود ناخالص : ' + n(d.gross) + ' تومان</b>' + (d.net_sales > 0 ? ' (' + pct(d.gross, d.net_sales) + '٪ فروش)' : ''),
    '• − هزینه‌های عملیاتی : ' + n(d.opex) + ' عدد — ' + n(d.opex_sum) + ' تومان')
  for (const [k, v] of Object.entries(d.by_kind)) if (accKindGroup(k) === 'opex' && v.c > 0) L.push('   ↳ ' + accKindIcon(k) + ' ' + accExpenseKinds()[k] + ' : ' + n(v.c) + ' عدد — ' + n(v.s) + ' تومان')
  L.push('= <b>سود خالص : ' + n(d.net) + ' تومان</b>' + (d.net_sales > 0 ? ' (' + pct(d.net, d.net_sales) + '٪ فروش)' : ''),
    '• − ' + accKindIcon('dividend') + ' سود سهام / برداشت شرکا : ' + n(d.div) + ' عدد — ' + n(d.div_sum) + ' تومان', '= <b>سود باقی‌مانده : ' + n(d.retained) + ' تومان</b>', '',
    '🏦 <b>سرمایه (جدا از سود و فروش)</b>', '• ورود سرمایه در این بازه : ' + n(d.cap) + ' عدد — ' + n(d.cap_sum) + ' تومان')
  if (key !== 'all') L.push('• ورود سرمایه از ابتدا : ' + n(all.cap_sum) + ' تومان')
  L.push('• سرمایه + سود باقی‌مانده (از ابتدا) : ' + n(all.cap_sum + all.retained) + ' تومان', '',
    '🔋 <b>حجم فروخته‌شده : ' + vol(d.vol_service + d.vol_extra) + ' گیگابایت</b>', '• از خرید سرویس : ' + vol(d.vol_service) + ' · از حجم اضافه : ' + vol(d.vol_extra),
    '• اینترنت معمولی : ' + vol(d.vol_service - d.vol_emergency) + ' · اضطراری : ' + vol(d.vol_emergency), '',
    '🔑 اکانت تست : ' + n(d.tests) + ' عدد · 👤 کاربر جدید : ' + n(d.new_users) + ' نفر',
    '⏱ میانگین زمان عضویت تا اولین خرید : ' + (d.first_avg_n > 0 ? statsDuration(d.first_avg_sec) + ' (' + n(d.first_avg_n) + ' کاربر)' : '—'), '')
  if (key !== 'all') L.push('💰 فروش (از ابتدا) : ' + n(all.revenue) + ' تومان', '📈 سود ناخالص (از ابتدا) : ' + n(all.gross) + ' تومان', '💵 سود خالص (از ابتدا) : ' + n(all.net) + ' تومان', '🧮 سود باقی‌مانده (از ابتدا) : ' + n(all.retained) + ' تومان')
  if (key === 'all') {
    L.push('', '📈 <b>شاخص‌ها</b>', '• درآمد هر مشتری از ابتدا (کل درآمد ÷ همه مشتری‌ها) : ' + n(o.buyers ? d.revenue / o.buyers : 0) + ' تومان',
      '• سهم تمدید از درآمد : ' + pct(d.renew_sum, d.revenue) + '٪', '• وفاداری (مشتری با ۲ خرید/تمدید یا بیشتر) : ' + pct(o.repeat_buyers, o.buyers) + '٪',
      '• درآمد ۳۰ روز اخیر : ' + n(o.revenue_30d) + ' تومان · حجم : ' + vol(o.volume_30d) + ' گیگابایت',
      '• سرویس‌های فعال : ' + n(o.active_services) + ' عدد — ' + n(o.active_sum) + ' تومان',
      '• نمایندگان : ' + n(o.agents_n + o.agents_n2) + ' (عادی ' + n(o.agents_n) + ' · پیشرفته ' + n(o.agents_n2) + ') · پنل‌ها : ' + n(o.panels))
  }
  return L.join('\n')
}
