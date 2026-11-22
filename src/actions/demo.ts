/**
 * Demo data (owner only): pretend students, trucks, chats and an invite, so the app can be
 * seen "busy". Everything goes through the real actions — same wallet, matching, lock and
 * chat rules — just run as demo users. Demo ids start with "demo_" and are shown with a
 * Demo badge; demo emails end in .invalid so nothing is ever sent.
 *
 * Seeding runs in small steps (the page calls them one by one) to stay well inside the
 * per-request limits of the platform.
 */
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'

export const DEMO_PREFIX = 'demo_'
export const isDemoId = (id: string) => id.startsWith(DEMO_PREFIX)

type Result = { success: boolean; data?: Record<string, unknown>; error?: string; code?: string }
type Actions = Record<string, ActionHandler<Env>>

const PEOPLE = [
  { id: 'demo_maya', name: 'Maya Chen', school: 'Carnegie Mellon', year: '2027', avatar: '🎸', bio: 'Summer internship in Philly. Storing my dorm until August.' },
  { id: 'demo_emma', name: 'Emma Davis', school: 'Carnegie Mellon', year: '2026', avatar: '🪴', bio: 'Graduating! Mostly books and plants.' },
  { id: 'demo_jordan', name: 'Jordan Lee', school: 'Pitt', year: '2027', avatar: '🏀', bio: 'Have a 10\' truck booked, room for 2 more.' },
  { id: 'demo_priya', name: 'Priya Shah', school: 'Carnegie Mellon', year: '2026', avatar: '📚', bio: 'Moving to NYC for my first job. Driving a 20\' truck Saturday morning.' },
  { id: 'demo_sam', name: 'Sam Rivera', school: 'Pitt', year: '2026', avatar: '🎨', bio: 'Heading to Brooklyn. Fragile art, please be gentle!' },
  { id: 'demo_li', name: 'Li Wei', school: 'Carnegie Mellon', year: '2028', avatar: '🍜', bio: 'Need to store a mini fridge, a desk and a few boxes.' },
  { id: 'demo_ava', name: 'Ava Brooks', school: 'Chatham', year: '2027', avatar: '🌟', bio: 'Moving to New York, flexible on pickup time.' },
  { id: 'demo_noah', name: 'Noah Kim', school: 'Duquesne', year: '2026', avatar: '🐶', bio: 'Going to Philadelphia, just boxes and a bike.' },
] as const

const box = (qty: number) => ({ kind: 'preset', key: 'box_medium', qty })
const item = (key: string, qty = 1) => ({ kind: 'preset', key, qty })
const contact = (id: string) => ({ method: 'email', handle: `${id.slice(5)}.demo@example.com` })

/** Pick a move date: the owner's own move if it's far enough out, else two weeks from today. */
function demoDate(own?: string): string {
  const soonest = Date.now() + 5 * 86_400_000
  if (own && Date.parse(`${own}T12:00:00Z`) > soonest) return own
  return new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
}

