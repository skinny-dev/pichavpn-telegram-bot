import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ChevronRight, ChevronLeft, Download, FileSpreadsheet, FileText, FileJson, Loader2, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { api, ApiError, type Col, type Resource, type Row } from '@/lib/api'
import { fmtNum, fmtStr, fmtTs, normalizeDigits } from '@/lib/format'
import { exportRows, type ExportFormat } from '@/lib/io'
import { useCoarsePointer, useDebounced } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
      return <Badge variant={bad ? 'destructive' : String(v) === 'Active' ? 'success' : 'secondary'}>{label}</Badge>
    }
    default: return <span>{String(v)}</span>
  }
}

const rawText = (col: Col, v: unknown) => (v === null || v === undefined ? '' : String(v))

export function DataGrid({ resName, res, hide = [], toolbar, filterCols = [] }: Props) {
  const qc = useQueryClient()
  const coarse = useCoarsePointer()
  const cols = useMemo(() => res.cols.filter((c) => !hide.includes(c.key)), [res, hide])
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

  const params = { res: resName, page, per, q: dq, sort: sort?.key, dir: sort?.dir, f: filters }
  const queryKey = ['list', resName, params]
  const list = useQuery({
    queryKey,
    queryFn: () => api<{ rows: Row[]; total: number }>('list', { query: params }),
    placeholderData: keepPreviousData,
  })
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
      const out = await api<{ rows: Row[] }>('export', { query: { res: resName, q: dq, sort: sort?.key, dir: sort?.dir, f: filters } })
      await exportRows(res, out.rows, fmt, resName)
      toast.success(`${fmtNum(out.rows.length)} ردیف خروجی گرفته شد`)
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'خروجی ناموفق بود') } finally { setExporting(false) }
  }

  const enumFilters = cols.filter((c) => c.type === 'enum' && (filterCols.length === 0 || filterCols.includes(c.key)))
  const anyFilter = Object.values(filters).some(Boolean)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو…" className="ps-9" aria-label="جستجو" />
        </div>
        {enumFilters.map((c) => (
          <Select key={c.key} value={filters[c.key] ?? 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, [c.key]: v === 'all' ? '' : v }))}>
            <SelectTrigger className="w-auto min-w-[8rem]" aria-label={c.label}><SelectValue placeholder={c.label} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{c.label}: همه</SelectItem>
              {Object.entries(c.options ?? {}).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        ))}
        {anyFilter && <Button variant="ghost" size="sm" onClick={() => setFilters({})}>حذف فیلترها</Button>}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {toolbar}
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
          {res.import && <Button variant="outline" onClick={() => setImportOpen(true)}><Upload /><span className="hidden sm:inline">درون‌ریزی</span></Button>}
          {res.create && <Button onClick={() => setCreateOpen(true)}><Plus /><span className="hidden sm:inline">افزودن</span></Button>}
        </div>
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-rowcount={total}
        aria-label={res.title}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCopy={onCopy}
        className="relative max-h-[calc(100dvh-16rem)] min-h-[12rem] overflow-auto rounded-xl border bg-card"
      >
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
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
              {res.delete && <th className="w-10 border-b" />}
            </tr>
          </thead>
          <tbody>
            {list.isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>{cols.map((c) => <td key={c.key} className="border-b px-3 py-3"><Skeleton className="h-4 w-full min-w-[4rem]" /></td>)}{res.delete && <td className="border-b" />}</tr>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="px-3 py-16 text-center text-muted-foreground">{dq || anyFilter ? 'نتیجه‌ای پیدا نشد' : 'هنوز داده‌ای ثبت نشده است'}</td></tr>
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
                        setSel({ r: ri, c: ci })
                        gridRef.current?.focus({ preventScroll: true })
                        if (coarse && col.edit) setDialogCell({ r: ri, c: ci })
                      }}
                      onDoubleClick={() => { if (col.edit && !coarse) setEditing(true) }}
                      className={cn(
                        'max-w-[22rem] truncate whitespace-nowrap border-b px-3 py-2',
                        ci === 0 && 'sticky start-0 z-10 bg-card font-medium group-hover:bg-accent',
                        col.edit && 'cursor-cell',
                        isSel && 'outline outline-2 -outline-offset-2 outline-primary',
                      )}
                    >
                      {isEdit ? (
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
                      ) : displayValue(col, row[col.key])}
                    </td>
                  )
                })}
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
        <span>{fmtNum(total)} ردیف{list.isFetching && !list.isLoading ? ' · در حال بروزرسانی…' : ''}</span>
        <div className="flex items-center gap-2">
          <Select value={String(per)} onValueChange={(v) => setPer(Number(v))}>
            <SelectTrigger className="h-9 w-24" aria-label="تعداد در صفحه"><SelectValue /></SelectTrigger>
            <SelectContent>{PER_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{fmtNum(n)}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="صفحه قبل"><ChevronRight /></Button>
          <span className="min-w-[4.5rem] text-center tabular">{fmtNum(page)} از {fmtNum(pages)}</span>
          <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="صفحه بعد"><ChevronLeft /></Button>
        </div>
      </div>
      <p className="hidden text-xs text-muted-foreground md:block">برای ویرایش روی سلول دو بار کلیک کنید یا Enter بزنید · با کلیدهای جهت‌نما حرکت کنید · از Excel/Sheets می‌توانید مستقیم Paste کنید.</p>

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
