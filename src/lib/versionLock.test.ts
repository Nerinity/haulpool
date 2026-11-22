import { describe, expect, it } from 'vitest'
import { joinPool, changePool, lockOp, leaveOp, resizeOp, seatResizeOp, leaveLockedOp, transferOp, cancelOp, usedCuFt, type LockStore, type Snapshot } from './versionLock'

/**
 * Fake Durable Object: every method is one atomic step, and each call yields a random number
 * of macrotask ticks first, so concurrent joins interleave unpredictably — like separate
 * requests from different worker invocations.
 */
function makeStore(seed: number, usableCuFt: number) {
  let r = seed
  const rand = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const jitter = () => new Promise<void>((res) => setTimeout(res, Math.floor(rand() * 3)))
  const versions = new Map<number, Snapshot>([[0, { status: 'open', usableCuFt, seats: [] }]])
  const activeUsers = new Set<string>()
  const seats = new Map<string, { userId: string; status: string }>()
  const store: LockStore = {
    async head() { await jitter(); const v = Math.max(...versions.keys()); return { version: v, snapshot: versions.get(v)! } },
    async claimVersion(_p, v, _op, _a, snap) { await jitter(); if (versions.has(v)) return false; versions.set(v, snap); return true },
    async reserveUser(seatId, _p, userId) { await jitter(); if (activeUsers.has(userId)) return false; activeUsers.add(userId); seats.set(seatId, { userId, status: 'pending' }); return true },
    async setSeatStatus(seatId, status) { await jitter(); const s = seats.get(seatId)!; s.status = status; if (status !== 'active') activeUsers.delete(s.userId) },
    sleep: () => jitter(),
    now: () => 0,
  }
  return { store, versions, seats }
}

describe('version lock under concurrency', () => {
  it('never overbooks, never admits after lock, seats match the ledger (300 random runs)', async () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { store, versions, seats } = makeStore(seed, 100)
      const vols = [20, 30, 40, 50, 20, 30, 40, 50]
      const joins = vols.map((v, i) =>
        joinPool(store, { poolId: 'p', seatId: `seat${i}`, userId: `u${i}`, volumeCuFt: v, deadlineAt: 1 }))
      // same user double-clicks in a second tab
      joins.push(joinPool(store, { poolId: 'p', seatId: 'seat0-dup', userId: 'u0', volumeCuFt: 20, deadlineAt: 1 }))
      const locking = changePool(store, { poolId: 'p', actorId: 'u0', op: 'lock', apply: lockOp })
      await Promise.all([...joins, locking])

      const headV = Math.max(...versions.keys())
      const head = versions.get(headV)!
      expect(usedCuFt(head)).toBeLessThanOrEqual(100)
      const active = [...seats.entries()].filter(([, s]) => s.status === 'active').map(([id]) => id).sort()
      expect(active).toEqual(head.seats.map((s) => s.seatId).sort())
      const users = head.seats.map((s) => s.userId)
      expect(new Set(users).size).toBe(users.length)
      const lockedAt = [...versions.entries()].filter(([, s]) => s.status === 'locked').map(([v]) => v)
      if (lockedAt.length) {
        for (const [v, s] of versions) if (v > lockedAt[0]) expect(s.seats).toEqual(versions.get(lockedAt[0])!.seats)
      }
    }
  }, 60_000)

  it('naive read-then-write DOES overbook (why the lock exists)', async () => {
    let over = 0
    for (let seed = 1; seed <= 100; seed++) {
      let used = 0
      let r = seed
      const tick = () => new Promise<void>((res) => setTimeout(res, (r = (r * 48271) % 2147483647) % 3))
      await Promise.all([20, 30, 40, 50, 20, 30, 40, 50].map(async (v) => {
        await tick(); const seen = used
        await tick(); if (seen + v <= 100) used = used + v
      }))
      if (used > 100) over++
    }
    expect(over).toBeGreaterThan(50)
  })
})

describe('pool changes', () => {
  const s: Snapshot = { status: 'open', usableCuFt: 611, seats: [{ seatId: 'a', userId: 'u', volumeCuFt: 300 }] }
  it('cannot shrink below what is booked (spec §11, E4)', () => {
    expect(resizeOp(250)(s)).toEqual({ error: 'new vehicle holds 250 cu ft but 300 is already booked' })
    expect(resizeOp(400)(s)).toMatchObject({ usableCuFt: 400 })
  })
  it('organizer can lock alone or with anyone (changed 11/19)', () => {
    expect(lockOp(s)).toMatchObject({ status: 'locked' })
    expect(lockOp({ ...s, seats: [...s.seats, { seatId: 'b', userId: 'v', volumeCuFt: 10 }] })).toMatchObject({ status: 'locked' })
    expect('error' in lockOp({ ...s, status: 'locked' })).toBe(true)
  })
  it('a member can resize their seat only within the free space, and only while open', () => {
    const two: Snapshot = { ...s, usableCuFt: 400, seats: [...s.seats, { seatId: 'b', userId: 'v', volumeCuFt: 50 }] }
    expect(seatResizeOp('b', 100)(two)).toMatchObject({ seats: [{ volumeCuFt: 300 }, { volumeCuFt: 100 }] })
    expect(seatResizeOp('b', 101)(two)).toEqual({ error: expect.stringContaining('only has 100 cu ft for you') })
    expect('error' in seatResizeOp('b', 60)({ ...two, status: 'locked' })).toBe(true)
  })
  it('cannot leave after lock (spec §6.5)', () => {
    expect('error' in leaveOp('a')({ ...s, status: 'locked' })).toBe(true)
    expect(leaveOp('a')(s)).toMatchObject({ seats: [] })
  })
  it('after lock you can still leave (fee is the wallet\'s job), but not as the last person', () => {
    const two: Snapshot = { ...s, status: 'locked', seats: [...s.seats, { seatId: 'b', userId: 'v', volumeCuFt: 10 }] }
    expect(leaveLockedOp('b')(two)).toMatchObject({ seats: [{ seatId: 'a' }] })
    expect('error' in leaveLockedOp('a')({ ...s, status: 'locked' })).toBe(true)
  })
  it('organizer leaving hands the pool to the next person who joined', () => {
    const three: Snapshot = { ...s, seats: [{ seatId: 'a', userId: 'u', volumeCuFt: 10, isOrganizer: true }, { seatId: 'b', userId: 'v', volumeCuFt: 10 }, { seatId: 'c', userId: 'w', volumeCuFt: 10 }] }
    expect(transferOp('a')(three)).toMatchObject({ seats: [{ seatId: 'b', isOrganizer: true }, { seatId: 'c', isOrganizer: false }] })
    expect('error' in transferOp('a')(s)).toBe(true)
  })
  it('only a pool with one person can be cancelled', () => {
    expect(cancelOp(s)).toMatchObject({ status: 'cancelled', seats: [] })
    expect('error' in cancelOp({ ...s, seats: [...s.seats, { seatId: 'b', userId: 'v', volumeCuFt: 1 }] })).toBe(true)
  })
})
