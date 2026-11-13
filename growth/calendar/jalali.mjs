// Jalali ⇄ Gregorian (standard arithmetic algorithm), used only to print/validate calendar dates.
export function j2g(jy, jm, jd) {
  jy += 1595
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186)
  let gy = 400 * Math.floor(days / 146097)
  days %= 146097
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++ }
  gy += 4 * Math.floor(days / 1461); days %= 1461
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365 }
  let gd = days + 1
  const m = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  let gm = 0
  for (; gm < 13 && gd > m[gm]; gm++) gd -= m[gm]
  return [gy, gm, gd]
}
export function g2j(gy, gm, gd) {
  const t = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const gy2 = gm > 2 ? gy + 1 : gy
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + t[gm - 1]
  let jy = -1595 + 33 * Math.floor(days / 12053)
  days %= 12053
  jy += 4 * Math.floor(days / 1461); days %= 1461
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365 }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30)
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30)
  return [jy, jm, jd]
}
export const WEEKDAY = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'] // Date#getUTCDay() order
export const MONTH = ['', 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
export const addDays = ([y, m, d], n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()] }
export const dow = ([y, m, d]) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()
export const fa = (s) => String(s).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[c])
export const pad = (n) => String(n).padStart(2, '0')
