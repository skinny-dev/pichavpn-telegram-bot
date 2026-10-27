// Every pre_checkout_query update goes through the same port of index.php
import { handleUpdate } from '../lib/bot.js'

export default async function (_payload, ctx) {
  await handleUpdate(ctx.update)
}
