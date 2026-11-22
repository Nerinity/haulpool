/**
 * End-to-end money flow through the real server actions, against an in-memory store that
 * enforces each collection's uniqueOn (like the DeepSpace RecordRoom does).
 */
import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { actions, sweepDeadlines } from './index'
import { fakeTools } from './fakeTools'

const call = async (tools: ActionTools, name: string, userId: string, params: Record<string, unknown> = {}) =>
  (await actions[name]({ userId, params, tools, env: {} as never, callerJwt: '' })) as { success: boolean; data?: Record<string, unknown>; error?: string; code?: string }

const DATE = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
const balance = (tools: ReturnType<typeof fakeTools>, u: string) => tools.all('walletTx').filter((t) => t.data.userId === u).reduce((a, t) => a + (t.data.amountCents as number), 0)

async function setup() {
  const tools = fakeTools()
  const move = (pickup: string) => ({ date: DATE, moveType: 'local', pickup, destination: 'st-keep-springgarden', storageMonths: 0,
    items: [{ kind: 'preset', key: 'box_medium', qty: 20 }], contact: { method: 'email', handle: 'a@b.edu' } })
  for (const [u, p] of [['org', 'morewood'], ['amy', 'shadyside'], ['bo', 'n-oakland']] as const) {
    expect((await call(tools, 'saveDraft', u, move(p))).success).toBe(true)
  }
  return tools
}

describe('wallet money flow (server actions end to end)', () => {
  it('needs a balance, holds at lock, refunds a late leaver minus $10, pays the organizer, keeps fees', async () => {
    const tools = await setup()
    const create = await call(tools, 'createPool', 'org', { vehicleType: 'truck_10', quote: { perMileCents: 100, miles: 10, fuelCents: 1000 } })
    expect(create.code).toMatch(/^low_balance:\d+$/)
    for (const u of ['org', 'amy', 'bo']) expect((await call(tools, 'topUp', u, { amountCents: 10_000 })).success).toBe(true)
    const { poolId } = (await call(tools, 'createPool', 'org', { vehicleType: 'truck_10', quote: { perMileCents: 100, miles: 10, fuelCents: 1000 } })).data as { poolId: string }
    expect((await call(tools, 'joinPool', 'amy', { poolId })).success).toBe(true)
    expect((await call(tools, 'joinPool', 'bo', { poolId })).success).toBe(true)
    expect(balance(tools, 'amy')).toBe(10_000) // nothing taken before lock

    expect((await call(tools, 'lockPool', 'org', { poolId })).success).toBe(true)
    const total = 1995 + 100 * 10 + 1000 // truck_10 day rate + miles + fuel = $39.95
    const afterLock = ['org', 'amy', 'bo'].map((u) => 10_000 - balance(tools, u))
    const fees = tools.all('walletTx') // fee = 8% of each share, min $1
    expect(afterLock.reduce((a, b) => a + b, 0)).toBeGreaterThan(total)
    expect(fees.every((t) => t.data.userId !== '__platform__')).toBe(true) // no revenue until the move is done

    // Bo leaves after lock: his hold comes back minus $10; org + amy split the $10 as credit and pay more
    const boHeld = 10_000 - balance(tools, 'bo')
    expect((await call(tools, 'leavePool', 'bo', { poolId })).success).toBe(true)
    expect(balance(tools, 'bo')).toBe(10_000 - 1000)
    expect(boHeld).toBeGreaterThan(0)
    // Running the same reconcile again must not double-charge
    expect((await call(tools, 'updatePool', 'org', { poolId, quote: {} })).success).toBe(true)
    const before = ['org', 'amy'].map((u) => balance(tools, u))
    expect((await call(tools, 'updatePool', 'org', { poolId, quote: {} })).success).toBe(true)
    expect(['org', 'amy'].map((u) => balance(tools, u))).toEqual(before)

    expect((await call(tools, 'completePool', 'org', { poolId })).success).toBe(true)
    const revenue = balance(tools, '__platform__')
    // Money is conserved: everything topped up = what people still have + HaulPool's fees
    expect(balance(tools, 'org') + balance(tools, 'amy') + balance(tools, 'bo') + revenue).toBe(30_000)
    expect(revenue).toBeGreaterThan(0)
    // Completing again does nothing: the pool is finished
    expect((await call(tools, 'completePool', 'org', { poolId })).success).toBe(false)
    expect(balance(tools, '__platform__')).toBe(revenue)
    // Everyone is free for their next move (bug found 11/19: seats stayed active after "done")
    expect(tools.all('seats').filter((x) => x.data.status === 'active')).toEqual([])
    expect((await call(tools, 'createPool', 'org', { vehicleType: 'truck_10' })).success).toBe(true)
  })

  it('organizer leaving hands over the pool; deadline sweep locks 2+ and closes solo pools with no fee', async () => {
    const tools = await setup()
    for (const u of ['org', 'amy', 'bo']) await call(tools, 'topUp', u, { amountCents: 10_000 })
    const p1 = ((await call(tools, 'createPool', 'org', { vehicleType: 'truck_10' })).data as { poolId: string }).poolId
    await call(tools, 'joinPool', 'amy', { poolId: p1 })
    expect((await call(tools, 'leavePool', 'org', { poolId: p1 })).success).toBe(true)
    const pool = tools.all('pools').find((p) => p.recordId === p1)!
    expect(pool.data.organizerId).toBe('amy')
    expect(balance(tools, 'org')).toBe(10_000) // free before lock

    const p2 = ((await call(tools, 'createPool', 'bo', { vehicleType: 'truck_10' })).data as { poolId: string }).poolId
    await call(tools, 'joinPool', 'org', { poolId: p1 })
    const far = Date.now() + 30 * 86_400_000
    const r = await sweepDeadlines(tools, far)
    expect(r).toEqual({ locked: 1, closed: 1 })
    expect(tools.all('pools').find((p) => p.recordId === p2)!.data).toMatchObject({ status: 'cancelled', cancelReason: 'not_filled' })
    expect(balance(tools, 'bo')).toBe(10_000) // alone at the deadline: no fee
    expect(balance(tools, 'amy')).toBeLessThan(10_000) // p1 locked: held
  })

  it('a seat left over from an already-finished pool (old data) is released, not blocking', async () => {
    const tools = await setup()
    await call(tools, 'topUp', 'org', { amountCents: 10_000 })
    const poolId = ((await call(tools, 'createPool', 'org', { vehicleType: 'truck_10' })).data as { poolId: string }).poolId
    // Simulate the old bug: pool completed but the seat still active
    const pool = tools.all('pools').find((p) => p.recordId === poolId)!
    pool.data.status = 'completed'
    expect((await call(tools, 'releaseFinished', 'org')).data).toEqual({ released: true })
    expect(tools.all('seats').find((x) => x.data.poolId === poolId)!.data).toMatchObject({ status: 'done', activeUserKey: null })
  })
})
