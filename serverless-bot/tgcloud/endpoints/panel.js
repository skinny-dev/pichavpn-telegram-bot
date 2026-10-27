// Mini App panel API: Telegram.WebApp.Serverless.call('panel', { r, query, body }) → { status, body }
import { EndpointError } from 'sdk'
import { handle } from '../lib/panelapi/index.js'

export default async function (input, ctx) {
  if (!ctx || !ctx.initData || !ctx.initData.user) throw new EndpointError('unauthorized', { code: 'UNAUTHORIZED' })
  const { r, query, body } = input || {}
  return handle(r, query, body, ctx.initData.user.id)
}
