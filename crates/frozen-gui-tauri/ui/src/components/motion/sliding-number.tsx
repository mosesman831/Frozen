import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'

// SlidingNumber — each digit rolls vertically on change (Motion Primitives style).
export function SlidingNumber({ value, className }: { value: number | string; className?: string }) {
  const chars = String(value).split('')
  return (
    <span className={cn('inline-flex tabular-nums', className)} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {chars.map((ch, i) => (
        <span key={chars.length - i} className="relative inline-block overflow-hidden align-top">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={ch}
              className="inline-block"
              initial={{ y: '60%', opacity: 0 }}
              animate={{ y: '0%', opacity: 1 }}
              exit={{ y: '-60%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  )
}
