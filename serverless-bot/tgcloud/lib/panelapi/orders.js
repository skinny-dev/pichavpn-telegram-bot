// manual_order.php: an order for a customer outside Telegram — creates the VPN account and the invoice.
import { qAll, qOne, qRun, qVal } from './qb.js'
import { fail, str, now } from './util.js'
import { moneyInput } from './payments.js'
import { createUserFor, dataUser, subLink } from '../panel.js'
import { kvGet } from '../db.js'
import { randomHex } from '../php.js'

export async function options() {
  const panels = await qAll('SELECT name_panel, type, status FROM marzban_panel ORDER BY name_panel', [])
  const products = await qAll("SELECT id, name_product, code_product, price_product, Volume_constraint, Service_time, Location, category FROM product WHERE COALESCE(NULLIF(status_product,''),'active') = 'active' ORDER BY CAST(sort_order AS INTEGER), id", [])
  return { ok: true,
    panels: panels.map((p) => ({ name: str(p.name_panel), type: str(p.type), active: p.status !== 'disabled' })),
    products: products.map((p) => ({ id: Number(p.id), name: str(p.name_product), price: parseInt(p.price_product) || 0, volume: parseInt(p.Volume_constraint) || 0, days: parseInt(p.Service_time) || 0, location: str(p.Location), category: str(p.category) })) }
}

const serviceName = (v) => { v = str(v).trim().toLowerCase(); return /^[a-z0-9_]{3,32}$/.test(v) ? v : '' }

export async function create(b, admin) {
  const panelName = str(b.panel).trim()
  const panel = await qOne('SELECT * FROM marzban_panel WHERE name_panel = ?', [panelName])
  if (!panel) fail('پنل پیدا نشد', 404)
  if (panel.type === 'Manualsale') fail('برای پنل «فروش دستی» ساخت از اینجا پشتیبانی نمی‌شود', 422)
  const product = await qOne('SELECT * FROM product WHERE id = ?', [parseInt(b.product_id) || 0])
  if (!product) fail('محصول پیدا نشد', 404)
  if (![panelName, '/all'].includes(str(product.Location))) fail('این محصول برای این پنل نیست', 422)
  const tg = str(b.tg_user_id).trim()
  if (tg !== '') {
    if (!/^\d{1,15}$/.test(tg)) fail('آیدی عددی تلگرام نامعتبر است (برای مشتری خارج از تلگرام خالی بگذارید)', 422)
    if (!Number(await qVal('SELECT COUNT(*) FROM user WHERE id = ?', [tg]))) fail('این کاربر در ربات ثبت نشده است (باید یک‌بار ربات را استارت کرده باشد)؛ برای مشتری بدون تلگرام خالی بگذارید', 422)
  }
  const username = str(b.username).trim() === '' ? 'ext' + randomHex(3) : serviceName(b.username)
  if (username === '') fail('نام سرویس: فقط حروف انگلیسی کوچک، عدد و _ (۳ تا ۳۲ کاراکتر)', 422)
  let price = moneyInput(b.price ?? product.price_product)
  if (!('price' in b) || b.price === '' || b.price === null) price = parseInt(product.price_product) || 0
  const customer = [...str(b.customer).trim()].slice(0, 120).join('')
  const contact = [...str(b.contact).trim()].slice(0, 120).join('')
  const parts = ['مشتری: ' + customer, contact !== '' ? 'تماس: ' + contact : '', str(b.note).trim() !== '' ? str(b.note).trim() : '', 'ثبت دستی توسط ' + admin.username].filter((x) => x !== '' && x !== '0')
  const note = [...(customer === '' ? parts.slice(1) : parts).join(' | ')].slice(0, 480).join('')
  const domain = (await kvGet('config:domainhosts')) || ''
  const exists = Number(await qVal('SELECT COUNT(*) FROM invoice WHERE username = ?', [username]))
  const onPanel = await dataUser(panelName, username, domain)
  if (exists > 0 || (onPanel && onPanel.username)) fail('این نام سرویس قبلاً وجود دارد؛ نام دیگری انتخاب کنید یا خالی بگذارید', 409)
  const id = randomHex(4)
  const days = parseInt(product.Service_time) || 0, volume = parseInt(product.Volume_constraint) || 0
  await qRun('INSERT INTO invoice (id_user, id_invoice, username, time_sell, Service_location, name_product, price_product, Volume, Service_time, Status, note, notifctions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [tg === '' ? '0' : tg, id, username, String(now()), panelName, product.name_product, String(price), String(volume), String(days), 'unpaid', note, JSON.stringify({ volume: false, time: false })])
  const out = await createUserFor(panelName, product.code_product, username, { expire: days === 0 ? 0 : now() + days * 86400, data_limit: volume * 1024 ** 3, from_id: tg === '' ? '0' : tg, username: 'panel', type: 'buy' }, { domain })
  if (!out || !out.username) {
    await qRun("UPDATE invoice SET Status = 'Unsuccessful' WHERE id_invoice = ?", [id])
    const msg = out && out.msg !== undefined ? out.msg : 'unknown error'
    fail('ساخت سرویس روی پنل ناموفق بود: ' + (typeof msg === 'object' ? JSON.stringify(msg) : msg), 502)
  }
  await qRun("UPDATE invoice SET Status = 'active' WHERE id_invoice = ?", [id])
  const sub = subLink(panel, str(out.subscription_url), { id_invoice: id, username }, domain)
  return { ok: true, id, username, sub_link: sub, sub_page: `https://${domain}/sub/${id}`, configs: Object.values(out.configs || {}) }
}
