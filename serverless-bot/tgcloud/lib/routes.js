// The elseif chain of index.php after the checks, in the same order. Each route: async (c) => true when it handled the update.
import { start } from './routes/start.js'
import { services } from './routes/services.js'

export const routes = [
  ...start,
  ...services,
]
