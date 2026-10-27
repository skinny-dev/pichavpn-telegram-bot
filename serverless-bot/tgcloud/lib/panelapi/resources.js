// picha_resources() of dashboard/api.php: every table the panel edits, described once; the UI builds itself from the schema route.
import { qAll } from './qb.js'
import { accExpenseKinds } from './stats.js'

const ORDER_GROUPS = { active: 'فعال', onhold: 'در انتظار اولین اتصال', expired: 'منقضی‌شده', disabled: 'غیرفعال', removed: 'حذف‌شده', unpaid: 'پرداخت‌نشده / ناموفق', other: 'سایر' }
const STATUS_MAP = {
  active: ['active', 'فعال'], sendedwarn: ['active', 'فعال (هشدار ارسال شد)'], send_on_hold: ['onhold', 'در انتظار اولین اتصال'],
  end_of_time: ['expired', 'پایان زمان'], end_of_volume: ['expired', 'پایان حجم'],
  disabledn: ['disabled', 'غیرفعال'], disablebyadmin: ['disabled', 'غیرفعال توسط ادمین'], disabled: ['disabled', 'غیرفعال'],
  removebyuser: ['removed', 'حذف توسط کاربر'], removebyadmin: ['removed', 'حذف توسط ادمین'], removeTime: ['removed', 'حذف خودکار (انقضا)'],
  unpaid: ['unpaid', 'پرداخت‌نشده'], Unpaid: ['unpaid', 'پرداخت‌نشده'], Unsuccessful: ['unpaid', 'ناموفق'], expire: ['unpaid', 'منقضی‌شده (پرداخت‌نشده)'], reject: ['unpaid', 'رد شده'],
}
const GROUP_TONES = { active: 'success', onhold: 'warning', expired: 'destructive', disabled: 'secondary', removed: 'secondary', unpaid: 'destructive', other: 'secondary' }
export const orderStatusKeys = () => Object.keys(STATUS_MAP)
const statuses = () => Object.fromEntries(Object.entries(STATUS_MAP).map(([k, v]) => [k, v[1]]))
const statusTones = () => Object.fromEntries(Object.entries(STATUS_MAP).map(([k, v]) => [k, GROUP_TONES[v[0]]]))
export function orderGroupExpr() {
  const by = {}
  for (const [raw, [g]] of Object.entries(STATUS_MAP)) (by[g] ||= []).push("'" + raw.toLowerCase() + "'")
  let when = ''
  for (const [g, list] of Object.entries(by)) when += ` WHEN LOWER(i.Status) IN (${list.join(',')}) THEN '${g}'`
  return `CASE${when} ELSE 'other' END`
}
const AGENTS = { f: 'کاربر عادی', n: 'نماینده عادی', n2: 'نماینده پیشرفته' }
const SALE = { active: 'موجود', disable: 'ناموجود' }

async function orderCategories() {
  const o = {}
  for (const r of await qAll('SELECT remark FROM category ORDER BY CAST(sort_order AS INTEGER), id')) o[String(r.remark)] = String(r.remark)
  return o
}
async function orderPanels() {
  const o = {}
  for (const r of await qAll("SELECT DISTINCT Service_location AS c FROM invoice WHERE Service_location IS NOT NULL AND Service_location != '' ORDER BY 1")) o[String(r.c)] = String(r.c)
  return o
}

/** column = [key, label, type, extras] like the PHP arrays */
const col = (key, label, type, extra = {}) => ({ key, label, type, ...extra })

