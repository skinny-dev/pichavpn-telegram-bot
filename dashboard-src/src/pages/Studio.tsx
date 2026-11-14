import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, Check, Loader2, Plus, Send, Trash2, TriangleAlert, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Cta { key: string; url?: string; label?: string; code?: string }
interface Lint { errors: string[]; warnings: string[] }
interface Post { id: string; title: string; kind: string; occasion: string; text: string; image: string; cta: Cta[]; audience: 'channel' | 'admins'; when: number; status: string; auto: boolean; note: string; offerEnds: number; lint: Lint; day: string }
interface Occ { id: string; date: string; jy: number; jm: number; jd: number; kind: string; title: string; note: string }
interface CtaDef { label: string; group: string; ready: boolean; copy?: boolean; custom?: boolean }
interface State { now: number; settings: { live: boolean; channel: string; bot: string }; lib: string[]; occasions: Occ[]; kinds: Record<string, string>; cta: Record<string, CtaDef>; defaultCta: Record<string, string[]>; posts: Post[] }

const MONTH = ['', 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
const fa = (s: string | number) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
const STATUS: Record<string, { label: string; tone: 'default' | 'secondary' | 'success' | 'destructive' | 'warning' }> = {
  draft: { label: 'پیش‌نویس', tone: 'secondary' }, scheduled: { label: 'زمان‌بندی‌شده', tone: 'warning' }, simulated: { label: 'شبیه‌سازی شد', tone: 'default' },
  sent: { label: 'ارسال شد', tone: 'success' }, cancelled: { label: 'لغو', tone: 'destructive' },
}
const OFFSET = 12600 // Tehran, no daylight saving
const toLocal = (t: number) => { const d = new Date((t + OFFSET) * 1000); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) } }
const fromLocal = (date: string, time: string) => (date ? Math.floor(Date.parse(`${date}T${time || '10:00'}:00Z`) / 1000) - OFFSET : 0)
const jalaliOf = (t: number) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(new Date(t * 1000))
const err = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'ناموفق بود')

/** the Telegram HTML subset only: everything else is escaped */
function safeHtml(s: string) {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/&lt;(\/?)(b|i|u|s|code|blockquote|tg-spoiler)&gt;/g, '<$1$2>').replace(/\n/g, '<br/>')
}

const blank = (): Post => ({ id: '', title: '', kind: 'tip', occasion: '', text: 'درود 🌿\n\n', image: '', cta: [{ key: 'test' }], audience: 'channel', when: 0, status: 'draft', auto: false, note: '', offerEnds: 0, lint: { errors: [], warnings: [] }, day: '' })

function Preview({ p, st }: { p: Post; st: State }) {
  const rows: Cta[][] = []
  for (let i = 0; i < p.cta.length; i += 2) rows.push(p.cta.slice(i, i + 2))
  const label = (b: Cta) => b.label || st.cta[b.key]?.label || b.key
  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl bg-[#0e1621] p-3 text-white" data-testid="preview">
      <div className="overflow-hidden rounded-xl bg-[#182533]">
        {p.image && <div className="flex h-40 items-center justify-center bg-black text-xs text-sky-300" dir="ltr">🖼 {p.image}{st.lib.includes(p.image) ? '' : ' (در کتابخانه نیست)'}</div>}
        <div dir="rtl" className="px-3 py-2 text-[15px] leading-7" dangerouslySetInnerHTML={{ __html: safeHtml(p.text) }} />
        <div className="px-3 pb-2 text-left text-[11px] text-slate-400" dir="ltr">{p.when ? jalaliOf(p.when) : 'بدون زمان'}</div>
      </div>
      <div className="mt-1 space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1">{r.map((b, j) => <div key={j} className="flex-1 rounded-lg bg-[#2b5278]/60 px-2 py-2 text-center text-sm">{label(b)}</div>)}</div>
        ))}
      </div>
    </div>
  )
}

