import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BarChart3, LayoutDashboard, LogOut, Menu, Moon, Package, Receipt, ShoppingCart, Sun, Users, Wallet, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Item { to: string; label: string; icon: LucideIcon }
const ITEMS: Item[] = [
  { to: '/', label: 'نمای کلی', icon: LayoutDashboard },
  { to: '/stats', label: 'آمار', icon: BarChart3 },
  { to: '/users', label: 'کاربران', icon: Users },
  { to: '/orders', label: 'سفارشات', icon: ShoppingCart },
  { to: '/products', label: 'محصولات', icon: Package },
  { to: '/accounting', label: 'حسابداری', icon: Wallet },
]
const PRIMARY_MOBILE = ITEMS.slice(0, 4)

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('picha-theme', dark ? 'dark' : 'light') } catch { /* private mode */ }
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

export function Layout() {
  const { user, brand } = useSession()
  const qc = useQueryClient()
  const { pathname } = useLocation()
  const theme = useTheme()
  const [more, setMore] = useState(false)
  useEffect(() => setMore(false), [pathname])
  const current = ITEMS.find((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)))

  async function logout() {
    try { await api('logout', { body: {} }) } finally { qc.clear(); location.reload() }
  }

  const link = (i: Item, mobile = false) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === '/'}
      className={({ isActive }) => cn(
        mobile ? 'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px]' : 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
        isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <i.icon className={mobile ? 'size-5' : 'size-[18px]'} />
      <span className="truncate">{i.label}</span>
    </NavLink>
  )

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-e bg-card p-3 md:flex">
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:hidden">
          <h1 className="flex-1 truncate font-semibold">{current?.label ?? brand}</h1>
          <Button variant="ghost" size="icon-sm" onClick={theme.toggle} aria-label="تغییر تم">{theme.dark ? <Sun /> : <Moon />}</Button>
        </header>
        <main className="mx-auto w-full max-w-[90rem] px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">
          <h1 className="mb-6 hidden text-2xl font-bold md:block">{current?.label}</h1>
          <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" />}><Outlet /></Suspense>
        </main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t bg-background/95 px-2 pt-1 backdrop-blur md:hidden" aria-label="منوی موبایل">
        {PRIMARY_MOBILE.map((i) => link(i, true))}
        <button onClick={() => setMore(true)} className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-muted-foreground"><Menu className="size-5" />بیشتر</button>
      </nav>
      <Dialog open={more} onOpenChange={setMore}>
        <DialogContent>
          <DialogHeader><DialogTitle>{brand}</DialogTitle></DialogHeader>
          <div className="grid gap-1">
            {ITEMS.slice(4).map((i) => link(i))}
            <Button variant="ghost" className="justify-start text-destructive" onClick={logout}><LogOut />خروج ({user})</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