export async function resources() {
  const cats = await orderCategories(), panels = await orderPanels()
  return {
    users: {
      table: 'user', pk: 'id', title: 'کاربران', create: false, delete: false, import: true,
      search: ['id', 'username', 'namecustom', 'number'], order: 'register', dir: 'DESC',
      cols: [
        col('id', 'آیدی عددی', 'text'), col('username', 'نام کاربری', 'text'), col('namecustom', 'نام نمایشی', 'text', { edit: true }), col('number', 'شماره', 'text', { edit: true }),
        col('Balance', 'موجودی (تومان)', 'int', { edit: true }), col('agent', 'نقش', 'enum', { edit: true, options: AGENTS }),
        col('User_Status', 'وضعیت', 'enum', { edit: true, options: { Active: 'فعال', block: 'مسدود' } }), col('pricediscount', 'درصد تخفیف', 'int', { edit: true }),
        col('maxbuyagent', 'سقف خرید نماینده', 'int', { edit: true }), col('score', 'امتیاز', 'int', { edit: true }), col('limit_usertest', 'محدودیت تست', 'int', { edit: true }),
        col('affiliatescount', 'تعداد زیرمجموعه', 'int'), col('register', 'تاریخ عضویت', 'ts'),
      ],
    },
    orders: {
      table: 'invoice', pk: 'id_invoice', title: 'سفارشات', create: false, delete: false, import: true,
      from: '`invoice` i LEFT JOIN `user` u ON u.id = i.id_user', alias: 'i', datecol: 'time_sell', summary: true,
      search: ['id_invoice', 'username', 'id_user', 'name_product', 'u_name'], order: 'time_sell', dir: 'DESC',
      cols: [
        col('id_invoice', 'شماره سفارش', 'text'), col('time_sell', 'زمان', 'ts'),
        col('u_name', 'نام کاربر', 'text', { expr: "COALESCE(NULLIF(u.namecustom,''), NULLIF(NULLIF(u.username,''),'none'), i.id_user)" }),
        col('id_user', 'آیدی کاربر', 'text'), col('username', 'نام سرویس', 'text'), col('name_product', 'محصول', 'text'),
        col('cat', 'دسته‌بندی محصول', 'enum', { options: cats, expr: '(SELECT p.category FROM product p WHERE p.name_product = i.name_product LIMIT 1)' }),
        col('otype', 'نوع سفارش', 'enum', { options: { paid: 'خرید', free: 'رایگان / هدیه', test: 'تست' }, tones: { paid: 'default', free: 'secondary', test: 'warning' },
          expr: "CASE WHEN i.name_product LIKE '%تست%' THEN 'test' WHEN CAST(i.price_product AS SIGNED) = 0 THEN 'free' ELSE 'paid' END" }),
        col('agent', 'نوع خریدار', 'enum', { options: AGENTS, expr: "COALESCE(NULLIF(u.agent,''),'f')" }),
        col('price_product', 'مبلغ (تومان)', 'int', { edit: true }), col('Volume', 'حجم (GB)', 'int', { edit: true }), col('Service_time', 'مدت (روز)', 'int', { edit: true }),
        col('Service_location', 'پنل', 'enum', { options: panels }),
        col('Status', 'وضعیت', 'enum', { edit: true, options: statuses(), tones: statusTones() }),
        col('sgrp', 'گروه وضعیت', 'enum', { options: ORDER_GROUPS, tones: GROUP_TONES, expr: orderGroupExpr() }),
        col('note', 'یادداشت', 'text', { edit: true }),
      ],
    },
    products: {
      table: 'product', pk: 'id', title: 'محصولات', create: true, delete: true, import: true,
      search: ['name_product', 'code_product', 'category'], order: 'sort_order', dir: 'ASC',
      cols: [
        col('id', 'شناسه', 'int'), col('name_product', 'نام محصول', 'text', { edit: true, req: true }), col('price_product', 'قیمت (تومان)', 'int', { edit: true }),
        col('Volume_constraint', 'حجم (GB)', 'int', { edit: true }), col('Service_time', 'مدت (روز)', 'int', { edit: true }), col('Location', 'پنل', 'text', { edit: true }),
        col('category', 'دسته‌بندی', 'text', { edit: true }), col('agent', 'قابل خرید برای', 'enum', { edit: true, options: { ...AGENTS, all: 'همه' } }),
        col('note', 'توضیحات', 'text', { edit: true }), col('sort_order', 'ترتیب', 'int', { edit: true }), col('status_product', 'وضعیت فروش', 'enum', { edit: true, options: SALE }),
      ],
      defaults: { status_product: 'active', agent: 'f', data_limit_reset: 'no_reset', one_buy_status: '0', hide_panel: '{}', note: '', price_product: '0', Volume_constraint: '0', Service_time: '0' },
    },
    categories: {
      table: 'category', pk: 'id', title: 'دسته‌بندی‌ها', create: true, delete: true, import: true, search: ['remark'], order: 'sort_order', dir: 'ASC',
      cols: [col('id', 'شناسه', 'int'), col('remark', 'نام دسته', 'text', { edit: true, req: true }), col('sort_order', 'ترتیب', 'int', { edit: true }), col('status', 'وضعیت فروش', 'enum', { edit: true, options: SALE })],
      defaults: { status: 'active' },
    },
    payments: {
      table: 'Payment_report', pk: 'id', title: 'پرداخت‌ها', create: false, delete: false, import: false,
      search: ['id_user', 'id_order', 'Payment_Method'], order: 'id', dir: 'DESC',
      cols: [col('id', 'شناسه', 'int'), col('time', 'زمان', 'str'), col('id_user', 'کاربر', 'text'), col('price', 'مبلغ (تومان)', 'int'), col('Payment_Method', 'روش پرداخت', 'text'),
        col('payment_Status', 'وضعیت', 'text'), col('id_order', 'کد پیگیری', 'text')],
    },
    expenses: {
      table: 'expenses', pk: 'id', title: 'هزینه‌ها', create: true, delete: true, import: true, search: ['description', 'payer', 'payee'], order: 'created_at', dir: 'DESC', autots: 'created_at',
      cols: [col('id', 'شناسه', 'int'), col('created_at', 'تاریخ و ساعت (خالی = همین الان)', 'dt', { edit: true }), col('kind', 'نوع هزینه', 'enum', { edit: true, options: accExpenseKinds() }),
        col('description', 'نام / توضیحات', 'text', { edit: true, req: true }), col('payer', 'پرداخت‌کننده', 'text', { edit: true }), col('payee', 'مقصد / دریافت‌کننده', 'text', { edit: true }),
        col('amount', 'مبلغ (تومان)', 'int', { edit: true, req: true })],
      defaults: { kind: 'general' },
    },
    capital: {
      table: 'capital_entries', pk: 'id', title: 'ورود سرمایه', create: true, delete: true, import: true, search: ['description'], order: 'created_at', dir: 'DESC', autots: 'created_at',
      cols: [col('id', 'شناسه', 'int'), col('created_at', 'تاریخ و ساعت (خالی = همین الان)', 'dt', { edit: true }), col('amount', 'مبلغ (تومان)', 'int', { edit: true, req: true }),
        col('description', 'توضیحات', 'text', { edit: true })],
    },
  }
}
