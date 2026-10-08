import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Boxes, Coins, Scale, PiggyBank, Copy, Landmark, Receipt, RefreshCw, ShoppingBag, Users, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtNum, fmtNum2, fmtToman, fmtTs } from '@/lib/format'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/Stat'

const PERIODS = [['all', 'کل'], ['hour', 'یک ساعت اخیر'], ['today', 'امروز'], ['yesterday', 'دیروز'], ['month', 'ماه فعلی'], ['lastmonth', 'ماه قبل']] as const
type KindSum = Record<string, { c: number; s: number }>
type D = Record<string, number> & { by_kind: KindSum }
interface Kind { key: string; label: string; group: 'cogs' | 'opex' | 'equity' }
interface Method { m: string; c: string; s: string }
interface Overall { users: number; with_service: number; buyers: number; test_users: number; test_only: number; test_then_buy: number; balance: number; agents_n: number; agents_n2: number; panels: number; active_services: number; active_sum: number; auto_users: number | null; auto_services: number | null; repeat_buyers: number; revenue_30d: number; volume_30d: number; methods: Method[] }
interface StatsRes { title: string; start: number; end: number; data: D; all: D; overall: Overall | null; kinds: Kind[]; text: string }
const LABELS: Record<string, string> = { 'cart to cart': '💳 کارت به کارت', 'Star Telegram': '⭐ استار تلگرام', tetraminator: '🏦 درگاه tetraminator', 'after pay': '🧾 پرداخت بعد از دریافت', 'manual invoice': '✍️ فاکتور دستی', 'add order by admin': '🛠 سفارش ثبت‌شده توسط ادمین', 'extend by admin': '🛠 تمدید توسط ادمین', wallet: '👛 پرداخت از کیف پول (داخلی)', 'add balance by admin': '🎁 شارژ توسط ادمین (هدیه)', zarinpal: 'زرین‌پال', aqayepardakht: 'آقای پرداخت' }
const dur = (sec: number) => { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600); return d ? `${fmtNum(d)} روز${h ? ` و ${fmtNum(h)} ساعت` : ''}` : h ? `${fmtNum(h)} ساعت` : `${fmtNum2(sec / 60)} دقیقه` }
const gb = (v: number) => `${fmtNum2(v)} گیگابایت`
const pct = (a: number, b: number) => (b > 0 ? `${fmtNum2((a * 100) / b)}٪` : '—')

