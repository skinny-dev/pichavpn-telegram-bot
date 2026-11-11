// One order / one customer: everything the bot's admin menu does, from the panel and the Mini App.
// useManage().openOrder(id) / openUser(id) from anywhere; sheets stack (an order opened from a customer goes back to them).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Ban, CalendarPlus, Check, ChevronLeft, CircleSlash, Copy, Gauge, History, Link2, Loader2, MessageSquare, Minus, Pencil, Plus, Power, RefreshCw, RotateCcw, Trash2, User, Wallet, Zap,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { fmtNum, fmtStr, fmtToman, fmtTs, normalizeDigits } from '@/lib/format'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import { tgHaptic } from '@/lib/telegram'
import { useBackLayer } from '@/lib/backstack'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// ------------------------------------------------------------------ types
interface Live { ok: boolean; error?: string; not_found?: boolean; status?: string; data_limit?: number; used?: number; expire?: number; online_at?: string | null; sub?: string; configs?: string[] }
interface OrderData {
  order: { id: string; user_id: string; username: string; product: string; price: number; gb: number; days: number; location: string; status: string; time: number; note: string; sub_page: string }
  user: { id: string; name: string; username: string; balance: number; status: string; agent: string } | null
  panel: { name: string; type: string; active: boolean } | null
  live: Live
  products: { id: number; name: string; price: number; gb: number; days: number; category: string }[]
  history: { type: string; value: string; time: string; price: string }[]
}
interface UserData {
  user: { id: string; username: string; name: string; phone: string; balance: number; agent: string; status: string; register: number; discount: number; referrals: number; referrer: string; score: number; spent: number }
  orders: { id: string; username: string; product: string; price: number; gb: number; days: number; location: string; status: string; time: number }[]
  payments: { id: string; time: string; price: number; status: string; method: string; for: string }[]
}

// ------------------------------------------------------------------ context
type Sheet = { kind: 'order' | 'user'; id: string }
const Ctx = createContext<{ openOrder: (id: string) => void; openUser: (id: string) => void } | null>(null)
export const useManage = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('ManageProvider missing')
  return c
}

export function ManageProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Sheet[]>([])
  const push = useCallback((s: Sheet) => setStack((st) => (st.at(-1)?.kind === s.kind && st.at(-1)?.id === s.id ? st : [...st, s])), [])
  const pop = useCallback(() => setStack((st) => st.slice(0, -1)), [])
  const value = useMemo(() => ({ openOrder: (id: string) => push({ kind: 'order', id }), openUser: (id: string) => push({ kind: 'user', id }) }), [push])
  const top = stack.at(-1)
  useBackLayer(!!top, pop) // Back steps out of nested order/user sheets one level at a time
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={!!top} onOpenChange={(o) => { if (!o) setStack([]) }}>
        <DialogContent className="max-h-[94dvh] gap-0 p-0 md:max-w-2xl" aria-describedby={undefined}>
          {top?.kind === 'order' && <OrderView key={'o' + top.id} id={top.id} back={stack.length > 1 ? pop : undefined} />}
          {top?.kind === 'user' && <UserView key={'u' + top.id} id={top.id} back={stack.length > 1 ? pop : undefined} />}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  )
}

// ------------------------------------------------------------------ small pieces
const AGENT: Record<string, string> = { f: 'کاربر عادی', n: 'نماینده', n2: 'نماینده پیشرفته' }
const LIVE_STATUS: Record<string, [string, 'success' | 'warning' | 'destructive' | 'secondary']> = {
  active: ['فعال', 'success'], on_hold: ['منتظر اولین اتصال', 'warning'], limited: ['حجم تمام', 'destructive'], expired: ['زمان تمام', 'destructive'], disabled: ['غیرفعال', 'secondary'],
}

export function gbText(bytes: number) {
  const g = bytes / 1073741824
  return g >= 1 ? `${fmtNum(Math.round(g * 100) / 100)} گیگ` : `${fmtNum(Math.round(g * 1024))} مگ`
}
/** Telegram usernames the bot stores when there is none */
const handle = (u?: string) => (u && u !== 'none' && u !== 'NOT_USERNAME' ? '@' + u : '')
const daysLeft = (ts: number) => Math.max(0, Math.ceil((ts - Date.now() / 1000) / 86400))

function copy(text: string, label = 'کپی شد') {
  navigator.clipboard?.writeText(text).then(() => { toast.success(label); tgHaptic('success') }, () => toast.error('کپی نشد'))
}

