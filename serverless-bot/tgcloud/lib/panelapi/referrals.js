// referral_links.php (money math, overview) + the referral and admin routes of dashboard/api.php.
import { bytesToB64 } from '../b64.js'
import { qAll, qOne, qRun, qVal } from './qb.js'
import { kvGet } from '../db.js'
import { phpRound } from '../fmt.js'
import { fail, str, now } from './util.js'
import { moneyInput } from './payments.js'
import { accParseDateTime } from './stats.js'

const RESERVED = ['start', 'usertest', 'buy', 'help', 'admin', 'test']
export function normalizeCode(code) {
  code = str(code).trim().toLowerCase()
  return /^[a-z][a-z0-9_-]{2,39}$/.test(code) && !RESERVED.includes(code) ? code : ''
}
async function generateCode() {
  for (let i = 0; i < 20; i++) {
    const b = crypto.getRandomValues(new Uint8Array(6))
    const c = ('ad_' + bytesToB64(b).replace(/\+/g, 'x').replace(/\//g, 'y').replace(/=/g, '').slice(0, 6)).toLowerCase()
    if (Number(await qVal('SELECT COUNT(*) FROM referral_links WHERE code = ?', [c])) === 0) return c
  }
  return 'ad_' + now()
}
const percentOf = (link, global) => (!parseInt(link.pays_commission) ? 0 : link.commission_percent !== null && link.commission_percent !== '' ? parseFloat(link.commission_percent) : global)
function money(link, revenue, paidOut, global) {
  const pct = percentOf(link, global)
  const commission = Math.round((revenue * pct) / 100)
  const cost = parseInt(link.price) || 0
  return { percent: pct, commission, paid: paidOut, due: Math.max(0, commission - paidOut), cost, net: revenue - cost - commission, roi: cost + commission > 0 ? phpRound(((revenue - cost - commission) / (cost + commission)) * 100, 1) : null }
}

export async function overview() {
  const global = parseFloat(await qVal('SELECT affiliatespercentage FROM setting LIMIT 1', [])) || 0
  const sale = "CAST(i.price_product AS INTEGER) > 0 AND LOWER(i.Status) NOT IN ('unpaid','expire','unsuccessful','reject') AND i.name_product NOT LIKE '%تست%'"
  const rows = await qAll(`SELECT l.*,
      (SELECT COUNT(*) FROM referral_signups s WHERE s.link_id = l.id) AS signups,
      (SELECT COUNT(DISTINCT i.id_user) FROM referral_signups s JOIN invoice i ON i.id_user = s.user_id WHERE s.link_id = l.id AND ${sale}) AS buyers,
      (SELECT COUNT(*) FROM referral_signups s JOIN invoice i ON i.id_user = s.user_id WHERE s.link_id = l.id AND ${sale}) AS orders,
      (SELECT COALESCE(SUM(CAST(i.price_product AS INTEGER)),0) FROM referral_signups s JOIN invoice i ON i.id_user = s.user_id WHERE s.link_id = l.id AND ${sale}) AS revenue,
      (SELECT COALESCE(SUM(p.amount),0) FROM referral_payouts p WHERE p.link_id = l.id) AS paid_out,
      (SELECT e.created_at FROM expenses e WHERE e.id = l.expense_id) AS expense_at
    FROM referral_links l ORDER BY CAST(l.active AS INTEGER) DESC, l.id DESC`, [])
  const links = rows.map((r) => {
    const m = money(r, parseInt(r.revenue) || 0, parseInt(r.paid_out) || 0, global)
    const o = { ...r }
    for (const k of ['id', 'signups', 'buyers', 'orders', 'revenue', 'price', 'pays_commission', 'active', 'created_at']) o[k] = parseInt(r[k]) || 0
    o.expense_id = r.expense_id === null ? null : parseInt(r.expense_id)
    o.expense_at = r.expense_at === null ? null : parseInt(r.expense_at)
    o.ad_date = r.ad_date === null || r.ad_date === undefined ? null : parseInt(r.ad_date)
    o.commission_percent = r.commission_percent === null ? null : parseInt(r.commission_percent)
    delete o.paid_out
    return { ...o, ...m }
  })
  return { links, global_percent: global }
}

export async function list() {
  const o = await overview()
  const tgRef = await qAll('SELECT u.id, u.username, u.affiliatescount FROM user u WHERE CAST(u.affiliatescount AS INTEGER) > 0 ORDER BY CAST(u.affiliatescount AS INTEGER) DESC LIMIT 50', [])
  return { ok: true, links: o.links, global_percent: o.global_percent, bot: str(await kvGet('config:usernamebot')).replace(/^@+/, ''),
    tg_referrers: tgRef.map((r) => ({ id: str(r.id), username: str(r.username), count: parseInt(r.affiliatescount) || 0 })) }
}

export async function save(b) {
  const name = str(b.name).trim()
  if (name === '' || [...name].length > 200) fail('نام تبلیغ‌دهنده/کمپین را وارد کنید', 422)
  const platform = ['instagram', 'telegram', 'youtube', 'tiktok', 'website', 'other'].includes(str(b.platform)) ? str(b.platform) : 'other'
  const price = moneyInput(b.price ?? '0')
  const pays = b.pays_commission ? 1 : 0
  const pct = b.commission_percent === '' || b.commission_percent === null || b.commission_percent === undefined ? null : parseInt(b.commission_percent) || 0
  if (pct !== null && (pct < 0 || pct > 100)) fail('درصد پورسانت باید بین ۰ تا ۱۰۰ باشد', 422)
  const tg = str(b.tg_user_id).trim()
  if (tg !== '' && !/^\d{5,15}$/.test(tg)) fail('آیدی عددی تلگرام نامعتبر است (برای اینستاگرام/خارج از تلگرام خالی بگذارید)', 422)
  const contact = [...str(b.contact).trim()].slice(0, 200).join('')
  const notes = [...str(b.notes).trim()].slice(0, 1000).join('')
  const active = 'active' in b && !b.active ? 0 : 1
  let adDate = null
  if (str(b.ad_date).trim() !== '') {
    adDate = accParseDateTime(str(b.ad_date))
    if (adDate === null) fail('تاریخ تبلیغ را به‌صورت 1405/07/14 یا 1405/07/14 15:30 بنویسید', 422)
  }
  const editId = parseInt(b.id ?? 0) || 0
  let code = str(b.code).trim()
  if (code !== '') { code = normalizeCode(code); if (code === '') fail('کد لینک: فقط حروف انگلیسی، عدد، _ و - (۳ تا ۴۰ کاراکتر، شروع با حرف)', 422) }
  if (editId === 0) {
    code = code !== '' ? code : await generateCode()
    if (Number(await qVal('SELECT COUNT(*) FROM referral_links WHERE code = ?', [code])) > 0) fail('این کد قبلاً استفاده شده است', 409)
    const r = await qRun('INSERT INTO referral_links (name, platform, code, tg_user_id, contact, price, pays_commission, commission_percent, active, notes, ad_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [name, platform, code, tg === '' ? null : tg, contact, price, pays, pct, active, notes, adDate, now()])
    return { ok: true, id: Number(r.lastInsertRowid), code }
  }
  const cur = await qOne('SELECT code, expense_id FROM referral_links WHERE id = ?', [editId])
  if (!cur) fail('لینک پیدا نشد', 404)
  await qRun('UPDATE referral_links SET name=?, platform=?, tg_user_id=?, contact=?, price=?, pays_commission=?, commission_percent=?, active=?, notes=?, ad_date=? WHERE id=?',
    [name, platform, tg === '' ? null : tg, contact, price, pays, pct, active, notes, adDate, editId])
  if (cur.expense_id !== null) await qRun('UPDATE expenses SET amount = ?, created_at = COALESCE(?, created_at) WHERE id = ?', [price, adDate, parseInt(cur.expense_id)])
  return { ok: true, id: editId, code: cur.code }
}

export async function remove(b) {
  const id = parseInt(b.id ?? 0) || 0
  if (Number(await qVal('SELECT COUNT(*) FROM referral_signups WHERE link_id = ?', [id])) > 0) fail('این لینک کاربر ثبت‌شده دارد؛ به‌جای حذف، غیرفعالش کنید', 409)
  await qRun('DELETE FROM referral_payouts WHERE link_id = ?', [id])
  await qRun('DELETE FROM referral_links WHERE id = ?', [id])
  return { ok: true }
}

export async function payout(b) {
  const id = parseInt(b.id ?? 0) || 0
  const amount = moneyInput(b.amount ?? '0')
  if (amount <= 0) fail('مبلغ پرداخت نامعتبر است', 422)
  if (!Number(await qVal('SELECT COUNT(*) FROM referral_links WHERE id = ?', [id]))) fail('لینک پیدا نشد', 404)
  await qRun('INSERT INTO referral_payouts (link_id, amount, note, created_at) VALUES (?,?,?,?)', [id, amount, [...str(b.note).trim()].slice(0, 300).join(''), now()])
  return { ok: true }
}

export async function bookCost(b, admin) {
  const id = parseInt(b.id ?? 0) || 0
  let bookAt = null
  if (str(b.date).trim() !== '') {
    bookAt = accParseDateTime(str(b.date))
    if (bookAt === null) fail('تاریخ را به‌صورت 1405/07/14 یا 1405/07/14 15:30 بنویسید', 422)
  }
  const l = await qOne('SELECT * FROM referral_links WHERE id = ?', [id])
  if (!l) fail('لینک پیدا نشد', 404)
  if (l.expense_id !== null) fail('هزینهٔ این کمپین قبلاً ثبت شده است', 409)
  if ((parseInt(l.price) || 0) <= 0) fail('قیمت کمپین صفر است', 422)
  const e = await qRun("INSERT INTO expenses (amount, description, created_at, admin_id, kind) VALUES (?,?,?,?,'advertising')",
    [parseInt(l.price), 'تبلیغات: ' + l.name, bookAt ?? (l.ad_date !== null ? parseInt(l.ad_date) : parseInt(l.created_at)), String(admin.username)])
  const eid = Number(e.lastInsertRowid)
  await qRun('UPDATE referral_links SET expense_id = ? WHERE id = ?', [eid, id])
  return { ok: true, expense_id: eid }
}

export async function payouts(q) {
  const rows = await qAll('SELECT id, amount, note, created_at FROM referral_payouts WHERE link_id = ? ORDER BY id DESC LIMIT 200', [parseInt(q.id ?? 0) || 0])
  return { ok: true, rows: rows.map((r) => ({ id: parseInt(r.id), amount: parseInt(r.amount), note: str(r.note), created_at: parseInt(r.created_at) })) }
}

// ---------------------------------------------------------------- admins
const ROLES = { administrator: 'مدیر کل (همه‌ی بخش‌ها + پنل وب)', Seller: 'فروشنده (دسترسی محدود در ربات)', support: 'پشتیبان (چت پشتیبانی در پنل وب، بدون رسید پرداخت‌ها)' }
const adminCount = async () => Number(await qVal("SELECT COUNT(*) FROM admin WHERE rule = 'administrator'", []))

export async function admins(admin) {
  const rows = await qAll("SELECT a.id_admin, a.username, a.rule, u.username AS tg_username, u.namecustom FROM admin a LEFT JOIN user u ON u.id = a.id_admin ORDER BY CASE a.rule WHEN 'administrator' THEN 1 WHEN 'Seller' THEN 2 WHEN 'support' THEN 3 ELSE 0 END, a.id_admin", [])
  return { ok: true, rows: rows.map((r) => ({ id_admin: str(r.id_admin), username: str(r.username), rule: str(r.rule), tg_username: str(r.tg_username), name: str(r.namecustom),
    web_login: ['administrator', 'support'].includes(str(r.rule)) && str(r.username) !== str(r.id_admin), self: str(r.id_admin) === str(admin.id_admin) })), roles: ROLES }
}

export async function adminSave(b, admin) {
  const rule = str(b.rule)
  if (!(rule in ROLES)) fail('نقش نامعتبر است', 422)
  let username = str(b.username).trim()
  const editId = str(b.id).trim()
  let newId, isSelf = false
  if (editId === '') {
    newId = str(b.id_admin).trim()
    if (!/^\d{5,15}$/.test(newId)) fail('آیدی عددی تلگرام نامعتبر است', 422)
    if (Number(await qVal('SELECT COUNT(*) FROM admin WHERE id_admin = ?', [newId])) > 0) fail('این آیدی قبلاً ادمین است', 409)
    username = username === '' ? newId : username
  } else {
    const row = await qOne('SELECT * FROM admin WHERE id_admin = ?', [editId])
    if (!row) fail('ادمین پیدا نشد', 404)
    newId = editId
    username = username === '' ? str(row.username) : username
    isSelf = str(row.id_admin) === str(admin.id_admin)
    if (isSelf && rule !== 'administrator') fail('نقش حساب خودتان را نمی‌توانید کاهش دهید', 409)
    if (row.rule === 'administrator' && rule !== 'administrator' && (await adminCount()) <= 1) fail('حداقل یک مدیر کل باید بماند', 409)
  }
  if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(username)) fail('نام کاربری فقط حروف انگلیسی، عدد و _ . - @ (۳ تا ۶۴ کاراکتر)', 422)
  if (Number(await qVal('SELECT COUNT(*) FROM admin WHERE username = ? AND id_admin != ?', [username, newId])) > 0) fail('این نام کاربری قبلاً استفاده شده است', 409)
  // the Mini App recognises admins by their Telegram account: there is no password login on Serverless
  if (editId === '') await qRun('INSERT INTO admin (id_admin, username, password, rule) VALUES (?,?,?,?)', [newId, username, '!' + [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join(''), rule])
  else await qRun('UPDATE admin SET username = ?, rule = ? WHERE id_admin = ?', [username, rule, newId])
  return { ok: true, id: newId }
}

export async function adminDelete(b, admin) {
  const id = str(b.id).trim()
  const row = await qOne('SELECT * FROM admin WHERE id_admin = ?', [id])
  if (!row) fail('ادمین پیدا نشد', 404)
  if (str(row.id_admin) === str(admin.id_admin)) fail('حساب خودتان را نمی‌توانید حذف کنید', 409)
  if (row.rule === 'administrator' && (await adminCount()) <= 1) fail('حداقل یک مدیر کل باید بماند', 409)
  await qRun('DELETE FROM admin WHERE id_admin = ?', [id])
  return { ok: true }
}
