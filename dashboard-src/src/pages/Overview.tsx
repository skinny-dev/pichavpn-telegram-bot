import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Banknote, Clock, CreditCard, ShoppingCart, TrendingUp, Users, Wifi } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { fmtCompact, fmtNum, fmtToman, fmtTs } from '@/lib/format'
import { StatCard } from '@/components/Stat'
import { ActivityHeatmap } from '@/components/ActivityHeatmap'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

interface Overview {
  today: Record<string, number>; month: Record<string, number>; users: number; balance: number; active_services: number; pending_payments: number
  series: { jdate: string; orders: number; revenue: number }[]
  recent: { id_invoice: string; username: string; name_product: string; price_product: string; time_sell: string; Status: string }[]
}

export default function Overview() {
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('overview'), refetchInterval: 60_000 })
  if (q.isLoading || !q.data) return <div className="grid gap-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72" /></div>
  if (q.isError) return <p className="text-destructive">بارگذاری ناموفق بود</p>
  const d = q.data
  return (
    <div className="grid gap-4 md:gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={TrendingUp} label="درآمد امروز" value={fmtCompact(d.today.revenue)} hint={`خالص: ${fmtToman(d.today.net)}`} tone="success" />
        <StatCard icon={Banknote} label="درآمد ماه فعلی" value={fmtCompact(d.month.revenue)} hint={`خالص: ${fmtToman(d.month.net)}`} tone="success" />
        <StatCard icon={ShoppingCart} label="سفارش امروز" value={fmtNum(d.today.orders)} hint={`${fmtNum(d.today.renew)} تمدید · ${fmtNum(d.today.first)} خرید اول`} />
        <StatCard icon={Users} label="کاربران" value={fmtNum(d.users)} hint={`${fmtNum(d.today.new_users)} کاربر جدید امروز`} />
        <StatCard icon={Wifi} label="سرویس‌های فعال" value={fmtNum(d.active_services)} />
        <StatCard icon={CreditCard} label="موجودی کیف‌پول‌ها" value={fmtCompact(d.balance)} hint="مجموع موجودی کاربران" />
        <StatCard icon={Clock} label="پرداخت در انتظار تأیید" value={fmtNum(d.pending_payments)} tone={d.pending_payments ? 'warn' : 'default'} hint={d.pending_payments ? <Link className="text-primary underline" to="/accounting">بررسی</Link> : undefined} />
        <StatCard icon={Banknote} label="هزینه‌های ماه" value={fmtCompact(d.month.exp_sum)} tone={d.month.exp_sum ? 'danger' : 'default'} />
      </div>

      <ActivityHeatmap />

      <Card>
        <CardHeader><CardTitle className="text-base">فروش ۳۰ روز اخیر</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64 w-full" dir="ltr" role="img" aria-label="نمودار فروش ۳۰ روز اخیر">
            <ResponsiveContainer>
              <AreaChart data={d.series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="jdate" tickLine={false} axisLine={false} fontSize={11} reversed interval="preserveStartEnd" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={48} orientation="right" tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, direction: 'rtl', fontFamily: 'inherit' }} formatter={(v, n) => [n === 'revenue' ? fmtToman(v) : fmtNum(v), n === 'revenue' ? 'فروش' : 'سفارش']} labelStyle={{ color: 'hsl(var(--foreground))' }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">آخرین سفارشات</CardTitle><Link to="/orders" className="text-sm text-primary">همه</Link></CardHeader>
        <CardContent>
          {d.recent.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">سفارشی ثبت نشده</p> : (
            <ul className="divide-y">
              {d.recent.map((r) => (
                <li key={r.id_invoice} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{r.name_product}</p><p className="truncate text-xs text-muted-foreground" dir="ltr">{fmtTs(r.time_sell)}</p></div>
                  <div className="shrink-0 text-end"><p className="text-sm tabular">{fmtToman(r.price_product)}</p><Badge variant="secondary">{r.Status}</Badge></div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
