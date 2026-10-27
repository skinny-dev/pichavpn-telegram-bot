import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, CheckCheck, FileText, Loader2, Paperclip, Search, Send, X } from 'lucide-react'
import { api, apiForm, ApiError, isServerless, supportFileUrl } from '@/lib/api'
import { fmtStr } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useDebounced } from '@/lib/hooks'

interface Thread { iduser: string; tg_username: string | null; name: string | null; unread: number; open: boolean; snippet: string; department: string; time: string; n: number }
interface Attach { row: number; side: 'c' | 's'; kind: 'image' | 'video' | 'audio' | 'file'; name: string }
interface Msg { id: string; from: 'customer' | 'support'; text: string; time: string; by?: string; dept?: string; file?: Attach }
interface ThreadData { uid: string; user: { username: string; namecustom: string; Balance: string; number: string } | null; messages: Msg[]; open: boolean }

const who = (t: { iduser: string; name?: string | null; tg_username?: string | null }) => t.name && t.name !== 'none' ? t.name : t.tg_username && t.tg_username !== 'none' ? `@${t.tg_username}` : t.iduser

function Attachment({ f }: { f: Attach }) {
  const [sent, setSent] = useState(false)
  // on Serverless a page cannot stream a file: the attachment is sent to the admin's own chat with the bot
  if (isServerless()) {
    return (
      <button type="button" disabled={sent} onClick={() => api('support_file', { query: { row: f.row, side: f.side } }).then(() => { setSent(true); toast.success('فایل در چت ربات برای شما ارسال شد') }).catch((e) => toast.error(e instanceof ApiError ? e.message : 'ارسال ناموفق بود'))}
        className="mb-1 flex items-center gap-2 rounded-lg bg-black/10 px-3 py-2 text-sm"><FileText className="size-4 shrink-0" /><span className="truncate" dir="ltr">{f.name}</span><span className="text-xs opacity-80">{sent ? '✓ ارسال شد' : '(ارسال به چت ربات)'}</span></button>
    )
  }
  const url = supportFileUrl(f.row, f.side)
  const [failed, setFailed] = useState(false)
  if (failed) return <a href={url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-lg bg-black/10 px-3 py-2 text-xs underline"><FileText className="size-4" />{f.name} (دانلود)</a>
  if (f.kind === 'image') return <a href={url} target="_blank" rel="noreferrer" className="mb-1 block"><img src={url} alt={f.name} loading="lazy" onError={() => setFailed(true)} className="max-h-72 max-w-full rounded-lg object-contain" /></a>
  if (f.kind === 'video') return <video src={url} controls preload="metadata" onError={() => setFailed(true)} className="mb-1 max-h-72 max-w-full rounded-lg" />
  if (f.kind === 'audio') return <audio src={url} controls preload="none" onError={() => setFailed(true)} className="mb-1 max-w-full" />
  return <a href={url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-lg bg-black/10 px-3 py-2 text-sm"><FileText className="size-4 shrink-0" /><span className="truncate" dir="ltr">{f.name}</span></a>
}

export default function Support() {
  const qc = useQueryClient()
  const [sel, setSel] = useState<string | null>(null)
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const threads = useQuery({
    queryKey: ['support-threads', filter, dq],
    queryFn: () => api<{ threads: Thread[] }>('support_threads', { query: { f: filter, q: dq } }),
    refetchInterval: 5000,
  })
  const refreshAll = () => { qc.invalidateQueries({ queryKey: ['support-threads'] }); qc.invalidateQueries({ queryKey: ['support-unread'] }) }

  return (
    <div className="grid h-[calc(100dvh-11rem)] min-h-[28rem] gap-4 md:h-[calc(100dvh-8rem)] md:grid-cols-[20rem_1fr]">
      <section className={cn('flex min-h-0 flex-col gap-2 rounded-xl border bg-card p-3', sel && 'hidden md:flex')}>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-9" placeholder="جستجوی نام یا آیدی" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {([['open', 'باز'], ['closed', 'بسته'], ['all', 'همه']] as const).map(([k, l]) => (
            <Button key={k} size="sm" variant={filter === k ? 'default' : 'ghost'} onClick={() => setFilter(k)}>{l}</Button>
          ))}
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {threads.isLoading && <div className="p-4 text-center text-sm text-muted-foreground">در حال بارگذاری…</div>}
          {threads.data?.threads.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">گفتگویی وجود ندارد</div>}
          {threads.data?.threads.map((t) => (
            <button key={t.iduser} onClick={() => setSel(t.iduser)} className={cn('mb-1 grid w-full gap-1 rounded-lg p-3 text-start transition-colors hover:bg-accent', sel === t.iduser && 'bg-primary/10')}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{who(t)}</span>
                {t.unread > 0 && <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">{t.unread}</span>}
              </div>
              <div className="truncate text-xs text-muted-foreground">{t.snippet}</div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span className="truncate">{t.department}</span><span dir="ltr">{fmtStr(t.time)}</span></div>
            </button>
          ))}
        </div>
      </section>

      <section className={cn('min-h-0 rounded-xl border bg-card', !sel && 'hidden md:grid md:place-items-center')}>
        {sel ? <Chat key={sel} uid={sel} onBack={() => setSel(null)} onChanged={refreshAll} /> : <p className="text-sm text-muted-foreground">یک گفتگو را انتخاب کنید</p>}
      </section>
    </div>
  )
}

function Chat({ uid, onBack, onChanged }: { uid: string; onBack: () => void; onChanged: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const bottom = useRef<HTMLDivElement>(null)
  const data = useQuery({ queryKey: ['support-thread', uid], queryFn: () => api<ThreadData>('support_thread', { query: { uid } }), refetchInterval: 4000 })
  const count = data.data?.messages.length ?? 0
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [count])
  useEffect(() => { onChanged() }, [data.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () => {
      if (!file) return api('support_reply', { body: { uid, text } })
      const fd = new FormData()
      fd.append('uid', uid); fd.append('text', text); fd.append('file', file)
      return apiForm('support_reply', fd)
    },
    onSuccess: () => { setText(''); setFile(null); qc.invalidateQueries({ queryKey: ['support-thread', uid] }); onChanged() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'ارسال ناموفق بود'),
  })
  const close = useMutation({
    mutationFn: () => api('support_close', { body: { uid } }),
    onSuccess: () => { toast.success('گفتگو بسته شد'); qc.invalidateQueries({ queryKey: ['support-thread', uid] }); onChanged() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'ناموفق بود'),
  })
  const u = data.data?.user

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b p-3">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="بازگشت"><ArrowRight /></Button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{u ? who({ iduser: uid, name: u.namecustom, tg_username: u.username }) : uid}</div>
          <div className="text-xs text-muted-foreground" dir="ltr">{uid}</div>
        </div>
        {data.data && !data.data.open && <Badge variant="secondary">بسته</Badge>}
        <Button size="sm" variant="outline" disabled={close.isPending || data.data?.open === false} onClick={() => close.mutate()}><CheckCheck />بستن گفتگو</Button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {data.isLoading && <div className="text-center text-sm text-muted-foreground">در حال بارگذاری…</div>}
        {data.data?.messages.map((m) => (
          <div key={m.id} className={cn('flex', m.from === 'support' ? 'justify-start' : 'justify-end')}>
            <div className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm', m.from === 'support' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
              {m.file && <Attachment f={m.file} />}
              {m.text}
              <div className={cn('mt-1 text-[10px] opacity-70', m.from === 'customer' && 'text-start')} dir="ltr">{m.from === 'customer' && m.dept ? `${m.dept} · ` : ''}{fmtStr(m.time)}</div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {file && (
        <div className="flex items-center gap-2 border-t bg-muted/50 px-3 py-2 text-sm">
          {preview ? <img src={preview} alt="" className="size-10 rounded object-cover" /> : <FileText className="size-5 shrink-0" />}
          <span className="min-w-0 flex-1 truncate" dir="ltr">{file.name}</span>
          <span className="text-xs text-muted-foreground tabular">{(file.size / 1048576).toFixed(1)} MB</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setFile(null)} aria-label="حذف فایل"><X /></Button>
        </div>
      )}
      <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); if ((text.trim() || file) && !send.isPending) send.mutate() }}>
        <input ref={picker} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (f.size > 20 * 1048576) toast.error('حداکثر حجم فایل ۲۰ مگابایت است'); else setFile(f) } e.target.value = '' }} />
        <Button type="button" variant="ghost" size="icon" onClick={() => picker.current?.click()} aria-label="پیوست فایل" disabled={send.isPending}><Paperclip /></Button>
        <textarea
          className="min-h-10 max-h-40 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={2} value={text} placeholder="پاسخ شما مستقیم در تلگرام مشتری ارسال می‌شود…" maxLength={3500}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { const f = Array.from(e.clipboardData.files)[0]; if (f) { e.preventDefault(); if (f.size > 20 * 1048576) toast.error('حداکثر حجم فایل ۲۰ مگابایت است'); else setFile(f) } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if ((text.trim() || file) && !send.isPending) send.mutate() } }}
        />
        <Button type="submit" disabled={(!text.trim() && !file) || send.isPending}>{send.isPending ? <Loader2 className="animate-spin" /> : <Send />}ارسال</Button>
      </form>
    </div>
  )
}
