// The panel API on Serverless: one endpoint, the same routes (and JSON) as dashboard/api.php.
// The caller is a Telegram Mini App user (initData is verified by the platform); they must be a panel admin.
import { qOne } from './qb.js'
import { PanelError, fail } from './util.js'
import * as core from './core.js'

const BRAND = 'پنل مدیریت پیچا'
const SUPPORT_ROUTES = ['logout', 'support_unread', 'support_threads', 'support_thread', 'support_reply', 'support_close', 'support_file']

export async function adminOf(tgId) {
  if (!tgId) return null
  const a = await qOne('SELECT * FROM admin WHERE id_admin = ?', [String(tgId)])
  return a && ['administrator', 'support'].includes(a.rule) ? a : null
}

/** routes added by the other modules register here: name or prefix → handler(route, q, body, admin) */
export const extra = { exact: {}, prefix: [] }

export async function panelRoute(route, q = {}, body = {}, tgId = null) {
  const admin = await adminOf(tgId)
  if (route === 'me') return { ok: true, authed: !!admin, user: admin ? admin.username : null, role: admin ? admin.rule : null, csrf: null, brand: BRAND, web_login: false }
  if (route === 'tg_login') {
    if (!admin) fail('این حساب تلگرام ادمین پنل نیست', 403)
    return { ok: true, user: admin.username, csrf: '', brand: BRAND, session: '' }
  }
  if (!admin) fail('ورود لازم است', 401)
  if (admin.rule === 'support' && !SUPPORT_ROUTES.includes(route)) fail('دسترسی این حساب فقط به بخش پشتیبانی است', 403)
  for (const [pre, fn] of extra.prefix) if (route.startsWith(pre)) return fn(route, q, body, admin)
  if (extra.exact[route]) return extra.exact[route](route, q, body, admin)
  switch (route) {
    case 'logout': return { ok: true }
    case 'schema': return core.schema()
    case 'list': case 'export': return core.list(route, q)
    case 'update': return core.update(body)
    case 'create': return core.create(body)
    case 'delete': return core.remove(body)
    case 'import': return core.importRows(body)
    case 'tree': return core.tree()
    case 'tree_save': return core.treeSave(body)
    case 'stats': return core.stats(q)
    case 'overview': return core.overview()
    default: fail('مسیر نامعتبر است', 404)
  }
}

/** → {status, body}: the shape the endpoint hands to the Mini App */
export async function handle(route, q, body, tgId) {
  try {
    const out = await panelRoute(String(route || ''), q || {}, body || {}, tgId)
    const status = out && out._status ? out._status : 200
    if (out && out._status) delete out._status
    return { status, body: out }
  } catch (e) {
    if (e instanceof PanelError) return { status: e.status, body: { ok: false, error: e.message, ...e.extra } }
    console.error('panel', route, e)
    return { status: 500, body: { ok: false, error: 'خطای داخلی سرور' } }
  }
}
