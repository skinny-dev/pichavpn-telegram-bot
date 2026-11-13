// atob / btoa / TextDecoder for an isolate that may not have them (the Serverless runtime has TextEncoder but no atob/btoa/URL/timers).
// Each uses the global when it exists, else a pure implementation with the same behaviour (atob throws on bad input).
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const REV = (() => { const m = {}; for (let i = 0; i < A.length; i++) m[A[i]] = i; return m })()

export function bytesToB64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? A[n & 63] : '=')
  }
  return out
}
/** base64 → bytes; throws on anything that is not base64 (like atob) */
export function b64ToBytes(s) {
  const t = String(s).replace(/[\t\n\f\r ]/g, '').replace(/={1,2}$/, '')
  if (/[^A-Za-z0-9+/]/.test(t) || t.length % 4 === 1) throw new Error('invalid base64')
  const out = []
  for (let i = 0; i < t.length; i += 4) {
    const n = (REV[t[i]] << 18) | (REV[t[i + 1]] << 12) | ((REV[t[i + 2]] ?? 0) << 6) | (REV[t[i + 3]] ?? 0)
    out.push((n >> 16) & 255)
    if (i + 2 < t.length) out.push((n >> 8) & 255)
    if (i + 3 < t.length) out.push(n & 255)
  }
  return Uint8Array.from(out)
}
/** atob(): binary string */
export const atobSafe = (s) => (typeof atob === 'function' ? atob(s) : String.fromCharCode(...b64ToBytes(s)))
/** btoa(): from a binary string */
export const btoaSafe = (bin) => (typeof btoa === 'function' ? btoa(bin) : bytesToB64(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
/** UTF-8 bytes → string (invalid sequences become U+FFFD, like TextDecoder) */
export function utf8Decode(bytes) {
  if (typeof TextDecoder === 'function') return new TextDecoder().decode(bytes)
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++]
    if (b < 0x80) out += String.fromCharCode(b)
    else if (b >= 0xc2 && b < 0xe0 && (bytes[i] & 0xc0) === 0x80) out += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63))
    else if (b >= 0xe0 && b < 0xf0 && (bytes[i] & 0xc0) === 0x80 && (bytes[i + 1] & 0xc0) === 0x80) out += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63))
    else if (b >= 0xf0 && b < 0xf5 && (bytes[i] & 0xc0) === 0x80 && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80) {
      const cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63)
      out += String.fromCodePoint(cp)
    } else out += '�'
  }
  return out
}