function useOrderStatus() {
  const { schema } = useSession()
  const col = schema.orders?.cols.find((c) => c.key === 'Status')
  return (s: string) => ({ label: col?.options?.[s] ?? s, tone: col?.tones?.[s] ?? 'secondary' })
}

function Head({ title, sub, badge, back, onRefresh, busy }: { title: React.ReactNode; sub?: React.ReactNode; badge?: React.ReactNode; back?: () => void; onRefresh?: () => void; busy?: boolean }) {
  return (
    <div className="sticky top-0 z-10 flex items-start gap-2 border-b bg-background/95 px-4 pb-3 pt-4 backdrop-blur">
      {back && <Button variant="ghost" size="icon-sm" className="-ms-2 shrink-0" onClick={back} aria-label="بازگشت"><ChevronLeft className="rotate-180" /></Button>}
      <div className="min-w-0 flex-1">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-base">{title}{badge}</DialogTitle>
        {sub && <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {onRefresh && <Button variant="ghost" size="icon-sm" className="me-6 shrink-0" onClick={onRefresh} aria-label="بروزرسانی"><RefreshCw className={cn(busy && 'animate-spin')} /></Button>}
    </div>
  )
}

function Section({ title, children, className }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-2', className)}>
      {title && <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>}
      {children}
    </section>
  )
}

function ActionTile({ icon: Icon, label, onClick, tone }: { icon: React.ElementType; label: string; onClick: () => void; tone?: 'danger' | 'success' }) {
  return (
    <button
      onClick={() => { tgHaptic('light'); onClick() }}
      className={cn('flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-card px-1 py-3 text-xs font-medium transition-colors active:scale-[.98] hover:bg-accent',
        tone === 'danger' && 'text-destructive', tone === 'success' && 'text-success')}
    >
      <Icon className="size-5" />
      <span className="text-center leading-tight">{label}</span>
    </button>
  )
}

function Row({ k, v, ltr, onCopy }: { k: string; v: React.ReactNode; ltr?: boolean; onCopy?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn('flex min-w-0 items-center gap-1.5 truncate font-medium', ltr && 'tabular')} dir={ltr ? 'ltr' : undefined}>
        <span className="truncate">{v}</span>
        {onCopy && <button onClick={() => copy(onCopy)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="کپی"><Copy className="size-3.5" /></button>}
      </span>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

const NumInput = (p: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) => (
  <Input inputMode="decimal" dir="ltr" className="text-start tabular" value={p.value} placeholder={p.placeholder} autoFocus={p.autoFocus} onChange={(e) => p.onChange(normalizeDigits(e.target.value).replace(/[^\d.-]/g, ''))} />
)

const TextArea = (p: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) => (
  <textarea rows={p.rows ?? 4} value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)}
    className="w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground md:text-sm" />
)

/** A small form opened from an action tile. */
function ActionDialog({ open, onClose, title, desc, children, submit, danger, busy, onSubmit }: {
  open: boolean; onClose: () => void; title: string; desc?: string; children?: React.ReactNode; submit: string; danger?: boolean; busy: boolean; onSubmit: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle>{desc && <DialogDescription>{desc}</DialogDescription>}</DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
          {children}
          <DialogFooter className="mt-1">
            <Button type="submit" variant={danger ? 'destructive' : 'default'} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{submit}</Button>
            <Button type="button" variant="outline" onClick={onClose}>انصراف</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function useAction(route: 'mg_order_action' | 'mg_user_action', id: string, after: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ message: string }>(route, { body: { id, ...body } }),
    onSuccess: (r) => {
      toast.success(r.message); tgHaptic('success'); after()
      qc.invalidateQueries({ queryKey: ['list'] }); qc.invalidateQueries({ queryKey: ['mg-user'] }); qc.invalidateQueries({ queryKey: ['mg-order'] }); qc.invalidateQueries({ queryKey: ['overview'] })
    },
    onError: (e) => { toast.error(e instanceof ApiError ? e.message : 'انجام نشد'); tgHaptic('error') },
  })
}

// ------------------------------------------------------------------ order
type OrderAct = 'renew' | 'add_volume' | 'add_time' | 'message' | 'edit' | 'delete' | 'toggle' | 'reset_usage' | 'revoke_sub' | null

