import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ChevronsUpDown, Inbox, Plus, Search, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { fmtNum, fmtToman, fmtTs, latinDigits, normalizeDigits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDebounced } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ------------------------------------------------------------------ data

export interface Account { id: number; code: string; name: string; money_kind: string | null; system_key: string | null }
export interface Meta {
  money_accounts: Account[]; expense_accounts: Account[]; revenue_accounts: Account[]; asset_accounts: Account[]
  roles: Record<string, string>; taxes: { id: number; name: string; rate: string; kind: string }[]
  recent_expense_accounts: number[]; last_money_account: number | null; permissions: string[]; payment_methods: Record<string, string>
}

/** every finance read goes through here: cached, server-filtered, key starts with 'fin' so one invalidate refreshes everything */
export function useFin<T = any>(route: string, params: Record<string, any> = {}, opts: { enabled?: boolean; refetch?: number } = {}) {
  return useQuery({
    queryKey: ['fin', route, params],
    queryFn: () => api<T>(route, { query: params }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetch,
  })
}

export const useMeta = () => useFin<Meta>('fin_meta', {}).data

export function usePost(route: string, onDone?: (r: any) => void, success = 'ثبت شد') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, any>) => api<any>(route, { body }),
    onSuccess: (r) => { toast.success(success); qc.invalidateQueries({ queryKey: ['fin'] }); onDone?.(r) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'عملیات ناموفق بود'),
  })
}

export const can = (meta: Meta | undefined, p: string) => !!meta?.permissions.includes(p)

// ------------------------------------------------------------------ formatting

export const fmtMoney = (v: number | string | null | undefined) => fmtToman(v)
export const fmtDay = (ts: number | string | null | undefined) => (ts ? fmtTs(ts, true) : '—')
export const fmtDateTime = (ts: number | string | null | undefined) => (ts ? fmtTs(ts) : '—')
const TIME = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tehran' })
export const fmtClock = (ts: number | string) => TIME.format(new Date(Number(ts) * 1000))

export const DOC_STATE: Record<string, { label: string; tone: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
  paid: { label: 'پرداخت‌شده', tone: 'success' }, partial: { label: 'بخشی پرداخت‌شده', tone: 'warning' }, unpaid: { label: 'پرداخت‌نشده', tone: 'secondary' },
  overdue: { label: 'سررسید گذشته', tone: 'destructive' }, refunded: { label: 'برگشت‌خورده', tone: 'secondary' }, cancelled: { label: 'ابطال‌شده', tone: 'secondary' },
}
export function StateBadge({ state }: { state: string }) {
  const s = DOC_STATE[state] ?? { label: state, tone: 'secondary' as const }
  return <Badge variant={s.tone}>{s.label}</Badge>
}

export const KIND_LABEL: Record<string, string> = { cash: 'صندوق', bank: 'بانک', gateway: 'درگاه', crypto: 'ارز دیجیتال', wallet: 'کیف پول', other: 'سایر' }

// ------------------------------------------------------------------ layout bits

