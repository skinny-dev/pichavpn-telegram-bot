import { useEffect, useRef, useState } from 'react'
import type { Col } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** Edit a single value of a column (used by the touch-friendly dialog and by create forms). */
export function FieldInput({ col, value, onChange, autoFocus }: { col: Col; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  if (col.type === 'enum') {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={col.label}><SelectValue placeholder="انتخاب کنید" /></SelectTrigger>
        <SelectContent>
          {Object.entries(col.options ?? {}).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode={col.type === 'int' ? 'numeric' : 'text'}
      aria-label={col.label}
      dir={col.type === 'int' || col.type === 'dt' ? 'ltr' : undefined}
      placeholder={col.type === 'dt' ? '1405/07/14 15:30' : undefined}
    />
  )
}

export function CellEditDialog({ open, col, initial, onClose, onSave }: { open: boolean; col: Col | null; initial: string; onClose: () => void; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setV(initial) }, [open, initial])
  if (!col) return null
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{col.label}</DialogTitle></DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try { await onSave(v); onClose() } finally { setBusy(false) }
          }}
        >
          <FieldInput col={col} value={v} onChange={setV} autoFocus />
          <DialogFooter>
            <Button type="submit" disabled={busy}>ذخیره</Button>
            <Button type="button" variant="outline" onClick={onClose}>انصراف</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Inline cell editor for desktop: Enter saves, Esc cancels. */
export function InlineEditor({ col, initial, onCommit, onCancel }: { col: Col; initial: string; onCommit: (v: string, move: 'down' | 'next' | 'prev' | 'none') => void; onCancel: () => void }) {
  const [v, setV] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const commit = (move: 'down' | 'next' | 'prev' | 'none') => { if (done.current) return; done.current = true; onCommit(v, move) }
  if (col.type === 'enum') {
    return (
      <select
        autoFocus
        value={v}
        onChange={(e) => { done.current = true; onCommit(e.target.value, 'none') }}
        onBlur={() => !done.current && onCancel()}
        onKeyDown={(e) => { if (e.key === 'Escape') { done.current = true; onCancel() } }}
        className="h-8 w-full rounded border border-ring bg-background px-1 text-sm"
      >
        <option value="" disabled>—</option>
        {Object.entries(col.options ?? {}).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    )
  }
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      inputMode={col.type === 'int' ? 'numeric' : 'text'}
      dir={col.type === 'int' ? 'ltr' : undefined}
      onBlur={() => commit('none')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit('down') }
        else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'prev' : 'next') }
        else if (e.key === 'Escape') { e.preventDefault(); done.current = true; onCancel() }
      }}
      className="h-8 w-full min-w-[6rem] rounded border border-ring bg-background px-2 text-sm"
    />
  )
}
