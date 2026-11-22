/**
 * Find: two lists for your moving day.
 *   Trucks         — trucks that fit you (ranked on the server, so nobody's address reaches this
 *                    browser) and everyone else organizing that day, with who's organizing.
 *   People looking — people who opted in to be found; invite them to your truck or message them.
 */
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Truck } from 'lucide-react'
import { useAsyncResource, useAuth, useQuery } from 'deepspace'
import { Badge, Button, EmptyState, useToast } from '@/components/ui'
import { MessageButton, UserLink } from '@/components/haul/People'
import { useNeedsContact } from '@/components/haul/ContactDialog'
import { api, dollars, walletUrlFor, type DraftRec, type LookingPostRec, type PoolRec, type SeatRec } from '@/lib/api'
import { serviceFee } from '@/lib/wallet'
import { daysBetween } from '@/lib/match'
import { CONFIG } from '@/config'
import { VEHICLES } from '@/config'
import type { MatchResult, Reason } from '@/lib/match'

const REASON_TEXT: Record<Reason, string> = {
  same_building: '🏢 Same building',
  small_detour: '🛣️ Barely a detour',
  cheap: '💸 Cheapest option',
  nearly_full: '🔥 Almost full: likely to go',
  same_storage: '📦 Same storage unit',
}

export default function SearchPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { userId } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'people' ? 'people' : 'trucks'
  const draft = useQuery<DraftRec>('moveDrafts', { where: { userId: userId ?? '' }, limit: 1 }).records[0]?.data
  const myPost = useQuery<LookingPostRec>('lookingPosts', { where: { userId: userId ?? '' }, limit: 1 }).records[0]?.data
  const mySeat = useQuery<SeatRec>('seats', { where: { userId: userId ?? '', status: 'active' }, limit: 1 }).records[0]?.data
  const flex = draft?.flexDays ?? CONFIG.dates.flexDefaultDays
  const inWindow = (d?: string) => !!d && !!draft?.date && Math.abs(daysBetween(draft.date, d)) <= flex
  const lookers = useQuery<LookingPostRec>('lookingPosts', { where: { status: 'looking' }, limit: 300 }).records.filter((p) => p.data.userId !== userId && inWindow(p.data.date))
  const [joining, setJoining] = useState<string | null>(null)
  const pools = useQuery<PoolRec>('pools', { where: { status: 'open' }, limit: 200 })
  const poolOf = (id: string) => pools.records.find((p) => p.recordId === id)?.data
  const res = useAsyncResource(async () => {
    const r = await api.searchPools()
    if (!r.success) throw new Error(r.error)
    return r.data.results
  }, [])

  const gate = useNeedsContact()
  async function join(poolId: string) {
    setJoining(poolId)
    let joined = false
    await gate.run(async () => {
      const r = await api.joinPool(poolId)
      if (r.success) { joined = true; navigate(`/pools/${poolId}`) }
      return r
    }, 'You are in! 🎉', `/pools/${poolId}`)
    setJoining(null)
    if (!joined) res.reload()
  }

  const sameDay = pools.records.filter((p) => inWindow(p.data.date) && p.data.organizerId !== userId && !(res.data ?? []).some((r) => r.poolId === p.recordId))
  const listed = myPost?.status === 'looking'

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6">
      {gate.dialog}
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-extrabold text-foreground">Find</h1>
        <Link to="/move" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {draft?.date ? `${new Date(`${draft.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · edit my move` : 'Plan my move'}
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-secondary p-1" role="tablist">
        {([['trucks', 'Trucks'], ['people', `People looking${lookers.length ? ` (${lookers.length})` : ''}`]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'people' ? { tab: 'people' } : {})}
            className={`h-9 rounded-full text-sm font-bold ${tab === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>{label}</button>
        ))}
      </div>

      {draft?.date && !mySeat && (
        <label className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-card p-3 text-sm">
          <input type="checkbox" checked={listed} className="mt-0.5 size-4 accent-[var(--color-primary)]" onChange={async (e) => {
            const r = await api.setLooking(e.target.checked)
            if (!r.success) toast.error('Not changed', r.error)
            else if (e.target.checked) toast.success('You are listed', 'Organizers moving your way can invite you. You also get an alert when a new truck fits.')
          }} data-testid="list-me" />
          <span><span className="font-semibold text-foreground">List me as looking for a truck</span><br />
            <span className="text-muted-foreground">Organizers see your date, areas and size (never your address) and can invite you. You get an alert when a new truck fits.</span></span>
        </label>
      )}

      {tab === 'people' && <PeopleLooking lookers={lookers} myPoolId={mySeat?.poolId} hasDraft={!!draft?.date} />}
      {tab === 'trucks' && (<>

      {res.status === 'loading' && (
        <div className="mt-6 grid gap-3" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-card" />)}
          <p className="text-center text-sm text-muted-foreground">Checking trucks leaving on your day…</p>
        </div>
      )}
      {res.status === 'error' && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4 text-sm">
          <p className="text-destructive">{res.error}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={res.reload}>Try again</Button>
        </div>
      )}
      {res.status === 'ready' && res.data && res.data.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<span className="text-4xl" aria-hidden>🚚</span>}
            title="No trucks on your day yet — you could be first"
            description="Start a pool and others moving that day will find it. Every person who joins lowers your price."
          />
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => navigate('/pools/new')}>Start a pool</Button>
            <Button variant="outline" onClick={() => navigate('/move')}>Change my date</Button>
          </div>
        </div>
      )}

      {(res.data ?? []).length > 0 && <h2 className="mt-6 text-sm font-bold text-foreground">Fit your move</h2>}
      <ul className="mt-2 grid gap-3">
        {(res.data ?? []).map((r: MatchResult) => (
          <li key={r.poolId} className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(60,40,20,0.04)]" data-testid="pool-card">
            {poolOf(r.poolId) && (
              <div className="mb-3 flex items-center justify-between gap-2">
                <UserLink userId={poolOf(r.poolId)!.organizerId} suffix="· organizer" />
                <MessageButton userId={poolOf(r.poolId)!.organizerId} label="Ask" />
              </div>
            )}
            {poolOf(r.poolId) && (
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                🚚 {VEHICLES[poolOf(r.poolId)!.vehicleType]?.label} · {poolOf(r.poolId)!.moveType === 'city' ? `${poolOf(r.poolId)!.fromCity} → ${poolOf(r.poolId)!.toCity}` : `to ${poolOf(r.poolId)!.destinationLabel}`}
              </p>
            )}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-foreground">{dollars(r.myShareCents + serviceFee(r.myShareCents))} <span className="text-sm font-normal text-muted-foreground">your share incl. fee</span></p>
                <p className="mt-1 text-sm text-muted-foreground">
                  📍 about {r.distanceMi} mi from you · {r.detourMi} mi detour · {r.fillAfterPct}% full after you join
                </p>
              </div>
              <Button size="sm" onClick={() => join(r.poolId)} loading={joining === r.poolId} disabled={!!joining}>Join</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {r.nearMiss && <Badge variant="outline">{r.nearMiss === 'capacity' ? 'Tight on space' : 'A bit out of the way'}</Badge>}
              {r.dayDiff !== 0 && <Badge variant="outline">{dayLabel(r.dayDiff)}</Badge>}
              {r.reasons.map((x) => <Badge key={x} variant="secondary">{REASON_TEXT[x]}</Badge>)}
            </div>
            <Link to={`/pools/${r.poolId}`} className="mt-3 inline-block text-xs text-muted-foreground underline-offset-4 hover:underline">See details</Link>
          </li>
        ))}
      </ul>

      {sameDay.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-bold text-foreground">Everyone else organizing {flex ? `within ${flex} day${flex > 1 ? 's' : ''}` : 'that day'}</h2>
          <p className="text-xs text-muted-foreground">These don't fit your route or space as is — message the organizer if you're flexible.</p>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {sameDay.map((p) => (
              <li key={p.recordId} className="flex items-center gap-3 px-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <UserLink userId={p.data.organizerId} />
                  <p className="mt-1 truncate text-xs text-muted-foreground">🚚 {VEHICLES[p.data.vehicleType]?.label} · {draft?.date && p.data.date !== draft.date ? `${dayLabel(daysBetween(draft.date, p.data.date))} · ` : ''}{p.data.moveType === 'city' ? `${p.data.fromCity} → ${p.data.toCity}` : `${p.data.areaLabel} → ${p.data.destinationLabel}`}</p>
                </div>
                <MessageButton userId={p.data.organizerId} label="Ask" />
              </li>
            ))}
          </ul>
        </>
      )}
      </>)}
    </div>
  )
}

