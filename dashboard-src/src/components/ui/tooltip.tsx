import * as React from 'react'
import * as T from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = T.Provider
const Tooltip = T.Root
const TooltipTrigger = T.Trigger
const TooltipContent = React.forwardRef<React.ElementRef<typeof T.Content>, React.ComponentPropsWithoutRef<typeof T.Content>>(({ className, sideOffset = 4, ...p }, ref) => (
  <T.Portal><T.Content ref={ref} sideOffset={sideOffset} className={cn('z-[70] rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background', className)} {...p} /></T.Portal>
))
TooltipContent.displayName = 'TooltipContent'
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
