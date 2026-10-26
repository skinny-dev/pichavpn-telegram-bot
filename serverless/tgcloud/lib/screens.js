// Each screen returns { text, reply_markup } (HTML). Callback data: m = menu, c / c:<id> = prices, s / s:<i> = my services, w = wallet, h = support.
import { call, NotConfigured } from './picha.js'
import { getSetting } from './store.js'
import { money, gb, esc, fa, jdate, daysLeft, STATUS } from './fmt.js'

const back = (to = 'm', text = '🔙 بازگشت') => [{ text, callback_data: to }]

async function mainBot() {
  return (await getSetting('main_bot')) || 'pichanet_bot'
}

async function buyRow() {
  return [{ text: '🛍 خرید در ربات اصلی', url: `https://t.me/${await mainBot()}` }]
}

export async function menu(user) {
  const rows = [
    [{ text: '🛒 تعرفه‌ها', callback_data: 'c' }, { text: '📦 سرویس‌های من', callback_data: 's' }],
    [{ text: '💰 کیف پول', callback_data: 'w' }, { text: '🆘 پشتیبانی', callback_data: 'h' }],
  ]
  try {
    const a = await call('admin', { tg_id: user.id })
    if (a.ok && a.admin) rows.push([{ text: '🖥 پنل مدیریت', web_app: { url: a.panel_url } }])
  } catch (e) {
    if (e instanceof NotConfigured) {
      return { text: '⚙️ ربات هنوز به سرور پیچا وصل نشده.\nروی سرور ربات دستور <code>php scripts/serverless_setup.php key</code> را بزنید و پیام /setup را که می‌دهد اینجا بفرستید.', reply_markup: { inline_keyboard: [] } }
    }
    throw e
  }
  const name = esc(user.first_name || '')
  return {
    text: `سلام ${name} 👋\nبه ربات <b>پیچا (نسخه تست)</b> خوش آمدید.\n\n🧪 این ربات روی Serverless تلگرام اجرا می‌شود و فعلاً فقط نمایش می‌دهد؛ خرید و تمدید در ربات اصلی است.`,
    reply_markup: { inline_keyboard: rows },
  }
}

export async function categories() {
  const r = await call('catalog')
  if (!r.ok) throw new Error('catalog ' + r.error)
  const rows = r.categories.map((c) => [{ text: c.name, callback_data: 'c:' + c.id }])
  rows.push(back())
  let text = '🛒 <b>تعرفه‌ها</b>\nیک دسته را انتخاب کنید:'
  if (r.promo) text = `🔥 <b>${esc(r.promo.title || 'تخفیف')}</b> تا ${jdate(r.promo.ends_at)}\n\n` + text
  if (!r.categories.length) text = '🛒 فعلاً سرویسی برای فروش نیست.'
  return { text, reply_markup: { inline_keyboard: rows } }
}

export async function category(id) {
  const r = await call('catalog')
  const c = (r.categories || []).find((x) => String(x.id) === String(id))
  if (!c) return categories()
  const lines = c.products.map((p) => {
    const price = p.old_price ? `<s>${money(p.old_price)}</s> ${money(p.price)}` : money(p.price)
    const meta = [p.gb ? fa(p.gb) + ' گیگ' : 'نامحدود', p.days ? fa(p.days) + ' روزه' : ''].filter(Boolean).join(' · ')
    return `▫️ <b>${esc(p.name)}</b>\n     ${meta}\n     💵 ${price}`
  })
  return {
    text: `🗂 <b>${esc(c.name)}</b>\n\n${lines.join('\n\n')}`,
    reply_markup: { inline_keyboard: [await buyRow(), back('c')] },
  }
}

export async function services(user) {
  const r = await call('user', { tg_id: user.id })
  if (!r.exists) {
    return { text: '📦 هنوز در پیچا حسابی ندارید. اول ربات اصلی را استارت کنید.', reply_markup: { inline_keyboard: [await buyRow(), back()] } }
  }
  if (!r.services.length) {
    return { text: '📦 سرویس فعالی ندارید.', reply_markup: { inline_keyboard: [await buyRow(), back()] } }
  }
  const rows = r.services.slice(0, 30).map((s, i) => [{ text: `${s.username} | ${s.product}`.slice(0, 60), callback_data: 's:' + i }])
  rows.push(back())
  return { text: `📦 <b>سرویس‌های شما</b> (${fa(r.services.length)})\nبرای دیدن حجم و زمان باقی‌مانده روی سرویس بزنید:`, reply_markup: { inline_keyboard: rows } }
}

export async function service(user, index) {
  const list = await call('user', { tg_id: user.id })
  const s = (list.services || [])[Number(index)]
  if (!s) return services(user)
  const r = await call('service', { tg_id: user.id, username: s.username })
  const kb = { inline_keyboard: [[{ text: '🔄 به‌روزرسانی', callback_data: 's:' + index }], [{ text: '♻️ تمدید در ربات اصلی', url: `https://t.me/${await mainBot()}` }], back('s')] }
  if (!r.ok || !r.live) {
    return { text: `📦 <code>${esc(s.username)}</code>\n\n⚠️ الان اطلاعات از پنل گرفته نشد؛ کمی بعد دوباره امتحان کنید.`, reply_markup: kb }
  }
  const left = r.data_limit ? gb(Math.max(0, r.data_limit - r.used)) : 'نامحدود'
  const online = r.online_at === 'online' ? '🟢 آنلاین' : r.online_at ? 'وصل شده' : 'هنوز وصل نشده'
  const lines = [
    `📦 <code>${esc(r.username)}</code>`,
    `🏷 ${esc(r.product)}  |  📍 ${esc(r.location)}`,
    '',
    `وضعیت: ${STATUS[r.status] || esc(r.status)}`,
    `📊 مصرف: ${gb(r.used)} از ${r.data_limit ? gb(r.data_limit) : 'نامحدود'}`,
    `🔋 باقی‌مانده: ${left}`,
    `⏳ انقضا: ${r.expire ? `${jdate(r.expire)} (${fa(daysLeft(r.expire))} روز)` : 'نامحدود'}`,
    `📶 اتصال: ${online}`,
  ]
  if (r.sub) lines.push('', '🔗 لینک اشتراک:', `<code>${esc(r.sub)}</code>`)
  return { text: lines.join('\n'), reply_markup: kb }
}

export async function wallet(user) {
  const r = await call('user', { tg_id: user.id })
  const text = r.exists
    ? `💰 <b>کیف پول</b>\n\nموجودی: <b>${money(r.balance)}</b>\n\nبرای شارژ از ربات اصلی استفاده کنید.`
    : '💰 هنوز در پیچا حسابی ندارید. اول ربات اصلی را استارت کنید.'
  return { text, reply_markup: { inline_keyboard: [await buyRow(), back()] } }
}

export async function support() {
  return {
    text: '🆘 <b>پشتیبانی</b>\n\nبرای پشتیبانی، در ربات اصلی بخش «پشتیبانی» را بزنید؛ تیکت شما مستقیم به ادمین‌ها می‌رسد.',
    reply_markup: { inline_keyboard: [[{ text: '💬 ربات اصلی', url: `https://t.me/${await mainBot()}` }], back()] },
  }
}
