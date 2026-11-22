import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { totalCuFt, usableCuFt, mediumBoxEquivalent, VolumeError } from './volume'
import { bestInsertion, detourCapMi, roundForDisplay } from './route'
import { allocate, truckSplit, storageSplit, quoteTotalCents, explainShare } from './split'
import { rankPools, type PoolCandidate, type MatchRequest } from './match'

// Illustrative Pittsburgh coordinates used in spec §5.2
const CMU = { lat: 40.4433, lng: -79.9436 }
const OAK = { lat: 40.441, lng: -79.957 }
const SHADY = { lat: 40.455, lng: -79.933 }
const SQH = { lat: 40.438, lng: -79.923 }
const FAR = { lat: 40.49, lng: -79.92 }
const STORE = { lat: 40.43, lng: -79.98 }
const WEST = { lat: 40.42, lng: -80.06 } // beyond the storage, opposite side from Shadyside
const ELSEWHERE = { lat: 40.47, lng: -79.9 }

describe('volume', () => {
  it('sums presets and rounds up', () => {
    expect(totalCuFt([{ kind: 'preset', key: 'box_medium', qty: 10 }, { kind: 'preset', key: 'mini_fridge', qty: 1 }])).toBe(36)
    expect(totalCuFt([{ kind: 'custom', name: 'lamp', qty: 1, lengthIn: 12, widthIn: 12, heightIn: 13 }])).toBe(2) // 1.08 → 2
  })
  it('rejects bad input the client might send', () => {
    expect(() => totalCuFt([{ kind: 'preset', key: 'box_small', qty: 31 }])).toThrow(VolumeError)
    expect(() => totalCuFt([{ kind: 'preset', key: 'box_small', qty: 0 }])).toThrow(VolumeError)
    expect(() => totalCuFt([{ kind: 'custom', name: 'x', qty: 1, lengthIn: 100, widthIn: 100, heightIn: 100 }])).toThrow(VolumeError)
  })
  it('15 ft truck with 20% buffer has 611 usable cu ft (spec §6.1)', () => {
    expect(usableCuFt(764, 20)).toBe(611)
    expect(usableCuFt(764, 90)).toBe(Math.floor(764 * 0.65)) // clamped to 35%
  })
  it('converts to medium boxes', () => expect(mediumBoxEquivalent(36)).toBe(12))
})

describe('route (spec §5.2 table)', () => {
  const pool = [OAK, CMU]
  const cases: [string, typeof SHADY, number, boolean][] = [
    ['Carol Shadyside', SHADY, 2.07, true],
    ['Dave Squirrel Hill', SQH, 2.34, true],
    ['Erin far north', FAR, 5.08, false],
  ]
  it.each(cases)('%s', (_n, p, detour, ok) => {
    const ins = bestInsertion(pool, STORE, p)
    expect(ins.baseMi).toBeCloseTo(3.7, 1)
    expect(ins.detourMi).toBeCloseTo(detour, 2)
    expect(ins.detourMi <= detourCapMi(ins.baseMi)).toBe(ok)
  })
  it('cap is clamped to 3–25 miles', () => {
    expect(detourCapMi(2)).toBe(3)
    expect(detourCapMi(100)).toBe(15)
    expect(detourCapMi(332)).toBe(25)
  })
  it('rounds displayed distances to 0.5 mi, never 0', () => {
    expect(roundForDisplay(0.1)).toBe(0.5)
    expect(roundForDisplay(1.14)).toBe(1)
    expect(roundForDisplay(2.3)).toBe(2.5)
  })
})

