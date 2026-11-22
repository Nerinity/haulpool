/**
 * Admin-only funnel (埋点 dashboard). Reads the `events` collection, which only admins
 * (the app owner) can read — everyone else gets an empty list from the server, so the
 * nav hiding is cosmetic and the permission is the real gate.
 */
import { useMemo, useState } from 'react'
import { useAuthProfileReady, useQuery } from 'deepspace'
import { computeFunnel, rejectReasons, type EventRow } from '@/lib/events'

const WINDOWS = [
  { key: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { key: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
  { key: 'all', label: 'All time', ms: Infinity },
] as const

const REASON_TEXT: Record<string, string> = {
  full: 'Truck full', closed: 'Pool closed', busy: 'Too many joining at once', already_in_a_pool: 'Already in another pool', other: 'Other',
}

export default function FunnelPage() {
  const { user, isSignedIn, userLoading } = useAuthProfileReady({ requireUser: true })
  const { records, status } = useQuery<EventRow>('events', { orderBy: 'at', orderDir: 'desc', limit: 5000 })
  const [win, setWin] = useState<(typeof WINDOWS)[number]['key']>('30d')

  const since = useMemo(() => {
    const w = WINDOWS.find((x) => x.key === win)!
    return w.ms === Infinity ? 0 : Date.now() - w.ms
  }, [win])
  const rows = useMemo(() => records.map((r) => r.data), [records])
  const funnel = useMemo(() => computeFunnel(rows, since), [rows, since])
  const reasons = useMemo(() => rejectReasons(rows, since), [rows, since])
  const searches = rows.filter((r) => r.name === 'search_run' && r.at >= since)
  const withMatch = searches.filter((r) => Number(r.props?.results ?? 0) > 0).length
  const shares = rows.filter((r) => r.name === 'share_copied' && r.at >= since).length
  const shareJoins = rows.filter((r) => r.name === 'pool_joined' && r.props?.via === 'share' && r.at >= since).length

  if (!isSignedIn || userLoading) return <p className="px-4 py-8 text-sm text-muted-foreground">Loading…</p>
  if (user?.role !== 'admin') return <p className="px-4 py-8 text-sm text-muted-foreground">This page is for the app owner.</p>

  const max = Math.max(1, funnel[0]?.users ?? 1)
  const biggestDrop = funnel.slice(1).reduce((a, s) => (s.dropFromPrev > a.dropFromPrev ? s : a), funnel[1] ?? funnel[0])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Funnel</h1>
          <p className="mt-1 text-sm text-muted-foreground">Distinct people at each step. A person counts only if they also did every step above.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1" role="tablist">
          {WINDOWS.map((w) => (
            <button key={w.key} role="tab" aria-selected={win === w.key} onClick={() => setWin(w.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${win === w.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading events…</p>
      ) : (
        <>
          <ol className="mt-6 space-y-3" data-testid="funnel">
            {funnel.map((s, i) => (
              <li key={s.key} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-foreground">{i + 1}. {s.label}</span>
                  <span className="tabular-nums text-foreground">
                    <span className="text-lg font-semibold">{s.users}</span>
                    <span className="text-muted-foreground"> · {s.pctOfFirst}% of visitors</span>
                  </span>
                </div>
                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(s.users / max) * 100}%` }} />
                </div>
                {i > 0 && (
                  <p className={`mt-1 text-xs ${s.dropFromPrev >= 50 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {s.dropFromPrev}% dropped off after the previous step
                  </p>
                )}
              </li>
            ))}
          </ol>

          {funnel[0].users > 0 && biggestDrop && biggestDrop.dropFromPrev > 0 && (
            <p className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm text-foreground">
              Biggest leak: <span className="font-semibold">{biggestDrop.label}</span> ({biggestDrop.dropFromPrev}% lost). Fix that step first.
            </p>
          )}

          <h2 className="mt-8 text-base font-semibold text-foreground">Supporting numbers</h2>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Stat label="Searches" value={searches.length} />
            <Stat label="Searches with a match" value={searches.length ? `${Math.round((withMatch / searches.length) * 100)}%` : '—'} />
            <Stat label="Invite links copied" value={shares} />
            <Stat label="Joins from an invite" value={shareJoins} />
            {Object.entries(reasons).map(([k, n]) => <Stat key={k} label={`Join failed: ${REASON_TEXT[k] ?? k}`} value={n} />)}
          </dl>
          <p className="mt-6 text-xs text-muted-foreground"><a href="/admin/demo" className="font-semibold text-primary">Demo data</a> · Events hold no addresses or names — only ids, counts and short codes. {records.length} events loaded.</p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
