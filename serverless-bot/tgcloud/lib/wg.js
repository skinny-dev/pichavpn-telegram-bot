// sendWireguardFiles() of function.php: each wireguard:// link as a .conf file
import { InputFile } from 'sdk'
import { telegram } from './tg.js'

/** parse_str with + kept as a plus (the PHP code turns + into %2B first) */
function parseQuery(q) {
  const out = {}
  for (const part of String(q).split('&')) {
    if (part === '') continue
    const [k, v = ''] = part.split('=')
    const dec = (s) => { try { return decodeURIComponent(s) } catch { return s } }
    let key = dec(k).replace(/\[.*$/, '')
    if (key === '' || key in out) continue
    out[key] = dec(v)
  }
  return out
}

export async function sendWireguardFiles(T, userId, links, username) {
  if (!Array.isArray(links)) return
  const wg = links.filter((l) => typeof l === 'string' && l.trim().toLowerCase().startsWith('wireguard://'))
  for (let i = 0; i < wg.length; i++) {
    const main = wg[i].trim().slice('wireguard://'.length).split('#')[0]
    const qi = main.indexOf('?')
    const auth = qi < 0 ? main : main.slice(0, qi)
    const qs = qi < 0 ? '' : main.slice(qi + 1)
    const at = auth.lastIndexOf('@')
    const endpoint = auth.slice(at < 0 ? 0 : at + 1).replace(/\/+$/, '')
    const raw = parseQuery(qs)
    const q = {}
    for (const [k, v] of Object.entries(raw)) q[k.replace(/[_-]/g, '').toLowerCase()] = v
    let privateKey = at < 0 ? q.privatekey ?? '' : auth.slice(0, at)
    if (at >= 0) { try { privateKey = decodeURIComponent(privateKey) } catch { /* as is */ } }
    const publicKey = q.publickey ?? q.peerpublickey ?? ''
    if (endpoint === '' || privateKey === '' || publicKey === '') continue
    const has = (k) => q[k] !== undefined && q[k] !== '' && q[k] !== '0'
    let conf = `[Interface]\nPrivateKey = ${privateKey}\n`
    if (has('address')) conf += `Address = ${q.address}\n`
    if (has('dns')) conf += `DNS = ${q.dns}\n`
    if (has('mtu')) conf += `MTU = ${q.mtu}\n`
    conf += `\n[Peer]\nPublicKey = ${publicKey}\n`
    if (has('presharedkey')) conf += `PresharedKey = ${q.presharedkey}\n`
    conf += `AllowedIPs = ${q.allowedips ?? '0.0.0.0/0, ::/0'}\n`
    conf += `Endpoint = ${endpoint}\n`
    conf += `PersistentKeepalive = ${q.keepalive ?? q.persistentkeepalive ?? '25'}\n`
    const name = (String(username ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'wireguard') + (wg.length > 1 ? `_${i + 1}` : '') + '.conf'
    await telegram('sendDocument', { chat_id: userId, document: new InputFile(new TextEncoder().encode(conf), name, { type: 'text/plain' }), caption: T.users.status.wireguardFile })
  }
}
