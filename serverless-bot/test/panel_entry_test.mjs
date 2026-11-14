// The panel through its REAL entry point (endpoints/panel.js), as the Mini App calls it — not through test shortcuts that import every module.
// Guards against a route module that is never loaded in production (support, finance, activity, promo, referrals, studio all 404'd once).
//   node --no-warnings --import ./register.mjs panel_entry_test.mjs <export dir>
import { seed } from './seed.mjs'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const ep = (await import('../tgcloud/endpoints/panel.js')).default
const admin = { initData: { user: { id: 99001 } } }
for (const r of ['me', 'overview', 'stats', 'list', 'activity', 'support_unread', 'support_threads', 'pay_pending', 'order_options', 'promo_state', 'referrals', 'admins', 'fin_overview', 'mg_order', 'studio_state']) {
  const x = await ep({ r, query: r === 'list' ? { resource: 'product' } : {}, body: {} }, admin)
  check(`${r} exists on the production entry point`, x.body?.error !== 'مسیر نامعتبر است', JSON.stringify(x).slice(0, 80))
}
check('a stranger is refused', await ep({ r: 'me' }, { initData: { user: { id: 1 } } }).then((x) => x.body.authed === false))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