function PeopleLooking({ lookers, myPoolId, hasDraft }: { lookers: { recordId: string; data: LookingPostRec }[]; myPoolId?: string; hasDraft: boolean }) {
  const toast = useToast()
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const fits = useAsyncResource(async () => {
    if (!myPoolId) return [] as string[]
    const r = await api.poolCandidates(myPoolId)
    return r.success ? r.data.people.map((p) => p.userId) : []
  }, [myPoolId, lookers.length])
  if (!hasDraft) return <div className="mt-6"><EmptyState title="Plan your move first" description="We show people moving on the same day as you." /></div>
  if (lookers.length === 0) return <div className="mt-6"><EmptyState title="Nobody else is listed for your day yet" description="Turn on 'List me as looking' so others can find you too, or start a truck and invite people later." /></div>
  const sorted = [...lookers].sort((a, b) => Number((fits.data ?? []).includes(b.data.userId)) - Number((fits.data ?? []).includes(a.data.userId)))
  return (
    <ul className="mt-4 grid gap-3" data-testid="people-looking">
      {sorted.map((p) => {
        const fit = (fits.data ?? []).includes(p.data.userId)
        return (
          <li key={p.recordId} className={`rounded-2xl border bg-card p-4 ${fit ? 'border-primary' : 'border-border'}`}>
            <div className="flex items-center justify-between gap-2">
              <UserLink userId={p.data.userId} size="md" />
              {fit && <Badge>Fits your truck</Badge>}
            </div>
            <p className="mt-2 text-sm text-foreground">{p.data.moveType === 'city' ? `${p.data.fromCity} → ${p.data.toCity}` : `${p.data.fromLabel} → ${p.data.toLabel}`}</p>
            <p className="text-xs text-muted-foreground">{p.data.volumeCuFt} cu ft · {p.data.date ? new Date(`${p.data.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}{p.data.flexDays ? ` ± ${p.data.flexDays}d` : ''} · looking for a truck</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <MessageButton userId={p.data.userId} />
              {myPoolId && fit && (
                <Button size="sm" disabled={sent[p.data.userId]} onClick={async () => {
                  const r = await api.invite(myPoolId, p.data.userId)
                  if (r.success) { setSent({ ...sent, [p.data.userId]: true }); toast.success('Invite sent', 'They get a notification and an email.') }
                  else toast.error('Not sent', r.error)
                }}><Truck className="mr-1.5 size-4" />{sent[p.data.userId] ? 'Invited' : 'Invite to my truck'}</Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** "2 days earlier" / "1 day later" relative to your date. */
function dayLabel(diff: number): string {
  const n = Math.abs(diff)
  return `${n} day${n > 1 ? 's' : ''} ${diff < 0 ? 'earlier' : 'later'}`
}
