import * as React from 'react'
import { Dialog as BDialog } from '@base-ui-components/react/dialog'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

export const Dialog = BDialog.Root
export const DialogTrigger = BDialog.Trigger
export const DialogClose = BDialog.Close

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BDialog.Popup>) {
  return (
    <BDialog.Portal>
      <BDialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
      <BDialog.Popup
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border border-white/[0.08] bg-[#131316] p-5 shadow-2xl shadow-black/60 outline-none',
          'transition-all duration-200 data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.96]',
          className,
        )}
        {...props}
      >
        {children}
        <BDialog.Close className="absolute right-4 top-4 rounded-md p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300 outline-none cursor-pointer">
          <X className="size-4" />
        </BDialog.Close>
      </BDialog.Popup>
    </BDialog.Portal>
  )
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof BDialog.Title>) {
  return <BDialog.Title className={cn('text-[15px] font-semibold text-foreground', className)} {...props} />
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof BDialog.Description>) {
  return <BDialog.Description className={cn('mt-1 text-[13px] text-zinc-500', className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-5 flex justify-end gap-2', className)} {...props} />
}
