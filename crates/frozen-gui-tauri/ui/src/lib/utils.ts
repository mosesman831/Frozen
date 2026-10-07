import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Lock } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtDur(s: number | undefined | null): string {
  const v = Math.max(0, Math.floor(s || 0))
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const sec = v % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}

export function fmtClock(unix: number | undefined | null): string {
  if (!unix) return '—'
  return new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function fmtCountdown(until: number | undefined | null): string {
  if (!until) return '—'
  const d = until - Math.floor(Date.now() / 1000)
  return d <= 0 ? 'ended' : fmtDur(d)
}

export function lockLabel(lock: Lock | undefined | null): string | null {
  if (!lock || lock.type === 'none') return null
  return lock.type.replace(/_/g, ' ')
}

export function nowS(): number {
  return Math.floor(Date.now() / 1000)
}
