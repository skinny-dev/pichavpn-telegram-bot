// Small PHP functions the ported code needs, with the same results.
import { b64ToBytes, bytesToB64, utf8Decode } from './b64.js'
import { phpFloat } from './fmt.js'

/** sprintf with %s %d %f %u %%, %1$s positions */
export function sprintf(fmt, ...args) {
  let i = 0
  return String(fmt ?? '').replace(/%(?:(\d+)\$)?([-+ 0]|'.)*(\d+)?(?:\.(\d+))?([sdufF%])/g, (m, pos, flag, width, prec, t) => {
    if (t === '%') return '%'
    const v = pos ? args[pos - 1] : args[i++]
    if (t === 'd' || t === 'u') return String(Math.trunc(Number(v) || 0))
    if (t === 'f' || t === 'F') return (Number(v) || 0).toFixed(prec === undefined ? 6 : Number(prec))
    return v === null || v === undefined ? '' : v === true ? '1' : v === false ? '' : typeof v === 'number' ? phpFloat(v) : String(v)
  })
}
/** number_format($n, $dec) with , and . */
export function numberFormat(n, dec = 0) {
  const x = Number(n) || 0
  const [a, b] = Math.abs(x).toFixed(dec).split('.')
  const s = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (x < 0 && Number(x.toFixed(dec)) !== 0 ? '-' : '') + s + (b ? '.' + b : '')
}
export function strtr(s, map) {
  s = String(s ?? '')
  const keys = Object.keys(map).filter((k) => k !== '').sort((a, b) => b.length - a.length)
  if (!keys.length) return s
  const re = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return s.replace(re, (m) => String(map[m] ?? ''))
}
export function convertPersianNumbers(s) {
  return String(s ?? '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
/** crc32 of the UTF-8 bytes (PHP crc32) */
export function crc32(str) {
  const bytes = new TextEncoder().encode(String(str))
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
export const dechex = (n) => Number(n).toString(16)
export const time = () => Math.floor(Date.now() / 1000)
/** loose PHP == between a value and a string/number */
export const eq = (a, b) => String(a ?? '') === String(b ?? '')
/** PHP intval */
export const intval = (v) => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : 0 }
/** random hex like bin2hex(random_bytes(n)) */
export function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join('') }
/** PHP json_encode of a keyboard (the Bot API side does not care about escaping) */
export const J = (o) => JSON.stringify(o)

/** base64_decode($s, true) as bytes, or false */
export function b64decodeStrict(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return false
  try { return b64ToBytes(s) } catch { return false }
}
export function b64encode(bytes) { return bytesToB64(bytes) }
/** isBase64() of function.php: decodes strictly and encodes back to the same string */
export function isBase64(s) {
  if (typeof s !== 'string') return false
  const d = b64decodeStrict(s)
  return b64encode(d === false ? new Uint8Array(0) : d) === s
}
export const utf8 = (bytes) => utf8Decode(bytes)
/** urldecode(): + is a space, bad % sequences stay as they are */
export function urldecode(s) {
  s = String(s ?? '').replace(/\+/g, ' ')
  return s.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => { try { return decodeURIComponent(m) } catch { return m } })
}
/** json_encode() with PHP's default escaping (\/ and \uXXXX), for text that is shown or compared */
export function phpJson(v) {
  return JSON.stringify(v ?? null).replace(/\//g, '\\/').replace(/[\u0080-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
}

// ---------------------------------------------------------------- dynamic product names
// A product NAME may carry tokens that are filled in for whoever looks at it, so a partner's price (or any price change) is never stale in the text:
//   {price} = the viewer's final price (number, no unit) · {volume} / {traffic} / {traffic_volume} = GB · {days} / {time} = days
const NAME_TOKEN = /\{(price|volume|traffic|traffic_volume|days|time)(_fa)?\}/gi
export const hasNameTokens = (s) => /\{(price|volume|traffic|traffic_volume|days|time)(_fa)?\}/i.test(String(s ?? ''))
const limitText = (v) => { const x = Number(v); return !Number.isFinite(x) || x === 0 ? 'نامحدود' : String(Math.round(x * 100) / 100) }
const faDigits = (t) => t.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/,/g, '٬') // {volume_fa} / {price_fa} / {days_fa}: Persian digits (the shop's names are often written in them)
export function productName(name, product = {}, price = product.price_product) {
  const s = String(name ?? '')
  if (!hasNameTokens(s)) return s
  return s.replace(NAME_TOKEN, (m, k, fa) => {
    k = k.toLowerCase()
    const v = k === 'price' ? numberFormat(Number(price) || 0) : limitText(k === 'days' || k === 'time' ? product.Service_time : product.Volume_constraint)
    return fa ? faDigits(v) : v
  })
}
/** does an invoice's stored name belong to this product? Exact, or the product's template filled with ITS OWN volume/days and any price (the price differs per viewer and per day) */
export function nameMatchesProduct(stored, product) {
  const tpl = String(product.name_product ?? ''), st = String(stored ?? '')
  if (tpl === st) return true
  if (!hasNameTokens(tpl)) return false
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re = '', last = 0
  for (const m of tpl.matchAll(NAME_TOKEN)) {
    re += esc(tpl.slice(last, m.index))
    const k = m[1].toLowerCase()
    re += k === 'price' ? '[\\d۰-۹,٬.]+' : esc(m[2] ? faDigits(limitText(k === 'days' || k === 'time' ? product.Service_time : product.Volume_constraint)) : limitText(k === 'days' || k === 'time' ? product.Service_time : product.Volume_constraint))
    last = m.index + m[0].length
  }
  re += esc(tpl.slice(last))
  return new RegExp('^' + re + '$').test(st)
}
