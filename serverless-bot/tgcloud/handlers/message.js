// Every message update: answered by the PHP bot, by this bot or by nobody, depending on the mode (lib/mode.js)
import { dispatch } from '../lib/mode.js'

export default async function (_payload, ctx) {
  await dispatch(ctx.update)
}
