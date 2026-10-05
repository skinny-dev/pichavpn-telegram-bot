import Papa from 'papaparse'
import type { Resource, Row } from './api'

export type ExportFormat = 'csv' | 'xlsx' | 'json'

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Guard against spreadsheet formula injection when a cell starts with = + - @
const safeCell = (v: unknown) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v ?? '')

export async function exportRows(res: Resource, rows: Row[], format: ExportFormat, fileBase: string) {
  const stamp = new Date().toISOString().slice(0, 10)
  const name = `${fileBase}-${stamp}`
  const keys = res.cols.map((c) => c.key)
  if (format === 'json') {
    return download(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }), `${name}.json`)
  }
  // Header row uses column keys (stable for re-import); labels are added as a second sheet in xlsx.
  const data = rows.map((r) => Object.fromEntries(keys.map((k) => [k, safeCell(r[k])])))
  if (format === 'csv') {
    const csv = Papa.unparse({ fields: keys, data: data.map((r) => keys.map((k) => r[k])) })
    return download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`)
  }
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(data, { header: keys })
  ws['!cols'] = keys.map((k) => ({ wch: Math.max(k.length, 14) }))
  XLSX.utils.book_append_sheet(wb, ws, 'data')
  const legend = XLSX.utils.aoa_to_sheet([['key', 'عنوان', 'قابل ویرایش'], ...res.cols.map((c) => [c.key, c.label, c.edit ? 'بله' : 'خیر'])])
  XLSX.utils.book_append_sheet(wb, legend, 'columns')
  XLSX.writeFile(wb, `${name}.xlsx`)
}

export function downloadTemplate(res: Resource, fileBase: string) {
  const cols = res.cols.filter((c) => c.edit || c.key === res.pk)
  const csv = Papa.unparse({ fields: cols.map((c) => c.key), data: [] })
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${fileBase}-template.csv`)
}

export interface ParsedFile { rows: Row[]; headers: string[] }

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'json') {
    const data = JSON.parse(await file.text())
    const rows = Array.isArray(data) ? data : data.rows
    if (!Array.isArray(rows)) throw new Error('فایل JSON باید آرایه‌ای از ردیف‌ها باشد')
    return { rows, headers: Array.from(new Set(rows.flatMap((r: Row) => Object.keys(r)))) }
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: '', raw: false })
    return { rows, headers: Object.keys(rows[0] ?? {}) }
  }
  const text = (await file.text()).replace(/^﻿/, '')
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() })
  if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message)
  return { rows: parsed.data, headers: parsed.meta.fields ?? [] }
}

/** Keep only known column keys; map labels to keys so exported-by-label files also work. */
export function mapRows(res: Resource, rows: Row[]): { rows: Row[]; unknown: string[] } {
  const byKey = new Map(res.cols.map((c) => [c.key.toLowerCase(), c.key]))
  const byLabel = new Map(res.cols.map((c) => [c.label, c.key]))
  const unknown = new Set<string>()
  const out = rows.map((r) => {
    const o: Row = {}
    for (const [h, v] of Object.entries(r)) {
      const k = byKey.get(h.trim().toLowerCase()) ?? byLabel.get(h.trim())
      if (!k) { unknown.add(h); continue }
      o[k] = typeof v === 'string' ? v.replace(/^'(?=[=+\-@])/, '') : v
    }
    return o
  })
  return { rows: out, unknown: Array.from(unknown) }
}
