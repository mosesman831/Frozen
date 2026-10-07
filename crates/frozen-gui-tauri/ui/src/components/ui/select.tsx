import * as React from 'react'
import { Select as BSelect } from '@base-ui-components/react/select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onValueChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function Select({ value, onValueChange, options, placeholder, className, disabled }: SelectProps) {
  return (
    <BSelect.Root value={value} onValueChange={(v) => v != null && onValueChange(v)} disabled={disabled}>
      <BSelect.Trigger
        className={cn(
          'inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-white/[0.09] bg-white/[0.03] px-2.5 text-[13px] text-foreground',
          'outline-none transition-colors hover:border-white/[0.14] focus:border-ring/60 focus:ring-2 focus:ring-ring/25',
          'disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer',
          className,
        )}
      >
        <BSelect.Value>{(v: string) => options.find((o) => o.value === v)?.label ?? placeholder ?? 'Select…'}</BSelect.Value>
        <BSelect.Icon>
          <ChevronDown className="size-3.5 text-zinc-500" />
        </BSelect.Icon>
      </BSelect.Trigger>
      <BSelect.Portal>
        <BSelect.Positioner sideOffset={6} className="z-50">
          <BSelect.Popup className="min-w-[var(--anchor-width)] overflow-hidden rounded-lg border border-white/[0.08] bg-[#151518]/95 backdrop-blur-xl shadow-2xl shadow-black/50 outline-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] transition-all duration-150">
            <BSelect.List className="max-h-60 overflow-y-auto p-1">
              {options.map((o) => (
                <BSelect.Item
                  key={o.value}
                  value={o.value}
                  className="flex h-7 cursor-pointer items-center justify-between rounded-md px-2 text-[13px] text-zinc-300 outline-none data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-foreground data-[selected]:text-foreground"
                >
                  <BSelect.ItemText>{o.label}</BSelect.ItemText>
                  <BSelect.ItemIndicator>
                    <Check className="size-3.5 text-primary" />
                  </BSelect.ItemIndicator>
                </BSelect.Item>
              ))}
            </BSelect.List>
          </BSelect.Popup>
        </BSelect.Positioner>
      </BSelect.Portal>
    </BSelect.Root>
  )
}