describe('split (spec §6.4 table)', () => {
  const T = quoteTotalCents({ baseDayCents: 2995, perMileCents: 119, miles: 12, fuelCents: 1000, otherCents: 0 })
  const seats = [
    { seatId: 'alice', volumeCuFt: 120, isOrganizer: true },
    { seatId: 'bob', volumeCuFt: 90, isOrganizer: false },
    { seatId: 'carol', volumeCuFt: 150, isOrganizer: false },
    { seatId: 'dave', volumeCuFt: 60, isOrganizer: false },
  ]
  it('truck total is $54.23', () => expect(T).toBe(5423))
  it('matches the worked example with a 10% organizer discount', () => {
    const s = truckSplit(T, seats, 10)
    expect([...s.values()]).toEqual([1394, 1209, 2014, 806])
  })
  it('storage matches the worked example ($144/mo, months 4/4/2/3)', () => {
    const s = storageSplit(14400, seats.map((x, i) => ({ seatId: x.seatId, volumeCuFt: x.volumeCuFt, months: [4, 4, 2, 3][i] })))
    expect([...s.values()]).toEqual([22857, 17143, 10286, 7314])
  })
  it('two people, $100/mo, 2 vs 4 months → $100 / $300 (spec §6.3)', () => {
    const s = storageSplit(10000, [{ seatId: 'a', volumeCuFt: 1, months: 2 }, { seatId: 'b', volumeCuFt: 1, months: 4 }])
    expect([...s.values()]).toEqual([10000, 30000])
  })
  it('no discount when the organizer is alone', () => {
    expect(truckSplit(T, [seats[0]], 10).get('alice')).toBe(T)
  })
  it('filling seats matters more than the discount (spec §17 U5)', () => {
    expect(truckSplit(T, seats, 10).get('alice')).toBe(1394)
    expect(truckSplit(T, seats.slice(0, 2), 10).get('alice')).toBe(2789)
  })
  it('explanation is a template with the computed numbers', () => {
    expect(explainShare({ myCuFt: 90, totalCuFt: 420, truckCents: 1209, storageCents: 17143, months: 4 }))
      .toBe('Your items take 21% of the loaded space, so your truck share is $12.09, plus $171.43 for 4 month(s) of storage.')
  })

  it('PROPERTY: every split sums exactly to its total, no negatives', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200_000 }),
        fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 25 }),
        fc.nat(),
        (total, vols, d, orgPick) => {
          const org = orgPick % vols.length
          const s = truckSplit(total, vols.map((v, i) => ({ seatId: `s${i}`, volumeCuFt: v, isOrganizer: i === org })), d)
          const vals = [...s.values()]
          return vals.reduce((a, b) => a + b, 0) === total && vals.every((v) => v >= 0)
        },
      ),
      { numRuns: 10_000 },
    )
  })
  it('PROPERTY: storage split sums to rent × longest stay', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40_000 }),
        fc.array(fc.record({ v: fc.integer({ min: 1, max: 400 }), m: fc.integer({ min: 1, max: 6 }) }), { minLength: 1, maxLength: 8 }),
        (rent, xs) => {
          const s = storageSplit(rent, xs.map((x, i) => ({ seatId: `s${i}`, volumeCuFt: x.v, months: x.m })))
          const sum = [...s.values()].reduce((a, b) => a + b, 0)
          return sum === rent * Math.max(...xs.map((x) => x.m))
        },
      ),
      { numRuns: 5_000 },
    )
  })
  it('allocate is exact even for awkward totals', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
  })
})

describe('matching', () => {
  const quote = { baseDayCents: 2995, perMileCents: 119, miles: 12, fuelCents: 1000, otherCents: 0 }
  const base: Omit<PoolCandidate, 'poolId' | 'pickups'> = {
    date: '2026-12-15', status: 'open', deadlineAt: Date.parse('2026-12-14T23:00:00Z'),
    usableCuFt: 611, usedCuFt: 210, destination: STORE, destinationKey: 'store-1', quote, organizerDiscountPct: 10,
    seats: [{ seatId: 'a', volumeCuFt: 120, isOrganizer: true }, { seatId: 'b', volumeCuFt: 90, isOrganizer: false }],
  }
  const now = Date.parse('2026-12-10T12:00:00Z')
  const req: MatchRequest = { userId: 'carol', date: '2026-12-15', pickup: SHADY, destination: STORE, destinationKey: 'store-1', volumeCuFt: 150 }

  it('filters by date, status, capacity and detour', () => {
    const pools: PoolCandidate[] = [
      { ...base, poolId: 'ok', pickups: [OAK, CMU] },
      { ...base, poolId: 'wrong-day', pickups: [OAK, CMU], date: '2026-12-16' },
      { ...base, poolId: 'locked', pickups: [OAK, CMU], status: 'locked' },
      { ...base, poolId: 'full', pickups: [OAK, CMU], usedCuFt: 500 },
      { ...base, poolId: 'off-route', pickups: [WEST] },
      { ...base, poolId: 'other-storage', pickups: [OAK, CMU], destination: ELSEWHERE, destinationKey: 'store-2' },
    ]
    expect(rankPools(req, pools, now).map((r) => r.poolId)).toEqual(['ok'])
  })
  it('never returns coordinates and rounds distances', () => {
    const [r] = rankPools(req, [{ ...base, poolId: 'ok', pickups: [OAK, CMU] }], now)
    expect(Object.keys(r).sort()).toEqual(['dayDiff', 'detourMi', 'distanceMi', 'fillAfterPct', 'myShareCents', 'poolId', 'reasons', 'score'])
    expect(r.distanceMi % 0.5).toBe(0)
  })
  it('is deterministic and prefers the smaller detour', () => {
    const pools: PoolCandidate[] = [
      { ...base, poolId: 'p-cmu', pickups: [OAK, CMU] },
      { ...base, poolId: 'p-shady', pickups: [SHADY] },
    ]
    const a = rankPools(req, pools, now)
    const b = rankPools(req, [...pools].reverse(), now)
    expect(a).toEqual(b)
    expect(a[0].poolId).toBe('p-shady')
    expect(a[0].reasons).toContain('same_building')
  })
  it('falls back to near misses instead of an empty page', () => {
    const r = rankPools({ ...req, volumeCuFt: 420 }, [{ ...base, poolId: 'tight', pickups: [OAK, CMU] }], now)
    expect(r).toHaveLength(1)
    expect(r[0].nearMiss).toBe('capacity')
  })
})

