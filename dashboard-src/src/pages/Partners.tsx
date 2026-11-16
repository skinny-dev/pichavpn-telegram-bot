import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Lock, LockOpen, Plus, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { fmtNum, fmtToman } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Tier { id: string; name: string; gb: number; pct: number }
interface Partner { brand: string; brandOk: boolean; brandAllowed: boolean; id: string; username: string; level: 'n' | 'n2'; pct: number; tierName: string; earnedName: string; earnedPct: number; gb30: number; orders30: number; spent30: number; balance: number; locked: boolean; below: number; toNext: number; nextName: string; expired: boolean }
interface Change { id: string; username: string; action: 'up' | 'down' | 'warn'; from: number; to: number; name: string }
interface BrandSt { on: boolean; minTier: string; minName: string; minPct: number; minGb: number }
interface State { brand: BrandSt; mode: 'sim' | 'live'; tiers: Tier[]; maxPct: number; downgradeMonths: number; partners: Partner[]; log: { t: number; id: string; username?: string; action: string; from?: number; to: number | string }[] }
const err = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'ناموفق بود')
const ACTION: Record<string, string> = { up: 'ارتقا', down: 'تنزل', warn: 'هشدار', manual: 'دستی', level: 'تغییر سطح' }


interface Req { id: string; username: string; at: number; note: string; balance: number }
const when = (t: number) => (t ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(new Date(t * 1000)) : '—')

function Requests() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['partner-requests'], queryFn: () => api<{ requests: Req[]; welcome_pct: number }>('partner_requests'), refetchInterval: 60000 })
  const act = useMutation({
    mutationFn: (b: { id: string; decision: 'accept' | 'reject'; type?: 'n' | 'n2' }) => api<{ already?: boolean; pct?: number; refunded?: number }>('partner_request', { body: b }),
    onSuccess: (r, b) => { toast.success(r.already ? 'قبلاً بررسی شده بود' : b.decision === 'accept' ? `تأیید شد؛ ${fmtNum(r.pct ?? 0)}٪ زیر لیست` : 'رد شد'); qc.invalidateQueries({ queryKey: ['partner-requests'] }); qc.invalidateQueries({ queryKey: ['partners'] }) },
    onError: err,
  })
  const list = data?.requests ?? []
  if (!list.length) return null
  return (
    <Card><CardHeader><CardTitle className="text-base">درخواست‌های همکاری ({fmtNum(list.length)})</CardTitle></CardHeader><CardContent className="space-y-2 text-sm" data-testid="requests">
      <div className="text-xs text-muted-foreground">با «تأیید»، کاربر همکار می‌شود و پلهٔ اول ({fmtNum(data?.welcome_pct ?? 0)}٪ زیر لیست) را می‌گیرد و پیام تأیید دریافت می‌کند. «رد»: هزینهٔ درخواست (اگر بوده) فقط یک‌بار برمی‌گردد.</div>
      {list.map((r) => (
        <div key={r.id} className="rounded-lg border p-2" data-testid="request">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">@{r.username || r.id}</span><span className="text-xs text-muted-foreground">{when(r.at)}</span></div>
          {r.note && <div className="mt-1 text-xs text-muted-foreground">{r.note}</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => act.mutate({ id: r.id, decision: 'accept' })} disabled={act.isPending}>تأیید (همکار)</Button>
            <Button size="sm" variant="outline" onClick={() => confirm('سطح اعتباری: خرید اعتباری فعال می‌شود. ادامه؟') && act.mutate({ id: r.id, decision: 'accept', type: 'n2' })} disabled={act.isPending}>تأیید (اعتباری)</Button>
            <Button size="sm" variant="ghost" onClick={() => confirm('رد شود؟') && act.mutate({ id: r.id, decision: 'reject' })} disabled={act.isPending}>رد</Button>
          </div>
        </div>
      ))}
    </CardContent></Card>
  )
}