function Row({ label, count, sum }: { label: string; count?: number; sum?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{count !== undefined && <span>{fmtNum(count)} عدد</span>}{count !== undefined && sum !== undefined && <span className="mx-1.5 text-muted-foreground">·</span>}{sum !== undefined && <span className="font-medium">{fmtToman(sum)}</span>}</span>
    </div>
  )
}
function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular">{value}</span>
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
            <StatCard icon={Coins} label="فروش" value={fmtToman(d.revenue)} tone="success" hint={`از ابتدا: ${fmtToman(all.revenue)}`} />
            <StatCard icon={Scale} label="سود ناخالص (فروش − خرید)" value={fmtToman(d.gross)} tone={d.gross < 0 ? 'danger' : 'success'} hint={`از ابتدا: ${fmtToman(all.gross)}`} />
            <StatCard icon={Wallet} label="سود خالص" value={fmtToman(d.net)} tone={d.net < 0 ? 'danger' : 'success'} hint={`از ابتدا: ${fmtToman(all.net)}`} />
            <StatCard icon={Landmark} label="ورود سرمایه (جدا از سود)" value={fmtToman(d.cap_sum)} hint={`از ابتدا: ${fmtToman(all.cap_sum)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="فروش" icon={ShoppingBag}>
              <Row label="سفارشات" count={d.orders} sum={d.orders_sum} />
              <Row label="خرید اول" count={d.first} sum={d.first_sum} />
              <Row label="خرید نمایندگان عادی" count={d.agent_n} sum={d.agent_n_sum} />
              <Row label="خرید نمایندگان پیشرفته" count={d.agent_n2} sum={d.agent_n2_sum} />
              <Row label="تمدید" count={d.renew} sum={d.renew_sum} />
              <Row label="حجم اضافه" count={d.extra} sum={d.extra_sum} />
            </Section>
            <Section title="صورت سود و زیان" icon={Scale}>
              <Row label="فروش (پول دریافتی)" count={d.count_all} sum={d.revenue} />
              {d.wallet_out_sum > 0 && <Row label="− بازپرداخت به مشتریان" count={d.wallet_out} sum={d.wallet_out_sum} />}
              <Row label="− خرید (بهای تمام‌شده)" count={d.cogs} sum={d.cogs_sum} />
              <div className="flex items-center justify-between py-2 text-sm font-semibold"><span>= سود ناخالص</span><span className="tabular">{fmtToman(d.gross)} <span className="text-xs font-normal text-muted-foreground">{pct(d.gross, d.net_sales)}</span></span></div>
              <Row label="− هزینه‌های عملیاتی" count={d.opex} sum={d.opex_sum} />
              <div className="flex items-center justify-between py-2 text-sm font-semibold"><span>= سود خالص</span><span className="tabular">{fmtToman(d.net)} <span className="text-xs font-normal text-muted-foreground">{pct(d.net, d.net_sales)}</span></span></div>
              <Row label="− سود سهام / برداشت شرکا" count={d.div} sum={d.div_sum} />
              <div className="flex items-center justify-between py-2 text-sm font-semibold"><span>= سود باقی‌مانده</span><span className="tabular">{fmtToman(d.retained)}</span></div>
            </Section>
            <Section title="هزینه‌ها به تفکیک دسته" icon={Receipt}>
              {q.data?.kinds.map((k) => <Row key={k.key} label={`${k.group === 'cogs' ? '🛒 ' : k.group === 'equity' ? '🤝 ' : ''}${k.label}`} count={d.by_kind[k.key]?.c ?? 0} sum={d.by_kind[k.key]?.s ?? 0} />)}
              <div className="py-2 text-xs text-muted-foreground">«سود سهام» هزینه حساب نمی‌شود؛ از سود خالص کم می‌شود.</div>
            </Section>
            <Section title="سرمایه (جدا از فروش و سود)" icon={PiggyBank}>
              <Row label="ورود سرمایه در این بازه" count={d.cap} sum={d.cap_sum} />
              <Row label="ورود سرمایه از ابتدا" sum={all.cap_sum} />
              <Row label="سرمایه + سود باقی‌مانده (از ابتدا)" sum={all.cap_sum + all.retained} />
            </Section>
            <Section title="پول دریافتی" icon={Wallet}>
              <Row label="پرداخت مشتریان (درگاه‌ها)" count={d.wallet_in} sum={d.wallet_in_sum} />
              <Row label="ثبت‌شده توسط ادمین" count={d.admin_in} sum={d.admin_in_sum} />
              <Row label="جمع پرداخت‌های موفق" count={d.count_all} />
            </Section>
            {q.data?.overall && (
              <>
                <Section title="قیف کاربران" icon={Users}>
                  <Row label="کل کاربران" count={q.data.overall.users} />
                  <Row label="دارای سرویس" count={q.data.overall.with_service} />
                  <Row label={`مشتری (${pct(q.data.overall.buyers, q.data.overall.users)} کاربران)`} count={q.data.overall.buyers} />
                  <Row label={`دریافت‌کننده تست (${pct(q.data.overall.test_users, q.data.overall.users)})`} count={q.data.overall.test_users} />
                  <Row label="تست بدون خرید" count={q.data.overall.test_only} />
                  <Row label="تست و سپس خرید" count={q.data.overall.test_then_buy} />
                  <Row label="موجودی کیف پول‌ها" sum={q.data.overall.balance} />
                </Section>
                <Section title="شاخص‌ها" icon={Coins}>
                  <Row label="میانگین درآمد هر مشتری" sum={q.data.overall.buyers ? d.revenue / q.data.overall.buyers : 0} />
                  <TextRow label="سهم تمدید از درآمد" value={pct(d.renew_sum, d.revenue)} />
                  <TextRow label="وفاداری (۲ خرید/تمدید یا بیشتر)" value={pct(q.data.overall.repeat_buyers, q.data.overall.buyers)} />
                  <Row label="درآمد ۳۰ روز اخیر" sum={q.data.overall.revenue_30d} />
                  <Row label="سرویس‌های فعال" count={q.data.overall.active_services} sum={q.data.overall.active_sum} />
                  {q.data.overall.auto_users !== null && <Row label={`تمدید خودکار (${fmtNum(q.data.overall.auto_services)} سرویس)`} count={q.data.overall.auto_users ?? 0} />}
                  <Row label="نمایندگان (عادی / پیشرفته)" count={q.data.overall.agents_n + q.data.overall.agents_n2} />
                </Section>
                <div className="lg:col-span-2">
                  <Section title="پرداخت‌ها به تفکیک روش" icon={Landmark}>
                    {q.data.overall.methods.map((m) => <Row key={m.m} label={LABELS[m.m] ?? m.m} count={Number(m.c)} sum={Number(m.s)} />)}
                  </Section>
                </div>
              </>
            )}
            <Section title="حجم فروخته‌شده" icon={Boxes}>
              <div className="py-2 text-2xl font-bold tabular">{fmtNum2(d.vol_service + d.vol_extra)} <span className="text-sm font-normal text-muted-foreground">گیگابایت</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">از خرید سرویس</span><span className="tabular">{gb(d.vol_service)}</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">از حجم اضافه</span><span className="tabular">{gb(d.vol_extra)}</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">اینترنت معمولی</span><span className="tabular">{gb(d.vol_service - d.vol_emergency)}</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">اینترنت اضطراری</span><span className="tabular">{gb(d.vol_emergency)}</span></div>
            </Section>
            <Section title="کاربران" icon={Users}>
              <Row label="کاربران جدید" count={d.new_users} />
              <Row label="اکانت‌های تست" count={d.tests} />
              <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">میانگین زمان عضویت تا اولین خرید</span><span>{d.first_avg_n > 0 ? `${dur(d.first_avg_sec)} (${fmtNum(d.first_avg_n)} کاربر)` : '—'}</span></div>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
