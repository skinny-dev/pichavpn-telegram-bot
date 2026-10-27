import { Suspense, useEffect, useState } from 'react'
import { inTelegram, setTelegramSession } from '@/lib/telegram'
import { ManageProvider } from '@/components/manage'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BadgePercent, BarChart3, Banknote, Headset, LayoutDashboard, LogOut, Megaphone, Menu, Moon, Package, Receipt, ShieldCheck, ShoppingCart, Sun, Users, Wallet, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Item { to: string; label: string; icon: LucideIcon; short?: string }
const ALL_ITEMS: Item[] = [
  { to: '/', label: 'نمای کلی', icon: LayoutDashboard, short: 'خانه' },
  { to: '/finance', label: 'مالی', icon: Banknote },
  { to: '/support', label: 'پشتیبانی', icon: Headset },
  { to: '/pending', label: 'پرداخت‌های معلق', icon: AlertTriangle, short: 'معلق' },
  { to: '/stats', label: 'آمار', icon: BarChart3 },
  { to: '/users', label: 'کاربران', icon: Users },
  { to: '/orders', label: 'سفارشات', icon: ShoppingCart },
  { to: '/products', label: 'محصولات', icon: Package },
  { to: '/accounting', label: 'داده‌های حسابداری', icon: Wallet },
  { to: '/promo', label: 'تخفیف‌ها', icon: BadgePercent },
  { to: '/referrals', label: 'رفرال و تبلیغات', icon: Megaphone },
  { to: '/admins', label: 'ادمین‌ها', icon: ShieldCheck },
]

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('picha-theme', dark ? 'dark' : 'light') } catch { /* private mode */ }
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

export function Layout() {
  const { user, brand, role } = useSession()
  const ITEMS = role === 'administrator' ? ALL_ITEMS : ALL_ITEMS.filter((i) => i.to === '/support')
  // phones: what an admin opens most; everything else is under «بیشتر»
  const PRIMARY_MOBILE = role === 'administrator' ? ['/', '/orders', '/users', '/support'].map((to) => ITEMS.find((i) => i.to === to)!).filter(Boolean) : ITEMS.slice(0, 4)
  const MORE = ITEMS.filter((i) => !PRIMARY_MOBILE.includes(i))
  const tg = inTelegram()
  const unread = useQuery({ queryKey: ['support-unread'], queryFn: () => api<{ unread: number }>('support_unread'), refetchInterval: 15000 }).data?.unread ?? 0
  const qc = useQueryClient()
  const { pathname } = useLocation()
  const theme = useTheme()
  const [more, setMore] = useState(false)
  useEffect(() => setMore(false), [pathname])
  const current = ITEMS.find((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)))

  async function logout() {
    try { await api('logout', { body: {} }) } finally {
      qc.clear()
      if (inTelegram()) { setTelegramSession(null); window.Telegram?.WebApp && (window.Telegram.WebApp as any).close?.(); return } // Mini App: just close it
      location.reload()
    }
  }

  const link = (i: Item, mobile = false) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === '/'}
      className={({ isActive }) => cn(
        mobile ? 'relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px]' : 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
        isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <i.icon className={mobile ? 'size-5' : 'size-[18px]'} />
      <span className="truncate">{mobile ? i.short ?? i.label : i.label}</span>
      {i.to === '/support' && unread > 0 && <span className={cn('rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white', mobile && 'absolute end-[calc(50%-1.4rem)] top-0.5')}>{unread}</span>}
    </NavLink>
  )

  return (
    <ManageProvider>
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-e bg-card p-3 md:flex print:!hidden">
        <div className="mb-3 flex items-center gap-2.5 px-2 pt-1">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Receipt className="size-5" /></div>
          <span className="font-bold">{brand}</span>
        </div>
        <nav className="grid gap-1" aria-label="منوی اصلی">{ITEMS.map((i) => link(i))}</nav>
        <div className="mt-auto grid gap-1">
          <div className="px-3 pb-1 text-xs text-muted-foreground" dir="ltr">{user}</div>
          <Button variant="ghost" className="justify-start" onClick={theme.toggle}>{theme.dark ? <Sun /> : <Moon />}{theme.dark ? 'تم روشن' : 'تم تیره'}</Button>
          <Button variant="ghost" className="justify-start text-destructive hover:text-destructive" onClick={logout}><LogOut />خروج</Button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:hidden print:hidden">
          <h1 className="flex-1 truncate text-[15px] font-semibold">{current?.label ?? brand}</h1>
          {!tg && <Button variant="ghost" size="icon-sm" onClick={theme.toggle} aria-label="تغییر تم">{theme.dark ? <Sun /> : <Moon />}</Button>}
        </header>
        <main className="mx-auto w-full max-w-[90rem] px-3 pb-24 pt-3 md:px-8 md:pb-10 md:pt-8">
          <h1 className="mb-6 hidden text-2xl font-bold md:block print:block">{current?.label}</h1>
          <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" />}><Outlet /></Suspense>
        </main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t bg-background/95 px-2 py-1 backdrop-blur md:hidden print:hidden" aria-label="منوی موبایل">
        {PRIMARY_MOBILE.map((i) => link(i, true))}
        <button onClick={() => setMore(true)} className={cn('flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px]', MORE.some((i) => i === current) ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}><Menu className="size-5" />بیشتر</button>
      </nav>
      <Dialog open={more} onOpenChange={setMore}>
        <DialogContent>
          <DialogHeader><DialogTitle>{brand}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-1">
            {MORE.map((i) => link(i))}
            {!tg && <Button variant="ghost" className="justify-start" onClick={theme.toggle}>{theme.dark ? <Sun /> : <Moon />}{theme.dark ? 'تم روشن' : 'تم تیره'}</Button>}
            <Button variant="ghost" className="justify-start text-destructive" onClick={logout}><LogOut />خروج ({user})</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </ManageProvider>
  )
}
