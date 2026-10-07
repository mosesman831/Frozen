import * as React from 'react'
import { cn } from '@/lib/utils'

// coss-style meter: label + value row, thin track.
export function Meter({
  value,
  max,
  label,
  valueLabel,
  className,
  tone = 'default',
}: {
  value: number
  max: number
  label?: string
  valueLabel?: string
  className?: string
  tone?: 'default' | 'warn' | 'bad'
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const color =
    tone === 'bad' ? 'bg-red-400' : tone === 'warn' ? 'bg-amber-400' : 'bg-primary'
  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || valueLabel) && (
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-zinc-500">{label}</span>
          <span className="font-medium text-zinc-300 tabular-nums">{valueLabel ?? `${pct}%`}</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 ease-out', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
