import * as React from 'react'
import { Menu as BMenu } from '@base-ui-components/react/menu'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Menu = BMenu.Root
export const MenuTrigger = BMenu.Trigger

export function MenuContent({
  className,
  children,
  side = 'bottom',
  align = 'end',
  sideOffset = 6,
}: {
  className?: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}) {
  return (
    <BMenu.Portal>
      <BMenu.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <BMenu.Popup
          className={cn(
            'min-w-44 overflow-hidden rounded-lg border border-white/[0.08] bg-[#151518]/95 p-1 shadow-2xl shadow-black/50 backdrop-blur-xl outline-none',
            'transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97]',
            className,
          )}
        >
          {children}
        </BMenu.Popup>
      </BMenu.Positioner>
    </BMenu.Portal>
  )
}

export function MenuItem({
  className,
  children,
  onClick,
  disabled,
}: {
  className?: string
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <BMenu.Item
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-zinc-300 outline-none',
        'data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-foreground',
        'disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:size-3.5 [&_svg]:text-zinc-500',
        className,
      )}
    >
      {children}
    </BMenu.Item>
  )
}

export function MenuSeparator() {
  return <BMenu.Separator className="my-1 h-px bg-white/[0.07]" />
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{children}</div>
}