export function Money({ value, className, sign, size = 'md' }: { value: number | string; className?: string; sign?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const n = Number(value)
  return (
    <span dir="ltr" className={cn('tabular font-semibold', size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base', sign && n > 0 && 'text-success', sign && n < 0 && 'text-destructive', className)}>
      {sign && n > 0 ? '+' : ''}{fmtNum(n)}
    </span>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
      <Inbox className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action}
    </div>
  )
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="grid gap-2">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
}

export function Section({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-3', className)}>
      {(title || action) && <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{action}</div>}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint, tone, onClick }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'success' | 'danger' | 'warn'; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={cn('rounded-xl border bg-card p-4 text-start', onClick && 'transition-colors hover:bg-accent/50')}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1.5 text-xl font-bold leading-tight tabular sm:text-2xl', tone === 'success' && 'text-success', tone === 'danger' && 'text-destructive', tone === 'warn' && 'text-amber-500')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Tag>
  )
}

/** one list, two layouts: a real table from md up, compact cards on phones (no horizontal scrolling) */
export interface Col<T> { key: string; label: string; render: (r: T) => React.ReactNode; className?: string; hideOnMobile?: boolean }
export function ResponsiveList<T>({ rows, cols, card, onOpen, rowKey, empty }: { rows: T[]; cols: Col<T>[]; card: (r: T) => React.ReactNode; onOpen?: (r: T) => void; rowKey: (r: T) => string | number; empty?: React.ReactNode }) {
  if (!rows.length) return <>{empty}</>
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground"><tr>{cols.map((c) => <th key={c.key} className={cn('whitespace-nowrap px-3 py-2.5 text-start font-medium', c.className)}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={() => onOpen?.(r)} className={cn('border-t', onOpen && 'cursor-pointer hover:bg-accent/40')} tabIndex={onOpen ? 0 : undefined} onKeyDown={(e) => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(r) } }}>
                {cols.map((c) => <td key={c.key} className={cn('px-3 py-2.5', c.className)}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)}>
            <button type="button" onClick={() => onOpen?.(r)} disabled={!onOpen} className="w-full rounded-xl border bg-card p-3 text-start active:bg-accent/50">{card(r)}</button>
          </li>
        ))}
      </ul>
    </>
  )
}

export function Pager({ page, per, total, onPage }: { page: number; per: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / per))
  if (pages <= 1) return <div className="text-xs text-muted-foreground">{fmtNum(total)} مورد</div>
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{fmtNum(total)} مورد</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>قبلی</Button>
        <span className="tabular text-xs">{fmtNum(page)} / {fmtNum(pages)}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>بعدی</Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ range picker

export type RangeKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom'
export const RANGES: [RangeKey, string][] = [['today', 'امروز'], ['week', 'این هفته'], ['month', 'این ماه'], ['quarter', 'این فصل'], ['year', 'امسال'], ['all', 'همه'], ['custom', 'بازه دلخواه']]
export interface RangeValue { range: RangeKey; from?: string; to?: string }

export function RangeBar({ value, onChange, allow = RANGES.map((r) => r[0]) }: { value: RangeValue; onChange: (v: RangeValue) => void; allow?: RangeKey[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="-mx-4 max-w-[100vw] overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="بازه زمانی">
        <div className="flex gap-1.5">
          {RANGES.filter(([k]) => allow.includes(k)).map(([k, l]) => (
            <button key={k} onClick={() => onChange({ ...value, range: k })} data-on={value.range === k}
              className="whitespace-nowrap rounded-full border px-3 py-1 text-sm hover:bg-accent data-[on=true]:border-primary data-[on=true]:bg-primary/10 data-[on=true]:font-medium">{l}</button>
          ))}
        </div>
      </div>
      {value.range === 'custom' && (
        <div className="flex items-center gap-2">
          <Input dir="ltr" className="h-9 w-32" placeholder="1405/01/01" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: latinDigits(e.target.value) })} aria-label="از تاریخ" />
          <span className="text-muted-foreground">تا</span>
          <Input dir="ltr" className="h-9 w-32" placeholder="1405/12/29" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: latinDigits(e.target.value) })} aria-label="تا تاریخ" />
        </div>
      )}
    </div>
  )
}

export const rangeParams = (v: RangeValue) => (v.range === 'custom' ? { range: 'custom', from: v.from, to: v.to } : { range: v.range })
export const rangeReady = (v: RangeValue) => v.range !== 'custom' || (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(v.from ?? '') && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(v.to ?? ''))

// ------------------------------------------------------------------ form fields

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <div className={cn('grid gap-1.5', className)}><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
}

