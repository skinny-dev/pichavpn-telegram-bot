import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ChevronRight, ChevronLeft, Columns3, Download, FileSpreadsheet, FileText, FileJson, Loader2, PanelLeftOpen, Plus, RefreshCw, Search, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import { api, ApiError, type Col, type Resource, type Row } from '@/lib/api'
import { fmtNum, fmtStr, fmtTs, normalizeDigits } from '@/lib/format'
import { exportRows, type ExportFormat } from '@/lib/io'
import { useCoarsePointer, useDebounced } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CellEditDialog, FieldInput, InlineEditor } from '@/components/CellEditor'
import { ImportDialog } from '@/components/ImportDialog'

interface Props {
  resName: string
  res: Resource
  /** columns to hide on this screen */
  hide?: string[]
  /** extra toolbar content */
  toolbar?: React.ReactNode
  /** enum columns that get a filter dropdown */
  filterCols?: string[]
  /** extra query parameters (e.g. a date range) */
  extra?: Record<string, string>
  /** filters controlled by the parent (e.g. status chips); they win over the dropdowns */
  forced?: Record<string, string>
  /** receives the `summary` block of the list response */
  onSummary?: (s: any) => void
  /** opens the full page of a row (order / customer) */
  onOpen?: (row: Row) => void
  /** phones: rows as cards instead of the spreadsheet */
  card?: (row: Row) => React.ReactNode
  /** custom cells (read-only display) by column key */
  renderers?: Record<string, (row: Row) => React.ReactNode>
  /** the roomy look: rounded frame, light header, numbered pages, a «columns» menu */
  rich?: boolean
  /** columns hidden until the admin turns them on in «ستون‌ها» */
  defaultHidden?: string[]
}

const PER_OPTIONS = [25, 50, 100, 200]

export function displayValue(col: Col, v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>
  switch (col.type) {
    case 'int': return <span className="tabular" dir="ltr">{fmtNum(v)}</span>
    case 'ts': return <span className="tabular" dir="ltr">{fmtTs(v)}</span>
    case 'str': return <span className="tabular" dir="ltr">{fmtStr(v)}</span>
    case 'dt': return <span className="tabular" dir="ltr">{String(v)}</span>
    case 'enum': {
      const label = col.options?.[String(v)] ?? String(v)
      const bad = ['block', 'مسدود'].includes(String(v))
      const tone = col.tones?.[String(v)]
      return <Badge variant={tone ?? (bad ? 'destructive' : String(v) === 'Active' ? 'success' : 'secondary')} className="gap-1.5"><span className="size-1.5 rounded-full bg-current" />{label}</Badge>
    }
    default: return <span>{String(v)}</span>
  }
}

/** page numbers with gaps: 1 … 4 5 6 … 20 (0 = a gap) */
function pageList(page: number, pages: number): number[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
  const out: number[] = []
  for (const n of [...set].sort((a, b) => a - b)) { if (out.length && n - out[out.length - 1] > 1) out.push(0); out.push(n) }
  return out
}

const rawText = (col: Col, v: unknown) => (v === null || v === undefined ? '' : String(v))

