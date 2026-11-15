import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Plus, Square, Trash2, TriangleAlert, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { fmtNum } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Params { percent?: number; gb?: number; ids?: number[]; round?: number; code?: string; limit?: number; first?: boolean; agent?: string; hours?: number; mb?: number }
interface Ev { id: string; name: string; type: string; startsAt: number; endsAt: number; group: string; occasion: string; params: Params; status: string; log: { t: number; msg: string }[]; check: { errors: string[]; warnings: string[] } }
interface Product { id: number; name: string; gb: number; days: number; price: number }
interface Row { name: string; gb: number; old: number; now: number; margin: number }
interface State { now: number; mode: 'sim' | 'live'; cost: number; maxPercent: number; gapDays: number; noticeDays: number; types: Record<string, string>; statuses: Record<string, string>; products: Product[]; events: Ev[] }

const OFFSET = 12600 // Tehran
const toLocal = (t: number) => { const d = new Date((t + OFFSET) * 1000); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) } }
const fromLocal = (date: string, time: string) => (date ? Math.floor(Date.parse(`${date}T${time || '00:00'}:00Z`) / 1000) - OFFSET : 0)
const jal = (t: number) => (t ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(new Date(t * 1000)) : '—')
const err = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'ناموفق بود')
const TONE: Record<string, 'default' | 'secondary' | 'success' | 'destructive' | 'warning'> = { draft: 'secondary', approved: 'warning', running: 'success', simulated: 'default', ended: 'secondary', cancelled: 'destructive', failed: 'destructive' }
const blank = (): Ev => ({ id: '', name: '', type: 'price_discount', startsAt: 0, endsAt: 0, group: '', occasion: '', params: { percent: 15, round: 1000 }, status: 'draft', log: [], check: { errors: [], warnings: [] } })
const summary = (e: Ev) => e.type === 'price_discount' ? `${e.params.percent}٪ تخفیف` : e.type === 'bonus_gb' ? `${e.params.gb} گیگ هدیه` : e.type === 'code' ? `کد ${e.params.code} · ${e.params.percent}٪ · ${e.params.limit} بار${e.params.first ? ' · خرید اول' : ''}` : e.type === 'test_extension' ? `تست ${e.params.hours} ساعت / ${e.params.mb} مگابایت` : e.type === 'price_increase' ? `افزایش ${e.params.percent}٪` : 'ثبات قیمت'

