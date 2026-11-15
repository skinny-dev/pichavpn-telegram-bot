// The panel through its REAL entry point (endpoints/panel.js), the way the Mini App calls it: no test shortcut loads the route modules for us.
import ep from '../../tgcloud/endpoints/panel.js'
export const handle = (r, query, body, tgId) => ep({ r, query, body }, { initData: { user: { id: Number(tgId) } } })
