/** Social features through the real actions: profiles, looking list, invites, alerts, chat privacy, email once. */
import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { actions } from './index'
import { fakeTools } from './fakeTools'

const call = async (tools: ActionTools, name: string, userId: string, params: Record<string, unknown> = {}) =>
  (await actions[name]({ userId, params, tools, env: {} as never, callerJwt: '' })) as { success: boolean; data?: Record<string, unknown>; error?: string; code?: string }

const DATE = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)

async function world() {
  const tools = fakeTools()
  for (const [id, name] of [['maya', 'Maya Chen'], ['li', 'Li Wei'], ['jo', 'Jo Park'], ['zed', 'Zed Far']]) {
    await tools.create('users', { name, email: `${id}@school.edu` }, id)
  }
  const move = (pickup: string, dest = 'st-keep-springgarden') => ({ date: DATE, moveType: 'local', pickup, destination: dest, storageMonths: 0,
    items: [{ kind: 'preset', key: 'box_medium', qty: 15 }], contact: { method: 'email', handle: 'x@school.edu' } })
  await call(tools, 'saveDraft', 'maya', move('morewood'))
  await call(tools, 'saveDraft', 'li', move('shadyside'))
  await call(tools, 'saveDraft', 'jo', move('n-oakland'))
  await call(tools, 'saveDraft', 'zed', move('dormont', 'st-extra-braddock')) // different storage: never fits Maya's truck
  for (const u of ['maya', 'li', 'jo', 'zed']) await call(tools, 'topUp', u, { amountCents: 10_000 })
  return tools
}
const notes = (tools: ReturnType<typeof fakeTools>, u: string, kind?: string) => tools.all('notifications').filter((n) => n.data.userId === u && (!kind || n.data.kind === kind))

describe('looking list, new-truck alerts and invites', () => {
  it('people who opt in get alerted (in-app + email, once) when a matching truck appears; others do not', async () => {
    const tools = await world()
    expect((await call(tools, 'setLooking', 'li', { on: true })).success).toBe(true)
    expect((await call(tools, 'setLooking', 'zed', { on: true })).success).toBe(true)
    const poolId = ((await call(tools, 'createPool', 'maya', { vehicleType: 'truck_15' })).data as { poolId: string }).poolId
    expect(notes(tools, 'li', 'new_truck')).toHaveLength(1)
    expect(notes(tools, 'li', 'new_truck')[0].data.title).toMatch(/^Maya is going to .* — join their truck\?$/)
    expect(notes(tools, 'zed', 'new_truck')).toHaveLength(0) // going somewhere else
    expect(tools.emails.filter((e) => e.to === 'li@school.edu')).toHaveLength(1)
    // Looking post never exposes the exact address or contact
    const post = tools.all('lookingPosts').find((p) => p.data.userId === 'li')!.data
    expect(JSON.stringify(post)).not.toMatch(/school\.edu|address/)

    // Organizer sees who fits and invites; inviting twice notifies once
    const cands = (await call(tools, 'poolCandidates', 'maya', { poolId })).data as { people: { userId: string }[] }
    expect(cands.people.map((p) => p.userId)).toEqual(['li'])
    expect((await call(tools, 'poolCandidates', 'jo', { poolId })).code).toBe('forbidden') // not in the pool
    expect((await call(tools, 'invite', 'maya', { poolId, userId: 'li' })).success).toBe(true)
    await call(tools, 'invite', 'maya', { poolId, userId: 'li' })
    expect(notes(tools, 'li', 'invite')).toHaveLength(1)
    expect((await call(tools, 'invite', 'maya', { poolId, userId: 'jo' })).code).toBe('not_looking') // didn't opt in

    // Li joins → organizer notified; Li's post becomes "matched" and leaves the list
    expect((await call(tools, 'joinPool', 'li', { poolId })).success).toBe(true)
    expect(notes(tools, 'maya', 'joined')).toHaveLength(1)
    expect(tools.all('lookingPosts').find((p) => p.data.userId === 'li')!.data.status).toBe('matched')
  })
})

