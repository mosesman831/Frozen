import * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-white/[0.06]', className)} {...props} />
}

export function Separator({ className, vertical, ...props }: React.ComponentProps<'div'> & { vertical?: boolean }) {
  return (
    <div
      className={cn(vertical ? 'h-full w-px' : 'h-px w-full', 'bg-white/[0.06]', className)}
      {...props}
    />
  )
}