export function DataGrid({ resName, res, hide = [], toolbar, filterCols = [], extra, forced, onSummary, onOpen, card, renderers, rich, defaultHidden = [] }: Props) {
  const [showFilters, setShowFilters] = useState(false)
  const qc = useQueryClient()
  const coarse = useCoarsePointer()
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('picha-cols-' + resName) ?? JSON.stringify(defaultHidden)) } catch { return defaultHidden } })
  const toggleCol = (k: string) => setHidden((h) => { const n = h.includes(k) ? h.filter((x) => x !== k) : [...h, k]; try { localStorage.setItem('picha-cols-' + resName, JSON.stringify(n)) } catch { /* private mode */ } return n })
  const allCols = useMemo(() => res.cols.filter((c) => !hide.includes(c.key)), [res, hide])
  const cols = useMemo(() => allCols.filter((c) => !hidden.includes(c.key) || c === allCols[0]), [allCols, hidden])
  const [page, setPage] = useState(1)
  const [per, setPer] = useState(50)
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [sort, setSort] = useState<{ key: string; dir: 'ASC' | 'DESC' } | null>(null)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [dialogCell, setDialogCell] = useState<{ r: number; c: number } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [delRow, setDelRow] = useState<Row | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setPage(1) }, [dq, filters, per, sort])

  const allFilters = { ...filters, ...(forced ?? {}) }
  const params = { res: resName, page, per, q: dq, sort: sort?.key, dir: sort?.dir, f: allFilters, ...(extra ?? {}) }
  const queryKey = ['list', resName, params]
  const list = useQuery({
    queryKey,
    queryFn: () => api<{ rows: Row[]; total: number; summary?: any }>('list', { query: params }),
    placeholderData: keepPreviousData,
  })
  useEffect(() => { onSummary?.(list.data?.summary ?? null) }, [list.data?.summary]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = list.data?.rows ?? []
  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / per))

  const save = useMutation({
    mutationFn: (v: { id: string; field: string; value: string }) => api<{ value: string }>('update', { body: { res: resName, ...v } }),
  })

  /** Optimistic cell update with rollback. Returns true on success. */
  const commit = useCallback(async (r: number, c: number, value: string): Promise<boolean> => {
    const col = cols[c]
    const row = rows[r]
    if (!col?.edit || !row) return false
    const prev = rawText(col, row[col.key])
    const next = col.type === 'int' ? normalizeDigits(value) : value
    if (prev === next || (col.type === 'int' && prev === String(Number(next || 0)) && next !== '' && Number(next) === Number(prev))) return true
    if (col.type === 'int' && next !== '' && !/^-?\d{1,15}$/.test(next)) { toast.error(`«${col.label}» باید عدد باشد`); return false }
    const id = String(row[res.pk])
    qc.setQueryData<{ rows: Row[]; total: number }>(queryKey, (d) => d && { ...d, rows: d.rows.map((x) => (String(x[res.pk]) === id ? { ...x, [col.key]: next } : x)) })
    try {
      const out = await save.mutateAsync({ id, field: col.key, value: next })
      qc.setQueryData<{ rows: Row[]; total: number }>(queryKey, (d) => d && { ...d, rows: d.rows.map((x) => (String(x[res.pk]) === id ? { ...x, [col.key]: out.value } : x)) })
      if (resName === 'products' || resName === 'categories') qc.invalidateQueries({ queryKey: ['tree'] })
      return true
    } catch (e) {
      qc.setQueryData<{ rows: Row[]; total: number }>(queryKey, (d) => d && { ...d, rows: d.rows.map((x) => (String(x[res.pk]) === id ? { ...x, [col.key]: prev } : x)) })
      toast.error(e instanceof ApiError ? e.message : 'ذخیره نشد')
      return false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows, res.pk, resName, qc, JSON.stringify(queryKey)])

  const move = (dr: number, dc: number) => setSel((s) => {
    if (!s) return { r: 0, c: 0 }
    return { r: Math.min(Math.max(s.r + dr, 0), rows.length - 1), c: Math.min(Math.max(s.c + dc, 0), cols.length - 1) }
  })

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || !sel || dialogCell) return
    const col = cols[sel.c]
    // RTL: the first column is on the right, so ArrowLeft goes to the next column.
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); return move(1, 0)
      case 'ArrowUp': e.preventDefault(); return move(-1, 0)
      case 'ArrowLeft': e.preventDefault(); return move(0, 1)
      case 'ArrowRight': e.preventDefault(); return move(0, -1)
      case 'Tab': e.preventDefault(); return move(0, e.shiftKey ? -1 : 1)
      case 'Enter':
      case 'F2': if (col?.edit) { e.preventDefault(); setEditing(true) } return
      case 'Escape': return setSel(null)
    }
  }

  async function onPaste(e: React.ClipboardEvent) {
    if (editing || !sel) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const grid = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    const cells = grid.reduce((n, r) => n + r.length, 0)
    if (cells > 1 && !window.confirm(`${fmtNum(cells)} سلول جای‌گذاری شود؟`)) return
    let ok = 0, bad = 0
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid[i].length; j++) {
        const r = sel.r + i, c = sel.c + j
        if (r >= rows.length || c >= cols.length || !cols[c].edit) { continue }
        ;(await commit(r, c, grid[i][j])) ? ok++ : bad++
      }
    }
    if (ok || bad) toast[bad ? 'warning' : 'success'](`${fmtNum(ok)} سلول ذخیره شد${bad ? `، ${fmtNum(bad)} مورد ناموفق` : ''}`)
  }

  function onCopy(e: React.ClipboardEvent) {
    if (editing || !sel) return
    const v = rows[sel.r]?.[cols[sel.c]?.key]
    if (v === undefined) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', rawText(cols[sel.c], v))
  }

  const del = useMutation({
    mutationFn: (id: string) => api('delete', { body: { res: resName, id } }),
    onSuccess: () => { toast.success('حذف شد'); setDelRow(null); qc.invalidateQueries({ queryKey: ['list', resName] }); qc.invalidateQueries({ queryKey: ['tree'] }) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'حذف نشد'),
  })

  const [exporting, setExporting] = useState(false)
  async function doExport(fmt: ExportFormat) {
    setExporting(true)
    try {
      const out = await api<{ rows: Row[] }>('export', { query: { res: resName, q: dq, sort: sort?.key, dir: sort?.dir, f: allFilters, ...(extra ?? {}) } })
      await exportRows(res, out.rows, fmt, resName)
      toast.success(`${fmtNum(out.rows.length)} ردیف خروجی گرفته شد`)
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'خروجی ناموفق بود') } finally { setExporting(false) }
  }

  const enumFilters = cols.filter((c) => c.type === 'enum' && (filterCols.length === 0 || filterCols.includes(c.key)))
  const anyFilter = Object.values(filters).some(Boolean) || Object.values(forced ?? {}).some(Boolean)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو…" className="ps-9" aria-label="جستجو" />
        </div>
        {enumFilters.length > 0 && (
          <Button variant={showFilters || anyFilter ? 'secondary' : 'outline'} size="icon" className="md:hidden" onClick={() => setShowFilters((v) => !v)} aria-label="فیلترها">
            <SlidersHorizontal />
          </Button>
        )}
        <div className={cn('w-full flex-wrap gap-2 md:contents', showFilters ? 'flex' : 'hidden')}>
        {enumFilters.map((c) => (
          <Select key={c.key} value={filters[c.key] ?? 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, [c.key]: v === 'all' ? '' : v }))}>
            <SelectTrigger className="w-[calc(50%-0.25rem)] min-w-[8rem] md:w-auto" aria-label={c.label}><SelectValue placeholder={c.label} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{c.label}: همه</SelectItem>
              {Object.entries(c.options ?? {}).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        ))}
        {anyFilter && <Button variant="ghost" size="sm" onClick={() => setFilters({})}>حذف فیلترها</Button>}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {toolbar}
          {rich && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><Columns3 /><span className="hidden sm:inline">ستون‌ها</span></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {allCols.slice(1).map((c) => <DropdownMenuCheckboxItem key={c.key} checked={!hidden.includes(c.key)} onCheckedChange={() => toggleCol(c.key)} onSelect={(e) => e.preventDefault()}>{c.label}</DropdownMenuCheckboxItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" size="icon" onClick={() => list.refetch()} aria-label="بروزرسانی" disabled={list.isFetching}>
            <RefreshCw className={cn(list.isFetching && 'animate-spin')} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={exporting}>{exporting ? <Loader2 className="animate-spin" /> : <Download />}<span className="hidden sm:inline">خروجی</span></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{fmtNum(total)} ردیف (با فیلتر فعلی)</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => doExport('xlsx')}><FileSpreadsheet />Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => doExport('csv')}><FileText />CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => doExport('json')}><FileJson />JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {res.import && <Button variant="outline" className="hidden md:inline-flex" onClick={() => setImportOpen(true)}><Upload /><span className="hidden sm:inline">درون‌ریزی</span></Button>}
          {res.create && <Button onClick={() => setCreateOpen(true)}><Plus /><span className="hidden sm:inline">افزودن</span></Button>}
        </div>
      </div>

      {card && (
        <div className="grid gap-2 md:hidden">
          {list.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          {!list.isLoading && rows.length === 0 && <p className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">{dq || anyFilter ? 'نتیجه‌ای پیدا نشد' : 'هنوز داده‌ای ثبت نشده است'}</p>}
          {rows.map((row) => (
            <button key={String(row[res.pk])} onClick={() => onOpen?.(row)} className="w-full rounded-xl border bg-card p-3 text-start transition-colors active:bg-accent">
              {card(row)}
            </button>
          ))}
        </div>
      )}

      <div
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-rowcount={total}
        aria-label={res.title}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCopy={onCopy}
        className={cn('relative max-h-[calc(100dvh-16rem)] min-h-[12rem] overflow-auto rounded-xl border bg-card', rich && 'shadow-sm', card && 'hidden md:block')}
      >
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead className={cn('sticky top-0 z-20 backdrop-blur', rich ? 'bg-muted/60' : 'bg-muted/95')}>
            <tr role="row">
              {cols.map((c, ci) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    role="columnheader"
                    aria-sort={active ? (sort!.dir === 'ASC' ? 'ascending' : 'descending') : 'none'}
                    className={cn('whitespace-nowrap border-b px-3 py-2.5 text-start font-medium text-muted-foreground', ci === 0 && 'sticky start-0 z-30 bg-muted')}
                  >
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort(active && sort!.dir === 'DESC' ? { key: c.key, dir: 'ASC' } : active ? null : { key: c.key, dir: 'DESC' })}>
                      {c.label}
                      {c.edit && <span className="size-1.5 rounded-full bg-primary/60" title="قابل ویرایش" />}
                      {active && (sort!.dir === 'ASC' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                    </button>
                  </th>
                )
              })}
              {onOpen && <th className="w-10 border-b" />}
              {res.delete && <th className="w-10 border-b" />}
            </tr>
          </thead>
          <tbody>
            {list.isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>{cols.map((c) => <td key={c.key} className="border-b px-3 py-3"><Skeleton className="h-4 w-full min-w-[4rem]" /></td>)}{onOpen && <td className="border-b" />}{res.delete && <td className="border-b" />}</tr>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <tr><td colSpan={cols.length + 2} className="px-3 py-16 text-center text-muted-foreground">{dq || anyFilter ? 'نتیجه‌ای پیدا نشد' : 'هنوز داده‌ای ثبت نشده است'}</td></tr>
            )}
            {rows.map((row, ri) => (
              <tr key={String(row[res.pk])} role="row" className="group hover:bg-accent/40">
                {cols.map((col, ci) => {
                  const isSel = sel?.r === ri && sel?.c === ci
                  const isEdit = isSel && editing
                  return (
                    <td
                      key={col.key}
                      role="gridcell"
                      aria-selected={isSel}
                      onClick={() => {
                        if (ci === 0 && onOpen && !col.edit) { onOpen(row); return } // the row's id opens its page
                        setSel({ r: ri, c: ci })
                        gridRef.current?.focus({ preventScroll: true })
                        if (coarse && col.edit) setDialogCell({ r: ri, c: ci })
                      }}
                      onDoubleClick={() => { if (col.edit && !coarse) setEditing(true) }}
                      className={cn(
                        rich ? 'relative max-w-[22rem] truncate whitespace-nowrap border-b px-3 py-3' : 'relative max-w-[22rem] truncate whitespace-nowrap border-b px-3 py-2',
                        ci === 0 && 'sticky start-0 z-10 bg-card font-medium group-hover:bg-accent',
                        ci === 0 && onOpen && !col.edit && 'cursor-pointer text-primary underline-offset-4 hover:underline',
                        col.edit && 'cursor-cell',
                        isSel && 'outline outline-2 -outline-offset-2 outline-primary',
                      )}
                    >
                      {/* the display value stays in place (hidden while editing) so the row never changes height or width */}
                      <span className={isEdit ? 'invisible' : undefined}>{renderers?.[col.key] ? renderers[col.key](row) : displayValue(col, row[col.key])}</span>
                      {isEdit && (
                        <span className="absolute inset-x-1 inset-y-0 flex items-center">
                          <InlineEditor
                            col={col}
                            initial={rawText(col, row[col.key])}
                            onCancel={() => { setEditing(false); gridRef.current?.focus() }}
                            onCommit={async (v, mv) => {
                              setEditing(false)
                              gridRef.current?.focus()
                              await commit(ri, ci, v)
                              if (mv === 'down') move(1, 0)
                              else if (mv === 'next') move(0, 1)
                              else if (mv === 'prev') move(0, -1)
                            }}
                          />
                        </span>
                      )}
                    </td>
                  )
                })}
                {onOpen && (
                  <td className="border-b px-1 text-center">
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-primary" aria-label="باز کردن و مدیریت" title="باز کردن و مدیریت" onClick={() => onOpen(row)}><PanelLeftOpen /></Button>
                  </td>
                )}
                {res.delete && (
                  <td className="border-b px-1 text-center">
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label="حذف" onClick={() => setDelRow(row)}><Trash2 /></Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>ردیف در صفحه</span>
          <Select value={String(per)} onValueChange={(v) => setPer(Number(v))}>
            <SelectTrigger className="h-9 w-20" aria-label="تعداد در صفحه"><SelectValue /></SelectTrigger>
            <SelectContent>{PER_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{fmtNum(n)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <span className="tabular">{total ? `${fmtNum((page - 1) * per + 1)}–${fmtNum(Math.min(page * per, total))} از ${fmtNum(total)} ردیف` : '۰ ردیف'}{list.isFetching && !list.isLoading ? ' · …' : ''}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="صفحه قبل"><ChevronRight /></Button>
          {pageList(page, pages).map((n, i) => n === 0
            ? <span key={'e' + i} className="px-1">…</span>
            : <Button key={n} variant={n === page ? 'secondary' : 'ghost'} size="icon-sm" className="tabular" onClick={() => setPage(n)} aria-current={n === page ? 'page' : undefined}>{fmtNum(n)}</Button>)}
          <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="صفحه بعد"><ChevronLeft /></Button>
        </div>
      </div>
      <p className="hidden text-xs text-muted-foreground md:block">{onOpen ? 'برای مدیریت، روی ستون اول (آبی) بزنید · ' : ''}برای ویرایش روی سلول دو بار کلیک کنید یا Enter بزنید · با کلیدهای جهت‌نما حرکت کنید · از Excel/Sheets می‌توانید مستقیم Paste کنید.</p>

      <CellEditDialog
        open={!!dialogCell}
        col={dialogCell ? cols[dialogCell.c] : null}
        initial={dialogCell ? rawText(cols[dialogCell.c], rows[dialogCell.r]?.[cols[dialogCell.c].key]) : ''}
        onClose={() => setDialogCell(null)}
        onSave={async (v) => { if (dialogCell) await commit(dialogCell.r, dialogCell.c, v) }}
      />
      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} resName={resName} res={res} />
      {res.import && <ImportDialog open={importOpen} onOpenChange={setImportOpen} resName={resName} res={res} />}
      <Dialog open={!!delRow} onOpenChange={(o) => !o && setDelRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذف این ردیف؟</DialogTitle>
            <DialogDescription>این کار قابل بازگشت نیست.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" disabled={del.isPending} onClick={() => delRow && del.mutate(String(delRow[res.pk]))}>{del.isPending && <Loader2 className="animate-spin" />}حذف</Button>
            <Button variant="outline" onClick={() => setDelRow(null)}>انصراف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function CreateDialog({ open, onOpenChange, resName, res, initial }: { open: boolean; onOpenChange: (o: boolean) => void; resName: string; res: Resource; initial?: Record<string, string>; onCreated?: () => void }) {
  const qc = useQueryClient()
  const fields = res.cols.filter((c) => c.edit)
  const [v, setV] = useState<Record<string, string>>({})
  useEffect(() => { if (open) setV(initial ?? {}) }, [open, initial])
  const create = useMutation({
    mutationFn: () => api('create', { body: { res: resName, row: v } }),
    onSuccess: () => {
      toast.success('افزوده شد')
      qc.invalidateQueries({ queryKey: ['list', resName] })
      qc.invalidateQueries({ queryKey: ['tree'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'افزودن ناموفق بود'),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>افزودن به {res.title}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
          {fields.map((c, i) => (
            <label key={c.key} className="grid gap-1.5 text-sm">
              <span className="font-medium">{c.label}{c.req && <span className="text-destructive"> *</span>}</span>
              <FieldInput col={c} value={v[c.key] ?? ''} onChange={(x) => setV((s) => ({ ...s, [c.key]: x }))} autoFocus={i === 0} />
            </label>
          ))}
          <DialogFooter className="mt-2">
            <Button type="submit" disabled={create.isPending}>{create.isPending && <Loader2 className="animate-spin" />}افزودن</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
