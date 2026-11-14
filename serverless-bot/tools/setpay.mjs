// Payment settings, typed on the server (secrets in hidden prompts, never in a chat). Run in the project folder (it uses `npx tgcloud run`):
//   node tools/setpay.mjs paychi          ask for the address + API key (+ webhook secret), save, and switch Paychi ON
//   node tools/setpay.mjs paychi off|on   hide / show the Paychi button
//   node tools/setpay.mjs variza off|on   hide / show the Variza button (nothing is deleted)
//   node tools/setpay.mjs variza keys   token + webhook secret (hidden prompts)
//   node tools/setpay.mjs variza url [https://<paychi>/api/compat/variza/v1]   Variza's API address (no argument = back to variza.ir)
//   node tools/setpay.mjs status          what is set (secrets shown as set / not set)
import { spawnSync } from 'node:child_process'

function ask(label, hidden = false) {
  return new Promise((resolve) => {
    process.stdout.write(label)
    const stdin = process.stdin
    let buf = ''
    if (hidden && stdin.isTTY) stdin.setRawMode(true)
    stdin.resume(); stdin.setEncoding('utf8')
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130) }
        if (c === '\r' || c === '\n') { stdin.off('data', onData); if (hidden && stdin.isTTY) stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); return resolve(buf.trim()) }
        if (c === '\u007f' || c === '\b') { buf = buf.slice(0, -1); continue }
        buf += c
      }
    }
    stdin.on('data', onData)
  })
}
function call(payload) {
  const r = spawnSync('npx', ['tgcloud', 'run', 'endpoints/admin_paysetting', JSON.stringify(payload)], { encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const line = out.split('\n').filter((l) => /^[<✗]/.test(l)).join('\n') || out
  console.log(line.replace(/pk_[A-Za-z0-9_.-]+/g, '<key>')) // never echo a key, whatever the answer contained
  return r.status === 0 && !/✗/.test(out)
}

const [, , cmd, arg] = process.argv
if (cmd === 'status') call({})
else if (cmd === 'variza' && arg === 'url') call({ set: { variza_api_url: (process.argv[4] || 'https://variza.ir/api/v1') } })
else if (cmd === 'variza' && arg === 'keys') {
  const token = await ask('Variza (or Paychi Variz) API token (hidden): ', true)
  const secret = await ask('Webhook signing secret (hidden): ', true)
  if (token && secret) call({ set: { variza_api_token: token, variza_webhook_secret: secret } })
  else console.log('nothing changed (both are needed)')
} else if (cmd === 'variza' && ['on', 'off'].includes(arg)) call({ set: { variza_status: arg === 'on' ? 'onvariza' : 'offvariza' } })
else if (cmd === 'paychi' && ['on', 'off'].includes(arg)) call({ set: { paychi_status: arg === 'on' ? 'onpaychi' : 'offpaychi' } })
else if (cmd === 'paychi') {
  const rawBase = await ask('Paychi address (https://…, port 443): ')
  const base = (/^(https:\/\/[^\/?#\s]+)/.exec(rawBase.trim()) || [])[1] || rawBase.trim() // only scheme+host: a pasted dashboard/pairing link keeps no path or #token
  const key = await ask('Paychi API key (hidden): ', true)
  const secret = await ask('Paychi webhook secret (hidden, Enter to skip): ', true)
  const set = { paychi_base_url: base, paychi_api_key: key }
  if (secret) set.paychi_webhook_secret = secret
  if (call({ set })) { console.log('saved; switching Paychi on…'); call({ set: { paychi_status: 'onpaychi' } }) }
} else console.log('usage: node tools/setpay.mjs paychi | paychi on|off | variza on|off | variza url [URL] | variza keys | status')
