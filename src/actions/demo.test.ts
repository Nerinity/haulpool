/** Demo data: every step runs through the real actions, and cleanup leaves no trace (and refunds real people). */
import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { actions } from './index'
import { fakeTools } from './fakeTools'

const env = { OWNER_USER_ID: 'owner' } as never
const call = async (tools: ActionTools, name: string, userId: string, params: Record<string, unknown> = {}) =>
  (await actions[name]({ userId, params, tools, env, callerJwt: '' })) as { success: boolean; data?: Record<string, unknown>; error?: string; code?: string }

describe('demo data', () => {
  it('builds a busy app around the owner\'s move, then removes it cleanly', async () => {
    const tools = fakeTools()
    await tools.registerUser({ userId: 'owner', name: 'Nerin Wang', email: 'nerin@school.edu' })
    const date = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)
    await call(tools, 'saveDraft', 'owner', { date, moveType: 'local', pickup: 'shadyside', destination: 'st-keep-springgarden', items: [{ kind: 'preset', key: 'box_medium', qty: 12 }], contact: { method: 'email', handle: 'nerin@school.edu' } })
    await call(tools, 'topUp', 'owner', { amountCents: 10_000 })

    expect((await call(tools, 'seedDemo', 'demo_maya', { step: 0 })).code).toBe('forbidden') // owner only
    let step: number | null = 0
    while (step !== null) {
      const r = await call(tools, 'seedDemo', 'owner', { step })
      expect(r.success, r.error).toBe(true)
      expect(r.data!.warning, String(r.data!.warning)).toBeNull()
      step = r.data!.next as number | null
    }
    const open = tools.all('pools').filter((p) => p.data.status === 'open')
    expect(open).toHaveLength(3)
    const maya = open.find((p) => p.data.organizerId === 'demo_maya')!
    expect(maya.data.date).toBe(date) // built on the owner's day and destination
    expect(maya.data.destinationKey).toBe('st-keep-springgarden')
    expect(tools.all('notifications').some((n) => n.data.userId === 'owner' && n.data.kind === 'invite')).toBe(true)
    expect(tools.all('notifications').some((n) => n.data.userId === 'owner' && n.data.kind === 'message')).toBe(true)
    expect(tools.all('messages').length).toBeGreaterThanOrEqual(7)
    expect(tools.emails.every((e) => e.to === 'nerin@school.edu')).toBe(true) // demo people are never emailed

    // The owner joins the demo truck, then removes the demo: hold refunded, no demo rows left
    expect((await call(tools, 'joinPool', 'owner', { poolId: maya.recordId })).success).toBe(true)
    await call(tools, 'lockPool', 'demo_maya', { poolId: maya.recordId })
    expect(await call(tools, 'clearDemo', 'owner')).toMatchObject({ success: true })
    const bal = tools.all('walletTx').filter((t) => t.data.userId === 'owner').reduce((a, t) => a + (t.data.amountCents as number), 0)
    expect(bal).toBe(10_000)
    for (const c of ['users', 'profiles', 'lookingPosts', 'moveDrafts', 'walletTx']) {
      expect(tools.all(c).filter((r) => String(r.recordId).startsWith('demo_') || String(r.data.userId ?? '').startsWith('demo_'))).toEqual([])
    }
    expect(tools.all('pools').filter((p) => p.data.status === 'open')).toEqual([])
    expect(tools.all('seats').filter((s) => s.data.status === 'active')).toEqual([])
    expect(tools.all('conversations')).toEqual([])
  })
})
