// The daily pulse for many people (CLI only): run from a cron on the VPS every minute —
//   * * * * * cd /root/picha-serverless-main && npx tgcloud run endpoints/pulse_tick '{}' >> /var/log/pulse_tick.log 2>&1
// The lazy cron inside the bot sends a few; this sends up to `batch` (default 100) per call, so a slot reaches everyone.
import { EndpointError } from 'sdk'
import { systemContext } from '../lib/bot.js'
import { pulseTick } from '../lib/pulse.js'

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const c = await systemContext()
  return pulseTick(c, { BATCH: Math.min(Math.max(parseInt(input?.batch) || 100, 1), 150) })
}
