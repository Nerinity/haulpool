import { describe, expect, it } from 'vitest'
import { balanceOf, cancelCredits, extraRouteCents, heldFor, poolCharges, serviceFee, type Tx } from './wallet'

describe('wallet rules', () => {
  it('8% service fee with a $1 minimum', () => {
    expect(serviceFee(2000)).toBe(160)
    expect(serviceFee(1220)).toBe(100) // 97.6 → $1 minimum
    expect(serviceFee(500)).toBe(100)
    expect(serviceFee(0)).toBe(0)
  })
  it('pool charges = truck share + storage + fee + accepted extra; shares still sum to the truck total', () => {
    const seats = [
      { seatId: 'a', userId: 'A', volumeCuFt: 61, isOrganizer: true },
      { seatId: 'b', userId: 'B', volumeCuFt: 61, isOrganizer: false, extraCents: 250 },
    ]
    const c = poolCharges(5423, seats, 10)
    expect(c.get('a')!.share + c.get('b')!.share).toBe(5423)
    expect(c.get('b')!.total).toBe(c.get('b')!.share + serviceFee(c.get('b')!.share) + 250)
  })
  it('holds, adjustments and releases net out per pool', () => {
    const txs: Tx[] = [
      { userId: 'B', amountCents: 5000, kind: 'topup', key: 't1' },
      { userId: 'B', amountCents: -1400, kind: 'hold', poolId: 'p', key: 'h' },
      { userId: 'B', amountCents: -300, kind: 'adjust', poolId: 'p', key: 'a' },
      { userId: 'B', amountCents: -999, kind: 'hold', poolId: 'other', key: 'h2' },
    ]
    expect(heldFor(txs, 'p')).toBe(1700)
    expect(balanceOf(txs)).toBe(5000 - 1400 - 300 - 999)
    expect(heldFor([...txs, { userId: 'B', amountCents: 1700, kind: 'release', poolId: 'p', key: 'r' }], 'p')).toBe(0)
  })
  it('the $10 cancellation fee is split exactly among the people left', () => {
    const m = cancelCredits([{ seatId: 'x', volumeCuFt: 100 }, { seatId: 'y', volumeCuFt: 50 }, { seatId: 'z', volumeCuFt: 50 }])
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(1000)
    expect(m.get('x')).toBe(500)
  })
  it('a longer route costs the changer per-mile plus fuel', () => {
    expect(extraRouteCents(2, 119)).toBe(Math.round(2 * (119 + 35)))
    expect(extraRouteCents(0, 119)).toBe(0)
  })
})
