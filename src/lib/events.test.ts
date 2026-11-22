import { describe, expect, it } from 'vitest'
import { cleanProps, computeFunnel, rejectReasons, type EventRow } from './events'

const ev = (name: string, userId: string, props: Record<string, unknown> = {}, at = 1000): EventRow => ({ name, userId, day: '2026-11-19', at, props })

describe('funnel', () => {
  it('counts distinct users and drop-off per step', () => {
    const rows = [
      ev('visit', 'a'), ev('visit', 'a'), ev('visit', 'b'), ev('visit', 'c'), ev('visit', 'd'),
      ev('draft_saved', 'a'), ev('draft_saved', 'b'), ev('draft_saved', 'c'),
      ev('search_run', 'a'), ev('pool_created', 'b'),
      ev('pool_joined', 'a'),
      ev('pool_locked', 'b', { memberIds: ['a', 'b'] }),
      ev('pool_completed', 'b', { memberIds: ['a', 'b'] }),
    ]
    const f = computeFunnel(rows)
    expect(f.map((s) => s.users)).toEqual([4, 3, 2, 2, 2, 2])
    expect(f[1].dropFromPrev).toBe(25)
    expect(f[2].pctOfFirst).toBe(50)
  })
  it('is strict: skipping an earlier step does not count later', () => {
    const f = computeFunnel([ev('visit', 'a'), ev('pool_joined', 'z')])
    expect(f.map((s) => s.users)).toEqual([1, 0, 0, 0, 0, 0])
  })
  it('respects the time window', () => {
    const f = computeFunnel([ev('visit', 'a', {}, 10), ev('visit', 'b', {}, 500)], 100)
    expect(f[0].users).toBe(1)
  })
  it('counts reject reasons', () => {
    expect(rejectReasons([ev('join_rejected', 'a', { reason: 'full' }), ev('join_rejected', 'b', { reason: 'full' }), ev('join_rejected', 'c')])).toEqual({ full: 2, other: 1 })
  })
})

describe('cleanProps (no PII in events)', () => {
  it('keeps numbers, booleans and short codes only', () => {
    expect(cleanProps({ n: 3, ok: true, code: 'dorm', address: '5000 Forbes Ave, Pittsburgh', name: 'Nerin Wang', obj: { a: 1 } }))
      .toEqual({ n: 3, ok: true, code: 'dorm' })
  })
  it('handles junk input', () => {
    expect(cleanProps(null)).toEqual({})
    expect(cleanProps('x')).toEqual({})
    expect(cleanProps({ 'bad key': 1, n: Infinity })).toEqual({})
  })
})
