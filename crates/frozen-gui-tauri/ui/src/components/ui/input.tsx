import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-8 w-full rounded-md border border-white/[0.09] bg-white/[0.03] px-2.5 text-[13px] text-foreground',
        'placeholder:text-zinc-600 outline-none transition-colors',
        'hover:border-white/[0.14] focus:border-ring/60 focus:ring-2 focus:ring-ring/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
