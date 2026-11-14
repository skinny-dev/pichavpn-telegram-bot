// The elseif chain of index.php after the checks, in the same order. Each route: async (c) => true when it handled the update.
import { start } from './routes/start.js'
import { services } from './routes/services.js'
import { config } from './routes/config.js'
import { extendRoutes } from './routes/extend.js'
import { manageRoutes } from './routes/manage.js'
import { usertestRoutes } from './routes/usertest.js'
import { supportRoutes } from './routes/support.js'
import { buyRoutes } from './routes/buy.js'
import { bulkRoutes } from './routes/bulk.js'
import { payRoutes } from './routes/pay.js'
import { adminPayRoutes } from './admin/payments.js'
import { adminRelayRoutes } from './admin/relay.js'
import { adminGatewayRoutes } from './admin/gateways.js'
import { adminCareRoutes } from './admin/care.js'
import { careRoutes } from './care.js'
import { fitRoutes, adminFitRoutes } from './fit.js'
import { pulseRoutes } from './pulse.js'
import { adminPulseRoutes } from './admin/pulse.js'
import { adminMenuRoutes } from './admin/menu.js'
import { starsRoutes } from './routes/stars.js'
import { miscRoutes } from './routes/misc.js'
import { lateRoutes } from './routes/late.js'

export const routes = [
  ...pulseRoutes, // first: it only counts a pulse click and then lets the normal route handle the real action
  ...start,
  ...services,
  ...config,
  ...extendRoutes,
  ...manageRoutes,
  ...usertestRoutes,
  ...supportRoutes,
  ...buyRoutes,
  ...bulkRoutes,
  ...payRoutes,
  ...miscRoutes,
  ...careRoutes,
  ...fitRoutes,
  ...starsRoutes,
  ...lateRoutes,
]

// admin.php, for admins, after the customer routes
export const adminRoutes = [
  ...adminRelayRoutes,
  ...adminGatewayRoutes,
  ...adminCareRoutes,
  ...adminFitRoutes,
  ...adminPulseRoutes,
  ...adminPayRoutes,
  ...adminMenuRoutes,
]
