import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export function StatCard({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'success' | 'warn' | 'danger' }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="truncate">{label}</span>
        <Icon className={cn('size-4 shrink-0', tone === 'success' && 'text-success', tone === 'danger' && 'text-destructive', tone === 'warn' && 'text-amber-500')} />
      </div>
      <div className="mt-2 text-2xl font-bold tabular tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}
