const nf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 })
export const fmtNum = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '—' : nf.format(Number(v)))
export const fmtNum2 = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '—' : nf2.format(Number(v)))
export const fmtToman = (v: unknown) => `${fmtNum(v)} تومان`

// Compact: 1.2 میلیون / 340 هزار
export function fmtCompact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${nf2.format(v / 1e9)} میلیارد`
  if (a >= 1e6) return `${nf2.format(v / 1e6)} میلیون`
  if (a >= 1e3) return `${nf2.format(v / 1e3)} هزار`
  return nf.format(v)
}

const dtf = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tehran' })
const df = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tehran' })

/** unix seconds (number|string) -> Jalali date-time. Non-numeric values are returned as-is (e.g. register='none'). */
export function fmtTs(v: unknown, dateOnly = false): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return String(v) === 'none' ? '—' : String(v)
  return (dateOnly ? df : dtf).format(new Date(n * 1000)).replace(/[،,]/g, '')
}

/** 'YYYY/MM/DD HH:mm:ss' (server local, Asia/Tehran) -> Jalali */
export function fmtStr(v: unknown): string {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}))?/.exec(String(v ?? ''))
  if (!m) return v ? String(v) : '—'
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:00+03:30`)
  return Number.isNaN(d.getTime()) ? String(v) : dtf.format(d).replace(/[،,]/g, '')
}

// Persian/Arabic digits -> latin, strip separators. Used when users type numbers.
export function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,٬\s]/g, '')
}

/** Persian/Arabic digits -> latin but keep separators and spaces (dates like ۱۴۰۵/۰۷/۱۴ ۱۵:۳۰) */
export function latinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, ':')
}