interface NoticeState { count: number; notices: { t: number; source: string; text: string; sent: number; failed: number }[] }
function Notice() {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const q = useQuery({ queryKey: ['partner_notice'], queryFn: () => api<NoticeState>('partner_notice_state') })
  const send = useMutation({
    mutationFn: () => api<{ sent: number; failed: number }>('partner_notice', { body: { text, send: true, confirm: true } }),
    onSuccess: (r) => { toast.success(`برای ${fmtNum(r.sent)} همکار ارسال شد`); setText(''); qc.invalidateQueries({ queryKey: ['partner_notice'] }) }, onError: err,
  })
  const n = q.data?.count ?? 0
  return (
    <Card><CardHeader><CardTitle className="text-base">اطلاع‌رسانی زودهنگام به همکاران</CardTitle></CardHeader><CardContent className="space-y-2 text-sm" data-testid="notice">
      <div className="text-xs text-muted-foreground">قطعی، رویداد یا تغییر قیمت را اول به همکاران بگویید. رویدادهای تأییدشده و قطع درگاه (در حالت زنده) خودکار هم اطلاع داده می‌شوند. با «درود» شروع کنید.</div>
      <textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={3} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} placeholder="درود 🌿 ..." data-testid="notice-text" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={text.trim().length < 5 || send.isPending} data-testid="notice-send" onClick={() => { if (window.confirm(`این پیام برای ${n} همکار ارسال می‌شود. ادامه؟`)) send.mutate() }}>{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `ارسال به ${fmtNum(n)} همکار`}</Button>
      </div>
      {(q.data?.notices ?? []).slice(0, 5).map((x, i) => <div key={i} className="text-xs text-muted-foreground">{new Date(x.t * 1000).toLocaleDateString('fa-IR')} · {x.source} · {fmtNum(x.sent)} ارسال{x.failed ? ` · ${fmtNum(x.failed)} ناموفق` : ''} — {x.text.slice(0, 60)}</div>)}
    </CardContent></Card>
  )
}
function Brand({ st }: { st: State }) {
  const qc = useQueryClient()
  const after = () => qc.invalidateQueries({ queryKey: ['partners'] })
  const save = useMutation({ mutationFn: (b: object) => api('partner_brand_settings', { body: b }), onSuccess: after, onError: err })
  return (
    <Card><CardHeader><CardTitle className="text-base">نام برند در سرویس‌ها</CardTitle></CardHeader><CardContent className="space-y-2 text-sm" data-testid="brand">
      <div className="text-xs text-muted-foreground">وقتی روشن باشد، همکارِ واجد شرایط سرویس‌هایش را با نام خودش می‌سازد: <span dir="ltr">acme_a1b2</span> به‌جای <span dir="ltr">pichavpn_a1b2</span>. نام فقط لاتین، یکتا و هرگز نام ما نیست.</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={st.brand.on ? 'default' : 'outline'} data-testid="brand-on" onClick={() => save.mutate({ on: !st.brand.on })}>{st.brand.on ? 'روشن است' : 'خاموش است'}</Button>
        <span className="text-xs">حداقل پله:</span>
        <Select value={st.brand.minTier} onValueChange={(v) => save.mutate({ minTier: v })}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{st.tiers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({fmtNum(t.gb)} گیگ)</SelectItem>)}</SelectContent></Select>
        <span className="text-xs text-muted-foreground">سطح اعتباری همیشه مجاز است؛ بقیه را می‌توان دستی مجاز کرد.</span>
      </div>
    </CardContent></Card>
  )
}

function Tiers({ st }: { st: State }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<Tier[]>(st.tiers)
  const save = useMutation({ mutationFn: () => api('partner_tiers', { body: { tiers: rows.map((r) => ({ ...r, gb: Number(r.gb), pct: Number(r.pct) })) } }), onSuccess: () => { toast.success('پله‌ها ذخیره شد'); qc.invalidateQueries({ queryKey: ['partners'] }) }, onError: err })
  const set = (i: number, k: keyof Tier, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: k === 'name' ? v : v.replace(/[^\d.]/g, '') } : x)))
  return (
    <Card><CardHeader><CardTitle className="text-base">پله‌های قیمت</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      <div className="text-xs text-muted-foreground">درصد زیر قیمت نماینده، بر پایهٔ حجم خرید ۳۰ روز اخیر (خرید + تمدید). ارتقا فوری، تنزل بعد از {fmtNum(st.downgradeMonths)} ماه پیاپی. حداکثر {fmtNum(st.maxPct)}٪.</div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5" data-testid="tier">
          <Input className="w-24" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
          <Input dir="ltr" className="w-24" inputMode="decimal" value={String(r.gb)} onChange={(e) => set(i, 'gb', e.target.value)} />
          <span className="text-xs">گیگ</span>
          <Input dir="ltr" className="w-16" inputMode="decimal" value={String(r.pct)} onChange={(e) => set(i, 'pct', e.target.value)} />
          <span className="text-xs">٪</span>
          {rows.length > 2 && i > 0 && <Button size="icon" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
        </div>
      ))}
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setRows([...rows, { id: 't' + rows.length, name: 'پلهٔ جدید', gb: (rows[rows.length - 1]?.gb ?? 0) + 1000, pct: Math.min(st.maxPct, (rows[rows.length - 1]?.pct ?? 10) + 5) }])}><Plus className="size-4" /> پله</Button><Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>ذخیرهٔ پله‌ها</Button></div>
    </CardContent></Card>
  )
}

