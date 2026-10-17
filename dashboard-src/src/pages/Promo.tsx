import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, Flame, Gift, Loader2, Percent, Square, StopCircle } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { fmtNum, fmtToman, fmtTs, latinDigits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Product { id: number; name: string; category: string; gb: number; days: number; price: number; agent: string; active: boolean }
interface Item { id: number; name: string; category: string; agent: string; old_price: number; new_price: number; old_gb: number; new_gb: number }
interface Active { title: string; type: 'percent' | 'bonus_gb'; value: number; started_at: number; ends_at: number; items: Item[] }
interface State { products: Product[]; active: Active | null; bot: string }

const AGENTS: Record<string, string> = { f: 'کاربر عادی', n: 'نماینده', n2: 'نماینده پیشرفته' }
const DURATIONS: [string, string][] = [['24', '۱ روز'], ['48', '۲ روز'], ['72', '۳ روز'], ['168', '۷ روز']]
const ROUNDS: [string, string][] = [['1', 'بدون رند'], ['1000', '۱٬۰۰۰ تومان'], ['5000', '۵٬۰۰۰ تومان'], ['10000', '۱۰٬۰۰۰ تومان'], ['50000', '۵۰٬۰۰۰ تومان']]
const MODES: [string, string][] = [['down', 'به پایین (ارزان‌تر)'], ['nearest', 'نزدیک‌ترین'], ['up', 'به بالا']]
const n = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(1)

function announcement(items: Item[], type: string, value: number, title: string, endsAt: number, bot: string) {
  const head = type === 'percent' ? `🔥 ${title} — ${n(value)}٪ تخفیف روی پلن‌های منتخب پیچا!` : `🎁 ${title} — ${n(value)} گیگ هدیه روی پلن‌های منتخب پیچا!`
  const lines = items.map((it) => type === 'percent'
    ? `• ${it.name.split(/\s*[—-]\s*/)[0]}: ${fmtNum(it.old_price)} ← ${fmtNum(it.new_price)} تومان`
    : `• ${n(it.old_gb)} گیگ + ${n(it.new_gb - it.old_gb)} گیگ هدیه = ${n(it.new_gb)} گیگ با همان قیمت ${fmtNum(it.new_price)} تومان`)
  return [head, '', ...lines, '', `⏳ فقط تا ${fmtTs(endsAt)}`, '🚀 اتصال پایدار، بدون قطعی', '', '👇 خرید با تخفیف:', `https://t.me/${bot}?start=buy`].join('\n')
}

export default function Promo() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['promo'], queryFn: () => api<State>('promo_state'), refetchInterval: 30000 })
  const [ids, setIds] = useState<Set<number>>(new Set())
  const [type, setType] = useState<'percent' | 'bonus_gb'>('percent')
  const [value, setValue] = useState('20')
  const [round, setRound] = useState('5000')
  const [mode, setMode] = useState('down')
  const [hours, setHours] = useState('72')
  const [title, setTitle] = useState('تخفیف ویژهٔ پلن‌های پرحجم')
  const [minGb, setMinGb] = useState('40')
  const [copied, setCopied] = useState(false)
  const err = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'ناموفق بود')

  const body = { ids: [...ids], type, value, round: Number(round), round_mode: mode }
  const preview = useMutation({ mutationFn: () => api<{ items: Item[] }>('promo_preview', { body }), onError: err })
  const start = useMutation({
    mutationFn: () => api('promo_start', { body: { ...body, hours: Number(hours), title } }),
    onSuccess: () => { toast.success('تخفیف شروع شد؛ قیمت‌ها در ربات عوض شد'); qc.invalidateQueries({ queryKey: ['promo'] }) },
    onError: err,
  })
  const end = useMutation({
    mutationFn: () => api<{ restored: number; skipped: string[] }>('promo_end', { body: {} }),
    onSuccess: (r) => { toast.success(`تخفیف تمام شد؛ ${fmtNum(r.restored)} محصول به قیمت قبل برگشت${r.skipped.length ? ` (${r.skipped.length} محصول را در این مدت دستی عوض کرده بودید و دست نخورد)` : ''}`); qc.invalidateQueries({ queryKey: ['promo'] }) },
    onError: err,
  })
  // live preview while choosing
  useEffect(() => { if (ids.size && Number(value) > 0 && !data?.active) { const t = setTimeout(() => preview.mutate(), 350); return () => clearTimeout(t) } }, [ids, type, value, round, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g = new Map<string, Product[]>()
    for (const p of data?.products ?? []) g.set(p.category, [...(g.get(p.category) ?? []), p])
    return [...g.entries()]
  }, [data])
  const toggle = (list: number[], on: boolean) => setIds((s) => { const x = new Set(s); list.forEach((i) => (on ? x.add(i) : x.delete(i))); return x })
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { toast.error('کپی نشد') } }

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />

  if (data.active) {
    const a = data.active
    const text = announcement(a.items, a.type, a.value, a.title, a.ends_at, data.bot)
    const left = Math.max(0, a.ends_at - Date.now() / 1000)
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Card className="border-primary/50">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base"><Flame className="size-5 text-primary" />{a.title} — در حال اجرا</CardTitle>
            <Button variant="destructive" size="sm" disabled={end.isPending} onClick={() => confirm('تخفیف همین الان تمام شود و قیمت‌ها برگردند؟') && end.mutate()}>{end.isPending ? <Loader2 className="animate-spin" /> : <StopCircle />}پایان تخفیف</Button>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge>{a.type === 'percent' ? `${n(a.value)}٪ تخفیف` : `${n(a.value)} گیگ هدیه`}</Badge>
              <Badge variant="secondary">پایان: {fmtTs(a.ends_at)}</Badge>
              <Badge variant="outline">{Math.floor(left / 3600)} ساعت و {Math.floor((left % 3600) / 60)} دقیقه مانده</Badge>
            </div>
            <p className="text-xs text-muted-foreground">در پایان، قیمت‌ها و حجم‌ها خودکار برمی‌گردند. سفارش‌ها و پرداخت‌هایی که در این مدت ساخته شده‌اند با همان قیمتی که مشتری دیده تسویه می‌شوند.</p>
            <ItemsTable items={a.items} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-base">متن اطلاع‌رسانی</CardTitle><Button size="sm" variant="outline" onClick={() => copy(text)}>{copied ? <Check /> : <Copy />}کپی</Button></CardHeader>
          <CardContent className="grid gap-2">
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm leading-7" dir="rtl">{text}</pre>
            <p className="text-xs text-muted-foreground">کانال: همین متن را پست کنید. همهٔ کاربران ربات: در ربات ← پنل مدیریت ← «ارسال همگانی»، متن را بفرستید و دکمهٔ «خرید سرویس» را انتخاب کنید.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const items = preview.data?.items ?? []
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <p className="text-sm text-muted-foreground">محصول یا دسته را انتخاب کنید، نوع تخفیف و مدت را بگذارید. قیمت‌ها در ربات همان لحظه عوض می‌شوند و در پایان خودکار برمی‌گردند.</p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">انتخاب محصولات ({fmtNum(ids.size)})</CardTitle>
            <div className="flex items-center gap-1">
              <Input className="h-8 w-16" dir="ltr" inputMode="numeric" value={minGb} onChange={(e) => setMinGb(latinDigits(e.target.value))} aria-label="حداقل گیگ" />
              <Button size="sm" variant="outline" onClick={() => setIds(new Set((data.products).filter((p) => p.agent === 'f' && p.gb >= Number(minGb) && p.gb > 0).map((p) => p.id)))}>گیگ به بالا</Button>
              <Button size="sm" variant="ghost" onClick={() => setIds(new Set())}>پاک</Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {groups.map(([cat, list]) => {
              const all = list.every((p) => ids.has(p.id))
              return (
                <div key={cat} className="min-w-0 rounded-xl border">
                  <button type="button" onClick={() => toggle(list.map((p) => p.id), !all)} className="flex w-full items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                    {all ? <Check className="size-4 text-primary" /> : <Square className="size-4 text-muted-foreground" />}{cat}<span className="ms-auto text-xs text-muted-foreground">{fmtNum(list.length)} محصول</span>
                  </button>
                  <ul className="divide-y">
                    {list.map((p) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50">
                          <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={ids.has(p.id)} onChange={(e) => toggle([p.id], e.target.checked)} />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          {p.agent !== 'f' && <Badge variant="outline">{AGENTS[p.agent] ?? p.agent}</Badge>}
                          {!p.active && <Badge variant="secondary">ناموجود</Badge>}
                          <span className="tabular text-xs text-muted-foreground">{p.gb ? `${n(p.gb)}GB` : 'نامحدود'} · {fmtToman(p.price)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">تنظیمات تخفیف</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={type === 'percent' ? 'default' : 'outline'} onClick={() => { setType('percent'); setValue('20') }}><Percent />درصد تخفیف</Button>
              <Button type="button" variant={type === 'bonus_gb' ? 'default' : 'outline'} onClick={() => { setType('bonus_gb'); setValue('10') }}><Gift />گیگ هدیه</Button>
            </div>
            <div className="grid gap-2"><Label htmlFor="pv">{type === 'percent' ? 'چند درصد؟' : 'چند گیگ هدیه؟'}</Label><Input id="pv" dir="ltr" inputMode="decimal" value={value} onChange={(e) => setValue(latinDigits(e.target.value))} /></div>
            {type === 'percent' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-2"><Label>رند کردن قیمت</Label><Select value={round} onValueChange={setRound}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ROUNDS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-2"><Label>جهت رند</Label><Select value={mode} onValueChange={setMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MODES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              </div>
            )}
            <div className="grid gap-2"><Label>مدت</Label><Select value={hours} onValueChange={setHours}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DURATIONS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="pt">عنوان (در متن اطلاع‌رسانی)</Label><Input id="pt" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            {items.length > 0 && <ItemsTable items={items} />}
            {ids.size > 0 && !preview.isPending && items.length === 0 && <p className="text-xs text-destructive">این تخفیف روی محصولات انتخابی اثری ندارد (مثلاً پلن نامحدود برای گیگ هدیه).</p>}
            <Button disabled={!items.length || start.isPending} onClick={() => confirm(`تخفیف روی ${items.length} محصول به مدت ${DURATIONS.find(([k]) => k === hours)?.[1]} شروع شود؟ قیمت‌ها همین الان در ربات عوض می‌شوند.`) && start.mutate()}>
              {start.isPending && <Loader2 className="animate-spin" />}شروع تخفیف
            </Button>
            {items.length > 0 && <AnnouncementPreview text={announcement(items, type, Number(value), title, Date.now() / 1000 + Number(hours) * 3600, data.bot)} />}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ItemsTable({ items }: { items: Item[] }) {
  return (
    <ul className="grid gap-1 text-sm">
      {items.map((it) => (
        <li key={it.id} className="flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg bg-muted/40 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate">{it.name}</span>
          {it.new_gb !== it.old_gb
            ? <span className="tabular text-xs">{n(it.old_gb)} ← <b>{n(it.new_gb)}</b> گیگ</span>
            : <span className="tabular text-xs"><s className="text-muted-foreground">{fmtNum(it.old_price)}</s> ← <b>{fmtNum(it.new_price)}</b> تومان</span>}
        </li>
      ))}
    </ul>
  )
}

function AnnouncementPreview({ text }: { text: string }) {
  return (
    <details className="rounded-lg border p-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">پیش‌نمایش متن اطلاع‌رسانی</summary>
      <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6" dir="rtl">{text}</pre>
    </details>
  )
}
