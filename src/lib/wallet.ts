/**
 * Wallet money rules — pure functions, unit-tested; the server actions only move what these compute.
 *
 *   join/start  → need enough balance; nothing is taken yet
 *   lock        → each person's share + 8% fee (+ any extra they accepted) is HELD (debited)
 *   leave late  → your hold comes back, minus a $10 fee, which is split as credit to the people left
 *   move done   → organizer receives every share (pays back the truck); HaulPool keeps the fees
 *
 * Amounts are integer cents. A transaction's `key` is unique, so retrying a step never double-charges.
 */
import { CONFIG } from '../config'
import { allocate, truckSplit } from './split'

export type TxKind = 'topup' | 'hold' | 'adjust' | 'release' | 'cancel_fee' | 'credit' | 'payout' | 'fee_revenue'
export interface Tx { userId: string; amountCents: number; kind: TxKind; poolId?: string; key: string; note?: string }

export interface MoneySeat { seatId: string; userId: string; volumeCuFt: number; isOrganizer: boolean; extraCents?: number; storageCents?: number }
export interface SeatCharge { share: number; fee: number; extra: number; total: number }

/** HaulPool's service fee on one share. */
export function serviceFee(shareCents: number): number {
  if (shareCents <= 0) return 0
  return Math.max(CONFIG.fees.serviceMinCents, Math.round((shareCents * CONFIG.fees.servicePct) / 100))
}

/** What each seat owes for this pool right now. */
export function poolCharges(truckTotalCents: number, seats: MoneySeat[], discountPct: number): Map<string, SeatCharge> {
  const truck = truckSplit(truckTotalCents, seats.map((s) => ({ seatId: s.seatId, volumeCuFt: s.volumeCuFt, isOrganizer: s.isOrganizer })), discountPct)
  const out = new Map<string, SeatCharge>()
  for (const s of seats) {
    const share = (truck.get(s.seatId) ?? 0) + (s.storageCents ?? 0)
    const fee = serviceFee(share)
    const extra = s.extraCents ?? 0
    out.set(s.seatId, { share, fee, extra, total: share + fee + extra })
  }
  return out
}

export const balanceOf = (txs: Pick<Tx, 'amountCents'>[]) => txs.reduce((a, t) => a + t.amountCents, 0)

/** How much a user currently has held for a pool (positive number). */
export function heldFor(txs: Pick<Tx, 'amountCents' | 'kind' | 'poolId'>[], poolId: string): number {
  const net = txs.filter((t) => t.poolId === poolId && (t.kind === 'hold' || t.kind === 'adjust' || t.kind === 'release')).reduce((a, t) => a + t.amountCents, 0)
  return net === 0 ? 0 : -net
}

/** Split the $10 cancellation fee among the people left, by space used. */
export function cancelCredits(remaining: { seatId: string; volumeCuFt: number }[]): Map<string, number> {
  if (remaining.length === 0) return new Map()
  const parts = allocate(CONFIG.fees.cancelCents, remaining.map((r) => Math.max(1, r.volumeCuFt)))
  return new Map(remaining.map((r, i) => [r.seatId, parts[i]]))
}

/** Extra cost of a longer route, charged only to the person who changed their address. */
export function extraRouteCents(extraMiles: number, perMileCents: number): number {
  if (extraMiles <= 0.05) return 0
  const fuelPerMile = CONFIG.route.fuelPerGallonCents / CONFIG.route.mpg
  return Math.round(extraMiles * (perMileCents + fuelPerMile))
}
