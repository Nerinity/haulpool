/**
 * My pool — the signed-in hub. Three states:
 *   1. In a pool: live truck, your share, countdown, actions, contacts, move-day checklist.
 *   2. Move planned, no pool yet: summary + how many trucks leave that day + next actions.
 *   3. Nothing yet: how it works + start.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Lock, LogOut, MessageCircle, Pencil, Share2, Truck, Wallet, X } from 'lucide-react'
import { useAuth, useAuthProfileReady, useQuery, useUserLookup } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { TruckLoad } from '@/components/haul/TruckLoad'
import { CONFIG, VEHICLES } from '@/config'
import { poolCharges } from '@/lib/wallet'
import { daysBetween } from '@/lib/match'
import { usableCuFt } from '@/lib/volume'
import { quoteTotalCents, storageSplit } from '@/lib/split'
import { inviteText, shareInvite } from '@/lib/share'
import {
  CONTACT_LABEL, api, contactHref, dollars, stopOrder, walletUrlFor, isUnread, type ConversationRec, type DraftRec, type PoolPrivateRec, type PoolRec, type SeatRec,
} from '@/lib/api'

const STATUS: Record<PoolRec['status'], { text: string; cls: string }> = {
  open: { text: 'Open — room for more', cls: 'bg-primary/10 text-primary' },
  locked: { text: 'Locked — set for move day', cls: 'bg-[var(--color-tape)]/30 text-[#4d3a00]' },
  in_progress: { text: 'Moving now', cls: 'bg-primary text-primary-foreground' },
  completed: { text: 'Done', cls: 'bg-secondary text-muted-foreground' },
  cancelled: { text: 'Cancelled', cls: 'bg-secondary text-muted-foreground' },
}

export default function HomePage() {
  const { isSignedIn, userId } = useAuth()
  const seats = useQuery<SeatRec>('seats', { where: { userId: userId ?? '', status: 'active' }, limit: 1 })
  const drafts = useQuery<DraftRec>('moveDrafts', { where: { userId: userId ?? '' }, limit: 1 })
  const mine = seats.records[0]

  if (!isSignedIn) {
    return (
      <Shell>
        <p className="mt-6 text-sm text-muted-foreground">Sign in with your school account to plan your move.</p>
      </Shell>
    )
  }
  if (seats.status === 'loading' || drafts.status === 'loading') return <Shell><div className="mt-6 h-64 animate-pulse rounded-2xl bg-card" /></Shell>
  if (mine) return <Shell><PoolHub poolId={mine.data.poolId} seatId={mine.recordId} /></Shell>
  return <Shell><NoPool draft={drafts.records[0]?.data} /></Shell>
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useAuthProfileReady({ requireUser: true })
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
      {children}
      {user?.role === 'admin' && (
        <Link to="/admin/demo" className="mt-6 block rounded-xl border border-dashed border-border p-3 text-center text-xs font-semibold text-muted-foreground hover:text-foreground">
          Owner tools: load demo people & trucks · <span className="underline">open</span>
        </Link>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ in a pool

function PoolHub({ poolId, seatId }: { poolId: string; seatId: string }) {
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const toast = useToast()
  const navigate = useNavigate()
  const pools = useQuery<PoolRec>('pools', { limit: 200 })
  const seatsQ = useQuery<SeatRec>('seats', { where: { poolId } })
  const privQ = useQuery<PoolPrivateRec>('poolPrivate', { where: { poolId }, limit: 1 })
  const chat = useQuery<ConversationRec>('conversations', { where: { kind: 'pool', poolId }, limit: 1 }).records[0]
  const [busy, setBusy] = useState<string | null>(null)
  const now = useNow()

  const pool = pools.records.find((p) => p.recordId === poolId)?.data
  const seats = seatsQ.records.filter((s) => s.data.status === 'active')
  const me = seats.find((s) => s.recordId === seatId)
  const priv = privQ.records[0]?.data
  const isOrganizer = pool?.organizerId === userId

  const money = useMemo(() => {
    if (!pool || seats.length === 0) return null
    const total = quoteTotalCents(pool.quote)
    const storage = pool.hasStorage && pool.storageMonthlyCents
      ? storageSplit(pool.storageMonthlyCents, seats.map((s) => ({ seatId: s.recordId, volumeCuFt: s.data.volumeCuFt, months: Math.max(1, s.data.storageMonths || 1) })))
      : new Map<string, number>()
    const charges = poolCharges(total, seats.map((s) => ({
      seatId: s.recordId, userId: s.data.userId, volumeCuFt: s.data.volumeCuFt, isOrganizer: !!s.data.isOrganizer,
      extraCents: s.data.extraCents ?? 0, storageCents: storage.get(s.recordId) ?? 0,
    })), pool.organizerDiscountPct)
    const mine = charges.get(seatId)
    return { total, mineCents: mine?.total ?? 0, mineFee: mine?.fee ?? 0 }
  }, [pool, seats, seatId])

  if (!pool) return <div className="h-64 animate-pulse rounded-2xl bg-card" />

  if (pool.status === 'completed' || pool.status === 'cancelled') {
    return <FinishedCard pool={pool} poolId={poolId} paidCents={money?.mineCents ?? null} />
  }

  const usable = usableCuFt(pool.capacityCuFt, pool.bufferPct)
  const used = seats.reduce((a, s) => a + s.data.volumeCuFt, 0)
  const left = Math.max(0, Math.round(usable - used))
  const moveDay = new Date(`${pool.date}T${pool.departureTime ?? '09:00'}:00`)
  const st = STATUS[pool.status]

  async function run(key: string, fn: () => Promise<{ success: boolean; error?: string }>, ok: string) {
    setBusy(key)
    const r = await fn()
    setBusy(null)
    if (r.success) return toast.success(ok)
    const wallet = walletUrlFor(r as { success: boolean; code?: string }, '/home')
    if (wallet) { toast.error('Top up your wallet', r.error); navigate(wallet); return }
    toast.error('Not done', r.error)
  }
  const fee = dollars(CONFIG.fees.cancelCents)
  async function invite() {
    const each = money ? Math.round(money.total / (seats.length + 1) / 100) : null
    const how = await shareInvite(poolId, inviteText(pool!, left, each))
    if (how === 'clipboard') toast.success('Invite copied', 'Paste it in your group chat.')
    if (how) api.track('share_copied', { how, seats: seats.length, leftCuFt: left, from: 'hub' }, poolId)
  }

  return (
    <div className="space-y-4" data-testid="pool-hub">
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="bg-primary px-4 py-3 text-primary-foreground">
          <p className="text-xs font-semibold opacity-85">{VEHICLES[pool.vehicleType]?.label} · {isOrganizer ? 'you organize' : 'you joined'}</p>
          <h1 className="mt-0.5 text-xl font-extrabold leading-tight">
            {pool.moveType === 'city' ? `${pool.fromCity} → ${pool.toCity}` : `${pool.areaLabel || 'Campus'} → ${pool.destinationLabel}`}
          </h1>
          <p className="mt-1 text-sm opacity-90">
            {moveDay.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, leaves {pool.departureTime ?? 'time TBD'}
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${st.cls}`}>{st.text}</span>
            <span className="text-xs font-semibold text-muted-foreground" data-testid="countdown">
              {pool.status === 'open' ? `Closes in ${until(pool.deadlineAt, now)}` : pool.status === 'locked' ? `Move day in ${until(moveDay.getTime(), now)}` : ''}
            </span>
          </div>
          <div className="mt-3">
            <TruckLoad capacityCuFt={pool.capacityCuFt} usableCuFt={usable} vehicleLabel={`${seats.length} ${seats.length === 1 ? 'person' : 'people'} on board`}
              segments={(() => {
                const order = stopOrder(seats, priv?.stops)
                return seats.map((s) => ({ label: s.recordId === seatId ? 'You' : getName(s.data.userId) ?? 'Member', cuFt: s.data.volumeCuFt, fragileCuFt: s.data.fragileCuFt ?? 0, mine: s.recordId === seatId, order: order.get(s.recordId) }))
              })()} />
          </div>
          <div className="mt-4 flex items-end justify-between gap-3 rounded-xl bg-secondary p-3">
            <div>
              <p className="text-xs text-muted-foreground">You pay</p>
              <p className="text-2xl font-black text-foreground" data-testid="hub-share">{money ? dollars(money.mineCents) : '—'}</p>
            </div>
            <p className="text-right text-xs text-muted-foreground">
              incl. {money ? dollars(money.mineFee) : ''} service fee · {me?.data.volumeCuFt} of {used} cu ft<br />
              {pool.status === 'open' ? 'Taken from your wallet when the pool locks' : pool.status === 'locked' ? '🔒 Held from your wallet' : 'Paid'}
              {pool.quoteIsEstimate ? ' · price is an estimate' : ''}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border p-3 sm:grid-cols-4">
          <Action icon={ChevronRight} label="Details" onClick={() => navigate(`/pools/${poolId}`)} />
          {chat && <Action icon={MessageCircle} label={isUnread(chat.data, userId ?? '') ? 'Group chat •' : 'Group chat'} onClick={() => navigate(`/messages/${chat.recordId}`)} />}
          {pool.status === 'open' && <Action icon={Share2} label="Invite" onClick={invite} primary />}
          {pool.status === 'open' && <Action icon={Pencil} label="Edit my stuff" onClick={() => navigate('/move')} />}
          {isOrganizer && pool.status === 'open' && (
            <Action icon={Lock} label={seats.length === 1 ? 'Lock & go solo' : 'Lock pool'} busy={busy === 'lock'} onClick={() => {
              if (seats.length === 1 && !window.confirm(`Nobody has joined yet. Lock and move on your own? You'll pay the full ${money ? dollars(money.total) : 'price'}.`)) return
              void run('lock', () => api.lockPool(poolId), 'Locked. You are set for move day.')
            }} />
          )}
          {(pool.status === 'open' || pool.status === 'locked') && !(isOrganizer && seats.length === 1) && (
            <Action icon={LogOut} label={isOrganizer ? 'Leave (hand over)' : 'Leave'} busy={busy === 'leave'} onClick={() => {
              const late = pool.status === 'locked'
              const msg = isOrganizer
                ? `Leave and hand this pool to the next person who joined?${late ? ` A ${fee} cancellation fee is kept from your hold.` : ''}`
                : late ? `Leaving a locked pool returns your hold minus a ${fee} cancellation fee (it goes to the people left). Leave?` : 'Leave this pool? Your space goes back to the others.'
              if (!window.confirm(msg)) return
              void run('leave', () => api.leavePool(poolId), late ? `You left. ${fee} fee applied.` : 'You left the pool')
            }} />
          )}
          {isOrganizer && seats.length === 1 && (pool.status === 'open' || pool.status === 'locked') && (
            <Action icon={X} label="Cancel pool" busy={busy === 'cancel'} onClick={() => {
              if (!window.confirm(pool.status === 'locked' ? `Cancel your solo move? Your hold comes back minus ${fee}.` : 'Cancel this pool? Nobody joined, so no fee.')) return
              void run('cancel', () => api.cancelPool(poolId), 'Pool cancelled')
            }} />
          )}
          <Action icon={Wallet} label="Wallet" onClick={() => navigate('/wallet')} />
          {isOrganizer && pool.status === 'locked' && (
            <Action icon={Check} label="Mark move done" busy={busy === 'done'} onClick={() => {
              if (!window.confirm('Mark the move as done? Do this after move day: everyone\'s share is paid to you for the truck, and it can\'t be undone or cancelled afterwards.')) return
              void run('done', () => api.completePool(poolId), 'Marked done. Nice move!')
            }} />
          )}
        </div>
      </section>

      {priv && priv.stops.length > 1 && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-bold text-foreground">Your pool</h2>
          <ul className="mt-2 divide-y divide-border">
            {[...priv.stops].sort((a, b) => a.order - b.order).map((s) => {
              const href = s.contact ? contactHref(s.contact) : null
              const name = s.userId === userId ? 'You' : getName(s.userId) ?? 'Member'
              return (
                <li key={s.seatId} className="flex items-center gap-3 py-2 text-sm">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary font-bold text-foreground">{name[0]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{name}{s.userId === pool.organizerId ? ' · organizer' : ''}</p>
                    <p className="truncate text-xs text-muted-foreground">Pickup #{s.order} · {s.label}</p>
                  </div>
                  {s.userId !== userId && s.contact && (href
                    ? <a href={href} target="_blank" rel="noreferrer" className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">{CONTACT_LABEL[s.contact.method]}</a>
                    : <button type="button" className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
                        onClick={() => { void navigator.clipboard.writeText(s.contact!.handle); toast.success('Copied', `${CONTACT_LABEL[s.contact!.method]} ID: ${s.contact!.handle}`) }}>
                        {CONTACT_LABEL[s.contact.method]}
                      </button>)}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {me && <Checklist poolId={poolId} boxCode={me.data.boxCode} paid={!!me.data.paid} isOrganizer={isOrganizer} share={money ? dollars(money.mineCents) : null} hasFragile={(me.data.fragileCuFt ?? 0) > 0} />}
    </div>
  )
}

function Action({ icon: Icon, label, onClick, primary, busy }: { icon: typeof Truck; label: string; onClick: () => void; primary?: boolean; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-bold disabled:opacity-60 ${primary ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-muted'}`}>
      <Icon className="size-4" aria-hidden />{label}
    </button>
  )
}

/** Move-day checklist. Ticks are per person, per pool, kept in this browser. */
function Checklist({ poolId, boxCode, paid, isOrganizer, share, hasFragile }: { poolId: string; boxCode?: string; paid: boolean; isOrganizer: boolean; share: string | null; hasFragile: boolean }) {
  const key = `hp_check_${poolId}`
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean> } catch { return {} }
  })
  const toggle = (id: string) => {
    const next = { ...done, [id]: !done[id] }
    setDone(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* private mode: keep in memory */ }
  }
  const items = [
    { id: 'label', text: `Label every box with ${boxCode ?? 'your code'} so it gets off at the right stop` },
    ...(hasFragile ? [{ id: 'fragile', text: 'Wrap fragile things and mark them FRAGILE — they ride on top of your stuff' }] : []),
    { id: 'time', text: 'Confirm pickup time and spot with your pool' },
    { id: 'ready', text: 'Have everything packed and by the door 30 minutes before pickup' },
    ...(isOrganizer ? [{ id: 'book', text: 'Book the truck, then Details → "Edit truck & price" with the real price' }] : []),
    { id: 'wallet', text: `Keep at least ${share ?? 'your share'} in your wallet — it's held when the pool locks`, auto: paid },
  ]
  const count = items.filter((i) => ('auto' in i && i.auto) || done[i.id]).length
  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-testid="checklist">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold text-foreground">Move-day checklist</h2>
        <span className="text-xs font-semibold text-muted-foreground">{count} of {items.length}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {items.map((i) => {
          const on = ('auto' in i && i.auto) || !!done[i.id]
          return (
            <li key={i.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 text-sm hover:bg-secondary">
                <input type="checkbox" checked={on} onChange={() => toggle(i.id)} disabled={'auto' in i && i.auto} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                <span className={on ? 'text-muted-foreground line-through' : 'text-foreground'}>{i.text}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ------------------------------------------------------------------ no pool yet

function NoPool({ draft }: { draft?: DraftRec }) {
  const complete = !!(draft?.date && draft.pickup && draft.destination && (draft.items ?? []).length > 0)
  const openPools = useQuery<PoolRec>('pools', { where: { status: 'open' }, limit: 200 })
  const flex = draft?.flexDays ?? CONFIG.dates.flexDefaultDays
  const navigate = useNavigate()

  if (!complete) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-primary p-5 text-primary-foreground">
          <h1 className="text-2xl font-black leading-tight">Moving out soon?</h1>
          <p className="mt-1 text-sm opacity-90">Tell us your day and your stuff. We'll find people heading the same way so you split one truck.</p>
          <Link to="/move"><Button className="mt-4 bg-white text-primary hover:bg-white/90">{draft ? 'Finish planning my move' : 'Plan my move'}</Button></Link>
        </div>
        <ol className="space-y-2">
          {[['Tell us your move', 'Date, where from and to, and your stuff — scan your room or tap a preset.'], ['Join or start a truck', 'Same day and on the way, around town or city to city.'], ['Split by space', 'Pay for the space your stuff takes, to the cent.']].map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-tape)] font-black text-[#3b2c00]">{i + 1}</span>
              <div><p className="font-bold text-foreground">{t}</p><p className="text-sm text-muted-foreground">{d}</p></div>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  const trucks = openPools.records.filter((p) => draft?.date && Math.abs(daysBetween(draft.date, p.data.date)) <= flex).length
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-semibold text-muted-foreground">Your move</p>
        <h1 className="mt-0.5 text-xl font-extrabold leading-tight text-foreground">
          {new Date(`${draft!.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {draft!.pickup!.cityLabel && draft!.moveType === 'city' ? `${draft!.pickup!.cityLabel} → ${draft!.destination!.cityLabel ?? draft!.destination!.label}` : `${draft!.pickup!.label} → ${draft!.destination!.label}`}
          {' · '}{draft!.volumeCuFt} cu ft
        </p>
        <button type="button" onClick={() => navigate('/move')} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary"><Pencil className="size-3.5" />Edit</button>
      </section>

      <section className="rounded-2xl bg-primary p-4 text-primary-foreground">
        <p className="text-3xl font-black">{trucks}</p>
        <p className="text-sm opacity-90">{trucks === 1 ? 'truck is' : 'trucks are'} leaving {flex ? `within ${flex} day${flex > 1 ? 's' : ''} of your date` : 'that day'} so far</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="bg-white text-primary hover:bg-white/90" onClick={() => navigate('/search')}>{trucks > 0 ? 'See which fit me' : 'Check for matches'}</Button>
          <Button variant="outline" className="border-white/70 bg-transparent text-white hover:bg-white/10" onClick={() => navigate('/pools/new')}>Start my own truck</Button>
        </div>
      </section>
      {!draft!.contact && (
        <p className="rounded-xl border border-border bg-card p-3 text-sm text-foreground">
          📞 Add how your pool can reach you before joining. <Link to="/move" className="font-semibold text-primary">Add contact</Link>
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ helpers

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function until(t: number, now: number): string {
  const d = Math.max(0, t - now)
  const days = Math.floor(d / 86_400_000)
  const hours = Math.floor((d % 86_400_000) / 3_600_000)
  if (days > 0) return `${days}d ${hours}h`
  const mins = Math.floor((d % 3_600_000) / 60_000)
  return d === 0 ? 'now' : `${hours}h ${mins}m`
}

/** A pool that's over (done or closed): say what happened and let the person start their next move. */
function FinishedCard({ pool, poolId, paidCents }: { pool: PoolRec; poolId: string; paidCents: number | null }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const done = pool.status === 'completed'
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="finished">
      <div className={`px-4 py-4 ${done ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}>
        <p className="text-sm font-semibold opacity-85">{done ? 'Move done 🎉' : 'This pool closed'}</p>
        <h1 className="mt-0.5 text-xl font-extrabold leading-tight">{pool.moveType === 'city' ? `${pool.fromCity} → ${pool.toCity}` : `${pool.areaLabel || 'Campus'} → ${pool.destinationLabel}`}</h1>
        <p className="mt-1 text-sm opacity-90">{new Date(`${pool.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
      </div>
      <div className="space-y-3 p-4 text-sm text-foreground">
        <p>
          {done
            ? `Finished and settled${paidCents !== null ? ` — you paid ${dollars(paidCents)} from your wallet` : ''}. A finished move can't be cancelled; it's kept in your wallet history.`
            : pool.cancelReason === 'not_filled' ? 'Nobody joined before the deadline, so it closed. No fee was charged.' : 'It was cancelled.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} onClick={async () => {
            setBusy(true)
            const r = await api.releaseFinished()
            setBusy(false)
            if (!r.success) return toast.error('Not done', r.error)
            navigate('/move')
          }} data-testid="next-move">Plan my next move</Button>
          <Button variant="outline" onClick={() => navigate(`/pools/${poolId}`)}>See details</Button>
          <Button variant="outline" onClick={() => navigate('/wallet')}>Wallet</Button>
        </div>
      </div>
    </section>
  )
}