describe('chat', () => {
  it('pool chat follows membership; DMs are private; only members can post', async () => {
    const tools = await world()
    const poolId = ((await call(tools, 'createPool', 'maya', { vehicleType: 'truck_15' })).data as { poolId: string }).poolId
    const poolChat = () => tools.all('conversations').find((c) => c.data.kind === 'pool' && c.data.poolId === poolId)!
    expect(poolChat().data.memberIds).toEqual(['maya'])
    await call(tools, 'sendMessage', 'maya', { conversationId: poolChat().recordId, text: 'Hi! Leaving 9am' })
    await call(tools, 'joinPool', 'li', { poolId })
    expect(poolChat().data.memberIds).toEqual(['maya', 'li'])
    // New member can read earlier messages: every message carries the current member list
    expect(tools.all('messages').every((m) => (m.data.memberIds as string[]).includes('li'))).toBe(true)
    expect((await call(tools, 'sendMessage', 'jo', { conversationId: poolChat().recordId, text: 'let me in' })).code).toBe('forbidden')

    const dm = (await call(tools, 'openDm', 'jo', { userId: 'maya' })).data as { conversationId: string }
    expect(((await call(tools, 'openDm', 'maya', { userId: 'jo' })).data as { conversationId: string }).conversationId).toBe(dm.conversationId) // same thread both ways
    expect((await call(tools, 'sendMessage', 'jo', { conversationId: dm.conversationId, text: 'Room for a desk?' })).success).toBe(true)
    expect((await call(tools, 'sendMessage', 'li', { conversationId: dm.conversationId, text: 'hi' })).code).toBe('forbidden')
    const dmMsgs = tools.all('messages').filter((m) => m.data.conversationId === dm.conversationId)
    expect(dmMsgs.every((m) => JSON.stringify(m.data.memberIds) === JSON.stringify(['jo', 'maya']))).toBe(true)
    expect(notes(tools, 'maya', 'message')).toHaveLength(1) // first message only
    await call(tools, 'sendMessage', 'jo', { conversationId: dm.conversationId, text: 'second' })
    expect(notes(tools, 'maya', 'message')).toHaveLength(1)
    expect((await call(tools, 'sendMessage', 'jo', { conversationId: dm.conversationId, text: '   ' })).code).toBe('empty')
  })

  it('profiles: saved through the action only, emails can be turned off', async () => {
    const tools = await world()
    expect((await call(tools, 'saveProfile', 'li', { school: 'CMU', year: '2027', bio: 'Moving to NYC <b>soon</b>', emailNotify: false })).success).toBe(true)
    const p = tools.all('profiles').find((x) => x.data.userId === 'li')!.data
    expect(p).toMatchObject({ school: 'CMU', year: '2027', emailNotify: false })
    expect(p.bio).not.toMatch(/[<>]/)
    await call(tools, 'setLooking', 'li', { on: true })
    await call(tools, 'createPool', 'maya', { vehicleType: 'truck_15' })
    expect(notes(tools, 'li', 'new_truck')).toHaveLength(1) // still notified in-app
    expect(tools.emails.filter((e) => e.to === 'li@school.edu')).toHaveLength(0) // but no email
  })
})

describe('changing the destination while in a pool', () => {
  it('member: same storage only; organizer: can move an open truck (everyone told), not a locked one', async () => {
    const tools = await world()
    const poolId = ((await call(tools, 'createPool', 'maya', { vehicleType: 'truck_15' })).data as { poolId: string }).poolId
    await call(tools, 'joinPool', 'li', { poolId })
    const base = { date: DATE, moveType: 'local', pickup: 'shadyside', items: [{ kind: 'preset', key: 'box_medium', qty: 15 }] }

    // Li picks a different storage unit: that's not where this truck goes
    expect((await call(tools, 'saveDraft', 'li', { ...base, destination: 'st-extra-braddock' })).code).toBe('dest_mismatch')
    // Date can't change while in a pool
    const later = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10)
    expect((await call(tools, 'saveDraft', 'li', { ...base, date: later, destination: 'st-keep-springgarden' })).code).toBe('in_pool')

    // Maya (organizer) moves the open truck to another storage unit: pool + private record follow, Li is told
    expect((await call(tools, 'saveDraft', 'maya', { date: DATE, moveType: 'local', pickup: 'morewood', destination: 'st-extra-braddock', items: [{ kind: 'preset', key: 'box_medium', qty: 15 }] })).success).toBe(true)
    const pool = tools.all('pools').find((p) => p.recordId === poolId)!.data
    expect(pool.destinationKey).toBe('st-extra-braddock')
    expect((tools.all('poolPrivate').find((p) => p.data.poolId === poolId)!.data.destination as { key: string }).key).toBe('st-extra-braddock')
    expect(tools.all('notifications').filter((n) => n.data.userId === 'li' && n.data.kind === 'destination')).toHaveLength(1)
    // ...and now Li can follow it
    expect((await call(tools, 'saveDraft', 'li', { ...base, destination: 'st-extra-braddock' })).success).toBe(true)

    // After lock the organizer can't move the truck
    await call(tools, 'lockPool', 'maya', { poolId })
    expect((await call(tools, 'saveDraft', 'maya', { date: DATE, moveType: 'local', pickup: 'morewood', destination: 'st-keep-springgarden', items: [{ kind: 'preset', key: 'box_medium', qty: 15 }] })).code).toBe('locked')
  })

  it('city-to-city member can switch to another area of the same city and pays only the extra drop-off', async () => {
    const tools = await world()
    const city = (pickup: string, destination: string) => ({ date: DATE, moveType: 'city', pickup, destination, items: [{ kind: 'preset', key: 'box_medium', qty: 15 }] })
    await call(tools, 'saveDraft', 'maya', city('morewood', 'nyc:midtown'))
    await call(tools, 'saveDraft', 'li', city('shadyside', 'nyc:midtown'))
    for (const u of ['maya', 'li']) for (let i = 0; i < 4; i++) await call(tools, 'topUp', u, { amountCents: 10_000 })
    const poolId = ((await call(tools, 'createPool', 'maya', { vehicleType: 'truck_15' })).data as { poolId: string }).poolId
    expect((await call(tools, 'joinPool', 'li', { poolId })).success).toBe(true)
    const first = await call(tools, 'saveDraft', 'li', city('shadyside', 'nyc:williamsburg'))
    expect(first.code).toMatch(/^needs_accept:\d+$/)
    const extra = Number(first.code!.split(':')[1])
    expect((await call(tools, 'saveDraft', 'li', { ...city('shadyside', 'nyc:williamsburg'), acceptExtraCents: extra })).success).toBe(true)
    expect(tools.all('seats').find((s) => s.data.userId === 'li' && s.data.status === 'active')!.data.extraCents).toBe(extra)
    expect((await call(tools, 'saveDraft', 'li', city('shadyside', 'philly:center'))).code).toBe('dest_mismatch') // another city
  })
})