describe('room presets', () => {
  it('every preset is valid and under the item cap', async () => {
    const { ROOM_PRESETS, ITEMS, ITEM_GROUPS } = await import('../config')
    const { totalCuFt } = await import('./volume')
    for (const p of ROOM_PRESETS) {
      const lines = Object.entries(p.items).map(([key, qty]) => ({ kind: 'preset' as const, key: key as keyof typeof ITEMS, qty: qty! }))
      expect(() => totalCuFt(lines)).not.toThrow()
    }
    // every item appears in exactly one group
    const grouped = ITEM_GROUPS.flatMap((g) => g.keys).sort()
    expect(grouped).toEqual(Object.keys(ITEMS).sort())
  })
})

describe('city-to-city matching', () => {
  const CMU = { lat: 40.44392, lng: -79.94283 }
  const SHADY = { lat: 40.45152, lng: -79.93655 }
  const MIDTOWN = { lat: 40.7549, lng: -73.984 }
  const WILLIAMSBURG = { lat: 40.7081, lng: -73.9571 }
  const PHILLY = { lat: 39.9526, lng: -75.1652 }
  const quote = { baseDayCents: 2995, perMileCents: 119, miles: 400, fuelCents: 14000, otherCents: 0 }
  const base: Omit<PoolCandidate, 'poolId'> = {
    date: '2026-12-15', status: 'open', deadlineAt: Date.parse('2026-12-14T23:00:00Z'),
    usableCuFt: 611, usedCuFt: 120, pickups: [CMU], destination: MIDTOWN, quote, organizerDiscountPct: 10,
    seats: [{ seatId: 'a', volumeCuFt: 120, isOrganizer: true }],
  }
  const now = Date.parse('2026-12-10T12:00:00Z')
  const req = (destination: { lat: number; lng: number }): MatchRequest => ({ userId: 'me', date: '2026-12-15', pickup: SHADY, destination, volumeCuFt: 60 })

  it('matches a different area in the same destination city, counting the extra drop-off', () => {
    const [r] = rankPools(req(WILLIAMSBURG), [{ ...base, poolId: 'nyc' }], now)
    expect(r?.poolId).toBe('nyc')
    expect(r.detourMi).toBeGreaterThan(3) // ~3.5 mi Midtown→Williamsburg ×1.3 road factor + pickup detour
  })
  it('does not match a different destination city', () => {
    expect(rankPools(req(PHILLY), [{ ...base, poolId: 'nyc' }], now)).toEqual([])
  })
  it('local moves still need the same destination (0.5 mi)', () => {
    const local = { ...base, poolId: 'local', destination: { lat: 40.4285, lng: -79.9772 }, quote: { ...quote, miles: 12 } }
    expect(rankPools(req({ lat: 40.4406, lng: -79.9959 }), [local], now)).toEqual([])
  })
})

describe('fragile items', () => {
  it('count 1.5× for space and price, and are reported as their own zone', async () => {
    const { fragileCuFt } = await import('./volume')
    const lines = [{ kind: 'preset' as const, key: 'box_medium' as const, qty: 2 }, { kind: 'preset' as const, key: 'tv' as const, qty: 1 }]
    expect(totalCuFt(lines)).toBe(14) // 6 + 5 × 1.5 = 13.5 → 14
    expect(fragileCuFt(lines)).toBe(8) // 7.5 → 8
    expect(fragileCuFt([{ kind: 'preset', key: 'box_medium', qty: 2 }])).toBe(0)
  })
})

describe('flexible dates (±3 days, 11/20)', () => {
  const CMU = { lat: 40.44392, lng: -79.94283 }
  const SHADY = { lat: 40.45152, lng: -79.93655 }
  const STORE = { lat: 40.4602, lng: -80.0103 }
  const pool = (poolId: string, date: string): PoolCandidate => ({
    poolId, date, status: 'open', deadlineAt: Date.parse('2026-12-01T00:00:00Z'), usableCuFt: 611, usedCuFt: 60,
    pickups: [CMU], destination: STORE, quote: { baseDayCents: 2995, perMileCents: 119, miles: 12, fuelCents: 1000, otherCents: 0 },
    organizerDiscountPct: 10, seats: [{ seatId: 'o', volumeCuFt: 60, isOrganizer: true }],
  })
  const now = Date.parse('2026-11-20T12:00:00Z')
  const me = (flexDays: number) => ({ userId: 'me', date: '2026-12-15', pickup: SHADY, destination: STORE, volumeCuFt: 60, flexDays })
  it('finds trucks within your window, same day first', () => {
    const r = rankPools(me(3), [pool('d-2', '2026-12-13'), pool('d0', '2026-12-15'), pool('d+4', '2026-12-19'), pool('d+3', '2026-12-18')], now)
    expect(r.map((x) => x.poolId)).toEqual(['d0', 'd-2', 'd+3'])
    expect(r.map((x) => x.dayDiff)).toEqual([0, -2, 3])
  })
  it('exact-day people only see their day', () => {
    expect(rankPools(me(0), [pool('d-1', '2026-12-14'), pool('d0', '2026-12-15')], now).map((x) => x.poolId)).toEqual(['d0'])
  })
})
