import * as React from 'react'
import { NumberField as BNumberField } from '@base-ui-components/react/number-field'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

// coss-style stepper number field.
export function NumberField({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  className,
  suffix,
  disabled,
}: {
  value: number
  onValueChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  suffix?: string
  disabled?: boolean
}) {
  return (
    <BNumberField.Root
      value={value}
      onValueChange={(v) => v != null && onValueChange(v)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn('inline-flex items-center', className)}
    >
      <BNumberField.Decrement className="flex h-8 w-7 items-center justify-center rounded-l-md border border-white/[0.09] bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07] hover:text-foreground disabled:opacity-40 cursor-pointer transition-colors">
        <Minus className="size-3" />
      </BNumberField.Decrement>
      <div className="relative">
        <BNumberField.Input className="h-8 w-16 border-y border-white/[0.09] bg-white/[0.03] px-2 text-center text-[13px] tabular-nums text-foreground outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring/60 transition-colors" />
        {suffix && (
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500">{suffix}</span>
        )}
      </div>
      <BNumberField.Increment className="flex h-8 w-7 items-center justify-center rounded-r-md border border-white/[0.09] bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07] hover:text-foreground disabled:opacity-40 cursor-pointer transition-colors">
        <Plus className="size-3" />
      </BNumberField.Increment>
    </BNumberField.Root>
  )
}
