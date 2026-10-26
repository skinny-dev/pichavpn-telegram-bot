// Persian formatting: digits, toman, GB, Jalali dates.

const FA = '۰۱۲۳۴۵۶۷۸۹'
export const fa = (v) => String(v).replace(/\d/g, (d) => FA[d])

export function money(n) {
  const s = String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fa(s) + ' تومان'
}

export function gb(bytes) {
  const g = (Number(bytes) || 0) / 1073741824
  if (g >= 100) return fa(Math.round(g)) + ' گیگ'
  if (g >= 1) return fa(g.toFixed(2).replace(/\.?0+$/, '')) + ' گیگ'
  return fa(Math.round(g * 1024)) + ' مگ'
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Gregorian → Jalali (algorithm from jdf / jalaali-js). */
export function toJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const gy2 = gm > 2 ? gy + 1 : gy
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1]
  let jy = -1595 + 33 * Math.floor(days / 12053)
  days %= 12053
  jy += 4 * Math.floor(days / 1461)
  days %= 1461
  if (days > 365) {
    jy += Math.floor((days - 1) / 365)
    days = (days - 1) % 365
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30)
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30)
  return [jy, jm, jd]
}

/** unix seconds → «۱۴۰۵/۰۸/۰۴» in Tehran time */
export function jdate(ts) {
  const d = new Date((Number(ts) + 12600) * 1000) // UTC+3:30
  const [y, m, day] = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  return fa(`${y}/${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}`)
}

export function daysLeft(ts) {
  const s = Number(ts) - Date.now() / 1000
  return s <= 0 ? 0 : Math.ceil(s / 86400)
}

export const STATUS = {
  active: '🟢 فعال',
  limited: '🔴 حجم تمام شده',
  expired: '🔴 زمان تمام شده',
  disabled: '⚪️ غیرفعال',
  on_hold: '🟡 در انتظار اولین اتصال',
}
