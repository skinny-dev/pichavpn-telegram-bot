import { Route, Routes, Navigate } from 'react-router-dom'
import { SessionProvider } from '@/lib/session'
import { Layout } from '@/components/Layout'
import { Login } from '@/components/Login'
import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

const Overview = lazy(() => import('@/pages/Overview'))
const Admins = lazy(() => import('@/pages/Admins'))
const Stats = lazy(() => import('@/pages/Stats'))
const Users = lazy(() => import('@/pages/Resources').then((m) => ({ default: m.Users })))
const Orders = lazy(() => import('@/pages/Resources').then((m) => ({ default: m.Orders })))
const Products = lazy(() => import('@/pages/Resources').then((m) => ({ default: m.Products })))
const Accounting = lazy(() => import('@/pages/Resources').then((m) => ({ default: m.Accounting })))

const Splash = () => <div className="grid min-h-dvh place-items-center"><Skeleton className="h-10 w-40" /></div>

export default function App() {
  return (
    <SessionProvider fallback={<Splash />} loginView={(done) => <Login onDone={done} />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="stats" element={<Stats />} />
          <Route path="users" element={<Users />} />
          <Route path="orders" element={<Orders />} />
          <Route path="products" element={<Products />} />
          <Route path="admins" element={<Admins />} />
          <Route path="accounting" element={<Accounting />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}
