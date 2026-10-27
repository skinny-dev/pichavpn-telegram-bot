// Small PHP functions the ported code needs, with the same results.

/** sprintf with %s %d %f %u %%, %1$s positions */
export function sprintf(fmt, ...args) {
  let i = 0
  return String(fmt ?? '').replace(/%(?:(\d+)\$)?([-+ 0]|'.)*(\d+)?(?:\.(\d+))?([sdufF%])/g, (m, pos, flag, width, prec, t) => {
    if (t === '%') return '%'
    const v = pos ? args[pos - 1] : args[i++]
    if (t === 'd' || t === 'u') return String(Math.trunc(Number(v) || 0))
    if (t === 'f' || t === 'F') return (Number(v) || 0).toFixed(prec === undefined ? 6 : Number(prec))
    return v === null || v === undefined ? '' : v === true ? '1' : v === false ? '' : String(v)
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
