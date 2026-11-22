import { CONFIG } from '../config'

/**
 * Optimistic version lock built on `uniqueOn` (spec §11).
 *
 * DeepSpace serializes single writes inside the Durable Object but has no compare-and-swap,
 * and a server action's read and write are separate requests. `uniqueOn: ['poolId', 'version']`
 * on `poolVersions` gives an atomic "claim the next version" primitive: whoever inserts v+1
 * first wins; everyone else re-reads and retries.
 *
 * The store is injected so this exact code runs in unit tests (fake store) and in the server
 * action (adapter over `tools.create / tools.query / tools.update`).
 */

export type PoolStatus = 'open' | 'locked' | 'in_progress' | 'completed' | 'cancelled'

export interface Snapshot {
  status: PoolStatus
  usableCuFt: number
  seats: SnapshotSeat[]
}

/** Seat as recorded in the ledger. Pickup coordinates live here (ledger is not client-readable). */
export interface SnapshotSeat {
  seatId: string
  userId: string
  volumeCuFt: number
  isOrganizer?: boolean
  pickup?: { label: string; lat: number; lng: number }
  storageMonths?: number
}

export const usedCuFt = (s: Snapshot) => s.seats.reduce((a, x) => a + x.volumeCuFt, 0)

export interface LockStore {
  /** Latest ledger entry for the pool (highest version). */
  head(poolId: string): Promise<{ version: number; snapshot: Snapshot }>
  /** Insert version row. Resolves false on a uniqueOn duplicate, true on success. */
  claimVersion(poolId: string, version: number, op: string, actorId: string, snapshot: Snapshot): Promise<boolean>
  /** Insert a pending seat with activeUserKey = userId. Resolves false on duplicate (user already active elsewhere). */
  reserveUser(seatId: string, poolId: string, userId: string, volumeCuFt: number): Promise<boolean>
  setSeatStatus(seatId: string, status: 'active' | 'rejected' | 'left'): Promise<void>
  sleep(ms: number): Promise<void>
  now(): number
}

export type JoinResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'already_in_a_pool' | 'full' | 'closed' | 'busy' }

export async function joinPool(
  store: LockStore,
  args: { poolId: string; seatId: string; userId: string; volumeCuFt: number; deadlineAt: number; seat?: Partial<SnapshotSeat> },
): Promise<JoinResult> {
  const { poolId, seatId, userId, volumeCuFt } = args
  if (!(await store.reserveUser(seatId, poolId, userId, volumeCuFt))) return { ok: false, reason: 'already_in_a_pool' }

  for (let attempt = 0; attempt < CONFIG.lock.maxRetries; attempt++) {
    const { version, snapshot } = await store.head(poolId)
    if (snapshot.status !== 'open' || store.now() >= args.deadlineAt) {
      await store.setSeatStatus(seatId, 'rejected')
      return { ok: false, reason: 'closed' }
    }
    if (usedCuFt(snapshot) + volumeCuFt > snapshot.usableCuFt) {
      await store.setSeatStatus(seatId, 'rejected')
      return { ok: false, reason: 'full' }
    }
    const next: Snapshot = { ...snapshot, seats: [...snapshot.seats, { ...args.seat, seatId, userId, volumeCuFt }] }
    if (await store.claimVersion(poolId, version + 1, 'join', userId, next)) {
      await store.setSeatStatus(seatId, 'active')
      return { ok: true, version: version + 1 }
    }
    const { backoffMinMs, backoffMaxMs } = CONFIG.lock
    await store.sleep(backoffMinMs + Math.random() * (backoffMaxMs - backoffMinMs))
  }
  await store.setSeatStatus(seatId, 'rejected')
  return { ok: false, reason: 'busy' }
}

/** Any other change to a pool (leave, lock, cancel, change vehicle) goes through the same claim loop. */
export async function changePool(
  store: LockStore,
  args: { poolId: string; actorId: string; op: string; apply: (s: Snapshot) => Snapshot | { error: string } },
): Promise<{ ok: true; version: number; snapshot: Snapshot } | { ok: false; reason: string }> {
  for (let attempt = 0; attempt < CONFIG.lock.maxRetries; attempt++) {
    const { version, snapshot } = await store.head(args.poolId)
    const next = args.apply(snapshot)
    if ('error' in next) return { ok: false, reason: next.error }
    if (await store.claimVersion(args.poolId, version + 1, args.op, args.actorId, next)) {
      return { ok: true, version: version + 1, snapshot: next }
    }
    const { backoffMinMs, backoffMaxMs } = CONFIG.lock
    await store.sleep(backoffMinMs + Math.random() * (backoffMaxMs - backoffMinMs))
  }
  return { ok: false, reason: 'busy' }
}

