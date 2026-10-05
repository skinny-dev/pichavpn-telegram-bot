import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { api, ApiError, setCsrf } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Login({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await api<{ csrf: string }>('login', { body: { username: u.trim(), password: p } })
      setCsrf(r.csrf)
      onDone()
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'ورود ناموفق بود') } finally { setBusy(false) }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><ShieldCheck className="size-6" /></div>
          <CardTitle className="text-xl">پنل مدیریت پیچا</CardTitle>
          <CardDescription>برای ادامه وارد شوید</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2"><Label htmlFor="u">نام کاربری</Label><Input id="u" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} dir="ltr" required autoFocus /></div>
            <div className="grid gap-2"><Label htmlFor="p">رمز عبور</Label><Input id="p" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} dir="ltr" required /></div>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            <Button type="submit" disabled={busy || !u || !p}>{busy && <Loader2 className="animate-spin" />}ورود</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
