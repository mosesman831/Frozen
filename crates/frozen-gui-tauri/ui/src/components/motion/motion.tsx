import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'

// BlurFade — Magic UI staggered entrance.
export function BlurFade({
  children,
  delay = 0,
  className,
  yOffset = 6,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
  yOffset?: number
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: yOffset, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ delay, duration: 0.45, ease: [0.25, 0.4, 0.25, 1] }}
    >
      {children}
    </motion.div>
  )
}

// TextShimmer — Motion Primitives.
export function TextShimmer({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block bg-gradient-to-r from-zinc-500 via-zinc-100 to-zinc-500 bg-clip-text text-transparent',
        'bg-[length:200%_100%] animate-[shimmer_2.5s_linear_infinite]',
        className,
      )}
      style={{ backgroundPosition: '0% 0%' }}
    >
      {children}
      <style>{`@keyframes shimmer { to { background-position: -200% 0 } }`}</style>
    </span>
  )
}

// BorderTrail — Motion Primitives: a light trace orbiting the card border.
export function BorderTrail({ className, size = 60 }: { className?: string; size?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <motion.div
        className={cn('absolute aspect-square', className)}
        style={{
          width: size,
          background: 'radial-gradient(circle, rgba(124,108,240,.5) 0%, transparent 60%)',
          offsetPath: 'rect(0 auto auto 0 round 12px)',
        }}
        animate={{ offsetDistance: ['0%', '100%'] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  )
}

// AnimatedCircularProgress — Magic UI gauge.
export function AnimatedCircularProgress({
  value,
  max = 100,
  size = 120,
  strokeWidth = 8,
  label,
  sublabel,
  className,
}: {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  label?: React.ReactNode
  sublabel?: React.ReactNode
  className?: string
}) {
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#acp-grad)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="acp-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7c6cf0" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xl font-semibold tabular-nums text-foreground">{label}</div>
        {sublabel && <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">{sublabel}</div>}
      </div>
    </div>
  )
}

// AnimatedList — Magic UI: rows cascade in.
export function AnimatedList({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.03, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  )
}

export function AnimatedListItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, x: -8, filter: 'blur(2px)' },
        show: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.3, ease: 'easeOut' } },
      }}
    >
      {children}
    </motion.div>
  )
}

export { SlidingNumber } from './sliding-number'
