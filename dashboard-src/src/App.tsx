import { Route, Routes, Navigate } from 'react-router-dom'
import { SessionProvider, useSession } from '@/lib/session'
import { Layout } from '@/components/Layout'
import { Login } from '@/components/Login'
import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

const Overview = lazy(() => import('@/pages/Overview'))
const Admins = lazy(() => import('@/pages/Admins'))
const Referrals = lazy(() => import('@/pages/Referrals'))
const Pending = lazy(() => import('@/pages/Pending'))
const Finance = lazy(() => import('@/pages/finance'))
const Support = lazy(() => import('@/pages/Support'))
const Stats = lazy(() => import('@/pages/Stats'))
const Users = lazy(() => import('@/pages/Resources').then((m) => ({ default: m.Users })))
const Orders = lazy(() => import('@/pages/Resources').then((m) => ({ default: m.Orders })))
const Products = lazy(() => import('@/pages/Resources').then((m) => ({ default: m.Products })))
const Accounting = lazy(() => import('@/pages/Resources').then((m) => ({ default: m.Accounting })))

const Splash = () => <div className="grid min-h-dvh place-items-center"><Skeleton className="h-10 w-40" /></div>

function Home() {
  const { role } = useSession()
  return role === 'support' ? <Navigate to="/support" replace /> : <Overview />
}

export default function App() {
  return (
    <SessionProvider fallback={<Splash />} loginView={(done) => <Login onDone={done} />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="support" element={<Support />} />
          <Route path="finance/*" element={<Finance />} />
          <Route path="stats" element={<Stats />} />
          <Route path="users" element={<Users />} />
          <Route path="orders" element={<Orders />} />
          <Route path="products" element={<Products />} />
          <Route path="pending" element={<Pending />} />
          <Route path="referrals" element={<Referrals />} />
          <Route path="admins" element={<Admins />} />
          <Route path="accounting" element={<Accounting />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}
