import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, FileUp, FileDown, Loader2 } from 'lucide-react'
import { api, ApiError, type Resource, type Row } from '@/lib/api'
import { downloadTemplate, mapRows, parseFile } from '@/lib/io'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { fmtNum } from '@/lib/format'

interface Result { inserted: number; updated: number; skipped: number; errors: { line: number; error: string }[]; applied: boolean }
const CHUNK = 2000

async function run(resName: string, rows: Row[], dry: boolean, partial: boolean): Promise<Result> {
  const total: Result = { inserted: 0, updated: 0, skipped: 0, errors: [], applied: !dry }
  for (let i = 0; i < rows.length; i += CHUNK) {
    let r: any
    try {
      r = await api('import', { body: { res: resName, rows: rows.slice(i, i + CHUNK), dry, partial } })
    } catch (e) {
      if (e instanceof ApiError && e.extra && 'errors' in e.extra) r = e.extra
      else throw e
    }
    total.inserted += r.inserted ?? 0
    total.updated += r.updated ?? 0
    total.skipped += r.skipped ?? 0
    total.errors.push(...(r.errors ?? []).map((x: any) => ({ line: x.line + i, error: x.error })))
    if (!dry && r.applied === false) { total.applied = false; break }
  }
  return total
}

export function ImportDialog({ open, onOpenChange, resName, res }: { open: boolean; onOpenChange: (o: boolean) => void; resName: string; res: Resource }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [unknown, setUnknown] = useState<string[]>([])
  const [check, setCheck] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)

  const reset = () => { setFile(null); setRows([]); setUnknown([]); setCheck(null) }
  const cols = useMemo(() => res.cols.filter((c) => rows.some((r) => c.key in r)), [res, rows])

  async function pick(f: File | undefined) {
    if (!f) return
    reset()
    setBusy(true)
    try {
      const parsed = await parseFile(f)
      const m = mapRows(res, parsed.rows)
      if (!m.rows.length) throw new Error('فایل هیچ ردیفی ندارد')
      setFile(f); setRows(m.rows); setUnknown(m.unknown)
      setCheck(await run(resName, m.rows, true, false))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خواندن فایل ناموفق بود')
      reset()
    } finally { setBusy(false) }
  }

  async function apply(partial: boolean) {
    setBusy(true)
    try {
      const r = await run(resName, rows, false, partial)
      if (!r.applied) { setCheck(r); toast.error('درون‌ریزی به دلیل خطا انجام نشد'); return }
      toast.success(`${fmtNum(r.inserted)} ردیف جدید، ${fmtNum(r.updated)} ردیف به‌روزرسانی شد`)
      qc.invalidateQueries({ queryKey: ['list', resName] })
      qc.invalidateQueries({ queryKey: ['tree'] })
      onOpenChange(false); reset()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در درون‌ریزی')
    } finally { setBusy(false) }
  }

  const hasErrors = !!check?.errors.length
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>درون‌ریزی {res.title}</DialogTitle>
          <DialogDescription>
            فایل CSV، Excel یا JSON. ردیفی که شناسه ({res.pk}) آن موجود باشد به‌روزرسانی می‌شود، بقیه افزوده می‌شوند. ابتدا بررسی می‌شود و تا تأیید شما چیزی تغییر نمی‌کند.
          </DialogDescription>
        </DialogHeader>

        {!file && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]) }}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${drag ? 'border-primary bg-primary/5' : 'border-input'}`}
          >
            {busy ? <Loader2 className="size-8 animate-spin text-muted-foreground" /> : <FileUp className="size-8 text-muted-foreground" />}
            <p className="text-sm text-muted-foreground">فایل را اینجا رها کنید یا انتخاب کنید</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={busy}>انتخاب فایل</Button>
              <Button variant="ghost" size="sm" onClick={() => downloadTemplate(res, resName)}><FileDown /> دانلود قالب خالی</Button>
            </div>
            <input ref={input} type="file" accept=".csv,.xlsx,.xls,.json" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        )}

        {file && check && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted p-3 text-sm">
              <span className="font-medium" dir="ltr">{file.name}</span>
              <span>{fmtNum(rows.length)} ردیف</span>
              <span className="text-success">{fmtNum(check.inserted)} جدید</span>
              <span className="text-primary">{fmtNum(check.updated)} تغییر</span>
              <span className="text-muted-foreground">{fmtNum(check.skipped)} بدون تغییر/ردشده</span>
            </div>
            {unknown.length > 0 && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0" />ستون‌های ناشناخته نادیده گرفته شد: <span dir="ltr">{unknown.join(', ')}</span></p>
            )}
            {hasErrors ? (
              <div className="max-h-40 overflow-auto rounded-lg border border-destructive/40 p-3 text-sm">
                <p className="mb-1 flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="size-4" />{fmtNum(check.errors.length)} خطا</p>
                <ul className="space-y-0.5">{check.errors.slice(0, 50).map((e, i) => <li key={i}>ردیف {fmtNum(e.line)}: {e.error}</li>)}</ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" />فایل معتبر است و آماده درون‌ریزی.</p>
            )}
            <div className="max-h-48 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted"><tr>{cols.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-1.5 text-start font-medium">{c.label}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t">{cols.map((c) => <td key={c.key} className="whitespace-nowrap px-2 py-1.5">{String(r[c.key] ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <DialogFooter>
              {!hasErrors && <Button onClick={() => apply(false)} disabled={busy}>{busy && <Loader2 className="animate-spin" />}اعمال تغییرات</Button>}
              {hasErrors && <Button variant="secondary" onClick={() => apply(true)} disabled={busy}>اعمال ردیف‌های سالم</Button>}
              <Button variant="outline" onClick={reset} disabled={busy}>فایل دیگر</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
