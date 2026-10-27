// jdate() (jdf.php, Asia/Tehran, Persian digits) and formatBytes() of function.php

export function gregorianToJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const gy2 = gm > 2 ? gy + 1 : gy
  let days = 355666 + 365 * gy + Math.trunc((gy2 + 3) / 4) - Math.trunc((gy2 + 99) / 100) + Math.trunc((gy2 + 399) / 400) + gd + gdm[gm - 1]
  let jy = -1595 + 33 * Math.trunc(days / 12053)
  days %= 12053
  jy += 4 * Math.trunc(days / 1461)
  days %= 1461
  if (days > 365) { jy += Math.trunc((days - 1) / 365); days = (days - 1) % 365 }
  const jm = days < 186 ? 1 + Math.trunc(days / 31) : 7 + Math.trunc((days - 186) / 30)
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30)
  return [jy, jm, jd]
}
const FA = '۰۱۲۳۴۵۶۷۸۹'
const JMONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
export const trNumFa = (s) => String(s).replace(/\d/g, (d) => FA[d]).replace(/\./g, '٫')

/** Tehran wall-clock parts of a unix time (Iran has no DST since 2022) */
function tehran(ts) {
  const d = new Date((Number(ts) + 12600) * 1000)
  return { Y: d.getUTCFullYear(), n: d.getUTCMonth() + 1, j: d.getUTCDate(), H: d.getUTCHours(), i: d.getUTCMinutes(), s: d.getUTCSeconds() }
}
const p2 = (n) => String(n).padStart(2, '0')
/** jdate($format, $timestamp) with Persian digits, for the formats the bot uses */
export function jdate(format, ts = Math.floor(Date.now() / 1000), latin = false) {
  const t = tehran(ts)
  const [jy, jm, jd] = gregorianToJalali(t.Y, t.n, t.j)
  let out = ''
  for (const ch of format) {
    switch (ch) {
      case 'Y': out += jy; break
      case 'y': out += String(jy).slice(2); break
      case 'm': out += p2(jm); break
      case 'n': out += jm; break
      case 'd': out += p2(jd); break
      case 'F': out += JMONTHS[jm - 1]; break
      case 'w': out += (new Date((Number(ts) + 12600) * 1000).getUTCDay() + 1) % 7; break
      case 'j': out += jd; break
      case 'H': out += p2(t.H); break
      case 'G': out += t.H; break
      case 'i': out += p2(t.i); break
      case 's': out += p2(t.s); break
      default: out += ch
    }
  }
  return latin ? out : trNumFa(out)
}

/** PHP float to string (precision 14, like echo) */
export function phpFloat(x) {
  if (Number.isNaN(x)) return 'NAN'
  if (!Number.isFinite(x)) return x > 0 ? 'INF' : '-INF'
  if (Number.isInteger(x)) return String(x)
  return String(Number(x.toPrecision(14)))
}
export const phpRound = (x, p = 0) => { const m = 10 ** p; return Math.round((x + Number.EPSILON * Math.sign(x)) * m) / m }

export function formatBytes(T, bytes, precision = 2) {
  bytes = Number(bytes)
  const base = Math.log(bytes) / Math.log(1024)
  const power = bytes > 0 ? Math.floor(base) : 0
  const suf = [T.common.units.byte, T.common.units.kilobyte, T.common.units.megabyte, T.common.units.gigabyteAlt, T.common.units.terabyte]
  return phpFloat(phpRound(1024 ** (base - power), precision)) + ' ' + (suf[power] ?? '')
}
