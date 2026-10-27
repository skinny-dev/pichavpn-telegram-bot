// QR code → PNG, in plain JavaScript (Serverless has no image libraries).
// Byte mode, error correction H (as the PHP bot), version chosen automatically; mask chosen by the standard penalty rules.
// PNG: 1-bit grayscale, zlib "stored" blocks (no compression library needed).

// ---- Reed–Solomon over GF(256), polynomial 0x11D
const EXP = new Uint8Array(512), LOG = new Uint8Array(256)
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] }
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])
function rsDivisor(deg) {
  let r = new Uint8Array(deg); r[deg - 1] = 1
  let root = 1
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) { r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1] }
    root = gmul(root, 2)
  }
  return r
}
function rsRemainder(data, div) {
  const res = new Uint8Array(div.length)
  for (const b of data) {
    const f = b ^ res[0]
    res.copyWithin(0, 1); res[res.length - 1] = 0
    for (let i = 0; i < div.length; i++) res[i] ^= gmul(div[i], f)
  }
  return res
}

// ---- tables (ECC level H only)
const ECC_H_CODEWORDS_PER_BLOCK = [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
const ECC_H_BLOCKS = [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
const FORMAT_BITS_H = 2 // ECC level H = binary 10

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36 }
  return r
}
const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_H_CODEWORDS_PER_BLOCK[ver] * ECC_H_BLOCKS[ver]
function alignPositions(ver) {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const out = [6]
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text))
  let ver = 1
  for (; ver <= 40; ver++) {
    const ccBits = ver < 10 ? 8 : 16
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break
  }
  if (ver > 40) throw new Error('QR: data too long')
  // bit stream
  const bits = []
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1) }
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const cap = dataCodewords(ver) * 8
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data = new Uint8Array(bits.length / 8)
  bits.forEach((b, i) => { data[i >>> 3] |= b << (7 - (i & 7)) })
  // blocks + ecc, interleaved
  const nb = ECC_H_BLOCKS[ver], ecLen = ECC_H_CODEWORDS_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8)
  const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb)
  const div = rsDivisor(ecLen)
  const blocks = []
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - ecLen + (i < nShort ? 0 : 1)
    const dat = data.slice(k, k + len); k += len
    const ecc = rsRemainder(dat, div)
    const blk = []
    for (const x of dat) blk.push(x)
    if (i < nShort) blk.push(-1)
    for (const x of ecc) blk.push(x)
    blocks.push(blk)
  }
  const all = []
  for (let i = 0; i < blocks[0].length; i++) for (let j = 0; j < blocks.length; j++) if (blocks[j][i] !== -1) all.push(blocks[j][i])

  const size = ver * 4 + 17
  const mod = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, d) => { mod[y][x] = d; fn[y][x] = true }
  // timing
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  // finders
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  // alignment
  const ap = alignPositions(ver)
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  // format placeholders + version
  const drawFormat = (mask) => {
    const d = (FORMAT_BITS_H << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    const bit = (i) => ((b >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3)
      set(a, c, bit); set(c, a, bit)
    }
  }
  // data (zigzag)
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert
      if (!fn[y][x] && i < all.length * 8) { mod[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++ }
    }
  }
  // masks
  const maskFn = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const apply = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x] }
  let best = 0, bestScore = Infinity
  for (let m = 0; m < 8; m++) {
    apply(m); drawFormat(m)
    const s = penalty(mod, size)
    if (s < bestScore) { bestScore = s; best = m }
    apply(m)
  }
  apply(best); drawFormat(best)
  return mod
}

function penalty(mod, size) {
  let r = 0
  const runs = (get) => {
    for (let a = 0; a < size; a++) {
      let color = get(a, 0), len = 1
      for (let b = 1; b < size; b++) {
        const c = get(a, b)
        if (c === color) { len++; if (len === 5) r += 3; else if (len > 5) r++ } else { color = c; len = 1 }
      }
    }
  }
  runs((a, b) => mod[a][b]); runs((a, b) => mod[b][a])
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) r += 3 }
  const pat = [true, false, true, true, true, false, true]
  const finderLike = (get) => {
    for (let a = 0; a < size; a++) for (let b = 0; b + 10 < size; b++) {
      let ok1 = true, ok2 = true
      for (let k = 0; k < 7; k++) if (get(a, b + k) !== pat[k]) { ok1 = false; break }
      if (ok1) {
        let w1 = true, w2 = true
        for (let k = 7; k < 11; k++) if (get(a, b + k)) w1 = false
        for (let k = -4; k < 0; k++) if (b + k >= 0 && get(a, b + k)) w2 = false
        if (w1 || (b >= 4 && w2)) r += 40
      }
      ok2 = ok2 && false
    }
  }
  finderLike((a, b) => mod[a][b]); finderLike((a, b) => mod[b][a])
  let dark = 0
  for (const row of mod) for (const c of row) if (c) dark++
  const total = size * size
  r += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10
  return r
}

// ---- PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function adler32(bytes) { let a = 1, b = 0; for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521 } return ((b << 16) | a) >>> 0 }
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
function chunk(type, data) {
  const body = new Uint8Array(4 + data.length)
  body.set([...type].map((ch) => ch.charCodeAt(0)), 0); body.set(data, 4)
  const out = new Uint8Array(8 + data.length + 4)
  out.set(u32(data.length), 0); out.set(body, 4); out.set(u32(crc32(body)), 8 + data.length)
  return out
}

/** PNG bytes: `size` px square (incl. `margin` px white border), black modules */
export function qrPng(text, size = 500, margin = 10) {
  const m = qrMatrix(text)
  const n = m.length
  const scale = Math.max(3, Math.floor((size - 2 * margin) / n)) // long data: a bigger picture rather than unreadable dots
  const inner = n * scale
  const W = inner + 2 * margin
  const rowBytes = Math.ceil(W / 8)
  const raw = new Uint8Array((rowBytes + 1) * W)
  for (let y = 0; y < W; y++) {
    const off = y * (rowBytes + 1)
    raw[off] = 0 // filter none
    for (let x = 0; x < W; x++) {
      const qx = Math.floor((x - margin) / scale), qy = Math.floor((y - margin) / scale)
      const dark = x >= margin && y >= margin && qx < n && qy < n && m[qy][qx]
      if (!dark) raw[off + 1 + (x >>> 3)] |= 0x80 >>> (x & 7) // 1 = white
    }
  }
  // zlib stored blocks (written into one buffer: no huge spreads)
  const nBlocks = Math.max(1, Math.ceil(raw.length / 65535))
  const z = new Uint8Array(2 + raw.length + nBlocks * 5 + 4)
  z[0] = 0x78; z[1] = 0x01
  let o = 2
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const part = raw.subarray(i, Math.min(raw.length, i + 65535))
    const last = i + 65535 >= raw.length ? 1 : 0
    z[o++] = last; z[o++] = part.length & 255; z[o++] = part.length >>> 8; z[o++] = ~part.length & 255; z[o++] = (~part.length >>> 8) & 255
    z.set(part, o); o += part.length
    if (last) break
  }
  z.set(u32(adler32(raw)), o)
  const ihdr = new Uint8Array([...u32(W), ...u32(W), 1, 0, 0, 0, 0]) // 1-bit grayscale
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let k = 0
  for (const p of parts) { out.set(p, k); k += p.length }
  return out
}