/**
 * Lock with whoever is in: 1 person (the organizer goes solo and pays the full price), 2, or more.
 * Changed 11/19: requiring 2+ trapped organizers whose truck nobody else fit into.
 */
export const lockOp = (s: Snapshot): Snapshot | { error: string } =>
  s.status !== 'open' ? { error: `cannot lock a ${s.status} pool` }
    : s.seats.length < 1 ? { error: 'nobody is in this pool' }
      : { ...s, status: 'locked' }

/** A member changed their item list: grow/shrink their seat, never past the truck's usable space. */
export const seatResizeOp = (seatId: string, newCuFt: number) => (s: Snapshot): Snapshot | { error: string } => {
  if (s.status !== 'open') return { error: 'This pool is locked, so your stuff can no longer change. Talk to your organizer.' }
  const seat = s.seats.find((x) => x.seatId === seatId)
  if (!seat) return { error: 'not in this pool' }
  const others = usedCuFt(s) - seat.volumeCuFt
  if (others + newCuFt > s.usableCuFt) {
    return { error: `That's ${newCuFt} cu ft, but your truck only has ${Math.max(0, s.usableCuFt - others)} cu ft for you. Remove some items, or leave this pool and find a bigger truck.` }
  }
  return { ...s, seats: s.seats.map((x) => (x.seatId === seatId ? { ...x, volumeCuFt: newCuFt } : x)) }
}

export const leaveOp = (seatId: string) => (s: Snapshot): Snapshot | { error: string } =>
  s.status !== 'open'
    ? { error: 'after lock you cannot leave; the organizer can remove you and you still owe your share' }
    : s.seats.some((x) => x.seatId === seatId)
      ? { ...s, seats: s.seats.filter((x) => x.seatId !== seatId) }
      : { error: 'not in this pool' }

/** Leave a LOCKED pool (allowed since 11/19, with a cancellation fee handled by the wallet). */
export const leaveLockedOp = (seatId: string) => (s: Snapshot): Snapshot | { error: string } =>
  s.status !== 'locked' ? { error: `cannot leave-late a ${s.status} pool` }
    : !s.seats.some((x) => x.seatId === seatId) ? { error: 'not in this pool' }
      : s.seats.length === 1 ? { error: 'you are the only one; cancel the pool instead' }
        : { ...s, seats: s.seats.filter((x) => x.seatId !== seatId) }

/**
 * The organizer leaves: the next person who joined (ledger order) becomes organizer and the
 * pool carries on. Works open or locked.
 */
export const transferOp = (organizerSeatId: string) => (s: Snapshot): Snapshot | { error: string } => {
  if (s.status !== 'open' && s.status !== 'locked') return { error: `cannot change a ${s.status} pool` }
  const rest = s.seats.filter((x) => x.seatId !== organizerSeatId)
  if (rest.length === s.seats.length) return { error: 'not in this pool' }
  if (rest.length === 0) return { error: 'you are the only one; cancel the pool instead' }
  return { ...s, seats: rest.map((x, i) => ({ ...x, isOrganizer: i === 0 })) }
}

/** Move a seat's pickup point (address change while in a pool). Detour limits are checked by the caller. */
export const seatPickupOp = (seatId: string, pickup: { label: string; lat: number; lng: number }) => (s: Snapshot): Snapshot | { error: string } =>
  s.status !== 'open' && s.status !== 'locked' ? { error: `cannot change a ${s.status} pool` }
    : !s.seats.some((x) => x.seatId === seatId) ? { error: 'not in this pool' }
      : { ...s, seats: s.seats.map((x) => (x.seatId === seatId ? { ...x, pickup } : x)) }

export const cancelOp = (s: Snapshot): Snapshot | { error: string } =>
  s.status !== 'open' && s.status !== 'locked' ? { error: `cannot cancel a ${s.status} pool` }
    : s.seats.length > 1 ? { error: 'others are in this pool; leave instead and the next person becomes organizer' }
      : { ...s, status: 'cancelled', seats: [] }

export const resizeOp = (newUsableCuFt: number) => (s: Snapshot): Snapshot | { error: string } =>
  usedCuFt(s) > newUsableCuFt
    ? { error: `new vehicle holds ${newUsableCuFt} cu ft but ${usedCuFt(s)} is already booked` }
    : { ...s, usableCuFt: newUsableCuFt }
