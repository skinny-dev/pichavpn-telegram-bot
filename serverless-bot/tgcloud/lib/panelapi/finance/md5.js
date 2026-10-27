// MD5 of a string (UTF-8) as hex. The legacy ledger bridge keys its entries on md5 hashes the PHP bot already wrote, so the same function is needed here.
export function md5(str) {
  const bytes = new TextEncoder().encode(str)
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
  const len = bytes.length
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6)
  padded.set(bytes); padded[len] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, (len * 8) >>> 0, true)
  dv.setUint32(padded.length - 4, Math.floor((len * 8) / 4294967296), true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const rotl = (x, c) => ((x << c) | (x >>> (32 - c))) >>> 0
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Uint32Array(16)
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true)
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F, g
      if (i < 16) { F = (B & C) | (~B & D); g = i } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 } else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D; D = C; C = B
      B = (B + rotl(F, S[(i >> 4) * 4 + (i % 4)])) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16), o = new DataView(out.buffer)
  o.setUint32(0, a0, true); o.setUint32(4, b0, true); o.setUint32(8, c0, true); o.setUint32(12, d0, true)
  return [...out].map((b) => b.toString(16).padStart(2, '0')).join('')
}