function Row({ p, tiers, maxPct, st }: { p: Partner; tiers: Tier[]; maxPct: number; st: State }) {
  const qc = useQueryClient()
  const [pct, setPct] = useState(String(p.pct))
  const after = () => qc.invalidateQueries({ queryKey: ['partners'] })
  const set = useMutation({ mutationFn: (b: object) => api('partner_set', { body: { id: p.id, ...b } }), onSuccess: after, onError: err })
  const next = tiers.find((t) => t.name === p.nextName)
  const progress = next ? Math.min(100, Math.round((p.gb30 / next.gb) * 100)) : 100
  return (
    <Card><CardContent className="space-y-2 p-3 text-sm" data-testid="partner">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">@{p.username || p.id}</span>
        <Badge variant="secondary">{p.level === 'n2' ? 'اعتباری' : 'همکار'}</Badge>
        <Badge variant="default">{p.tierName}{p.pct ? ` · ${fmtNum(p.pct)}٪` : ''}</Badge>
        {p.locked && <Badge variant="warning" className="gap-1"><Lock className="size-3" />دستی</Badge>}
        {p.expired && <Badge variant="destructive">نمایندگی منقضی</Badge>}
        {p.below > 0 && <Badge variant="warning">{fmtNum(p.below)} ماه زیر آستانه</Badge>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs"><div><div className="text-muted-foreground">۳۰ روز</div>{fmtNum(p.gb30)} گیگ</div><div><div className="text-muted-foreground">خرید</div>{fmtToman(p.spent30)}</div><div><div className="text-muted-foreground">موجودی</div>{fmtToman(p.balance)}</div></div>
      <div><div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: progress + '%' }} /></div>
        <div className="mt-1 text-xs text-muted-foreground">{p.nextName ? `${fmtNum(p.toNext)} گیگ تا ${p.nextName}` : 'بالاترین پله'} · سطح کسب‌شده: {p.earnedName} ({fmtNum(p.earnedPct)}٪)</div></div>
      {st.brand.on && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="partner-brand">
          <span className="text-muted-foreground">نام برند:</span>{p.brand ? <span dir="ltr" className="font-mono">{p.brand}_</span> : <span>—</span>}
          {p.brand && <Badge variant={p.brandOk ? 'success' : 'secondary'}>{p.brandOk ? 'فعال در سرویس‌ها' : 'واجد شرایط نیست'}</Badge>}
          <Button size="sm" variant="ghost" onClick={() => api('partner_brand', { body: { id: p.id, action: p.brandAllowed ? 'disallow' : 'allow' } }).then(() => qc.invalidateQueries({ queryKey: ['partners'] }))}>{p.brandAllowed ? 'لغو اجازهٔ دستی' : 'اجازهٔ دستی'}</Button>
          {p.brand && <Button size="sm" variant="ghost" onClick={() => api('partner_brand', { body: { id: p.id, action: 'clear' } }).then(() => qc.invalidateQueries({ queryKey: ['partners'] }))}>پاک کردن نام</Button>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input dir="ltr" className="w-20" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} />
        <span className="text-xs">٪ (حداکثر {fmtNum(maxPct)})</span>
        <Button size="sm" variant="outline" onClick={() => set.mutate({ pct: Number(pct) })} disabled={set.isPending}>{set.isPending && <Loader2 className="size-4 animate-spin" />} ثبت دستی</Button>
        <Button size="sm" variant="ghost" onClick={() => set.mutate({ lock: !p.locked })}>{p.locked ? <><LockOpen className="size-4" /> آزاد کردن</> : <><Lock className="size-4" /> قفل</>}</Button>
        <Select value={p.level} onValueChange={(v) => confirm(v === 'n2' ? 'سطح اعتباری: خرید اعتباری فعال می‌شود و پله‌ها خودکار عوض نمی‌شوند. ادامه؟' : 'برگشت به سطح همکار؟') && set.mutate({ level: v })}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="n">همکار</SelectItem><SelectItem value="n2">اعتباری</SelectItem></SelectContent></Select>
      </div>
    </CardContent></Card>
  )
}