export function createDemoActions(all: Actions): Actions {
  const as = async (userId: string, name: string, params: Record<string, unknown>, tools: ActionTools, env: Env) =>
    (await all[name]({ userId, params, tools, env, callerJwt: '' })) as Result

  /** What the steps share: the date and the owner's move, so one demo truck fits it. */
  async function plan(tools: ActionTools, ownerId: string) {
    const d = await tools.query<{ date?: string; pickup?: { key?: string }; destination?: { key?: string }; moveType?: string }>('moveDrafts', { where: { userId: ownerId }, limit: 1 })
    const own = d.success ? d.data.records[0]?.data : undefined
    const date = demoDate(own?.date)
    const usable = own?.date === date && own.pickup?.key && own.destination?.key && own.moveType !== 'city'
    return {
      date,
      fitsOwner: !!usable,
      mayaPickup: usable ? own!.pickup!.key! : 'morewood',
      mayaDest: usable ? own!.destination!.key! : 'st-keep-springgarden',
    }
  }

  return {
    /** Run seeding step `step` (0..N-1). Returns { next } until done. Owner only. */
    async seedDemo({ userId, params, tools, env }) {
      if (userId !== env.OWNER_USER_ID) return { success: false, error: 'Only the app owner can load demo data', code: 'forbidden' }
      const step = Number(params.step ?? 0)
      const p = await plan(tools, userId)
      const local = (pickup: string, destination: string, items: unknown[], extra: Record<string, unknown> = {}) =>
        ({ date: p.date, moveType: 'local', pickup, destination, storageMonths: destination.startsWith('st-') ? 3 : 0, items, ...extra })
      const city = (pickup: string, destination: string, items: unknown[]) => ({ date: p.date, moveType: 'city', pickup, destination, storageMonths: 0, items })
      const moves: Record<string, Record<string, unknown>> = {
        demo_maya: local(p.mayaPickup, p.mayaDest, [box(10), item('mini_fridge'), item('mattress_twin'), item('desk'), item('lamp')]),
        demo_emma: local(p.mayaPickup === 'morewood' ? 'c-oakland' : p.mayaPickup, p.mayaDest, [box(14), item('plant', 3), item('bookshelf')]),
        demo_jordan: local('pitt-towers', 'st-extra-braddock', [box(8), item('desk'), item('office_chair')]),
        demo_li: local('shadyside', p.mayaDest, [box(6), item('mini_fridge'), item('desk')]),
        demo_priya: city('cmu', 'nyc:midtown', [box(20), item('bed_full_set'), item('dresser_6'), item('desk'), item('monitor', 2)]),
        demo_sam: city('pitt-sutherland', 'nyc:williamsburg', [box(12), item('artwork', 4), item('mirror')]),
        demo_ava: city('chatham', 'nyc:uws', [box(10), item('mattress_twin'), item('tv')]),
        demo_noah: city('duquesne', 'philly:ucity', [box(9), item('bike')]),
      }
      const steps: (() => Promise<string | void>)[] = [
        // 0: people
        async () => {
          for (const x of PEOPLE) {
            await tools.registerUser({ userId: x.id, name: x.name, email: `${x.id.slice(5)}.demo@example.invalid` })
            await as(x.id, 'saveProfile', { school: x.school, year: x.year, bio: x.bio, avatar: x.avatar, emailNotify: false }, tools, env)
          }
        },
        // 1-8: each person's move + wallet
        ...PEOPLE.map((x) => async () => {
          const r = await as(x.id, 'saveDraft', { ...moves[x.id], contact: contact(x.id) }, tools, env)
          if (!r.success) return `${x.name}: ${r.error}`
          await as(x.id, 'topUp', { amountCents: 20_000 }, tools, env)
          await as(x.id, 'topUp', { amountCents: 20_000 }, tools, env)
        }),
        // 9: people looking (opt in before trucks appear, so they get alerts)
        async () => { for (const id of ['demo_li', 'demo_ava', 'demo_noah']) await as(id, 'setLooking', { on: true }, tools, env) },
        // 10: Maya's truck (fits the owner's move when there is one) + Emma joins
        async () => {
          const r = await as('demo_maya', 'createPool', { vehicleType: 'truck_15', departureTime: '09:30', hasStorage: p.mayaDest.startsWith('st-'), storageMonthlyCents: p.mayaDest.startsWith('st-') ? 18900 : 0 }, tools, env)
          if (!r.success) return `Maya's truck: ${r.error}`
          const j = await as('demo_emma', 'joinPool', { poolId: r.data!.poolId }, tools, env)
          if (!j.success) return `Emma: ${j.error}`
        },
        // 11: Jordan's truck (no one yet)
        async () => {
          const r = await as('demo_jordan', 'createPool', { vehicleType: 'truck_10', departureTime: '11:00' }, tools, env)
          if (!r.success) return `Jordan's truck: ${r.error}`
        },
        // 12: Priya's truck to NYC + Sam joins
        async () => {
          const r = await as('demo_priya', 'createPool', { vehicleType: 'truck_20', departureTime: '07:00', quote: { perMileCents: 79, miles: 371, fuelCents: 13000, otherCents: 3000 } }, tools, env)
          if (!r.success) return `Priya's truck: ${r.error}`
          const j = await as('demo_sam', 'joinPool', { poolId: r.data!.poolId }, tools, env)
          if (!j.success) return `Sam: ${j.error}`
        },
        // 13: group-chat messages
        async () => {
          const convs = await tools.query<{ poolId: string; memberIds: string[] }>('conversations', { where: { kind: 'pool' }, limit: 200 })
          const lines: Record<string, [string, string][]> = {
            demo_maya: [['demo_maya', 'Hi Emma! I booked a 15\' truck, leaving 9:30. I can pick you up second.'], ['demo_emma', 'Perfect, I\'ll have everything by the door. My plants ride on top so nothing squashes them 🪴'], ['demo_maya', 'Ha, of course. Anyone else who fits is welcome — sharing the link.']],
            demo_priya: [['demo_priya', 'Sam, we leave at 7. I-76 the whole way, ~6.5 hours.'], ['demo_sam', 'Great. My framed art is wrapped — can it ride on top so nothing gets stacked on it?'], ['demo_priya', 'Yes — fragile stuff always rides on top. See you Saturday!']],
          }
          for (const c of convs.success ? convs.data.records : []) {
            const org = c.data.memberIds.find((m) => m in lines)
            if (!org) continue
            for (const [from, text] of lines[org]) await as(from, 'sendMessage', { conversationId: c.recordId, text }, tools, env)
          }
        },
        // 14: things that happen to YOU: Li messages you; Maya invites you if her truck fits your move
        async () => {
          const dm = await as('demo_li', 'openDm', { userId }, tools, env)
          if (dm.success) await as('demo_li', 'sendMessage', { conversationId: dm.data!.conversationId, text: `Hi! I saw you're moving ${p.date} too. Are you looking for a truck? I only have a few boxes, a desk and a mini fridge.` }, tools, env)
          if (p.fitsOwner) {
            const pools = await tools.query<{ organizerId: string; status: string }>('pools', { where: { organizerId: 'demo_maya', status: 'open' }, limit: 1 })
            const pool = pools.success ? pools.data.records[0] : null
            if (pool) {
              await as(userId, 'setLooking', { on: true }, tools, env)
              await as('demo_maya', 'invite', { poolId: pool.recordId, userId }, tools, env)
            }
          }
        },
      ]
      if (step < 0 || step >= steps.length) return { success: false, error: 'bad step', code: 'bad_step' }
      const warning = await steps[step]()
      return { success: true, data: { next: step + 1 < steps.length ? step + 1 : null, total: steps.length, warning: warning ?? null, date: p.date, fitsOwner: p.fitsOwner } }
    },

    /** Remove all demo data. Real people in demo trucks get their holds back, no fee. Owner only. */
    async clearDemo({ userId, tools, env }) {
      if (userId !== env.OWNER_USER_ID) return { success: false, error: 'Only the app owner can remove demo data', code: 'forbidden' }
      const ids = PEOPLE.map((x) => x.id)
      let pools = 0
      for (const id of ids) {
        const own = await tools.query<{ status: string }>('pools', { where: { organizerId: id }, limit: 20 })
        for (const p of own.success ? own.data.records : []) {
          if (p.data.status === 'cancelled' || p.data.status === 'completed') continue
          pools++
          const seats = await tools.query<{ userId: string; status: string }>('seats', { where: { poolId: p.recordId, status: 'active' }, limit: 20 })
          for (const s of seats.success ? seats.data.records : []) {
            await tools.update('seats', s.recordId, { status: 'left', activeUserKey: null })
            if (isDemoId(s.data.userId)) continue
            // A real person was in a demo truck: return any hold, no fee.
            const txs = await tools.query<{ amountCents: number; kind: string; poolId?: string }>('walletTx', { where: { userId: s.data.userId, poolId: p.recordId }, limit: 100 })
            const held = -(txs.success ? txs.data.records : []).filter((t) => ['hold', 'adjust', 'release'].includes(t.data.kind)).reduce((a, t) => a + t.data.amountCents, 0)
            if (held > 0) await tools.create('walletTx', { userId: s.data.userId, poolId: p.recordId, amountCents: held, kind: 'release', key: `demo-release:${p.recordId}:${s.data.userId}`, note: 'Demo truck removed — hold returned', at: Date.now(), testMode: true })
          }
          await tools.update('pools', p.recordId, { status: 'cancelled', cancelReason: 'organizer' })
          const chats = await tools.query('conversations', { where: { kind: 'pool', poolId: p.recordId }, limit: 5 })
          for (const c of chats.success ? chats.data.records : []) {
            await tools.deleteWhere('messages', { conversationId: c.recordId }, 500)
            await tools.remove('conversations', c.recordId)
          }
        }
      }
      for (const id of ids) {
        for (const c of ['profiles', 'lookingPosts', 'moveDrafts', 'walletTx', 'aiUsage'] as const) await tools.deleteWhere(c, { userId: id }, 500)
        await tools.deleteWhere('notifications', { fromUserId: id }, 500)
        await tools.deleteWhere('seats', { userId: id }, 100)
        const dms = await tools.query<{ dmKey?: string }>('conversations', { where: { kind: 'dm' }, limit: 500 })
        for (const c of dms.success ? dms.data.records : []) {
          if (!c.data.dmKey?.split('|').includes(id)) continue
          await tools.deleteWhere('messages', { conversationId: c.recordId }, 500)
          await tools.remove('conversations', c.recordId)
        }
        await tools.remove('users', id)
      }
      return { success: true, data: { pools, people: ids.length } }
    },
  }
}