function OrderView({ id, back }: { id: string; back?: () => void }) {
  const q = useQuery({ queryKey: ['mg-order', id], queryFn: () => api<OrderData>('mg_order', { query: { id } }) })
  const { openUser } = useManage()
  const status = useOrderStatus()
  const [act, setAct] = useState<OrderAct>(null)
  const close = () => setAct(null)
  const run = useAction('mg_order_action', id, () => { close(); q.refetch() })
  const d = q.data

  if (q.isError) return <><Head title="سفارش" back={back} /><p className="p-6 text-center text-sm text-destructive">{q.error instanceof ApiError ? q.error.message : 'بارگذاری نشد'}</p></>
  if (!d) return <><Head title="سفارش" back={back} /><div className="grid gap-3 p-4"><Skeleton className="h-28" /><Skeleton className="h-20" /><Skeleton className="h-40" /></div></>

  const o = d.order, live = d.live
  const st = status(o.status)
  const used = live.used ?? 0, limit = live.data_limit ?? 0
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const [lsLabel, lsTone] = LIVE_STATUS[live.status ?? ''] ?? [live.status ?? '', 'secondary']
  const removed = o.status === 'removebyadmin' || o.status === 'removedbyuser'

  return (
    <div className="min-w-0">
      <Head
        title={<span dir="ltr" className="tabular">{o.username}</span>}
        badge={<Badge variant={st.tone as any}>{st.label}</Badge>}
        sub={`${o.product} · ${o.location}`}
        back={back}
        onRefresh={() => q.refetch()}
        busy={q.isFetching}
      />
      <div className="grid gap-5 p-4">
        {/* live state */}
        <Section>
          {live.ok ? (
            <div className="grid gap-3 rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={lsTone}>{lsLabel}</Badge>
                <span className="text-xs text-muted-foreground">{live.online_at === 'online' ? '🟢 آنلاین' : live.online_at ? `آخرین اتصال ${fmtStr(String(live.online_at).replace('T', ' ').replace(/-/g, '/'))}` : 'هنوز وصل نشده'}</span>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">مصرف</span>
                  <span className="font-bold tabular">{gbText(used)} <span className="font-normal text-muted-foreground">از {limit ? gbText(limit) : 'نامحدود'}</span></span>
                </div>
                {limit > 0 && <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', pct > 90 ? 'bg-destructive' : pct > 70 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} /></div>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-background/70 p-2.5"><div className="text-xs text-muted-foreground">باقی‌مانده</div><div className="mt-0.5 font-bold">{limit ? gbText(Math.max(0, limit - used)) : 'نامحدود'}</div></div>
                <div className="rounded-xl bg-background/70 p-2.5"><div className="text-xs text-muted-foreground">انقضا</div><div className="mt-0.5 font-bold">{live.expire ? `${fmtNum(daysLeft(live.expire))} روز` : 'نامحدود'}</div>{!!live.expire && <div className="text-[11px] text-muted-foreground" dir="ltr">{fmtTs(live.expire, true)}</div>}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
              <CircleSlash className="mb-1 inline size-4" /> {live.not_found ? 'این سرویس روی پنل نیست (پاک شده)' : `اطلاعات پنل گرفته نشد: ${live.error}`}
            </div>
          )}
        </Section>

        {/* actions */}
        {!removed && (
          <Section title="مدیریت">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              <ActionTile icon={RotateCcw} label="تمدید" onClick={() => setAct('renew')} tone="success" />
              <ActionTile icon={Plus} label="حجم اضافه" onClick={() => setAct('add_volume')} />
              <ActionTile icon={CalendarPlus} label="زمان اضافه" onClick={() => setAct('add_time')} />
              <ActionTile icon={Power} label={live.status === 'disabled' ? 'فعال کردن' : 'غیرفعال کردن'} onClick={() => setAct('toggle')} />
              <ActionTile icon={Gauge} label="صفر کردن مصرف" onClick={() => setAct('reset_usage')} />
              <ActionTile icon={Link2} label="لینک جدید" onClick={() => setAct('revoke_sub')} />
              <ActionTile icon={MessageSquare} label="پیام به کاربر" onClick={() => setAct('message')} />
              <ActionTile icon={Pencil} label="ویرایش" onClick={() => setAct('edit')} />
              <ActionTile icon={Trash2} label="حذف" onClick={() => setAct('delete')} tone="danger" />
            </div>
          </Section>
        )}
        {removed && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setAct('edit')}><Pencil />ویرایش</Button>
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => setAct('delete')}><Trash2 />پاک کردن کامل سفارش</Button>
          </div>
        )}

        {/* links */}
        {(live.sub || o.sub_page) && (
          <Section title="لینک‌ها">
            <div className="grid gap-2">
              <Button variant="outline" className="justify-between" onClick={() => copy(o.sub_page, 'لینک صفحه‌ی اشتراک کپی شد')}><span className="truncate" dir="ltr">{o.sub_page}</span><Copy /></Button>
              {live.sub && <Button variant="outline" className="justify-between" onClick={() => copy(live.sub!, 'لینک ساب کپی شد')}><span className="truncate" dir="ltr">{live.sub}</span><Copy /></Button>}
              {!!live.configs?.length && <Button variant="outline" className="justify-between" onClick={() => copy(live.configs!.join('\n'), `${fmtNum(live.configs!.length)} کانفیگ کپی شد`)}><span>کپی همه کانفیگ‌ها ({fmtNum(live.configs.length)})</span><Copy /></Button>}
            </div>
          </Section>
        )}

        {/* customer */}
        <Section title="مشتری">
          {d.user ? (
            <button onClick={() => openUser(d.user!.id)} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-start transition-colors hover:bg-accent">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><User className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.user.name || d.user.id}</div>
                <div className="truncate text-xs text-muted-foreground" dir="ltr">{handle(d.user.username) ? handle(d.user.username) + ' · ' : ''}{d.user.id}</div>
              </div>
              <div className="shrink-0 text-end text-sm"><div className="tabular font-medium">{fmtToman(d.user.balance)}</div><div className="text-xs text-muted-foreground">{AGENT[d.user.agent] ?? d.user.agent}</div></div>
              <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ) : <p className="text-sm text-muted-foreground">سفارش دستی (بدون حساب تلگرام)</p>}
        </Section>

        {/* details */}
        <Section title="جزئیات سفارش">
          <div className="divide-y rounded-xl border bg-card px-3">
            <Row k="شماره سفارش" v={o.id} ltr onCopy={o.id} />
            <Row k="محصول" v={o.product} />
            <Row k="مبلغ" v={fmtToman(o.price)} />
            <Row k="حجم / مدت" v={`${fmtNum(o.gb)} گیگ · ${fmtNum(o.days)} روز`} />
            <Row k="پنل" v={`${o.location}${d.panel ? '' : ' (حذف شده)'}`} />
            <Row k="زمان خرید" v={fmtTs(o.time)} ltr />
            {o.note && <Row k="یادداشت" v={o.note} />}
          </div>
        </Section>

        {d.history.length > 0 && (
          <Section title={<span className="inline-flex items-center gap-1"><History className="size-3.5" />سابقه تمدید و افزودنی‌ها</span>}>
            <ul className="divide-y rounded-xl border bg-card px-3 text-sm">
              {d.history.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <span>{HIST[h.type] ?? h.type} <span className="text-muted-foreground" dir="ltr">{h.value.replace('_', ' / ')}</span></span>
                  <span className="text-xs text-muted-foreground" dir="ltr">{fmtStr(h.time)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <OrderActions act={act} close={close} data={d} run={run} />
    </div>
  )
}

const HIST: Record<string, string> = { extend_user: 'تمدید', extend_user_by_admin: 'تمدید توسط ادمین', extra_user: 'حجم اضافه', extra_time_user: 'زمان اضافه', change_location: 'تغییر لوکیشن' }

function OrderActions({ act, close, data, run }: { act: OrderAct; close: () => void; data: OrderData; run: ReturnType<typeof useAction> }) {
  const o = data.order
  const [productId, setProductId] = useState<number | 'custom'>('custom')
  const [gb, setGb] = useState('')
  const [days, setDays] = useState('')
  const [price, setPrice] = useState('')
  const [charge, setCharge] = useState(false)
  const [notify, setNotify] = useState(true)
  const [text, setText] = useState('')
  const [refund, setRefund] = useState(false)
  const [purge, setPurge] = useState(false)
  const [force, setForce] = useState(false)
  const [edit, setEdit] = useState({ name_product: '', price_product: '', Volume: '', Service_time: '', note: '', Status: '' })
  const statusCol = useSession().schema.orders?.cols.find((c) => c.key === 'Status')
  useEffect(() => {
    if (!act) return
    setGb(''); setDays(''); setPrice(''); setCharge(false); setNotify(true); setText(''); setRefund(false); setForce(false)
    setPurge(o.status === 'removebyadmin')
    setProductId(data.products[0]?.id ?? 'custom')
    setEdit({ name_product: o.product, price_product: String(o.price), Volume: String(o.gb), Service_time: String(o.days), note: o.note, Status: o.status })
  }, [act]) // eslint-disable-line react-hooks/exhaustive-deps
  const busy = run.isPending
  const p = productId === 'custom' ? null : data.products.find((x) => x.id === productId)
  const userTg = !!data.user

  return (
    <>
      <ActionDialog open={act === 'renew'} onClose={close} title="تمدید سرویس" desc={`${o.username} · روش تمدید پنل «${o.location}»`} submit="تمدید" busy={busy}
        onSubmit={() => run.mutate(productId === 'custom' ? { action: 'renew', gb, days, price, charge, notify } : { action: 'renew', product_id: productId, charge, notify })}>
        <div className="grid max-h-60 gap-1.5 overflow-y-auto">
          {data.products.map((x) => (
            <button type="button" key={x.id} onClick={() => setProductId(x.id)}
              className={cn('flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm', productId === x.id && 'border-primary bg-primary/10')}>
              <span className="truncate">{x.name}</span><span className="shrink-0 tabular text-muted-foreground">{fmtToman(x.price)}</span>
            </button>
          ))}
          <button type="button" onClick={() => setProductId('custom')} className={cn('rounded-lg border px-3 py-2 text-start text-sm', productId === 'custom' && 'border-primary bg-primary/10')}>دلخواه (حجم و روز را بنویسید)</button>
        </div>
        {productId === 'custom' && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="حجم (گیگ)"><NumInput value={gb} onChange={setGb} placeholder="30" /></Field>
            <Field label="روز"><NumInput value={days} onChange={setDays} placeholder="30" /></Field>
            <Field label="مبلغ"><NumInput value={price} onChange={setPrice} placeholder="0" /></Field>
          </div>
        )}
        {userTg && <Toggle label={`از کیف پول کم شود${p ? ` (${fmtToman(p.price)})` : ''} — موجودی ${fmtToman(data.user!.balance)}`} checked={charge} onChange={setCharge} />}
        {userTg && <Toggle label="به کاربر خبر بده" checked={notify} onChange={setNotify} />}
      </ActionDialog>

      <ActionDialog open={act === 'add_volume'} onClose={close} title="حجم اضافه" submit="اضافه کن" busy={busy} onSubmit={() => run.mutate({ action: 'add_volume', gb, notify })}>
        <Field label="چند گیگ؟"><NumInput value={gb} onChange={setGb} placeholder="10" autoFocus /></Field>
        <QuickChips values={[1, 2, 5, 10, 20, 50]} unit="گیگ" onPick={(v) => setGb(String(v))} />
        {userTg && <Toggle label="به کاربر خبر بده" checked={notify} onChange={setNotify} />}
      </ActionDialog>

      <ActionDialog open={act === 'add_time'} onClose={close} title="زمان اضافه" submit="اضافه کن" busy={busy} onSubmit={() => run.mutate({ action: 'add_time', days, notify })}>
        <Field label="چند روز؟"><NumInput value={days} onChange={setDays} placeholder="7" autoFocus /></Field>
        <QuickChips values={[1, 3, 7, 15, 30]} unit="روز" onPick={(v) => setDays(String(v))} />
        {userTg && <Toggle label="به کاربر خبر بده" checked={notify} onChange={setNotify} />}
      </ActionDialog>

      <ActionDialog open={act === 'toggle'} onClose={close} title={data.live.status === 'disabled' ? 'فعال کردن سرویس؟' : 'غیرفعال کردن سرویس؟'}
        desc={data.live.status === 'disabled' ? 'کاربر دوباره می‌تواند وصل شود.' : 'تا وقتی دوباره فعالش نکنید کاربر وصل نمی‌شود.'} submit="انجام بده" busy={busy} onSubmit={() => run.mutate({ action: 'toggle' })} />

      <ActionDialog open={act === 'reset_usage'} onClose={close} title="صفر کردن مصرف؟" desc="مصرف این سرویس روی پنل صفر می‌شود و کل حجم دوباره در دسترس است." submit="صفر کن" busy={busy} onSubmit={() => run.mutate({ action: 'reset_usage' })} />

      <ActionDialog open={act === 'revoke_sub'} onClose={close} title="لینک اشتراک جدید؟" desc="لینک و کانفیگ‌های فعلی از کار می‌افتند؛ کاربر باید لینک جدید را وارد کند." submit="لینک جدید بساز" danger busy={busy} onSubmit={() => run.mutate({ action: 'revoke_sub' })} />

      <ActionDialog open={act === 'message'} onClose={close} title="پیام به کاربر" desc="از طرف ربات فرستاده می‌شود." submit="بفرست" busy={busy} onSubmit={() => run.mutate({ action: 'message', text })}>
        <TextArea value={text} onChange={setText} placeholder="متن پیام…" />
      </ActionDialog>

      <ActionDialog open={act === 'edit'} onClose={close} title="ویرایش سفارش" desc="فقط اطلاعات سفارش در ربات عوض می‌شود؛ برای حجم و زمان روی پنل از «تمدید / حجم / زمان اضافه» استفاده کنید." submit="ذخیره" busy={busy}
        onSubmit={() => run.mutate({ action: 'edit', fields: edit })}>
        <Field label="نام محصول"><Input value={edit.name_product} onChange={(e) => setEdit({ ...edit, name_product: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="مبلغ"><NumInput value={edit.price_product} onChange={(v) => setEdit({ ...edit, price_product: v })} /></Field>
          <Field label="حجم"><NumInput value={edit.Volume} onChange={(v) => setEdit({ ...edit, Volume: v })} /></Field>
          <Field label="روز"><NumInput value={edit.Service_time} onChange={(v) => setEdit({ ...edit, Service_time: v })} /></Field>
        </div>
        <Field label="وضعیت">
          <select value={edit.Status} onChange={(e) => setEdit({ ...edit, Status: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-base md:text-sm">
            {Object.entries(statusCol?.options ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="یادداشت"><TextArea rows={2} value={edit.note} onChange={(v) => setEdit({ ...edit, note: v })} /></Field>
      </ActionDialog>

      <ActionDialog open={act === 'delete'} onClose={close} title="حذف سرویس" danger submit={purge ? 'حذف کامل' : 'حذف'} busy={busy}
        desc="سرویس از پنل پاک می‌شود و کاربر دیگر وصل نمی‌شود."
        onSubmit={() => run.mutate({ action: purge ? 'purge' : 'delete', refund, notify, force })}>
        {userTg && o.price > 0 && <Toggle label={`برگشت ${fmtToman(o.price)} به کیف پول`} checked={refund} onChange={setRefund} />}
        {userTg && refund && <Toggle label="به کاربر خبر بده" checked={notify} onChange={setNotify} />}
        <Toggle label="سفارش هم از لیست پاک شود (در آمار نماند)" checked={purge} onChange={setPurge} />
        {run.error instanceof ApiError && /پنل جواب نداد/.test(run.error.message) && <Toggle label="پاک کردن بدون پنل (پنل در دسترس نیست)" checked={force} onChange={setForce} />}
      </ActionDialog>
    </>
  )
}

function QuickChips({ values, unit, onPick }: { values: number[]; unit: string; onPick: (v: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => <button type="button" key={v} onClick={() => onPick(v)} className="rounded-full border px-3 py-1 text-xs hover:bg-accent">{fmtNum(v)} {unit}</button>)}
    </div>
  )
}

// ------------------------------------------------------------------ user
type UserAct = 'add' | 'sub' | 'message' | 'block' | 'unblock' | 'edit' | null

function UserView({ id, back }: { id: string; back?: () => void }) {
  const q = useQuery({ queryKey: ['mg-user', id], queryFn: () => api<UserData>('mg_user', { query: { id } }) })
  const { openOrder } = useManage()
  const status = useOrderStatus()
  const [act, setAct] = useState<UserAct>(null)
  const [tab, setTab] = useState<'orders' | 'payments'>('orders')
  const close = () => setAct(null)
  const run = useAction('mg_user_action', id, () => { close(); q.refetch() })
  const d = q.data

  if (q.isError) return <><Head title="کاربر" back={back} /><p className="p-6 text-center text-sm text-destructive">{q.error instanceof ApiError ? q.error.message : 'بارگذاری نشد'}</p></>
  if (!d) return <><Head title="کاربر" back={back} /><div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-16" /><Skeleton className="h-40" /></div></>
  const u = d.user
  const blocked = u.status === 'block'
  const live = d.orders.filter((o) => ['active', 'end_of_time', 'end_of_volume', 'sendedwarn', 'send_on_hold'].includes(o.status)).length

  return (
    <div className="min-w-0">
      <Head
        title={u.name || handle(u.username) || u.id}
        badge={<>{blocked && <Badge variant="destructive">مسدود</Badge>}<Badge variant="secondary">{AGENT[u.agent] ?? u.agent}</Badge></>}
        sub={<span dir="ltr">{handle(u.username) ? handle(u.username) + ' · ' : ''}{u.id}</span>}
        back={back}
        onRefresh={() => q.refetch()}
        busy={q.isFetching}
      />
      <div className="grid gap-5 p-4">
        <div className="grid gap-3 rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-4">
          <div className="flex items-end justify-between gap-2">
            <div><div className="text-xs text-muted-foreground">موجودی کیف پول</div><div className="mt-1 text-2xl font-bold tabular">{fmtToman(u.balance)}</div></div>
            <Wallet className="size-6 text-primary" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setAct('add')}><Plus />افزایش</Button>
            <Button variant="outline" onClick={() => setAct('sub')}><Minus />کاهش</Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="سرویس فعال" value={fmtNum(live)} />
          <Mini label="کل خرید" value={fmtNum(u.spent)} hint="تومان" />
          <Mini label="زیرمجموعه" value={fmtNum(u.referrals)} />
        </div>

        <Section title="مدیریت">
          <div className="grid grid-cols-3 gap-2">
            <ActionTile icon={MessageSquare} label="پیام" onClick={() => setAct('message')} />
            <ActionTile icon={Pencil} label="ویرایش" onClick={() => setAct('edit')} />
            {blocked ? <ActionTile icon={Zap} label="آزاد کردن" onClick={() => setAct('unblock')} tone="success" /> : <ActionTile icon={Ban} label="مسدود کردن" onClick={() => setAct('block')} tone="danger" />}
          </div>
        </Section>

        <Section>
          <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
            {(['orders', 'payments'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn('flex-1 rounded-md py-1.5', tab === t && 'bg-background font-medium shadow-sm')}>
                {t === 'orders' ? `سفارش‌ها (${fmtNum(d.orders.length)})` : `پرداخت‌ها (${fmtNum(d.payments.length)})`}
              </button>
            ))}
          </div>
          {tab === 'orders' && (d.orders.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">سفارشی ندارد</p> : (
            <ul className="grid gap-2">
              {d.orders.map((o) => {
                const s = status(o.status)
                return (
                  <li key={o.id}>
                    <button onClick={() => openOrder(o.id)} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-start transition-colors hover:bg-accent">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="truncate font-medium tabular" dir="ltr">{o.username}</span><Badge variant={s.tone as any}>{s.label}</Badge></div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{o.product} · {o.location}</div>
                      </div>
                      <div className="shrink-0 text-end text-xs"><div className="tabular font-medium">{fmtNum(o.price)}</div><div className="text-muted-foreground" dir="ltr">{fmtTs(o.time, true)}</div></div>
                      <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                )
              })}
            </ul>
          ))}
          {tab === 'payments' && (d.payments.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">پرداختی ندارد</p> : (
            <ul className="divide-y rounded-xl border bg-card px-3 text-sm">
              {d.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0"><div className="truncate">{PAY_METHOD[p.method] ?? p.method}</div><div className="text-xs text-muted-foreground" dir="ltr">{fmtStr(p.time)}</div></div>
                  <div className="shrink-0 text-end"><div className="tabular font-medium">{fmtNum(p.price)}</div><Badge variant={p.status === 'paid' ? 'success' : p.status === 'Unpaid' || p.status === 'unpaid' ? 'secondary' : 'warning'}>{PAY_STATUS[p.status] ?? p.status}</Badge></div>
                </li>
              ))}
            </ul>
          ))}
        </Section>

        <Section title="اطلاعات">
          <div className="divide-y rounded-xl border bg-card px-3">
            <Row k="آیدی عددی" v={u.id} ltr onCopy={u.id} />
            {u.phone && u.phone !== 'none' && <Row k="شماره" v={u.phone} ltr onCopy={u.phone} />}
            <Row k="عضویت" v={fmtTs(u.register)} ltr />
            {u.discount > 0 && <Row k="تخفیف" v={`${fmtNum(u.discount)}٪`} />}
            {u.referrer && u.referrer !== '0' && <Row k="معرف" v={u.referrer} ltr />}
          </div>
          <a href={`tg://user?id=${u.id}`} className="text-center text-xs text-primary">باز کردن در تلگرام</a>
        </Section>
      </div>

      <UserActions act={act} close={close} data={d} run={run} />
    </div>
  )
}

const PAY_STATUS: Record<string, string> = { paid: 'پرداخت شده', Unpaid: 'پرداخت نشده', unpaid: 'پرداخت نشده', waiting: 'در انتظار', reject: 'رد شده', expire: 'منقضی' }
const PAY_METHOD: Record<string, string> = { 'add balance by admin': 'افزایش توسط ادمین', 'low balance by admin': 'کاهش توسط ادمین', cart_to_offline: 'کارت به کارت', 'Currency Rial 1': 'درگاه ریالی' }

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-xl border bg-card p-2.5"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-0.5 font-bold tabular">{value}</div>{hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}</div>
}

function UserActions({ act, close, data, run }: { act: UserAct; close: () => void; data: UserData; run: ReturnType<typeof useAction> }) {
  const u = data.user
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(true)
  const [text, setText] = useState('')
  const [edit, setEdit] = useState({ namecustom: '', number: '', agent: 'f', pricediscount: '0' })
  useEffect(() => {
    if (!act) return
    setAmount(''); setReason(''); setNotify(true); setText('')
    setEdit({ namecustom: u.name, number: u.phone === 'none' ? '' : u.phone, agent: u.agent || 'f', pricediscount: String(u.discount) })
  }, [act]) // eslint-disable-line react-hooks/exhaustive-deps
  const busy = run.isPending
  const n = Number(amount || 0)
  const after = act === 'sub' ? u.balance - n : u.balance + n

  return (
    <>
      <ActionDialog open={act === 'add' || act === 'sub'} onClose={close} title={act === 'add' ? 'افزایش موجودی' : 'کاهش موجودی'} submit={act === 'add' ? 'اضافه کن' : 'کم کن'} danger={act === 'sub'} busy={busy}
        desc={`موجودی فعلی ${fmtToman(u.balance)}${n ? ` ← بعد از این: ${fmtToman(after)}` : ''}`}
        onSubmit={() => run.mutate({ action: 'wallet', amount: act === 'sub' ? -n : n, reason, notify })}>
        <Field label="مبلغ (تومان)"><NumInput value={amount} onChange={setAmount} placeholder="50000" autoFocus /></Field>
        <QuickChips values={[10000, 50000, 100000, 200000, 500000]} unit="" onPick={(v) => setAmount(String(v))} />
        <Field label="توضیح (اختیاری)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً جبران قطعی" /></Field>
        <Toggle label="به کاربر خبر بده" checked={notify} onChange={setNotify} />
      </ActionDialog>

      <ActionDialog open={act === 'message'} onClose={close} title="پیام به کاربر" submit="بفرست" busy={busy} onSubmit={() => run.mutate({ action: 'message', text })}>
        <TextArea value={text} onChange={setText} placeholder="متن پیام…" />
      </ActionDialog>

      <ActionDialog open={act === 'block'} onClose={close} title="مسدود کردن کاربر؟" desc="کاربر دیگر نمی‌تواند از ربات استفاده کند." danger submit="مسدود کن" busy={busy} onSubmit={() => run.mutate({ action: 'block', reason })}>
        <Field label="دلیل (به کاربر نشان داده می‌شود)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ActionDialog>

      <ActionDialog open={act === 'unblock'} onClose={close} title="آزاد کردن کاربر؟" submit="آزاد کن" busy={busy} onSubmit={() => run.mutate({ action: 'unblock' })} />

      <ActionDialog open={act === 'edit'} onClose={close} title="ویرایش کاربر" submit="ذخیره" busy={busy} onSubmit={() => run.mutate({ action: 'edit', fields: edit })}>
        <Field label="نام نمایشی"><Input value={edit.namecustom} onChange={(e) => setEdit({ ...edit, namecustom: e.target.value })} /></Field>
        <Field label="شماره"><Input dir="ltr" value={edit.number} onChange={(e) => setEdit({ ...edit, number: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="نقش">
            <select value={edit.agent} onChange={(e) => setEdit({ ...edit, agent: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-base md:text-sm">
              {Object.entries(AGENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="درصد تخفیف"><NumInput value={edit.pricediscount} onChange={(v) => setEdit({ ...edit, pricediscount: v })} /></Field>
        </div>
      </ActionDialog>
    </>
  )
}
