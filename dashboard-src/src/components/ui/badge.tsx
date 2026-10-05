import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      success: 'border-transparent bg-success/15 text-success',
      destructive: 'border-transparent bg-destructive/15 text-destructive',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})
export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}
export const Badge = ({ className, variant, ...props }: BadgeProps) => <div className={cn(badgeVariants({ variant }), className)} {...props} />
