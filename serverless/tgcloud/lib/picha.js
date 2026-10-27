// Calls the main Picha server (serverless_api.php on the bot server). Read-only: nothing here buys or changes anything.
import { fetch } from 'sdk'
import { getSetting } from './store.js'

export class NotConfigured extends Error {}

export async function callWith(url, key, a, params = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Picha-Key': key },
    body: JSON.stringify({ a, ...params }),
  })
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!data) throw new Error(`picha ${a}: HTTP ${res.status}`)
  return { status: res.status, ...data }
}

export async function call(a, params = {}) {
  const url = await getSetting('api_url')
  const key = await getSetting('api_key')
  if (!url || !key) throw new NotConfigured('not configured')
  return callWith(url, key, a, params)
}

/**
 * The whole bot: the update goes to serverless_relay.php, which runs the main bot's code and answers with this bot.
 * Returns true when the server handled it, false when the relay is off (then this bot shows its read-only menus).
 */
export async function relay(update) {
  const api = await getSetting('api_url')
  const key = await getSetting('api_key')
  if (!api || !key) throw new NotConfigured('not configured')
  const url = api.replace(/serverless_api\.php$/, 'serverless_relay.php')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Picha-Key': key },
    body: JSON.stringify(update),
  })
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`relay: HTTP ${res.status}`)
  return true
}
