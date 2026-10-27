// Inline mode (admins look up users with @bot …): handled by the main bot's code (relay).
import { relay } from '../lib/picha.js'

export default async function (q, ctx) {
  try {
    await relay(ctx.update)
  } catch (e) {
    console.error(e)
  }
}
