import * as React from 'react'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

// coss-style empty state.
export function Empty({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2.5 py-14 text-center', className)}>
      {Icon && (
        <div className="mb-1 flex size-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04]">
          <Icon className="size-4.5 text-zinc-500" />
        </div>
      )}
      <div className="text-[13px] font-medium text-zinc-300">{title}</div>
      {description && <div className="max-w-64 text-xs leading-relaxed text-zinc-600">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