function Form({ st, ev, onDone }: { st: State; ev: Ev; onDone: () => void }) {
  const qc = useQueryClient()
  const [e, setE] = useState<Ev>(ev)
  const s0 = toLocal(ev.startsAt || st.now + 86400 * 2), e0 = toLocal(ev.endsAt || st.now + 86400 * 3)
  const [sd, setSd] = useState(ev.startsAt ? s0.date : ''), [stm, setStm] = useState(ev.startsAt ? s0.time : '10:00')
  const [ed, setEd] = useState(ev.endsAt ? e0.date : ''), [etm, setEtm] = useState(ev.endsAt ? e0.time : '23:59')
  const cur: Ev = { ...e, startsAt: fromLocal(sd, stm), endsAt: e.type === 'price_increase' ? 0 : fromLocal(ed, etm) }
  const P = (k: Partial<Params>) => setE((x) => ({ ...x, params: { ...x.params, ...k } }))
  const [out, setOut] = useState<{ errors: string[]; warnings: string[]; impact: Row[] } | null>(null)
  const preview = useMutation({ mutationFn: () => api<{ errors: string[]; warnings: string[]; impact: Row[] }>('event_preview', { body: { event: cur, approve: true } }), onSuccess: setOut, onError: err })
  const save = useMutation({
    mutationFn: (approve: boolean) => api('event_save', { body: { event: cur, approve } }),
    onSuccess: (_, approve) => { toast.success(approve ? 'تأیید و زمان‌بندی شد' : 'ذخیره شد'); qc.invalidateQueries({ queryKey: ['events'] }); onDone() },
    onError: (x) => { err(x); setOut((o) => ({ impact: o?.impact ?? [], warnings: [], errors: x instanceof ApiError && Array.isArray((x.extra as any)?.errors) ? (x.extra as any).errors : [] })) },
  })
  const ids = cur.params.ids ?? []
  const toggle = (id: number) => P({ ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] })
  const priceTypes = ['price_discount', 'bonus_gb', 'price_increase']
  const num = (k: keyof Params, label: string, w = '') => <div className={w}><Label>{label}</Label><Input dir="ltr" inputMode="decimal" value={String((cur.params[k] as number | undefined) ?? '')} onChange={(x) => P({ [k]: x.target.value } as Params)} /></div>
  return (
    <div className="space-y-3">
      <div><Label>نام رویداد</Label><Input value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} placeholder="بلک‌فرایدی" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>نوع</Label>
          <Select value={e.type} onValueChange={(v) => setE({ ...e, type: v, params: v === 'code' ? { percent: 20, limit: 50, first: false, agent: 'f' } : v === 'test_extension' ? { hours: 72, mb: 1500 } : v === 'bonus_gb' ? { gb: 10 } : { percent: v === 'price_increase' ? 10 : 15, round: 1000 } })}>
            <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(st.types).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>گروه (برای دو پیشنهاد یک بسته)</Label><Input dir="ltr" value={e.group} onChange={(x) => setE({ ...e, group: x.target.value })} placeholder="bf" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>شروع (تاریخ میلادی)</Label><Input dir="ltr" type="date" value={sd} onChange={(x) => setSd(x.target.value)} /></div>
        <div><Label>ساعت (تهران)</Label><Input dir="ltr" type="time" value={stm} onChange={(x) => setStm(x.target.value)} /></div>
        {e.type !== 'price_increase' && <><div><Label>پایان</Label><Input dir="ltr" type="date" value={ed} onChange={(x) => setEd(x.target.value)} /></div><div><Label>ساعت</Label><Input dir="ltr" type="time" value={etm} onChange={(x) => setEtm(x.target.value)} /></div></>}
      </div>
      <div className="text-xs text-muted-foreground">{jal(cur.startsAt)}{cur.endsAt ? ` تا ${jal(cur.endsAt)}` : ''}</div>
      {['price_discount', 'price_increase'].includes(e.type) && <div className="grid grid-cols-2 gap-2">{num('percent', `درصد (حداکثر تخفیف ${st.maxPercent})`)}<div><Label>رند کردن</Label>
        <Select value={String(e.params.round ?? 1000)} onValueChange={(v) => P({ round: Number(v) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[1000, 5000, 10000].map((r) => <SelectItem key={r} value={String(r)}>{fmtNum(r)} تومان</SelectItem>)}</SelectContent></Select></div></div>}
      {e.type === 'bonus_gb' && num('gb', 'گیگ هدیه')}
      {e.type === 'code' && <div className="grid grid-cols-2 gap-2"><div><Label>کد</Label><Input dir="ltr" value={e.params.code ?? ''} onChange={(x) => P({ code: x.target.value })} /></div>{num('percent', 'درصد')}{num('limit', 'سقف تعداد استفاده')}
        <div className="flex items-end gap-2 pb-2"><input type="checkbox" checked={!!e.params.first} onChange={(x) => P({ first: x.target.checked })} /><span className="text-sm">فقط خرید اول</span></div></div>}
      {e.type === 'test_extension' && <div className="grid grid-cols-2 gap-2">{num('hours', 'ساعت تست')}{num('mb', 'حجم تست (مگابایت)')}</div>}
      {priceTypes.includes(e.type) && (
        <div><Label>پلن‌ها (خالی = همهٔ پلن‌های مشتری)</Label>
          <div className="flex flex-wrap gap-1.5">{st.products.filter((p) => p.price > 0).map((p) => <button key={p.id} type="button" onClick={() => toggle(p.id)} className={`rounded-full border px-2.5 py-1 text-xs ${ids.includes(p.id) ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}>{p.name.split(/\s*[—-]\s*/)[0]}</button>)}</div></div>)}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending}>{preview.isPending && <Loader2 className="size-4 animate-spin" />} محاسبهٔ اثر و بررسی</Button>
        <Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending}>ذخیره پیش‌نویس</Button>
        <Button onClick={() => save.mutate(true)} disabled={save.isPending}>تأیید و زمان‌بندی</Button>
        <Button variant="ghost" onClick={onDone}>بستن</Button>
      </div>
      {out && (
        <div className="space-y-2 text-sm" data-testid="impact">
          {out.errors.map((x) => <div key={x} className="flex gap-1 text-destructive"><X className="mt-0.5 size-4 shrink-0" />{x}</div>)}
          {out.warnings.map((x) => <div key={x} className="flex gap-1 text-amber-600"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{x}</div>)}
          {out.impact.length > 0 && <div className="overflow-x-auto rounded-md border"><table className="w-full text-xs"><thead><tr className="bg-muted"><th className="p-1.5 text-right">پلن</th><th className="p-1.5">قبل</th><th className="p-1.5">بعد</th><th className="p-1.5">حاشیهٔ سود</th></tr></thead>
            <tbody>{out.impact.map((r, i) => <tr key={i} className="border-t"><td className="p-1.5">{r.name.split(/\s*[—-]\s*/)[0]}{r.gb ? ` · ${fmtNum(r.gb)} گیگ` : ''}</td><td className="p-1.5 text-center">{fmtNum(r.old)}</td><td className="p-1.5 text-center">{fmtNum(r.now)}</td><td className={`p-1.5 text-center ${r.margin < 30 ? 'text-amber-600' : ''}`}>{fmtNum(r.margin)}٪</td></tr>)}</tbody></table></div>}
          <div className="text-xs text-muted-foreground">هزینهٔ زیرساخت برای محاسبهٔ حاشیه: {fmtNum(st.cost)} تومان به ازای هر گیگ.</div>
        </div>)}
    </div>
  )
}

export default function Events() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['events'], queryFn: () => api<State>('event_state'), refetchInterval: 30000 })
  const [edit, setEdit] = useState<Ev | null>(null)
  const after = () => qc.invalidateQueries({ queryKey: ['events'] })
  const act = useMutation({ mutationFn: (b: { r: string; body: object }) => api<{ created?: string[] }>(b.r, { body: b.body }), onSuccess: (x) => { if (x.created) toast.success(`${x.created.length} پیش‌نویس پست در استودیو ساخته شد`); after() }, onError: err })
  const mode = useMutation({ mutationFn: (m: string) => api('event_mode', { body: { mode: m, confirm: m === 'live' } }), onSuccess: after, onError: err })
  const live = useMemo(() => data?.events.filter((x) => x.status === 'running') ?? [], [data])
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />
  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">رویدادها</h1>
        <div className="flex items-center gap-2"><Badge variant={data.mode === 'live' ? 'warning' : 'default'}>{data.mode === 'live' ? 'زنده: خودکار اعمال می‌شود' : 'شبیه‌سازی: چیزی تغییر نمی‌کند'}</Badge>
          <Button size="sm" variant="outline" data-testid="mode" onClick={() => (data.mode === 'live' || confirm('رویدادهای تأییدشده در موعد، قیمت و کدها را واقعاً تغییر می‌دهند. ادامه؟')) && mode.mutate(data.mode === 'live' ? 'sim' : 'live')}>{data.mode === 'live' ? 'برگشت به شبیه‌سازی' : 'روشن کردن حالت زنده'}</Button></div>
      </div>
      <div className="text-xs text-muted-foreground">رویداد در موعد خودش اعمال و در پایان برگردانده می‌شود. هیچ رویدادی بدون تأیید شما شروع نمی‌شود. حداکثر تخفیف {st(data.maxPercent)}٪، فاصلهٔ حداقل {st(data.gapDays)} روز بین پیشنهادها.</div>
      {live.length > 0 && <div className="rounded-md border border-green-600/40 p-2 text-sm">در حال اجرا: {live.map((x) => x.name).join('، ')}</div>}
      {edit ? <Card><CardContent className="p-3"><Form key={edit.id || 'new'} st={data} ev={edit} onDone={() => setEdit(null)} /></CardContent></Card> : <Button onClick={() => setEdit(blank())} data-testid="new"><Plus className="size-4" /> رویداد جدید</Button>}
      <div className="space-y-2">
        {data.events.length === 0 && <div className="text-sm text-muted-foreground">هنوز رویدادی نساخته‌اید.</div>}
        {data.events.map((x) => (
          <Card key={x.id}><CardContent className="space-y-1 p-3 text-sm" data-testid="event">
            <div className="flex items-center gap-2"><span className="flex-1 font-medium">{x.name}</span><Badge variant={TONE[x.status]}>{data.statuses[x.status]}</Badge></div>
            <div className="text-xs text-muted-foreground">{data.types[x.type]} · {summary(x)}</div>
            <div className="text-xs text-muted-foreground">{jal(x.startsAt)}{x.endsAt ? ` ← ${jal(x.endsAt)}` : ''}</div>
            {x.check.errors.map((m) => <div key={m} className="flex gap-1 text-xs text-destructive"><X className="size-3.5 shrink-0" />{m}</div>)}
            {x.log.length > 0 && <div className="text-xs text-muted-foreground">{x.log[x.log.length - 1].msg}</div>}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {['draft', 'approved', 'cancelled'].includes(x.status) && <Button size="sm" variant="outline" onClick={() => setEdit(x)}>ویرایش</Button>}
              {x.status === 'draft' && <Button size="sm" onClick={() => act.mutate({ r: 'event_save', body: { event: x, approve: true } })}>تأیید</Button>}
              {['draft', 'approved'].includes(x.status) && <Button size="sm" variant="ghost" onClick={() => act.mutate({ r: 'event_status', body: { id: x.id, status: 'cancelled' } })}>لغو</Button>}
              {['running', 'simulated'].includes(x.status) && <Button size="sm" variant="destructive" onClick={() => confirm('همین الان متوقف و برگردانده شود؟') && act.mutate({ r: 'event_status', body: { id: x.id, status: 'stop' } })}><Square className="size-3.5" /> توقف فوری</Button>}
              <Button size="sm" variant="outline" onClick={() => act.mutate({ r: 'event_posts', body: { id: x.id } })}>ساخت پست‌ها در استودیو</Button>
              {['draft', 'cancelled', 'ended', 'failed'].includes(x.status) && <Button size="sm" variant="ghost" onClick={() => confirm('حذف شود؟') && act.mutate({ r: 'event_delete', body: { id: x.id } })}><Trash2 className="size-4" /></Button>}
            </div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  )
}
const st = (n: number) => fmtNum(n)