describe('11/20 changes: big top-ups, contact once at sign-up, ±3-day trucks', () => {
  it('a single top-up can cover a long-distance share; the daily cap is high', async () => {
    const tools = await world()
    expect((await call(tools, 'topUp', 'li', { amountCents: 100_000 })).success).toBe(true) // $1,000
    expect((await call(tools, 'topUp', 'li', { amountCents: 300_000 })).success).toBe(true) // $3,000
    expect((await call(tools, 'topUp', 'li', { amountCents: 300_001 })).code).toBe('bad_amount')
  })

  it('contact set once in the profile is enough to join; saving without items keeps your items', async () => {
    const tools = await world()
    const poolId = ((await call(tools, 'createPool', 'maya', { vehicleType: 'truck_15' })).data as { poolId: string }).poolId
    // A brand-new person: profile first (with contact), then plans a move that never repeats the contact
    await tools.create('users', { name: 'New Person', email: 'new@school.edu' }, 'newbie')
    expect((await call(tools, 'saveProfile', 'newbie', { school: 'CMU', contact: { method: 'text', handle: '+1 412 555 0199' } })).success).toBe(true)
    expect((await call(tools, 'saveDraft', 'newbie', { date: DATE, moveType: 'local', pickup: 'shadyside', destination: 'st-keep-springgarden', items: [{ kind: 'preset', key: 'box_medium', qty: 5 }] })).success).toBe(true)
    await call(tools, 'topUp', 'newbie', { amountCents: 10_000 })
    expect((await call(tools, 'joinPool', 'newbie', { poolId })).success).toBe(true)
    const draft = tools.all('moveDrafts').find((d) => d.data.userId === 'newbie')!.data
    expect(draft.contact).toEqual({ method: 'text', handle: '+1 412 555 0199' })
    expect((draft.items as unknown[]).length).toBe(1)
  })

  it('you can join a truck 2 days off (your date moves to the truck\'s), not 4', async () => {
    const tools = await world()
    const shift = (d: number) => new Date(Date.parse(`${DATE}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)
    const move = (date: string) => ({ date, moveType: 'local', pickup: 'morewood', destination: 'st-keep-springgarden', items: [{ kind: 'preset', key: 'box_medium', qty: 15 }] })
    await call(tools, 'saveDraft', 'maya', move(shift(2)))
    const near = ((await call(tools, 'createPool', 'maya', { vehicleType: 'truck_15' })).data as { poolId: string }).poolId
    await call(tools, 'saveDraft', 'jo', { ...move(shift(4)), pickup: 'n-oakland' })
    const far = ((await call(tools, 'createPool', 'jo', { vehicleType: 'truck_15' })).data as { poolId: string }).poolId
    const found = (await call(tools, 'searchPools', 'li')).data as { results: { poolId: string; dayDiff: number }[] }
    expect(found.results.map((r) => [r.poolId, r.dayDiff])).toEqual([[near, 2]])
    expect((await call(tools, 'joinPool', 'li', { poolId: far })).code).toBe('wrong_date')
    expect((await call(tools, 'joinPool', 'li', { poolId: near })).success).toBe(true)
    expect(tools.all('moveDrafts').find((d) => d.data.userId === 'li')!.data.date).toBe(shift(2))
  })
})
