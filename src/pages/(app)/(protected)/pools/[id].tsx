/**
 * Pool detail — the core page. Everything here is live: when anyone joins or leaves,
 * every open copy of this page updates without a refresh (RecordRoom subscriptions).
 * Costs are computed here from the same pure functions the server uses (spec §10, E1).
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Share2 } from 'lucide-react'
import { useAsyncResource, useAuth, usePresenceRoom, useQuery, useUserLookup } from 'deepspace'
import { Badge, Button, useToast } from '@/components/ui'
import { TruckLoad } from '@/components/haul/TruckLoad'
import { VEHICLES } from '@/config'
import { usableCuFt } from '@/lib/volume'
import { explainShare, quoteTotalCents, storageSplit, truckSplit } from '@/lib/split'
import { CONTACT_LABEL, api, contactHref, dollars, mapsHref, stopOrder, walletUrlFor, type PoolPrivateRec, type PoolRec, type SeatRec } from '@/lib/api'
import { poolCharges } from '@/lib/wallet'
import { CONFIG } from '@/config'
import { EditPrice } from '@/components/haul/EditPrice'
import { MessageButton, UserLink } from '@/components/haul/People'
import { useNeedsContact } from '@/components/haul/ContactDialog'
import { MessageCircle, Truck as TruckIcon } from 'lucide-react'
import type { ConversationRec } from '@/lib/api'

const STATUS_TEXT: Record<PoolRec['status'], string> = {
  open: '🟢 Open — room for more', locked: '🔒 Locked — all set for move day', in_progress: '🚚 Moving now', completed: '✅ Done — settle up', cancelled: 'Cancelled',
}
const STATUS_HELP: Record<PoolRec['status'], string> = {
  open: 'Anyone moving the same day can join until the pool closes. Share the link to fill it faster.',
  locked: 'Shares are held from everyone\'s wallet. Leaving now costs a $10 cancellation fee.',
  in_progress: 'On the road.',
  completed: 'Move finished. Shares went to the organizer for the truck.',
  cancelled: 'This pool was closed.',
}

export default function PoolPage() {
  const { id = '' } = useParams()
  const { userId } = useAuth()
  const toast = useToast()
  const { getName } = useUserLookup()
  const pools = useQuery<PoolRec>('pools', { limit: 200 })
  const seatsQ = useQuery<SeatRec>('seats', { where: { poolId: id } })
  const privQ = useQuery<PoolPrivateRec>('poolPrivate', { where: { poolId: id }, limit: 1 })
  const { peers } = usePresenceRoom(`pool:${id}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const gate = useNeedsContact()
  const ref = params.get('ref')
  const fromShare = ref === 'share' || ref === 'invite'

  // 埋点: someone opened an invite link
  useEffect(() => {
    if (fromShare && id) api.track('invite_opened', { via: ref ?? 'share' }, id)
  }, [fromShare, id, ref])
  const poolChat = useQuery<ConversationRec>('conversations', { where: { kind: 'pool', poolId: id }, limit: 1 }).records[0]

  const pool = pools.records.find((r) => r.recordId === id)?.data
  const seats = seatsQ.records.filter((s) => s.data.status === 'active')
  const priv = privQ.records[0]?.data // only members receive this record
  const mySeat = seats.find((s) => s.data.userId === userId)
  const isOrganizer = pool?.organizerId === userId

  const money = useMemo(() => {
    if (!pool || seats.length === 0) return null
    const truckTotal = quoteTotalCents(pool.quote)
    const truck = truckSplit(truckTotal, seats.map((s) => ({ seatId: s.recordId, volumeCuFt: s.data.volumeCuFt, isOrganizer: !!s.data.isOrganizer })), pool.organizerDiscountPct)
    const storage = pool.hasStorage && pool.storageMonthlyCents
      ? storageSplit(pool.storageMonthlyCents, seats.map((s) => ({ seatId: s.recordId, volumeCuFt: s.data.volumeCuFt, months: Math.max(1, s.data.storageMonths || 1) })))
      : new Map<string, number>()
    const charges = poolCharges(truckTotal, seats.map((s) => ({
      seatId: s.recordId, userId: s.data.userId, volumeCuFt: s.data.volumeCuFt, isOrganizer: !!s.data.isOrganizer,
      extraCents: s.data.extraCents ?? 0, storageCents: storage.get(s.recordId) ?? 0,
    })), pool.organizerDiscountPct)
    return { truckTotal, truck, storage, charges }
  }, [pool, seats])

  if (pools.status === 'loading') return <p className="px-4 py-8 text-sm text-muted-foreground">Loading…</p>
  if (!pool) return <p className="px-4 py-8 text-sm text-muted-foreground">This pool does not exist or you cannot see it. <Link to="/search" className="underline">Back to search</Link></p>

  const usable = usableCuFt(pool.capacityCuFt, pool.bufferPct)
  const totalCuFt = seats.reduce((a, s) => a + s.data.volumeCuFt, 0)
  const run = async (key: string, fn: () => Promise<{ success: boolean; error?: string; code?: string }>, ok: string) => {
    setBusy(key)
    const r = await fn()
    setBusy(null)
    if (r.success) return toast.success(ok)
    const wallet = walletUrlFor(r as { success: boolean; code?: string }, `/pools/${id}`)
    if (wallet) { toast.error('Top up your wallet', r.error); navigate(wallet); return }
    toast.error('Not done', r.error)
  }
  const fee = dollars(CONFIG.fees.cancelCents)

  const leftCuFt = Math.max(0, Math.round(usable - totalCuFt))
  const perPersonIfOneMore = money ? Math.round(money.truckTotal / (seats.length + 1) / 100) : null
  async function share() {
    const url = `${window.location.origin}/pools/${id}?ref=share`
    const route = pool!.moveType === 'city' ? `from ${pool!.fromCity} to ${pool!.toCity}` : `from ${pool!.areaLabel || 'campus'} to ${pool!.destinationLabel}`
    const text = `🚚 Moving out ${pool!.date}? I'm sharing a ${VEHICLES[pool!.vehicleType]?.label.toLowerCase() ?? 'truck'} ${route}. ${leftCuFt} cu ft left${perPersonIfOneMore ? `, about $${perPersonIfOneMore} each` : ''}. Join on HaulPool:`
    let how: 'native' | 'clipboard' = 'clipboard'
    try {
      if (navigator.share) { await navigator.share({ text, url }); how = 'native' }
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast.success('Invite copied', 'Paste it in your group chat.') }
      api.track('share_copied', { how, seats: seats.length, leftCuFt }, id)
    } catch { /* user closed the share sheet */ }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      {gate.dialog}
      {fromShare && !mySeat && pool.status === 'open' && (
        <p className="mb-4 rounded-xl border border-primary/40 bg-accent/50 p-3 text-sm text-foreground">
          👋 You were invited to share this truck. Check the date and price below, then tap <span className="font-semibold">Join</span> — or message the organizer first.
        </p>
      )}
      <div className="mb-3 flex items-center justify-between gap-2" data-testid="organizer">
        <UserLink userId={pool.organizerId} suffix={pool.organizerId === userId ? '· you organize' : '· organizer'} size="md" />
        {pool.organizerId !== userId && <MessageButton userId={pool.organizerId} label={mySeat ? 'Message' : 'Ask a question'} />}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{VEHICLES[pool.vehicleType]?.label ?? 'Vehicle'} · {pool.date}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pool.moveType === 'city'
              ? <>🛣️ {pool.fromCity} → {pool.toCity} · drop-off near {pool.destinationLabel}</>
              : <>From {pool.areaLabel || 'near campus'} to {pool.destinationLabel}</>}
            {' '}· leaves {pool.departureTime ?? 'TBD'}
          </p>
        </div>
        <Badge variant={pool.status === 'open' ? 'success' : 'secondary'}>{STATUS_TEXT[pool.status]}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {pool.status === 'cancelled' && pool.cancelReason === 'not_filled' ? 'Nobody joined before the deadline, so this pool closed. No fee was charged.' : STATUS_HELP[pool.status]}
      </p>
      {peers.length > 0 && <p className="mt-2 text-xs text-muted-foreground" data-testid="viewers">{peers.length} other {peers.length === 1 ? 'person is' : 'people are'} looking at this pool right now</p>}

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <TruckLoad capacityCuFt={pool.capacityCuFt} usableCuFt={usable} vehicleLabel={VEHICLES[pool.vehicleType]?.label}
          segments={(() => {
            const order = stopOrder(seats, priv?.stops)
            return seats.map((s) => ({ label: s.data.userId === userId ? 'You' : getName(s.data.userId) ?? 'Member', cuFt: s.data.volumeCuFt, fragileCuFt: s.data.fragileCuFt ?? 0, mine: s.data.userId === userId, order: order.get(s.recordId) }))
          })()} />
        {!priv && seats.length > 1 && <p className="mt-1 text-xs text-muted-foreground">Shown in the order people joined. Members see the real pickup order.</p>}
        <p className="mt-3 text-sm text-muted-foreground">
          Closes {new Date(pool.deadlineAt).toLocaleString()} · truck total {money ? dollars(money.truckTotal) : '—'}
          {pool.quoteIsEstimate ? ' (estimate)' : ''}
        </p>
      </section>

      {mySeat && money && (() => {
        const c = money.charges.get(mySeat.recordId)!
        return (
          <section className="mt-4 rounded-2xl border border-primary/40 bg-primary/5 p-4" data-testid="my-share">
            <p className="text-lg font-bold text-foreground">You pay {dollars(c.total)}</p>
            <p className="mt-0.5 text-sm text-foreground">
              Share {dollars(c.share)} + {CONFIG.fees.servicePct}% service fee {dollars(c.fee)}{c.extra > 0 ? ` + route change ${dollars(c.extra)}` : ''}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {explainShare({ myCuFt: mySeat.data.volumeCuFt, totalCuFt, truckCents: money.truck.get(mySeat.recordId) ?? 0, storageCents: money.storage.get(mySeat.recordId) ?? 0, months: mySeat.data.storageMonths })}
            </p>
            <p className="mt-2 text-xs font-semibold text-foreground">
              {pool.status === 'open' && '💳 Nothing is taken from your wallet until the pool locks.'}
              {pool.status === 'locked' && '🔒 Held from your wallet. Settled after move day.'}
              {pool.status === 'completed' && '✅ Paid from your wallet.'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Label your boxes <span className="font-semibold text-foreground">{mySeat.data.boxCode}</span>.</p>
          </section>
        )
      })()}

      {editing && isOrganizer && (
        <EditPrice pool={pool} poolId={id} usedCuFt={totalCuFt} onDone={() => setEditing(false)} />
      )}

      <h2 className="mt-8 text-base font-semibold text-foreground">People ({seats.length})</h2>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
        {seats.map((s) => (
          <li key={s.recordId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <UserLink userId={s.data.userId} suffix={`${s.data.isOrganizer ? '· organizer' : ''}${s.data.userId === userId ? ' (you)' : ''}`} />
            <span className="flex items-center gap-2 text-muted-foreground">
              {s.data.volumeCuFt} cu ft{(s.data.fragileCuFt ?? 0) > 0 ? ` (${s.data.fragileCuFt} fragile)` : ''}{money ? ` · ${dollars(money.charges.get(s.recordId)?.total ?? 0)}` : ''}
            </span>
          </li>
        ))}
      </ul>

      {priv && (
        <>
          <h2 className="mt-8 text-base font-semibold text-foreground">Route & contacts</h2>
          <p className="text-xs text-muted-foreground">Only people in this pool can see addresses and contact details.</p>
          <ol className="mt-3 space-y-2" data-testid="stops">
            {[...priv.stops].sort((a, b) => a.order - b.order).map((st) => {
              const href = st.contact ? contactHref(st.contact) : null
              return (
                <li key={st.seatId} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{st.order}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-semibold text-foreground">{st.userId === userId ? 'You' : getName(st.userId) ?? 'Member'} <span className="font-normal text-muted-foreground">· pickup</span></p>
                    <a href={mapsHref(st)} target="_blank" rel="noreferrer" className="block truncate text-primary underline-offset-2 hover:underline">
                      {st.address ? `${st.address} (${st.label})` : st.label}{st.exact && !st.address ? ' · pinned' : ''}
                    </a>
                  </div>
                  {st.contact && st.userId !== userId && (
                    href
                      ? <a href={href} target="_blank" rel="noreferrer" className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground">{CONTACT_LABEL[st.contact.method]}</a>
                      : <button type="button" onClick={() => { void navigator.clipboard.writeText(st.contact!.handle); toast.success('Copied', `${CONTACT_LABEL[st.contact!.method]}: ${st.contact!.handle}`) }}
                          className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground">{CONTACT_LABEL[st.contact.method]}: copy</button>
                  )}
                </li>
              )
            })}
            {(() => {
              const drops = (priv.dropoffs ?? []).filter((d) => d.address || d.exact)
              const dest = priv.destination?.label
              return (
                <li className="flex items-start gap-3 rounded-xl border border-dashed border-border p-3 text-sm">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-tape)] text-xs font-bold text-[#3b2c00]">🏁</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">Unload at {dest} <span className="font-normal text-muted-foreground">· about {priv.routeMiles} mi total</span></p>
                    {drops.map((d) => (
                      <a key={d.seatId} href={mapsHref(d)} target="_blank" rel="noreferrer" className="block truncate text-primary underline-offset-2 hover:underline">
                        {d.userId === userId ? 'You' : getName(d.userId) ?? 'Member'}: {d.address ?? d.label}
                      </a>
                    ))}
                  </div>
                </li>
              )
            })()}
          </ol>
        </>
      )}

      {mySeat && poolChat && (
        <Link to={`/messages/${poolChat.recordId}`} className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card p-3 hover:bg-secondary" data-testid="pool-chat">
          <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground"><MessageCircle className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-foreground">Group chat</span>
            <span className="block truncate text-sm text-muted-foreground">{poolChat.data.lastText ?? 'Agree on pickup time and who brings the dolly'}</span>
          </span>
        </Link>
      )}

      {mySeat && pool.status === 'open' && <FitsYourTruck poolId={id} />}

      <div className="mt-8 flex flex-wrap gap-2">
        {!mySeat && pool.status === 'open' && (
          <Button onClick={async () => { setBusy('join'); await gate.run(() => api.joinPool(id, fromShare ? 'share' : 'search'), 'You are in! 🎉', `/pools/${id}`); setBusy(null) }} loading={busy === 'join'} data-testid="join">Join this pool</Button>
        )}
        {mySeat && (pool.status === 'open' || pool.status === 'locked') && !(isOrganizer && seats.length === 1) && (
          <Button variant="outline" loading={busy === 'leave'} data-testid="leave" onClick={() => {
            const late = pool.status === 'locked'
            const msg = isOrganizer
              ? `Leave and hand this pool to the next person who joined?${late ? ` Because it's locked, ${fee} is kept from your hold as a cancellation fee (it goes to the others).` : ''}`
              : late ? `This pool is locked. Leaving returns your hold minus a ${fee} cancellation fee, which goes to the people left. Leave?` : 'Leave this pool? Your space goes back to the others.'
            if (!window.confirm(msg)) return
            void run('leave', () => api.leavePool(id), late ? `You left. ${fee} cancellation fee applied.` : 'You left the pool')
          }}>{isOrganizer ? 'Leave (hand over)' : 'Leave'}</Button>
        )}
        {isOrganizer && seats.length === 1 && (pool.status === 'open' || pool.status === 'locked') && (
          <Button variant="outline" loading={busy === 'cancel'} data-testid="cancel" onClick={() => {
            const late = pool.status === 'locked'
            if (!window.confirm(late ? `Cancel your solo move? Your hold comes back minus a ${fee} cancellation fee.` : 'Cancel this pool? Nobody has joined, so there is no fee.')) return
            void run('cancel', () => api.cancelPool(id), 'Pool cancelled')
          }}>Cancel pool</Button>
        )}
        {isOrganizer && (pool.status === 'open' || pool.status === 'locked') && !editing && (
          <Button variant="outline" onClick={() => setEditing(true)} data-testid="edit-price">Edit truck & price</Button>
        )}
        {mySeat && (pool.status === 'open' || pool.status === 'locked') && (
          <Link to="/move"><Button variant="outline" data-testid="change-places">{isOrganizer && pool.status === 'open' ? 'Change destination or pickup' : 'Change my pickup or drop-off'}</Button></Link>
        )}
        {mySeat && pool.status === 'open' && (
          <Button variant="outline" onClick={share} data-testid="share"><Share2 className="mr-1.5 size-4" />Invite people</Button>
        )}
        {isOrganizer && (pool.status === 'locked' || pool.status === 'in_progress') && (
          <Button variant="outline" onClick={() => {
            if (!window.confirm('Mark the move as done? Do this after move day: everyone\'s share is paid to you for the truck, and it can\'t be undone or cancelled afterwards.')) return
            void run('done', () => api.completePool(id), 'Marked done. Nice move!')
          }} loading={busy === 'done'}>Mark move done</Button>
        )}
        {isOrganizer && pool.status === 'open' && (
          <Button data-testid="lock" loading={busy === 'lock'} onClick={() => {
            if (seats.length === 1 && !window.confirm(`Nobody has joined yet. Lock and move on your own? You'll pay the full ${money ? dollars(money.truckTotal) : 'price'}.`)) return
            void run('lock', () => api.lockPool(id), seats.length === 1 ? 'Locked. You are moving solo.' : `Locked with ${seats.length} people. Everyone is set.`)
          }}>
            {seats.length === 1 ? 'Lock & go solo' : `Lock with ${seats.length} people`}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Looking people who fit this truck, for anyone in the pool to invite. */
function FitsYourTruck({ poolId }: { poolId: string }) {
  const toast = useToast()
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const res = useAsyncResource(async () => {
    const r = await api.poolCandidates(poolId)
    return r.success ? r.data.people : []
  }, [poolId])
  const people = res.data ?? []
  if (people.length === 0) return null
  return (
    <section className="mt-6 rounded-2xl border border-primary/40 bg-accent/40 p-4" data-testid="fits">
      <h2 className="font-bold text-foreground">{people.length} {people.length === 1 ? 'person is' : 'people are'} looking and fit your truck</h2>
      <ul className="mt-2 divide-y divide-border">
        {people.map((p) => (
          <li key={p.userId} className="flex items-center gap-3 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <UserLink userId={p.userId} />
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.fromLabel} · {p.volumeCuFt} cu ft · would pay about {dollars(p.estimateCents)}</p>
            </div>
            <Button size="sm" disabled={sent[p.userId]} onClick={async () => {
              const r = await api.invite(poolId, p.userId)
              if (r.success) { setSent({ ...sent, [p.userId]: true }); toast.success('Invite sent') } else toast.error('Not sent', r.error)
            }}><TruckIcon className="mr-1 size-4" />{sent[p.userId] ? 'Invited' : 'Invite'}</Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