/** amount with live thousand separators, numeric keyboard on phones; value is the raw digit string */
export function AmountInput({ value, onChange, placeholder = '0', autoFocus, id }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; id?: string }) {
  const shown = value ? Number(value).toLocaleString('en-US') : ''
  return (
    <div className="relative">
      <Input id={id} dir="ltr" inputMode="numeric" autoComplete="off" autoFocus={autoFocus} className="pe-16 text-lg font-semibold tabular" placeholder={placeholder} value={shown}
        onChange={(e) => onChange(normalizeDigits(e.target.value).replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 15))} />
      <span className="pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-xs text-muted-foreground">تومان</span>
    </div>
  )
}

export function DateInput({ value, onChange, label = 'تاریخ' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label} hint="خالی = همین الان · مثال: 1405/07/14 یا 1405/07/14 15:30">
      <Input dir="ltr" inputMode="numeric" placeholder="1405/07/14 15:30" value={value} onChange={(e) => onChange(latinDigits(e.target.value))} />
    </Field>
  )
}

export function AccountSelect({ value, onChange, accounts, placeholder = 'انتخاب حساب' }: { value: string; onChange: (v: string) => void; accounts: Account[] | undefined; placeholder?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{(accounts ?? []).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}</SelectContent>
    </Select>
  )
}

/** searchable party picker with inline "new party" */
export function PartyPicker({ value, onChange, role, placeholder = 'جستجوی نام یا شماره…', allowNew = true, defaultRole = 'customer' }: { value: { id: number; name: string } | null; onChange: (p: { id: number; name: string } | null) => void; role?: string; placeholder?: string; allowNew?: boolean; defaultRole?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 200)
  const box = useRef<HTMLDivElement>(null)
  const list = useFin<{ rows: { id: number; name: string; roles: string; receivable: string; payable: string }[] }>('fin_parties', { q: dq, role, per: 8 }, { enabled: open })
  const create = usePost('fin_party_save', (r) => { onChange({ id: r.id, name: q.trim() }); setOpen(false); setQ('') }, 'طرف حساب ساخته شد')
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm">
        <span className="truncate font-medium">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="تغییر طرف حساب"><X className="size-4" /></button>
      </div>
    )
  }
  const exact = (list.data?.rows ?? []).some((r) => r.name === q.trim())
  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="ps-9" value={q} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} aria-label="طرف حساب" role="combobox" aria-expanded={open} />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {(list.data?.rows ?? []).map((r) => (
            <button key={r.id} type="button" onClick={() => { onChange({ id: r.id, name: r.name }); setOpen(false) }} className="flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-start text-sm hover:bg-accent">
              <span className="truncate">{r.name}</span>
              {Number(r.receivable) > 0 && <span className="shrink-0 text-xs text-success">بدهکار به ما {fmtNum(r.receivable)}</span>}
              {Number(r.payable) > 0 && <span className="shrink-0 text-xs text-destructive">ما بدهکاریم {fmtNum(r.payable)}</span>}
            </button>
          ))}
          {!list.isFetching && !(list.data?.rows ?? []).length && <p className="px-2.5 py-2 text-sm text-muted-foreground">طرف حسابی پیدا نشد</p>}
          {allowNew && q.trim().length >= 2 && !exact && (
            <button type="button" disabled={create.isPending} onClick={() => create.mutate({ name: q.trim(), roles: [defaultRole] })} className="mt-1 flex w-full items-center gap-2 rounded border-t px-2.5 py-2 text-start text-sm text-primary hover:bg-accent">
              <Plus className="size-4" />ساخت «{q.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} data-on={value === k}
          className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm hover:bg-accent data-[on=true]:border-primary data-[on=true]:bg-primary/10 data-[on=true]:font-medium">
          {value === k && <Check className="size-3.5" />}{l}
        </button>
      ))}
    </div>
  )
}

export function useStable<T>(v: T): T {
  const ref = useRef(v)
  const key = JSON.stringify(v)
  return useMemo(() => { ref.current = v; return v }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

export { ChevronsUpDown }