export default function Partners() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['partners'], queryFn: () => api<State>('partner_state'), refetchInterval: 60000 })
  const [plan, setPlan] = useState<Change[] | null>(null)
  const mode = useMutation({ mutationFn: (m: string) => api('partner_mode', { body: { mode: m, confirm: m === 'live' } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['partners'] }), onError: err })
  const run = useMutation({ mutationFn: (dry: boolean) => api<{ changes: Change[] }>('partner_run', { body: { dry } }), onSuccess: (r, dry) => { setPlan(r.changes); if (!dry) { toast.success('اعمال شد'); qc.invalidateQueries({ queryKey: ['partners'] }) } }, onError: err })
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />
  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">همکاران</h1>
        <div className="flex items-center gap-2"><Badge variant={data.mode === 'live' ? 'warning' : 'default'}>{data.mode === 'live' ? 'زنده: پله‌ها خودکار عوض می‌شوند' : 'شبیه‌سازی: چیزی تغییر نمی‌کند'}</Badge>
          <Button size="sm" variant="outline" data-testid="mode" onClick={() => (data.mode === 'live' || confirm('پله‌ها خودکار عوض می‌شوند و به همکار پیام می‌رود. ادامه؟')) && mode.mutate(data.mode === 'live' ? 'sim' : 'live')}>{data.mode === 'live' ? 'برگشت به شبیه‌سازی' : 'روشن کردن حالت زنده'}</Button></div>
      </div>
      <div className="text-xs text-muted-foreground">{fmtNum(data.partners.length)} همکار. قیمت هر همکار با درصد پله‌اش از لیست نماینده کم می‌شود (در خرید، تمدید و ساخت دسته‌ای). قیمت دستی و سطح اعتباری هرگز خودکار عوض نمی‌شود.</div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending} data-testid="preview">پیش‌نمایش تغییرات خودکار</Button>
        {data.mode === 'live' && <Button onClick={() => confirm('همین الان اعمال شود و به همکارها پیام برود؟') && run.mutate(false)} disabled={run.isPending}>اجرای واقعی همین حالا</Button>}
      </div>
      {plan && (
        <Card><CardContent className="space-y-1 p-3 text-sm" data-testid="plan">
          {plan.length === 0 && <div className="text-muted-foreground">تغییری لازم نیست.</div>}
          {plan.map((c) => <div key={c.id + c.action}>@{c.username || c.id}: {ACTION[c.action]} {fmtNum(c.from)}٪ ← {fmtNum(c.to)}٪ ({c.name})</div>)}
        </CardContent></Card>
      )}
      <Requests />
      <Notice />
      <Brand st={data} />
      <Tiers key={JSON.stringify(data.tiers)} st={data} />
      <div className="space-y-2">{data.partners.length === 0 ? <div className="text-sm text-muted-foreground">هنوز همکاری ثبت نشده است.</div> : data.partners.map((p) => <Row key={p.id + p.pct + String(p.locked) + p.level + p.brand + String(p.brandAllowed)} p={p} tiers={data.tiers} maxPct={data.maxPct} st={data} />)}</div>
      {data.log.length > 0 && <Card><CardHeader><CardTitle className="text-base">آخرین تغییرها</CardTitle></CardHeader><CardContent className="space-y-1 text-xs">{data.log.map((l, i) => <div key={i}>@{l.username || l.id} · {ACTION[l.action] ?? l.action} {l.from !== undefined ? `${fmtNum(l.from)}٪ ← ` : ''}{typeof l.to === 'number' ? `${fmtNum(l.to)}٪` : l.to}</div>)}</CardContent></Card>}
    </div>
  )
}
