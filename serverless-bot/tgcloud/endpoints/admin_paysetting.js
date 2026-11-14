// Payment settings from the CLI only (`node tools/setpay.mjs …` calls this; secrets are typed into hidden prompts there, never into a chat).
// Only the names below can be changed; the answer says WHICH were set (never the values).
import { EndpointError } from 'sdk'
import { run, all, sql } from '../lib/db.js'

const TEXT = (min, re) => (v) => typeof v === 'string' && v.trim().length >= min && re.test(v.trim())
const RULES = {
  paychi_status: (v) => ['onpaychi', 'offpaychi'].includes(v),
  paychi_base_url: (v) => /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:443)?(\/[^\s?#@]*)?$/i.test(String(v).trim()),
  paychi_api_key: TEXT(16, /^[A-Za-z0-9_.-]+$/),
  paychi_webhook_secret: TEXT(8, /^[\x21-\x7e]+$/),
  minbalancepaychi: (v) => /^\d{1,9}$/.test(String(v)),
  maxbalancepaychi: (v) => /^\d{1,9}$/.test(String(v)),
  chashbackpaychi: (v) => /^\d{1,2}$/.test(String(v)),
  variza_api_url: (v) => /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:443)?(\/[A-Za-z0-9._~\/-]*)?$/i.test(String(v).trim().replace(/\/+$/, '')),
  variza_api_token: TEXT(8, /^[A-Za-z0-9_.-]+$/),
  variza_webhook_secret: TEXT(8, /^[\x21-\x7e]+$/),
  variza_status: (v) => ['onvariza', 'offvariza'].includes(v),
}
const SECRET = new Set(['paychi_api_key', 'paychi_webhook_secret', 'variza_api_token', 'variza_webhook_secret'])

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  if (input?.unpause && ['paychi', 'variza', 'tetraminator'].includes(input.unpause)) {
    await run(sql`DELETE FROM PaySetting WHERE NamePay = ${input.unpause + '_pause_until'}`)
    return { unpaused: input.unpause }
  }
  const set = input?.set
  if (set && typeof set === 'object') {
    const done = []
    for (const [name, value] of Object.entries(set)) {
      if (!RULES[name]) throw new EndpointError('setting not allowed: ' + name, { code: 'NAME' })
      if (!RULES[name](value)) throw new EndpointError('bad value for ' + name + (SECRET.has(name) ? '' : ''), { code: 'VALUE' })
      let v = String(value).trim()
      if (name === 'paychi_base_url' || name === 'variza_api_url') v = v.replace(/\/+$/, '')
      await run(sql`DELETE FROM PaySetting WHERE NamePay = ${name}`)
      await run(sql`INSERT INTO PaySetting (NamePay, ValuePay) VALUES (${name}, ${v})`)
      done.push(name)
    }
    return { set: done }
  }
  // status: which of them exist (secrets as yes/no only)
  const rows = await all(sql`SELECT NamePay, ValuePay FROM PaySetting`)
  const by = Object.fromEntries(rows.map((r) => [r.NamePay, r.ValuePay]))
  const out = {}
  for (const name of Object.keys(RULES)) out[name] = SECRET.has(name) ? (by[name] && by[name] !== '0' ? 'set' : 'not set') : by[name] ?? null
  return out
}
