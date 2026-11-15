// Gateway health check: is each ENABLED payment gateway reachable right now? A gateway found disconnected is hidden from the payment
// menu (catalog.js stepPaymentKb) so nobody pays into it for nothing, and it comes back by itself when it answers again.
// Runs as the cron job `gatehealth` (every 2 minutes) — never in a customer's path. A change is reported to the administrators.
//   • Variza / Paychi confirm payments through the payment relay → the relay must answer (and the gateway's own address, when no relay is used)
//   • Tetraminator → its API must answer
// Hysteresis: hidden after 2 failed checks in a row (a single timeout is not an outage), shown again after the first good one.
// Stale data (the checker stopped) counts as healthy — see gatewayDownSet().
import { one, all, sql, kvGet, kvSet } from './db.js'
import { fetch } from 'sdk'
import { withTimeout, abortAfter } from './timer.js'
import { sendmessage } from './tg.js'

const now = () => Math.floor(Date.now() / 1000)
export const FAILS_TO_HIDE = 2
export const NAMES = { variza: 'واریزا', paychi: 'پی‌چی', tetraminator: 'تتراِمیناتور (پرداخت آنلاین)' }
const pay = async (k) => String((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay ?? '').trim()
const filled = (v) => v !== '' && v !== '0'
const relayUrl = async () => String((await kvGet('config:pay_relay_url')) || '').replace(/\/+$/, '')

/** any HTTP answer below 500 means «the host is up» (401/404 are fine: we only ask whether the road is open) */
export async function reach(url) {
  try {
    const res = await withTimeout(fetch(url, { method: 'GET', ...abortAfter(8000) }), 8000)
    return res.status < 500 ? { ok: true } : { ok: false, reason: 'HTTP ' + res.status }
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 80) } }
}
export const PROBES = {
  reach,
  tetra: async () => {
    const { tetraCall } = await import('./tetraminator.js')
    const r = await tetraCall('GET', '/payment/inquiry/diagprobe', null, 8000)
    return r.http > 0 && r.http < 500 ? { ok: true } : { ok: false, reason: r.error || 'HTTP ' + r.http }
  },
}

/** gateway → {enabled, check(probes)}: only what is switched on is checked */
const CHECKS = {
  variza: {
    enabled: async () => (await pay('variza_status')) === 'onvariza' && filled(await pay('variza_api_token')),
    check: async (p) => {
      const relay = await relayUrl() // Variza is called through the relay when there is one
      if (relay) { const r = await p.reach(relay + '/pull'); return r.ok ? r : { ok: false, reason: 'relay: ' + r.reason } }
      const api = await pay('variza_api_url')
      return p.reach(/^https:\/\//.test(api) ? api : 'https://variza.ir/api/v1')
    },
  },
  paychi: {
    enabled: async () => (await pay('paychi_status')) === 'onpaychi' && filled(await pay('paychi_api_key')),
    check: async (p) => {
      const relay = await relayUrl() // its confirmation comes back through the relay
      if (relay) { const r = await p.reach(relay + '/pull'); if (!r.ok) return { ok: false, reason: 'relay: ' + r.reason } }
      const base = await pay('paychi_base_url')
      return filled(base) ? p.reach(base.replace(/\/+$/, '')) : { ok: false, reason: 'آدرس ثبت نشده' }
    },
  },
  tetraminator: {
    enabled: async () => (await pay('tetraminator_status')) === 'ontetraminator' && filled(await pay('tetraminator_api_key')),
    check: (p) => p.tetra(),
  },
}

export const healthGet = async () => { try { return JSON.parse((await kvGet('gate:health')) || '{}') || {} } catch { return {} } }

/** one round: probe every enabled gateway, keep the state, tell `notify` about changes. → the new state */
export async function gateHealthRun(notify = async () => {}, probes = PROBES) {
  const state = await healthGet(), t = now()
  for (const [g, def] of Object.entries(CHECKS)) {
    if (!(await def.enabled())) { delete state[g]; continue }
    let r
    try { r = await def.check(probes) } catch (e) { r = { ok: false, reason: String((e && e.message) || e).slice(0, 80) } }
    const old = state[g] || { ok: true, fails: 0, since: t }
    const st = { ...old, at: t, last: r.ok }
    if (r.ok) {
      st.fails = 0
      if (old.ok === false) { st.ok = true; st.since = t; await notify(`🟢 ${NAMES[g]} دوباره وصل شد؛ دکمهٔ آن به منوی پرداخت برگشت.`) }
      st.ok = true; delete st.reason
    } else {
      st.fails = (old.fails || 0) + 1; st.reason = r.reason
      if (old.ok !== false && st.fails >= FAILS_TO_HIDE) { st.ok = false; st.since = t; await notify(`🔴 ${NAMES[g]} وصل نیست (${r.reason}). دکمهٔ آن از منوی پرداخت برداشته شد و به‌محض وصل شدن خودکار برمی‌گردد.`) }
      else st.ok = old.ok !== false
    }
    state[g] = st
  }
  await kvSet('gate:health', JSON.stringify(state))
  return state
}

/** the report goes to every administrator's chat */
export async function notifyAdmins(text) {
  for (const r of await all(sql`SELECT id_admin FROM admin WHERE rule = 'administrator'`)) if (/^\d+$/.test(String(r.id_admin))) await sendmessage(r.id_admin, text, null, 'HTML')
}