function Composer({ st, post, onDone }: { st: State; post: Post; onDone: () => void }) {
  const qc = useQueryClient()
  const [p, setP] = useState<Post>(post)
  const loc = toLocal(p.when || st.now + 86400)
  const [date, setDate] = useState(p.when ? loc.date : '')
  const [time, setTime] = useState(p.when ? loc.time : '19:30')
  const when = fromLocal(date, time)
  const cur = { ...p, when }
  const set = (k: Partial<Post>) => setP((x) => ({ ...x, ...k }))
  const save = useMutation({
    mutationFn: (status: string) => api<{ post: Post }>('studio_save', { body: { ...cur, status } }),
    onSuccess: (r) => { toast.success(r.post.status === 'scheduled' ? 'زمان‌بندی شد' : 'ذخیره شد'); qc.invalidateQueries({ queryKey: ['studio'] }); onDone() },
    onError: err,
  })
  const test = useMutation({
    mutationFn: () => api<{ sent: { ok: boolean }[]; missingImage: boolean }>('studio_test', { body: { post: cur } }),
    onSuccess: (r) => (r.sent.every((x) => x.ok) ? toast.success(r.missingImage ? 'فرستاده شد (بدون تصویر؛ در کتابخانه نیست)' : 'برای خودتان فرستاده شد') : toast.error('ارسال ناموفق بود')),
    onError: err,
  })
  const del = useMutation({ mutationFn: () => api('studio_delete', { body: { id: p.id } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['studio'] }); onDone() }, onError: err })
  const toggle = (key: string) => set({ cta: cur.cta.some((b) => b.key === key) ? cur.cta.filter((b) => b.key !== key) : [...cur.cta, { key }] })
  const upd = (key: string, o: Partial<Cta>) => set({ cta: cur.cta.map((b) => (b.key === key ? { ...b, ...o } : b)) })
  const groups = useMemo(() => { const g: Record<string, [string, CtaDef][]> = {}; for (const [k, d] of Object.entries(st.cta)) (g[d.group] ||= []).push([k, d]); return g }, [st.cta])
  const useDefault = (kind: string) => set({ kind, cta: (st.defaultCta[kind] || []).slice(0, 2).map((key) => ({ key })) })
  const l = cur.lint.errors.length || cur.lint.warnings.length ? cur.lint : { errors: [] as string[], warnings: [] as string[] }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div><Label>عنوان (فقط برای شما)</Label><Input value={p.title} onChange={(e) => set({ title: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>نوع پست</Label>
            <Select value={p.kind} onValueChange={useDefault}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(st.kinds).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>مخاطب</Label>
            <Select value={p.audience} onValueChange={(v) => set({ audience: v as Post['audience'] })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="channel">کانال</SelectItem><SelectItem value="admins">فقط ادمین‌ها</SelectItem></SelectContent></Select></div>
        </div>
        <div><Label>متن (قالب تلگرام: b، i، code، blockquote)</Label>
          <textarea dir="rtl" rows={8} className="w-full rounded-md border bg-background p-2 text-sm" value={p.text} onChange={(e) => set({ text: e.target.value })} data-testid="text" /></div>
        <div><Label>تصویر (نام از کتابخانه یا لینک https)</Label>
          <div className="flex gap-2"><Input dir="ltr" value={p.image} onChange={(e) => set({ image: e.target.value })} />
            <Select value="" onValueChange={(v) => set({ image: v })}><SelectTrigger className="w-32"><SelectValue placeholder="کتابخانه" /></SelectTrigger>
              <SelectContent>{st.lib.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}{!st.lib.length && <div className="p-2 text-xs text-muted-foreground">خالی</div>}</SelectContent></Select></div></div>
        <div>
          <Label>دکمه‌های CTA (دکمهٔ اول اصلی است؛ ۱ تا ۴)</Label>
          <div className="space-y-2">
            {Object.entries(groups).map(([g, items]) => (
              <div key={g}><div className="mb-1 text-xs text-muted-foreground">{g}</div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map(([k, d]) => {
                    const on = cur.cta.findIndex((b) => b.key === k)
                    return <button key={k} type="button" onClick={() => toggle(k)} className={cn('rounded-full border px-2.5 py-1 text-xs', on >= 0 ? 'border-primary bg-primary text-primary-foreground' : 'bg-background')}>{on >= 0 ? fa(on + 1) + '. ' : ''}{d.label}{d.ready ? '' : ' ⚠'}</button>
                  })}
                </div></div>
            ))}
          </div>
          {cur.cta.filter((b) => st.cta[b.key]?.custom).map((b) => <Input key={b.key} dir="ltr" className="mt-2" placeholder="https://…" value={b.url || ''} onChange={(e) => upd(b.key, { url: e.target.value })} />)}
          {cur.cta.filter((b) => st.cta[b.key]?.copy).map((b) => <Input key={b.key} dir="ltr" className="mt-2" placeholder="کد تخفیف واقعی" value={b.code || ''} onChange={(e) => upd(b.key, { code: e.target.value })} />)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>تاریخ (میلادی)</Label><Input dir="ltr" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>ساعت (تهران)</Label><Input dir="ltr" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
        {when > 0 && <div className="text-xs text-muted-foreground">{jalaliOf(when)}</div>}
      </div>
      <div className="space-y-3">
        <Preview p={cur} st={st} />
        {(l.errors.length > 0 || l.warnings.length > 0) && (
          <div className="space-y-1 text-sm" data-testid="lint">
            {l.errors.map((e) => <div key={e} className="flex gap-1 text-destructive"><X className="mt-0.5 size-4 shrink-0" />{e}</div>)}
            {l.warnings.map((e) => <div key={e} className="flex gap-1 text-amber-600"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{e}</div>)}
          </div>
        )}
        {p.note && <div className="rounded-md border border-amber-500/50 p-2 text-sm text-amber-700 dark:text-amber-400">{p.note}</div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => save.mutate('draft')} disabled={save.isPending}>ذخیره پیش‌نویس</Button>
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} آزمایشی برای خودم</Button>
          <Button onClick={() => save.mutate('scheduled')} disabled={save.isPending}><Check className="size-4" /> تأیید و زمان‌بندی</Button>
          {p.id && <Button variant="ghost" onClick={() => confirm('این پست حذف شود؟') && del.mutate()}><Trash2 className="size-4" /></Button>}
        </div>
        <div className="text-xs text-muted-foreground">{st.settings.live ? '⚠️ حالت زنده: پست‌های تأییدشده به کانال می‌روند.' : '🧪 حالت شبیه‌سازی: هیچ‌چیز به کانال یا مشتری نمی‌رود؛ فقط برای ادمین‌ها فرستاده می‌شود.'}</div>
      </div>
    </div>
  )
}

function Calendar({ st, onOpen, onSeed, seeding }: { st: State; onOpen: (p: Post) => void; onSeed: () => void; seeding: boolean }) {
  const byOcc = new Map(st.posts.filter((p) => p.occasion).map((p) => [p.id, p]))
  type Row = { key: string; day: string; jm: number; title: string; kind: string; post?: Post; occ?: Occ }
  const rows: Row[] = [
    ...st.occasions.map((o) => ({ key: 'o' + o.id + o.jy, day: `${o.jy}/${String(o.jm).padStart(2, '0')}/${String(o.jd).padStart(2, '0')}`, jm: o.jm, title: o.title, kind: o.kind, occ: o, post: byOcc.get(`o-${o.id}-${o.jy}`) })),
    ...st.posts.filter((p) => !p.occasion).map((p) => ({ key: p.id, day: p.day || '9999', jm: p.day ? +p.day.slice(5, 7) : 0, title: p.title || 'بدون عنوان', kind: p.kind, post: p })),
  ].sort((a, b) => a.day.localeCompare(b.day))
  let lastM = ''
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">مناسبت‌های واقعی ایرانی، حرفه‌ای و گربه‌ای؛ روی هر ردیف بزنید.</div>
        <Button size="sm" variant="outline" onClick={onSeed} disabled={seeding}>{seeding ? <Loader2 className="size-4 animate-spin" /> : <CalendarDays className="size-4" />} ساخت پیش‌نویس برای مناسبت‌های ۴ ماه آینده</Button>
      </div>
      {rows.map((r) => {
        const ym = r.day.slice(0, 7), head = ym !== lastM ? (lastM = ym, `${MONTH[r.jm] || ''} ${fa(r.day.slice(0, 4))}`) : ''
        return (
          <div key={r.key}>
            {head && <div className="mt-3 mb-1 text-sm font-bold">{head}</div>}
            <button type="button" onClick={() => r.post ? onOpen(r.post) : r.occ && onOpen({ ...blank(), title: r.occ.title, occasion: r.occ.id })} className="flex w-full items-center gap-2 rounded-lg border bg-card p-2 text-right text-sm" data-testid="row">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">{fa(r.day.slice(5))}</span>
              <span className="flex-1 truncate">{r.title}</span>
              {r.post ? <Badge variant={STATUS[r.post.status]?.tone}>{STATUS[r.post.status]?.label}</Badge> : <span className="text-xs text-muted-foreground">بدون پست</span>}
              {r.post && r.post.lint.errors.length > 0 && <TriangleAlert className="size-4 text-destructive" />}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Queue({ st, onOpen }: { st: State; onOpen: (p: Post) => void }) {
  const qc = useQueryClient()
  const cancel = useMutation({ mutationFn: (id: string) => api('studio_status', { body: { id, status: 'cancelled' } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['studio'] }), onError: err })
  const list = st.posts.filter((p) => p.status !== 'draft')
  if (!list.length) return <div className="text-sm text-muted-foreground">هنوز پستی زمان‌بندی نشده است.</div>
  return (
    <div className="space-y-2">
      {list.map((p) => (
        <Card key={p.id}><CardContent className="flex items-center gap-2 p-3 text-sm">
          <button type="button" className="flex-1 text-right" onClick={() => onOpen(p)}><div className="font-medium">{p.title || p.id}</div><div className="text-xs text-muted-foreground">{p.when ? jalaliOf(p.when) : ''}</div></button>
          <Badge variant={STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</Badge>
          {p.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(p.id)}>لغو</Button>}
        </CardContent></Card>
      ))}
    </div>
  )
}

function Settings({ st }: { st: State }) {
  const qc = useQueryClient()
  const [channel, setChannel] = useState(st.settings.channel)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const after = () => qc.invalidateQueries({ queryKey: ['studio'] })
  const live = useMutation({ mutationFn: (v: boolean) => api('studio_settings', { body: { live: v } }), onSuccess: after, onError: err })
  const ch = useMutation({ mutationFn: () => api('studio_settings', { body: { channel } }), onSuccess: () => { toast.success('ذخیره شد'); after() }, onError: err })
  const libSet = useMutation({ mutationFn: () => api('studio_lib_set', { body: { name, value } }), onSuccess: () => { setName(''); setValue(''); after() }, onError: err })
  const libDel = useMutation({ mutationFn: (n: string) => api('studio_lib_delete', { body: { name: n } }), onSuccess: after, onError: err })
  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="text-base">ارسال زنده</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-3"><Switch checked={st.settings.live} onCheckedChange={(v) => (!v || confirm('پست‌های تأییدشده به کانال می‌روند. ادامه؟')) && live.mutate(v)} data-testid="live" />
          <span>{st.settings.live ? 'زنده: پست‌های تأییدشده به کانال می‌روند' : 'شبیه‌سازی: هیچ‌چیز به کانال یا مشتری نمی‌رود'}</span></div>
        <div className="text-xs text-muted-foreground">در شبیه‌سازی هر پست زمان‌بندی‌شده فقط برای ادمین‌ها فرستاده می‌شود (با برچسب شبیه‌سازی).</div>
        <div><Label>کانال (@name یا شناسهٔ عددی)</Label><div className="flex gap-2"><Input dir="ltr" value={channel} onChange={(e) => setChannel(e.target.value)} /><Button onClick={() => ch.mutate()}>ذخیره</Button></div>
          <div className="mt-1 text-xs text-muted-foreground">ربات باید ادمین کانال باشد.</div></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">کتابخانهٔ تصویر</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <div className="text-xs text-muted-foreground">نام لاتین + file_id تلگرام (تصویر را برای ربات بفرستید) یا لینک https.</div>
        <div className="flex gap-2"><Input dir="ltr" placeholder="yalda-wide" value={name} onChange={(e) => setName(e.target.value)} /><Input dir="ltr" placeholder="file_id / https://…" value={value} onChange={(e) => setValue(e.target.value)} /><Button onClick={() => libSet.mutate()}><Plus className="size-4" /></Button></div>
        <div className="flex flex-wrap gap-2">{st.lib.map((n) => <Badge key={n} variant="secondary" className="gap-1">{n}<button type="button" onClick={() => libDel.mutate(n)}><X className="size-3" /></button></Badge>)}</div>
      </CardContent></Card>
    </div>
  )
}

export default function Studio() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['studio'], queryFn: () => api<State>('studio_state') })
  const [tab, setTab] = useState('calendar')
  const [edit, setEdit] = useState<Post | null>(null)
  const seed = useMutation({ mutationFn: () => api<{ created: number }>('studio_seed', { body: {} }), onSuccess: (r) => { toast.success(`${fa(r.created)} پیش‌نویس ساخته شد`); qc.invalidateQueries({ queryKey: ['studio'] }) }, onError: err })
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />
  const open = (p: Post) => { setEdit(p); setTab('post') }
  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between"><h1 className="text-lg font-bold">استودیو محتوا</h1>
        <Badge variant={data.settings.live ? 'warning' : 'default'}>{data.settings.live ? 'زنده' : 'شبیه‌سازی'}</Badge></div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="calendar">تقویم</TabsTrigger><TabsTrigger value="post">پست</TabsTrigger><TabsTrigger value="queue">صف</TabsTrigger><TabsTrigger value="settings">تنظیمات</TabsTrigger></TabsList>
        <TabsContent value="calendar"><Calendar st={data} onOpen={open} onSeed={() => seed.mutate()} seeding={seed.isPending} /></TabsContent>
        <TabsContent value="post">
          {edit ? <Composer key={edit.id || 'new' + edit.occasion} st={data} post={edit} onDone={() => { setEdit(null); setTab('calendar') }} /> : <Button onClick={() => setEdit(blank())}><Plus className="size-4" /> پست جدید</Button>}
        </TabsContent>
        <TabsContent value="queue"><Queue st={data} onOpen={open} /></TabsContent>
        <TabsContent value="settings"><Settings st={data} /></TabsContent>
      </Tabs>
    </div>
  )
}
