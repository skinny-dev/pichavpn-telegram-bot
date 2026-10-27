// A member left / was restricted in a channel the bot watches: same handling as in index.php
import { dispatch } from '../lib/mode.js'

export default async function (_payload, ctx) {
  await dispatch(ctx.update)
}
