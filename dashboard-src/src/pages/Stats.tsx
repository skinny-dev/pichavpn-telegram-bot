import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Boxes, Coins, Copy, Landmark, Receipt, RefreshCw, ShoppingBag, Users, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtNum, fmtNum2, fmtToman, fmtTs } from '@/lib/format'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/Stat'

const PERIODS = [['all', 'کل'], ['hour', 'یک ساعت اخیر'], ['today', 'امروز'], ['yesterday', 'دیروز'], ['month', 'ماه فعلی'], ['lastmonth', 'ماه قبل']] as const
type D = Record<string, number>
interface StatsRes { title: string; start: number; end: number; data: D; all: D; text: string }

function Row({ label, count, sum }: { label: string; count?: number; sum?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{count !== undefined && <span>{fmtNum(count)} عدد</span>}{count !== undefined && sum !== undefined && <span className="mx-1.5 text-muted-foreground">·</span>}{sum !== undefined && <span className="font-medium">{fmtToman(sum)}</span>}</span>
    </div>
  )
}
function Section({ title, icon: Icon, children }: { title: string; icon: typeof Receipt; children: React.ReactNode }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-primary" />{title}</CardTitle></CardHeader><CardContent className="divide-y">{children}</CardContent></Card>
}

export default function Stats() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('today')
  const q = useQuery({ queryKey: ['stats', period], queryFn: () => api<StatsRes>('stats', { query: { period } }) })
  const d = q.data?.data, all = q.data?.all
  return (
    <div className="grid gap-4 md:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-mx-4 max-w-[100vw] overflow-x-auto px-4 md:mx-0 md:px-0">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <TabsList className="h-auto flex-nowrap">{PERIODS.map(([k, l]) => <TabsTrigger key={k} value={k}>{l}</TabsTrigger>)}</TabsList>
          </Tabs>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => q.refetch()} aria-label="بروزرسانی" disabled={q.isFetching}><RefreshCw className={q.isFetching ? 'animate-spin' : ''} /></Button>
          <Button variant="outline" disabled={!q.data} onClick={() => navigator.clipboard.writeText(q.data!.text).then(() => toast.success('متن گزارش کپی شد'), () => toast.error('کپی نشد'))}><Copy />کپی گزارش</Button>
        </div>
      </div>
      {q.data && period !== 'all' && <p className="text-sm text-muted-foreground" dir="auto">بازه: <span dir="ltr" className="tabular">{fmtTs(q.data.start)}</span> تا <span dir="ltr" className="tabular">{fmtTs(q.data.end)}</span></p>}

      {!d || !all ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={Coins} label="درآمد کل" value={fmtToman(d.revenue)} tone="success" hint={`از ابتدا: ${fmtToman(all.revenue)}`} />
            <StatCard icon={Wallet} label="درآمد خالص" value={fmtToman(d.net)} tone={d.net < 0 ? 'danger' : 'success'} hint={`از ابتدا: ${fmtToman(all.net)}`} />
            <StatCard icon={Landmark} label="ورود سرمایه" value={fmtToman(d.cap_sum)} hint={`از ابتدا: ${fmtToman(all.cap_sum)}`} />
            <StatCard icon={Receipt} label="مجموع هزینه‌ها" value={fmtToman(d.exp_sum)} tone={d.exp_sum ? 'danger' : 'default'} hint={`${fmtNum(d.exp)} مورد`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="فروش" icon={ShoppingBag}>
              <Row label="سفارشات" count={d.orders} sum={d.orders_sum} />
              <Row label="خرید اول" count={d.first} sum={d.first_sum} />
              <Row label="خرید نمایندگان عادی" count={d.agent_n} sum={d.agent_n_sum} />
              <Row label="خرید نمایندگان پیشرفته" count={d.agent_n2} sum={d.agent_n2_sum} />
              <Row label="تمدید" count={d.renew} sum={d.renew_sum} />
              <Row label="حجم اضافه" count={d.extra} sum={d.extra_sum} />
              <Row label="تعداد کل" count={d.count_all} />
            </Section>
            <Section title="کیف پول و حسابداری" icon={Wallet}>
              <Row label="شارژ کیف پول" count={d.wallet_in} sum={d.wallet_in_sum} />
              <Row label="برداشت از کیف پول" count={d.wallet_out} sum={d.wallet_out_sum} />
              <Row label="هزینه‌ها" count={d.exp} sum={d.exp_sum} />
              <Row label="ورود سرمایه" count={d.cap} sum={d.cap_sum} />
            </Section>
            <Section title="حجم فروخته‌شده" icon={Boxes}>
              <Row label="جمع حجم" sum={undefined} />
              <div className="py-2 text-2xl font-bold tabular">{fmtNum2(d.vol_service + d.vol_extra)} <span className="text-sm font-normal text-muted-foreground">گیگابایت</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">از خرید سرویس</span><span className="tabular">{fmtNum2(d.vol_service)} GB</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">از حجم اضافه</span><span className="tabular">{fmtNum2(d.vol_extra)} GB</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">اینترنت معمولی</span><span className="tabular">{fmtNum2(d.vol_service - d.vol_emergency)} GB</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">اینترنت اضطراری</span><span className="tabular">{fmtNum2(d.vol_emergency)} GB</span></div>
            </Section>
            <Section title="کاربران" icon={Users}>
              <Row label="کاربران جدید" count={d.new_users} />
              <Row label="اکانت‌های تست" count={d.tests} />
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">میانگین زمان عضویت تا اولین خرید</span><span>{d.first_avg_n > 0 ? `${fmtNum2(d.first_avg_sec / 60)} دقیقه (${fmtNum(d.first_avg_n)} کاربر)` : '—'}</span></div>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
