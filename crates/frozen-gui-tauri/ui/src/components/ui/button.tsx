import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-all duration-150 outline-none select-none cursor-pointer disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[0_0_0_1px_rgba(124,108,240,.4),0_4px_14px_-2px_rgba(124,108,240,.5)] hover:bg-primary/90',
        secondary: 'border border-white/[0.08] bg-white/[0.05] text-foreground hover:bg-white/[0.09]',
        ghost: 'text-zinc-400 hover:bg-white/[0.06] hover:text-foreground',
        destructive: 'border border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/20',
        outline: 'border border-white/[0.09] bg-transparent text-zinc-300 hover:bg-white/[0.05] hover:text-foreground',
      },
      size: {
        default: 'h-8 px-3.5',
        sm: 'h-7 px-2.5 text-xs',
        lg: 'h-10 px-5 text-sm',
        icon: 'size-8',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
  ),
)
Button.displayName = 'Button'
export { buttonVariants }
