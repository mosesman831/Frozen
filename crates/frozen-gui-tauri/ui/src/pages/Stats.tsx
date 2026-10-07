import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { Globe, AppWindow, ShieldBan, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { invoke } from '@/lib/bridge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/misc'
import { Empty } from '@/components/ui/empty'
import { BlurFade } from '@/components/motion/motion'
import { fmtDur } from '@/lib/utils'

interface Row { name: string; seconds?: number; count?: number }
interface StatsData { apps?: Row[]; domains?: Row[]; blocked?: Row[] }

const tickStyle = { fontSize: 11, fill: '#71717a' }

const tooltip = (
  <RTooltip
    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
    contentStyle={{
      background: '#17171a', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8, fontSize: 12, color: '#e4e4e7',
    }}
    itemStyle={{ color: '#e4e4e7' }}
    labelStyle={{ color: '#a1a1aa' }}
  />
)

export default function Stats() {
  const { rev, call } = useStore()
  const [days, setDays] = useState('7')
  const [data, setData] = useState<StatsData | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    invoke<StatsData>('stats', { days: Number(days) }).then((d) => live && setData(d))
    return () => { live = false }
  }, [days, rev])

  const domains = (data?.domains ?? []).slice(0, 8)
  const blocked = (data?.blocked ?? []).slice(0, 8)
  const apps = data?.apps ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <SegmentedControl
          value={days}
          onValueChange={setDays}
          options={[
            { value: '7', label: '7 days' },
            { value: '14', label: '14 days' },
            { value: '30', label: '30 days' },
          ]}
        />
        <Button
          variant="ghost" size="sm" className="text-zinc-500"
          onClick={() => call('delete-stats', {}, 'Stats cleared')}
        >
          <Trash2 /> Clear history
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* top domains */}
        <BlurFade>
          <Card className="h-72">
            <CardHeader className="flex-row items-center gap-2 py-3.5">
              <Globe className="size-3.5 text-violet-300" />
              <CardTitle>Time by domain</CardTitle>
            </CardHeader>
            <CardContent className="h-[calc(100%-56px)] pb-4">
              {!data ? (
                <Skeleton className="h-full w-full" />
              ) : domains.length === 0 ? (
                <Empty icon={Globe} title="No browsing data" description="Stats accumulate as you use your browser." className="py-6" />
              ) : (
                <ResponsiveContainer>
                  <BarChart data={domains} layout="vertical" margin={{ left: 8, right: 16, top: 0, bottom: 0 }}>
                    <XAxis type="number" tickFormatter={(v) => `${Math.round(v / 60)}m`} tick={tickStyle} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ ...tickStyle, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                    {tooltip}
                    <Bar dataKey="seconds" radius={[0, 4, 4, 0]} maxBarSize={14}>
                      {domains.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? '#7c6cf0' : `rgba(124,108,240,${0.75 - i * 0.09})`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </BlurFade>

        {/* blocked attempts */}
        <BlurFade delay={0.05}>
          <Card className="h-72">
            <CardHeader className="flex-row items-center gap-2 py-3.5">
              <ShieldBan className="size-3.5 text-rose-400" />
              <CardTitle>Blocked attempts</CardTitle>
            </CardHeader>
            <CardContent className="h-[calc(100%-56px)] pb-4">
              {!data ? (
                <Skeleton className="h-full w-full" />
              ) : blocked.length === 0 ? (
                <Empty icon={ShieldBan} title="No blocked attempts" description="The service has nothing to report yet." className="py-6" />
              ) : (
                <ResponsiveContainer>
                  <BarChart data={blocked} margin={{ left: -18, right: 8, top: 4, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ ...tickStyle, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={46} />
                    <YAxis tick={tickStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                    {tooltip}
                    <Bar dataKey="count" fill="#fb7185" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </BlurFade>
      </div>

      {/* app usage table */}
      <BlurFade delay={0.1}>
        <Card>
          <CardHeader className="flex-row items-center gap-2 py-3.5">
            <AppWindow className="size-3.5 text-sky-400" />
            <CardTitle>App usage</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!data ? (
              <div className="space-y-2 p-5"><Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" /></div>
            ) : apps.length === 0 ? (
              <Empty icon={AppWindow} title="No app usage recorded" className="py-8" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Application</TableHead>
                    <TableHead className="w-28 text-right">Time</TableHead>
                    <TableHead className="w-2/5 pr-5">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps.slice(0, 10).map((a) => {
                    const max = apps[0]?.seconds ?? 1
                    return (
                      <TableRow key={a.name}>
                        <TableCell className="pl-5 font-mono text-[12.5px]">{a.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-zinc-400">{fmtDur(a.seconds)}</TableCell>
                        <TableCell className="pr-5">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-sky-400/80"
                              style={{ width: `${Math.max(2, ((a.seconds ?? 0) / max) * 100)}%` }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </BlurFade>
    </div>
  )
}
