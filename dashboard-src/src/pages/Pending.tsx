import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { fmtStr, fmtToman } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Row { id_order: string; time: string; id_user: string; user: string; price: number; method: string; status: string; problem: string; kind: string; target: string; ref: string }
interface Data { rows: Row[]; counts: Record<string, number>; days: number }

const PROBLEMS: Record<string, { label: string; hint: string; tone: string }> = {
  not_delivered: { label: 'پرداخت شده، تحویل نشده', hint: 'پول رسیده ولی سرویس ساخته/تمدید نشده', tone: 'bg-destructive/15 text-destructive' },
  waiting: { label: 'رسید ارسال شده', hint: 'کاربر رسید فرستاده؛ منتظر تأیید ادمین', tone: 'bg-warning/15 text-warning' },
  unpaid: { label: 'در انتظار پرداخت/واریزا', hint: 'هنوز تأییدی از درگاه نرسیده', tone: 'bg-muted text-foreground' },
  expire: { label: 'منقضی شده', hint: 'مهلت پرداخت تمام شد؛ اگر پول رسیده، تأیید کنید', tone: 'bg-muted text-muted-foreground' },
  reject: { label: 'رد شده', hint: 'ادمین رد کرده', tone: 'bg-muted text-muted-foreground' },
}
const KINDS: Record<string, string> = { new: 'خرید جدید', renew: 'تمدید', volume: 'حجم اضافه', time: 'زمان اضافه', topup: 'شارژ کیف پول', refunded: 'برگشت به کیف پول' }
const METHODS: Record<string, string> = { variza: 'واریزا', 'کارت به کارت': 'کارت به کارت', 'Star Telegram': 'استار تلگرام' }

/** «معلق‌ها»: payments that need a person, especially «paid but not delivered». */
export default function Pending() {
  const qc = useQueryClient()
  const [days, setDays] = useState('7')
  const [filter, setFilter] = useState('')
  const { data, isLoading, isFetching, refetch } = useQuery({ queryKey: ['pay-pending', days], queryFn: () => api<Data>('pay_pending', { query: { days } }), refetchInterval: 60000 })
  const confirm = useMutation({
    mutationFn: (b: { order: string; allow_rejected?: boolean }) => api<{ delivered: boolean | null; kind: string }>('pay_confirm', { body: b }),
    onSuccess: (r) => {
      toast.success(r.delivered === false ? 'تأیید شد ولی تحویل انجام نشد؛ پنل VPN را چک کنید' : 'تأیید و تحویل شد')
      qc.invalidateQueries({ queryKey: ['pay-pending'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'ناموفق بود'),
  })
  const rows = (data?.rows ?? []).filter((r) => !filter || r.problem === filter)

  function act(r: Row) {
    const what = r.problem === 'not_delivered' ? 'تحویل دوباره' : 'تأیید پرداخت و تحویل'
    if (!window.confirm(`${what}؟\n${r.user} — ${fmtToman(r.price)} — ${KINDS[r.kind] ?? r.kind}${r.target ? ` (${r.target})` : ''}\n\nفقط وقتی بزنید که مطمئنید پول واقعاً رسیده.`)) return
    confirm.mutate({ order: r.id_order, allow_rejected: r.problem === 'reject' })
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <p className="text-sm text-muted-foreground">پرداخت‌هایی که به آدم نیاز دارند. مهم‌ترین: «پرداخت شده، تحویل نشده». قبل از تأیید، واریز را در پنل واریزا یا حساب بانکی چک کنید.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilter('')} data-on={!filter} className="rounded-full border px-3 py-1 text-sm data-[on=true]:border-primary data-[on=true]:bg-primary/10">همه {data ? `(${data.rows.length})` : ''}</button>
        {Object.entries(PROBLEMS).map(([k, p]) => (
          <button key={k} onClick={() => setFilter(k)} data-on={filter === k} className={cn('rounded-full border px-3 py-1 text-sm data-[on=true]:border-primary data-[on=true]:bg-primary/10', k === 'not_delivered' && (data?.counts[k] ?? 0) > 0 && 'border-destructive text-destructive')}>
            {p.label} {data ? `(${data.counts[k] ?? 0})` : ''}
          </button>
        ))}
        <div className="ms-auto flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-auto" aria-label="بازه"><SelectValue /></SelectTrigger>
            <SelectContent>{[['1', '۲۴ ساعت'], ['3', '۳ روز'], ['7', '۷ روز'], ['30', '۳۰ روز']].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="icon-sm" aria-label="تازه‌سازی" onClick={() => refetch()}>{isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-40 w-full" /> : rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground"><CheckCircle2 className="mx-auto mb-2 size-8 text-success" />موردی برای بررسی نیست.</div>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
          {rows.map((r) => {
            const p = PROBLEMS[r.problem]
            const canAct = r.problem !== 'not_delivered' || r.kind === 'new'
            return (
              <li key={r.id_order} className={cn('min-w-0 rounded-xl border bg-card p-3', r.problem === 'not_delivered' && 'border-destructive/50')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', p.tone)}>{r.problem === 'not_delivered' ? <AlertTriangle className="size-3" /> : <Clock className="size-3" />}{p.label}</span>
                  <Badge variant="secondary">{KINDS[r.kind] ?? r.kind}</Badge>
                  <Badge variant="outline">{METHODS[r.method] ?? r.method}</Badge>
                  <span className="ms-auto tabular font-semibold">{fmtToman(r.price)}</span>
                </div>
                <div className="mt-2 grid gap-0.5 text-sm">
                  <div className="truncate">{r.user} <span className="text-xs text-muted-foreground" dir="ltr">({r.id_user})</span></div>
                  {r.target && <div className="truncate text-xs text-muted-foreground">سرویس: <span dir="ltr">{r.target}</span></div>}
                  <div className="text-xs text-muted-foreground">{fmtStr(r.time)} · سفارش <span dir="ltr">{r.id_order}</span>{r.ref ? <> · واریزا <span dir="ltr">{r.ref}</span></> : null}</div>
                  <div className="text-xs text-muted-foreground">{p.hint}</div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {canAct ? (
                    <Button size="sm" variant={r.problem === 'not_delivered' || r.problem === 'waiting' ? 'default' : 'outline'} disabled={confirm.isPending} onClick={() => act(r)}>
                      {confirm.isPending && confirm.variables?.order === r.id_order && <Loader2 className="animate-spin" />}
                      {r.problem === 'not_delivered' ? 'تحویل دوباره' : 'تأیید و تحویل'}
                    </Button>
                  ) : <span className="text-xs text-destructive">تمدید را دستی در پنل VPN انجام دهید (تکرار خودکار ممکن است دوبار تمدید کند)</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
