import { createContext, useContext, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, isServerless, setCsrf, setUnauthorizedHandler, type Resource } from './api'
import { inTelegram, setTelegramSession, telegramInitData } from './telegram'

interface Session { user: string; role: string; brand: string; schema: Record<string, Resource> }
const Ctx = createContext<Session | null>(null)
export const useSession = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('no session')
  return s
}

export function SessionProvider({ children, fallback, loginView }: { children: React.ReactNode; fallback: React.ReactNode; loginView: (onDone: () => void) => React.ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ authed: boolean; user: string | null; role: string | null; csrf: string | null; brand: string; web_login?: boolean }>('me'), staleTime: Infinity })
  // inside Telegram the admin is recognised by their Telegram account: no password
  const [tg, setTg] = useState<'idle' | 'busy' | 'done' | string>('idle')
  useEffect(() => {
    if (isServerless()) return // Telegram signs every call: `me` already says who this is
    if (!inTelegram() || me.isLoading || me.data?.authed || tg !== 'idle') return
    setTg('busy')
    api<{ csrf: string; session: string }>('tg_login', { body: { init_data: telegramInitData() } })
      .then((r) => { setTelegramSession(r.session); setCsrf(r.csrf); setTg('done'); qc.invalidateQueries({ queryKey: ['me'] }) })
      .catch((e) => setTg(e instanceof ApiError ? e.message : 'ورود از تلگرام ناموفق بود'))
  }, [me.isLoading, me.data?.authed, tg, qc])
  useEffect(() => { if (tg === 'done' && me.data && !me.data.authed && !me.isFetching) setTg('ورود انجام شد ولی نشست نگه داشته نشد؛ مینی‌اپ را ببندید و دوباره باز کنید') }, [tg, me.data, me.isFetching])
  const [kicked, setKicked] = useState(false)
  useEffect(() => { setUnauthorizedHandler(() => { setKicked(true); qc.setQueryData(['me'], (d: any) => d && { ...d, authed: false }) }) }, [qc])
  useEffect(() => { if (me.data?.csrf) setCsrf(me.data.csrf) }, [me.data])
  const authed = !!me.data?.authed
  const schema = useQuery({ queryKey: ['schema'], queryFn: () => api<{ resources: Record<string, Resource> }>('schema'), enabled: authed && me.data?.role === 'administrator', staleTime: Infinity })
  if (me.isLoading) return <>{fallback}</>
  if (me.isError) return <div className="grid min-h-dvh place-items-center p-6 text-center text-destructive">اتصال به سرور برقرار نشد. صفحه را دوباره بارگذاری کنید.</div>
  if (!authed && isServerless()) return <div className="grid min-h-dvh place-items-center p-6 text-center"><div className="grid gap-2"><p className="font-medium">دسترسی ندارید</p><p className="text-sm text-muted-foreground">این حساب تلگرام ادمین پنل نیست.</p></div></div>
  if (!authed && inTelegram() && (tg === 'idle' || tg === 'busy' || tg === 'done')) return <>{fallback}</>
  if (!authed && inTelegram()) return <div className="grid min-h-dvh place-items-center p-6 text-center"><div className="grid gap-2"><p className="font-medium">ورود به پنل ممکن نشد</p><p className="text-sm text-muted-foreground">{tg}</p></div></div>
  if (!authed && me.data?.web_login === false) return <div className="grid min-h-dvh place-items-center p-6 text-center"><div className="grid gap-2"><p className="font-medium">پنل وب خاموش است</p><p className="text-sm text-muted-foreground">پنل را از دکمه‌ی «پنل مدیریت» در ربات تلگرام باز کنید.</p></div></div>
  if (!authed) return <>{loginView(() => { setKicked(false); qc.invalidateQueries({ queryKey: ['me'] }) })}{kicked ? null : null}</>
  const role = me.data!.role ?? 'support'
  if (role === 'administrator' && !schema.data) return <>{fallback}</>
  return <Ctx.Provider value={{ user: me.data!.user!, role, brand: me.data!.brand, schema: schema.data?.resources ?? {} }}>{children}</Ctx.Provider>
}
