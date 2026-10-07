import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide whitespace-nowrap [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-white/[0.08] text-zinc-300',
        on: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
        off: 'border-white/[0.08] bg-white/[0.03] text-zinc-500',
        warn: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
        bad: 'border-red-500/25 bg-red-500/10 text-red-400',
        violet: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
        blue: 'border-sky-500/25 bg-sky-500/10 text-sky-400',
        outline: 'border-white/[0.12] text-zinc-400',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
