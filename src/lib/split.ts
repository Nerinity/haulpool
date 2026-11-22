import { CONFIG } from '../config'

/**
 * Money is integer cents everywhere. Invariant (tested): every split sums EXACTLY to its total.
 * Spec §6.
 */

/** Largest-remainder allocation of `totalCents` in proportion to non-negative integer weights. */
export function allocate(totalCents: number, weights: number[]): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('totalCents must be a non-negative integer')
  if (weights.length === 0) return []
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) throw new Error('weights must be non-negative integers')
  const W = weights.reduce((a, b) => a + b, 0)
  if (W === 0) throw new Error('weights must not all be zero')
  // integer math: floor(total * w / W) and remainder numerators, no floating point
  const floors = weights.map((w) => Math.floor((totalCents * w) / W))
  const rems = weights.map((w, i) => totalCents * w - floors[i] * W)
  let left = totalCents - floors.reduce((a, b) => a + b, 0)
  const order = weights.map((_, i) => i).sort((a, b) => rems[b] - rems[a] || a - b)
  const out = [...floors]
  for (const i of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}

export interface Quote {
  baseDayCents: number
  perMileCents: number
  miles: number
  fuelCents: number
  otherCents: number
}

export function quoteTotalCents(q: Quote): number {
  const t = q.baseDayCents + Math.round(q.perMileCents * q.miles) + q.fuelCents + q.otherCents
  const { min, max } = CONFIG.quoteBoundsCents
  if (!Number.isFinite(t) || t < min || t > max) throw new Error('Quote out of bounds')
  return t
}

export interface SeatShareInput { seatId: string; volumeCuFt: number; isOrganizer: boolean }

/**
 * Truck cost split by volume; the organizer pays (1 - d) of their share and the difference is
 * spread over everyone else by volume. The discount only applies with ≥ 2 members.
 */
export function truckSplit(totalCents: number, seats: SeatShareInput[], discountPct: number = CONFIG.split.organizerDiscountPct): Map<string, number> {
  const d = Math.min(Math.max(discountPct, 0), CONFIG.split.organizerDiscountMaxPct)
  const base = allocate(totalCents, seats.map((s) => s.volumeCuFt))
  const out = new Map(seats.map((s, i) => [s.seatId, base[i]]))
  const orgIdx = seats.findIndex((s) => s.isOrganizer)
  if (orgIdx < 0 || seats.length < CONFIG.split.discountMinMembers || d === 0) return out
  const discount = Math.round((base[orgIdx] * d) / 100)
  const others = seats.filter((_, i) => i !== orgIdx)
  const extra = allocate(discount, others.map((s) => s.volumeCuFt))
  out.set(seats[orgIdx].seatId, base[orgIdx] - discount)
  others.forEach((s, k) => out.set(s.seatId, (out.get(s.seatId) ?? 0) + extra[k]))
  return out
}

export interface StorageSeat { seatId: string; volumeCuFt: number; months: number }

/** Each month's rent is split by volume among the people still storing that month (spec §6.3). */
export function storageSplit(monthlyRentCents: number, seats: StorageSeat[], oneTimeCents = 0): Map<string, number> {
  const out = new Map(seats.map((s) => [s.seatId, 0]))
  const maxM = Math.max(0, ...seats.map((s) => s.months))
  for (let m = 1; m <= maxM; m++) {
    const active = seats.filter((s) => s.months >= m)
    const part = allocate(monthlyRentCents, active.map((s) => s.volumeCuFt))
    active.forEach((s, k) => out.set(s.seatId, out.get(s.seatId)! + part[k]))
  }
  if (oneTimeCents > 0 && seats.length > 0) {
    const part = allocate(oneTimeCents, seats.map((s) => s.volumeCuFt))
    seats.forEach((s, k) => out.set(s.seatId, out.get(s.seatId)! + part[k]))
  }
  return out
}

/** The deterministic bill explanation (spec §8: a template, not AI). */
export function explainShare(opts: { myCuFt: number; totalCuFt: number; truckCents: number; storageCents: number; months: number }): string {
  const pct = opts.totalCuFt > 0 ? Math.round((opts.myCuFt / opts.totalCuFt) * 100) : 0
  const $ = (c: number) => `$${(c / 100).toFixed(2)}`
  const parts = [`Your items take ${pct}% of the loaded space, so your truck share is ${$(opts.truckCents)}`]
  if (opts.storageCents > 0) parts.push(`plus ${$(opts.storageCents)} for ${opts.months} month(s) of storage`)
  return parts.join(', ') + '.'
}
