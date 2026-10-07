import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { invoke, subscribeStore, type Snapshot } from './bridge'
import type { BlockListInfo, BridgeStatus } from './types'

interface Store {
  state: BlockListInfo | null
  status: BridgeStatus
  rev: number
  call: <T = unknown>(method: string, params?: Record<string, unknown>, ok?: string) => Promise<T | undefined>
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>({ status: { connected: false, detail: 'connecting…' }, state: null })

  useEffect(() => subscribeStore(setSnap), [])

  const call = useMemo(
    () =>
      async <T,>(method: string, params: Record<string, unknown> = {}, ok?: string): Promise<T | undefined> => {
        try {
          const r = await invoke<T>(method, params)
          if (ok) toast.success(ok)
          return r
        } catch (e) {
          toast.error(String((e as Error).message || e))
          return undefined
        }
      },
    [],
  )

  const v = useMemo<Store>(
    () => ({ state: snap.state, status: snap.status, rev: snap.state?.rev ?? -1, call }),
    [snap, call],
  )
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}

// Ticking "now" for countdowns — components subscribe at the granularity they need.
export function useNow(intervalMs = 1000): number {
  const [n, setN] = useState(() => Date.now())
  const ref = useRef(intervalMs)
  ref.current = intervalMs
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ref.current)
    return () => clearInterval(t)
  }, [])
  return n
}
