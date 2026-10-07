import * as React from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

// coss-style segmented control with sliding active pill.
export function SegmentedControl({
  value,
  onValueChange,
  options,
  className,
  size = 'default',
}: {
  value: string
  onValueChange: (v: string) => void
  options: { value: string; label: React.ReactNode }[]
  className?: string
  size?: 'default' | 'sm'
}) {
  const id = React.useId()
  return (
    <div className={cn('inline-flex items-center rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onValueChange(o.value)}
            className={cn(
              'relative z-10 whitespace-nowrap rounded-[7px] font-medium transition-colors duration-150 cursor-pointer outline-none',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-3 text-[13px]',
              active ? 'text-foreground' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[7px] bg-white/[0.1] shadow-sm"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
