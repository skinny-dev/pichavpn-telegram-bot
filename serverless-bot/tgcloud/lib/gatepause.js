// A gateway that is down (or refuses us) is hidden from the payment menu for a while — port of gateway_pause.php.
// The pause lives in PaySetting as «<gateway>_pause_until» (unix time) and ends by itself.
import { one, run, sql } from './db.js'

const now = () => Math.floor(Date.now() / 1000)

export async function gatewayPaused(gateway) {
  const v = (await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${gateway + '_pause_until'}`))?.ValuePay ?? 0
  return Number(v) > now()
}

export async function gatewayPause(gateway, seconds) {
  await run(sql`INSERT OR REPLACE INTO PaySetting (NamePay, ValuePay) VALUES (${gateway + '_pause_until'}, ${String(now() + seconds)})`)
}

/** createPayVariza()'s answer: did Variza refuse because the account's own subscription limit is reached? (HTTP 422 «محدودیت اشتراک») */
export function varizaLimitReached(res) {
  if (!res || typeof res !== 'object' || Number(res.http_code) !== 422) return false
  let d = res.decoded
  if (!d || typeof d !== 'object') { try { d = JSON.parse(String(res.raw ?? '')) } catch { d = null } }
  const msg = d && typeof d === 'object' ? String(d.message ?? '') : ''
  return msg !== '' && msg.includes('محدودیت اشتراک')
}

/** how long to hide a gateway after a failed «create link»: 0 = not at all (a bad request); down / no answer / 5xx = 10 minutes; refused key = 30 */
export function gatewayOutageSeconds(res) {
  if (!res || typeof res !== 'object' || !res.error) return 0
  const code = Number(res.http_code ?? 0)
  if (code === 401 || code === 403) return 1800
  return code === 0 || code >= 500 ? 600 : 0
}
