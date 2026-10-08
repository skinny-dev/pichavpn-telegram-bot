import { createContext, useContext, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, setCsrf, setUnauthorizedHandler, type Resource } from './api'

interface Session { user: string; role: string; brand: string; schema: Record<string, Resource> }
const Ctx = createContext<Session | null>(null)
export const useSession = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('no session')
  return s
}

export function SessionProvider({ children, fallback, loginView }: { children: React.ReactNode; fallback: React.ReactNode; loginView: (onDone: () => void) => React.ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ authed: boolean; user: string | null; role: string | null; csrf: string | null; brand: string }>('me'), staleTime: Infinity })
  const [kicked, setKicked] = useState(false)
  useEffect(() => { setUnauthorizedHandler(() => { setKicked(true); qc.setQueryData(['me'], (d: any) => d && { ...d, authed: false }) }) }, [qc])
  useEffect(() => { if (me.data?.csrf) setCsrf(me.data.csrf) }, [me.data])
  const authed = !!me.data?.authed
  const schema = useQuery({ queryKey: ['schema'], queryFn: () => api<{ resources: Record<string, Resource> }>('schema'), enabled: authed && me.data?.role === 'administrator', staleTime: Infinity })
  if (me.isLoading) return <>{fallback}</>
  if (me.isError) return <div className="grid min-h-dvh place-items-center p-6 text-center text-destructive">اتصال به سرور برقرار نشد. صفحه را دوباره بارگذاری کنید.</div>
  if (!authed) return <>{loginView(() => { setKicked(false); qc.invalidateQueries({ queryKey: ['me'] }) })}{kicked ? null : null}</>
  const role = me.data!.role ?? 'support'
  if (role === 'administrator' && !schema.data) return <>{fallback}</>
  return <Ctx.Provider value={{ user: me.data!.user!, role, brand: me.data!.brand, schema: schema.data?.resources ?? {} }}>{children}</Ctx.Provider>
}
