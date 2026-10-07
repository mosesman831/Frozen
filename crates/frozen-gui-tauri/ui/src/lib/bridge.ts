// Single seam between UI and backend.
// In Tauri: `rpc` command + `snapshot` poll (Tauri events unreliable on WV2).
// In a plain browser (vite dev): in-memory mock service.
import type { BlockListInfo, BridgeStatus } from './types'
import { mockInvoke, mockSnapshot } from './mock'

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke: (c: string, a?: unknown) => Promise<unknown> }; event?: { listen: (n: string, f: (e: { payload: unknown }) => void) => Promise<unknown> } }
  }
}

export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI__?.core

export interface Snapshot {
  status: BridgeStatus
  state: BlockListInfo | null
}

export function invoke<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) return window.__TAURI__!.core!.invoke('rpc', { method, params }) as Promise<T>
  return mockInvoke(method, params) as Promise<T>
}

function snapshot(): Promise<Snapshot> {
  if (isTauri()) return window.__TAURI__!.core!.invoke('snapshot') as Promise<Snapshot>
  return Promise.resolve(mockSnapshot())
}

type Cb = (s: Snapshot) => void
const subs = new Set<Cb>()
let lastRev = -1
let lastConn: boolean | null = null
let lastDetail: string | undefined
let current: Snapshot = { status: { connected: false, detail: 'connecting…' }, state: null }
let started = false

function poll() {
  snapshot()
    .then((s) => {
      const conn = s.status.connected
      const det = s.status.detail
      let dirty = false
      if (conn !== lastConn || det !== lastDetail) {
        lastConn = conn
        lastDetail = det
        dirty = true
      }
      const rev = s.state?.rev
      if (rev !== undefined && rev !== lastRev) {
        lastRev = rev
        dirty = true
      }
      if (dirty) {
        current = s
        subs.forEach((f) => {
          try { f(current) } catch (e) { console.error(e) }
        })
      }
    })
    .catch(() => {
      if (lastConn !== false) {
        lastConn = false
        lastDetail = 'bridge lost'
        current = { status: { connected: false, detail: 'bridge lost' }, state: current.state }
        subs.forEach((f) => {
          try { f(current) } catch (e) { console.error(e) }
        })
      }
    })
}

export function subscribeStore(cb: Cb): () => void {
  subs.add(cb)
  cb(current)
  if (!started) {
    started = true
    poll()
    setInterval(poll, 800)
  }
  return () => subs.delete(cb)
}
