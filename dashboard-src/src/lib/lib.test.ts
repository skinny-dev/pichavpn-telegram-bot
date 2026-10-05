import { describe, expect, it } from 'vitest'
import { fmtNum, fmtStr, fmtTs, normalizeDigits } from './format'
import { mapRows } from './io'
import type { Resource } from './api'

describe('normalizeDigits', () => {
  it('converts Persian/Arabic digits and strips separators', () => {
    expect(normalizeDigits('۱۲٬۳۴۵')).toBe('12345')
    expect(normalizeDigits('٤٢')).toBe('42')
    expect(normalizeDigits('1,000 000')).toBe('1000000')
  })
})

describe('formatting', () => {
  it('formats numbers in Persian and tolerates junk', () => {
    expect(fmtNum(60986)).toBe('۶۰٬۹۸۶')
    expect(fmtNum('')).toBe('—')
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum('abc')).toBe('—')
  })
  it('converts unix seconds to a Jalali date (Tehran time)', () => {
    // 2026-10-05 00:00:00 UTC -> 1405/07/13 03:30 in Tehran
    expect(fmtTs(1791158400)).toBe('۱۴۰۵/۰۷/۱۳ ۰۳:۳۰')
  })
  it('keeps non-numeric register values readable', () => {
    expect(fmtTs('none')).toBe('—')
    expect(fmtTs(0)).toBe('0')
  })
  it('parses server date strings', () => {
    expect(fmtStr('2026/10/05 09:42:05')).toMatch(/۱۴۰۵\/۰۷\/۱۳/)
    expect(fmtStr('garbage')).toBe('garbage')
  })
})

describe('mapRows', () => {
  const res: Resource = {
    title: 't', pk: 'id', create: true, delete: true, import: true,
    cols: [{ key: 'id', label: 'شناسه', type: 'int' }, { key: 'name_product', label: 'نام محصول', type: 'text', edit: true }],
  }
  it('maps keys case-insensitively and by Persian label, drops unknown columns', () => {
    const { rows, unknown } = mapRows(res, [{ ID: '1', 'نام محصول': 'x', evil: 'y' }])
    expect(rows).toEqual([{ id: '1', name_product: 'x' }])
    expect(unknown).toEqual(['evil'])
  })
  it('strips the formula-guard apostrophe added on export', () => {
    expect(mapRows(res, [{ name_product: "'=SUM(A1)" }]).rows[0].name_product).toBe('=SUM(A1)')
  })
})
