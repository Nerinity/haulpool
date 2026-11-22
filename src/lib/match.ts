import { CONFIG } from '../config'
import { bestInsertion, detourCapMi, haversineMi, roadMi, roundForDisplay, type LatLng } from './route'
import { quoteTotalCents, truckSplit, type Quote } from './split'

/** What the searcher brings (from their moveDraft). */
export interface MatchRequest {
  userId: string
  date: string // YYYY-MM-DD, school-local
  pickup: LatLng
  destination: LatLng
  destinationKey?: string // storage facility id when they want shared storage
  volumeCuFt: number
  storageMonths?: number
  /** Days earlier/later you could move (0 = exact day only). */
  flexDays?: number
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/** Server-side view of an open pool, including private coordinates (never sent to non-members). */
export interface PoolCandidate {
  poolId: string
  date: string
  status: 'open' | 'locked' | 'in_progress' | 'completed' | 'cancelled'
  deadlineAt: number // epoch ms
  usableCuFt: number
  usedCuFt: number
  pickups: LatLng[] // in route order, organizer first
  destination: LatLng
  destinationKey?: string
  quote: Quote
  organizerDiscountPct: number
  seats: { seatId: string; volumeCuFt: number; isOrganizer: boolean; storageMonths?: number }[]
}

export type Reason = 'same_building' | 'cheap' | 'nearly_full' | 'small_detour' | 'same_storage'

/** What the client receives: no coordinates, rounded distance. */
export interface MatchResult {
  poolId: string
  score: number
  detourMi: number // rounded for display
  distanceMi: number // rounded for display
  myShareCents: number
  fillAfterPct: number
  reasons: Reason[]
  nearMiss?: 'detour' | 'capacity'
  /** Truck's date minus your date, in days (0 = same day). */
  dayDiff: number
}

type Hard = { ok: true; detourMi: number; capMi: number } | { ok: false; why: 'date' | 'status' | 'capacity' | 'destination' | 'detour'; detourMi?: number; capMi?: number }

export function hardFilter(req: MatchRequest, p: PoolCandidate, now: number, slack = { detour: 1, capacityPct: 0 }): Hard {
  if (Math.abs(daysBetween(req.date, p.date)) > Math.min(req.flexDays ?? 0, CONFIG.dates.flexMaxDays)) return { ok: false, why: 'date' }
  if (p.status !== 'open' || now >= p.deadlineAt) return { ok: false, why: 'status' }
  const room = p.usableCuFt * (1 + slack.capacityPct / 100) - p.usedCuFt
  if (req.volumeCuFt > room) return { ok: false, why: 'capacity' }
  if (p.pickups.length >= CONFIG.route.maxStops) return { ok: false, why: 'capacity' }
  const ins = bestInsertion(p.pickups, p.destination, req.pickup)
  const long = ins.baseMi > CONFIG.route.longDistanceMi
  const sameStorage = !!req.destinationKey && req.destinationKey === p.destinationKey
  const destGap = haversineMi(req.destination, p.destination)
  const destOk = sameStorage || destGap <= (long ? CONFIG.route.cityDestinationMi : CONFIG.route.sameDestinationMi)
  if (!destOk) return { ok: false, why: 'destination' }
  // City-to-city: a second drop-off in the same metro is extra driving, so it counts as detour.
  const dropMi = long && !sameStorage && destGap > CONFIG.route.sameDestinationMi ? roadMi(p.destination, req.destination) : 0
  const detourMi = ins.detourMi + dropMi
  const cap = long
    ? Math.min(Math.max(ins.baseMi * CONFIG.route.detourPct, CONFIG.route.detourMinMi), CONFIG.route.longDetourMaxMi)
    : detourCapMi(ins.baseMi)
  const capMi = cap * slack.detour
  if (detourMi > capMi) return { ok: false, why: 'detour', detourMi, capMi }
  return { ok: true, detourMi, capMi }
}

function myShareIfJoined(req: MatchRequest, p: PoolCandidate, extraMiles: number): number {
  const total = quoteTotalCents({ ...p.quote, miles: p.quote.miles + extraMiles })
  const seats = [...p.seats, { seatId: '__me__', volumeCuFt: req.volumeCuFt, isOrganizer: false }]
  return truckSplit(total, seats, p.organizerDiscountPct).get('__me__')!
}

/**
 * Rank open pools for a request. Deterministic: same inputs → same order (tested).
 * f_time is not available until P2, so its weight is redistributed to detour and cost.
 */
export function rankPools(req: MatchRequest, pools: PoolCandidate[], now: number): MatchResult[] {
  const passed = pools
    .map((p) => ({ p, h: hardFilter(req, p, now) }))
    .filter((x): x is { p: PoolCandidate; h: Extract<Hard, { ok: true }> } => x.h.ok)
  let results = score(req, passed.map(({ p, h }) => ({ p, detourMi: h.detourMi, capMi: h.capMi })))
  if (results.length > 0) return results

  // near misses (spec §5.4): relax detour ×1.5 or capacity +10%
  const { detourMultiplier, capacitySlackPct } = CONFIG.score.nearMiss
  const near = pools
    .map((p) => ({ p, h: hardFilter(req, p, now, { detour: detourMultiplier, capacityPct: capacitySlackPct }), strict: hardFilter(req, p, now) }))
    .filter((x) => x.h.ok)
  results = score(req, near.map(({ p, h }) => ({ p, detourMi: (h as any).detourMi, capMi: (h as any).capMi })))
  return results.map((r) => {
    const s = near.find((n) => n.p.poolId === r.poolId)!.strict
    return { ...r, nearMiss: !s.ok && s.why === 'capacity' ? 'capacity' : 'detour' }
  })
}

function score(req: MatchRequest, xs: { p: PoolCandidate; detourMi: number; capMi: number }[]): MatchResult[] {
  if (xs.length === 0) return []
  const w = CONFIG.score.weights
  // P2 not built yet: share f_time's weight between detour and cost in proportion
  const wd = w.detour + (w.time * w.detour) / (w.detour + w.cost)
  const wc = w.cost + (w.time * w.cost) / (w.detour + w.cost)
  const shares = xs.map(({ p, detourMi }) => myShareIfJoined(req, p, detourMi))
  const minShare = Math.min(...shares)
  return xs
    .map(({ p, detourMi, capMi }, i) => {
      const fDetour = 1 - detourMi / capMi
      const fCost = shares[i] > 0 ? minShare / shares[i] : 1
      const fillAfter = (p.usedCuFt + req.volumeCuFt) / p.usableCuFt
      const dayDiff = daysBetween(req.date, p.date)
      let s = wd * fDetour + wc * fCost + w.fill * Math.min(fillAfter, 1) - CONFIG.dates.scorePenaltyPerDay * Math.abs(dayDiff)
      const theirMonths = p.seats.find((x) => x.isOrganizer)?.storageMonths
      if (req.storageMonths && theirMonths) s *= CONFIG.score.storageMonthMismatchFactor ** Math.abs(req.storageMonths - theirMonths)
      const nearest = Math.min(...p.pickups.map((q) => haversineMi(q, req.pickup)))
      const reasons: Reason[] = []
      if (nearest < 0.1) reasons.push('same_building')
      if (detourMi <= 1) reasons.push('small_detour')
      if (shares[i] === minShare && xs.length > 1) reasons.push('cheap')
      if (fillAfter >= 0.8) reasons.push('nearly_full')
      if (req.destinationKey && req.destinationKey === p.destinationKey) reasons.push('same_storage')
      return {
        poolId: p.poolId,
        score: Math.round(s * 10) / 10,
        detourMi: roundForDisplay(detourMi),
        distanceMi: roundForDisplay(nearest),
        myShareCents: shares[i],
        fillAfterPct: Math.round(fillAfter * 100),
        reasons,
        dayDiff,
        _detourExact: detourMi,
        _created: p.poolId,
      }
    })
    .sort((a, b) => b.score - a.score || a._detourExact - b._detourExact || a._created.localeCompare(b._created))
    .map(({ _detourExact, _created, ...r }) => r)
}
