import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { GradientBg } from '@/components/GradientBg'
import { Sidebar, type PageId } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { CommandMenu } from '@/components/CommandMenu'
import { useStore } from '@/lib/store'
import Dashboard from '@/pages/Dashboard'
import Blocks from '@/pages/Blocks'
import Focus from '@/pages/Focus'
import Stats from '@/pages/Stats'
import Audit from '@/pages/Audit'
import { Skeleton } from '@/components/ui/misc'

export default function App() {
  const [page, setPage] = useState<PageId>('dashboard')
  const [cmdOpen, setCmdOpen] = useState(false)
  const { state } = useStore()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen((v) => !v)
      }
      if (e.key >= '1' && e.key <= '5' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPage(['dashboard', 'blocks', 'focus', 'stats', 'audit'][Number(e.key) - 1] as PageId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigate = useCallback((p: PageId) => setPage(p), [])

  return (
    <div className="h-full text-foreground">
      <GradientBg />
      <div className="flex h-full">
        <Sidebar page={page} onNavigate={navigate} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar page={page} onOpenCommand={() => setCmdOpen(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto">
            {!state ? (
              <LoadingSkeleton />
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={page}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="h-full"
                >
                  {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
                  {page === 'blocks' && <Blocks />}
                  {page === 'focus' && <Focus />}
                  {page === 'stats' && <Stats />}
                  {page === 'audit' && <Audit />}
                </motion.div>
              </AnimatePresence>
            )}
          </main>
        </div>
      </div>
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} onNavigate={navigate} />
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}
