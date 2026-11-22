/**
 * HaulPool server actions (spec §9.2). Every write in the app goes through here.
 *
 * Server actions bypass RBAC: the app's own checks below ARE the trust boundary.
 * Identity always comes from ctx.userId (verified JWT), never from params.
 */
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { CONFIG, VEHICLES, type VehicleType } from '../config'
import { fragileCuFt, totalCuFt, usableCuFt, type ItemLine } from '../lib/volume'
import { detourCapMi, haversineMi } from '../lib/route'
import { bestInsertion, roadMi, routeMi } from '../lib/route'
import { daysBetween, hardFilter, rankPools, type PoolCandidate } from '../lib/match'
import { quoteTotalCents, type Quote } from '../lib/split'
import { HOME_CITY_KEY, placeByKey, storageByKey } from '../places'
import { cancelOp, changePool, joinPool, leaveLockedOp, leaveOp, lockOp, resizeOp, seatPickupOp, seatResizeOp, transferOp, usedCuFt, type LockStore, type Snapshot } from '../lib/versionLock'
import { cancelCredits, extraRouteCents, heldFor, poolCharges, type MoneySeat, type Tx } from '../lib/wallet'
import { storageSplit } from '../lib/split'
import { CLIENT_EVENTS, cleanProps, type EventName } from '../lib/events'
import { createDemoActions } from './demo'
import { SCAN_LIMITS, isImageDataUrl, parseScanReply, scanPrompt } from '../lib/scan'
import { createDeepSpaceAI } from 'deepspace/worker'
import { generateText } from 'ai'

type Place = { label: string; lat: number; lng: number; key?: string; cityKey?: string; cityLabel?: string }
type MoveType = 'local' | 'city'
type Detail = { address?: string; lat?: number; lng?: number }
type Contact = { method: string; handle: string }
type Draft = {
  date?: string; items: ItemLine[]; volumeCuFt: number; pickup?: Place; destination?: Place; storageMonths?: number; moveType?: MoveType
  pickupDetail?: Detail; destDetail?: Detail; contact?: Contact; flexDays?: number
}
type Pool = {
  organizerId: string; date: string; status: Snapshot['status']; vehicleType: VehicleType; capacityCuFt: number; bufferPct: number
  areaLabel?: string; destinationKey?: string; destinationLabel?: string; hasStorage?: boolean; storageMonthlyCents?: number
  quote: Quote; quoteIsEstimate?: boolean; organizerDiscountPct: number; deadlineAt: number; departureTime?: string
  moveType?: MoveType; fromCity?: string; toCity?: string
}

const fail = (error: string, code?: string) => ({ success: false as const, error, ...(code ? { code } : {}) })
const ok = <T>(data: T) => ({ success: true as const, data })
const isDuplicate = (r: { success: boolean; error?: string }) => !r.success && /^Duplicate/i.test(r.error ?? '')

// ---------------------------------------------------------------- version-lock store over tools

function lockStore(tools: ActionTools): LockStore {
  return {
    async head(poolId) {
      const r = await tools.query<{ version: number; snapshot: Snapshot }>('poolVersions', {
        where: { poolId }, orderBy: 'version', orderDir: 'desc', limit: 1,
      })
      if (!r.success || r.data.records.length === 0) throw new Error(`No ledger for pool ${poolId}`)
      const { version, snapshot } = r.data.records[0].data
      return { version, snapshot }
    },
    async claimVersion(poolId, version, op, actorId, snapshot) {
      const r = await tools.create('poolVersions', { poolId, version, op, actorId, snapshot })
      if (r.success) return true
      if (isDuplicate(r)) return false
      throw new Error(r.error)
    },
    async reserveUser(seatId, poolId, userId, volumeCuFt) {
      const r = await tools.create('seats', { poolId, userId, volumeCuFt, status: 'pending', activeUserKey: userId }, seatId)
      if (r.success) return true
      if (isDuplicate(r)) return false
      throw new Error(r.error)
    },
    async setSeatStatus(seatId, status) {
      const patch: Record<string, unknown> = status === 'active' ? { status } : { status, activeUserKey: null }
      const r = await tools.update('seats', seatId, patch)
      if (!r.success) throw new Error(r.error)
    },
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    now: () => Date.now(),
  }
}

// ---------------------------------------------------------------- helpers

async function getDraft(tools: ActionTools, userId: string): Promise<(Draft & { recordId: string }) | null> {
  const r = await tools.query<Draft>('moveDrafts', { where: { userId }, limit: 1 })
  if (!r.success || r.data.records.length === 0) return null
  return { ...r.data.records[0].data, recordId: r.data.records[0].recordId }
}

async function getPool(tools: ActionTools, poolId: string): Promise<Pool | null> {
  const r = await tools.get<Pool>('pools', poolId)
  return r.success ? r.data.record.data : null
}

/**
 * Rebuild the members-only stop list from the ledger head. Re-checks the head after writing so a
 * slower concurrent writer can't leave an older snapshot in place (spec §11 review note).
 */
async function syncPrivate(tools: ActionTools, poolId: string, privateId: string, destination: Place): Promise<void> {
  const store = lockStore(tools)
  for (let i = 0; i < 3; i++) {
    const { version, snapshot } = await store.head(poolId)
    const seats = snapshot.seats.filter((s) => s.pickup)
    // organizer first, then each later member at their cheapest position
    const order: typeof seats = []
    for (const s of seats) {
      if (order.length === 0) { order.push(s); continue }
      const pos = bestInsertion(order.map((x) => x.pickup!), destination, s.pickup!).position
      order.splice(Math.max(pos, 1), 0, s)
    }
    // Exact addresses and contact come from each member's own (private) draft and are shown
    // only inside this members-only record.
    const drafts = new Map<string, Draft | null>()
    for (const s of snapshot.seats) drafts.set(s.userId, await getDraft(tools, s.userId))
    const stops = order.map((s, k) => {
      const d = drafts.get(s.userId)
      return {
        seatId: s.seatId, userId: s.userId, label: s.pickup!.label, lat: s.pickup!.lat, lng: s.pickup!.lng, order: k + 1,
        address: d?.pickupDetail?.address, exact: d?.pickupDetail?.lat !== undefined ? { lat: d.pickupDetail.lat, lng: d.pickupDetail.lng } : undefined,
        contact: d?.contact,
      }
    })
    const dropoffs = snapshot.seats.map((s) => {
      const d = drafts.get(s.userId)
      return {
        seatId: s.seatId, userId: s.userId, label: d?.destination?.label ?? destination.label,
        address: d?.destDetail?.address, exact: d?.destDetail?.lat !== undefined ? { lat: d.destDetail.lat, lng: d.destDetail.lng } : undefined,
      }
    })
    await tools.update('poolPrivate', privateId, {
      memberIds: snapshot.seats.map((s) => s.userId),
      stops,
      dropoffs,
      routeMiles: Math.round(routeMi([...order.map((s) => s.pickup!), destination]) * 10) / 10,
    })
    const again = await store.head(poolId)
    if (again.version === version) return
  }
}

async function getPrivate(tools: ActionTools, poolId: string) {
  const r = await tools.query<{ destination: Place }>('poolPrivate', { where: { poolId }, limit: 1 })
  if (!r.success || r.data.records.length === 0) return null
  return { id: r.data.records[0].recordId, destination: r.data.records[0].data.destination }
}

/** Write one analytics event. Never throws and never blocks the user's action on failure. */
async function track(tools: ActionTools, name: EventName, userId: string, extra: { poolId?: string; props?: Record<string, unknown> } = {}) {
  if (userId.startsWith('demo_')) return // demo people never count in the funnel
  try {
    const at = Date.now()
    await tools.create('events', { name, userId, at, day: new Date(at).toISOString().slice(0, 10), poolId: extra.poolId, props: extra.props ?? {} })
  } catch { /* analytics must never break the product */ }
}

/** A place chosen from the lists (key) or a geocoded city ({label, lat, lng}) from findCity. */
function resolvePlace(input: unknown): Place | null {
  if (typeof input === 'string') {
    const p = placeByKey(input)
    return p ? { key: p.key, label: p.label, lat: p.lat, lng: p.lng, cityKey: p.cityKey, cityLabel: p.cityLabel } : null
  }
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    const lat = Number(o.lat), lng = Number(o.lng)
    const label = String(o.label ?? '').replace(/[^\p{L}\p{N} ,.'()-]/gu, '').slice(0, 60).trim()
    // Continental US + AK/HI bounding box; keeps junk coordinates out.
    if (!label || !(lat > 18 && lat < 72) || !(lng > -170 && lng < -65)) return null
    const cityKey = `geo:${lat.toFixed(3)},${lng.toFixed(3)}`
    return { key: cityKey, label: `Anywhere in ${label}`, lat, lng, cityKey, cityLabel: label }
  }
  return null
}

const CONTACT_METHODS = ['text', 'call', 'whatsapp', 'wechat', 'email', 'instagram'] as const

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.replace(/[<>{}\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
  return t || undefined
}

/** Exact spot: optional street address and/or pinned coordinates, which must be near the chosen area. */
function parseDetail(input: unknown, area?: Place): Detail | undefined | 'too_far' {
  if (!input || typeof input !== 'object') return undefined
  const o = input as Record<string, unknown>
  const address = cleanText(o.address, 120)
  const lat = Number(o.lat), lng = Number(o.lng)
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && o.lat !== undefined && o.lng !== undefined
  if (hasPin && area && haversineMi({ lat, lng }, area) > 30) return 'too_far'
  if (!address && !hasPin) return undefined
  return { address, ...(hasPin ? { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : {}) }
}

function parseContact(input: unknown): Contact | undefined | 'bad' {
  if (input === null) return undefined
  if (!input || typeof input !== 'object') return 'bad'
  const o = input as Record<string, unknown>
  const method = String(o.method ?? '')
  const handle = cleanText(o.handle, 60)
  if (!(CONTACT_METHODS as readonly string[]).includes(method) || !handle) return 'bad'
  if (method === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(handle)) return 'bad'
  if ((method === 'text' || method === 'call' || method === 'whatsapp') && !/^[+\d][\d\s().-]{6,20}$/.test(handle)) return 'bad'
  return { method, handle }
}

/**
 * Your current seat, if your pool is still going. A seat in a finished (completed or cancelled)
 * pool is released on the spot, so a finished move never blocks your next one.
 */
async function activeSeat(tools: ActionTools, userId: string) {
  const r = await tools.query<{ poolId: string; volumeCuFt: number; isOrganizer?: boolean }>('seats', { where: { userId, status: 'active' }, limit: 5 })
  if (!r.success) return null
  for (const rec of r.data.records) {
    const pool = await tools.get<{ status: string } & Record<string, unknown>>('pools', rec.data.poolId)
    const status = pool.success ? pool.data.record.data.status : 'cancelled'
    if (status === 'completed' || status === 'cancelled') {
      await tools.update('seats', rec.recordId, { status: status === 'completed' ? 'done' : 'left', activeUserKey: null })
      continue
    }
    return { id: rec.recordId, ...rec.data }
  }
  return null
}

// ---------------------------------------------------------------- wallet (rules in src/lib/wallet.ts)

const PLATFORM = '__platform__'
type SeatRow = { userId: string; volumeCuFt: number; isOrganizer?: boolean; extraCents?: number; storageMonths?: number; status: string }

type TxRow = Tx & { at?: number } & Record<string, unknown>
async function userTxs(tools: ActionTools, userId: string): Promise<TxRow[]> {
  const r = await tools.query<TxRow>('walletTx', { where: { userId }, limit: 1000 })
  return r.success ? r.data.records.map((x) => x.data) : []
}
const balanceFor = async (tools: ActionTools, userId: string) => (await userTxs(tools, userId)).reduce((a, t) => a + t.amountCents, 0)

/** Insert a ledger row. A duplicate key means this step already happened: fine, not an error. */
async function writeTx(tools: ActionTools, tx: Tx): Promise<void> {
  if (tx.amountCents === 0) return
  const r = await tools.create('walletTx', { ...tx, note: tx.note?.slice(0, 140), at: Date.now(), testMode: true })
  if (!r.success && !isDuplicate(r)) throw new Error(r.error)
}

async function activeSeatRows(tools: ActionTools, poolId: string) {
  const r = await tools.query<SeatRow>('seats', { where: { poolId, status: 'active' }, limit: 20 })
  return r.success ? r.data.records : []
}

function moneySeats(pool: Pool, seats: { recordId: string; data: SeatRow }[]): MoneySeat[] {
  const storage = pool.hasStorage && pool.storageMonthlyCents
    ? storageSplit(pool.storageMonthlyCents, seats.map((s) => ({ seatId: s.recordId, volumeCuFt: s.data.volumeCuFt, months: Math.max(1, s.data.storageMonths || 1) })))
    : new Map<string, number>()
  return seats.map((s) => ({
    seatId: s.recordId, userId: s.data.userId, volumeCuFt: s.data.volumeCuFt, isOrganizer: !!s.data.isOrganizer,
    extraCents: s.data.extraCents ?? 0, storageCents: storage.get(s.recordId) ?? 0,
  }))
}

/**
 * After lock, every member's hold must equal what they owe now (share + fee + extra).
 * Called after lock, a late leave, a price edit or an accepted address change. The key includes
 * the ledger version, so re-running for the same state never double-charges.
 */
async function reconcileHolds(tools: ActionTools, poolId: string): Promise<void> {
  const pool = await getPool(tools, poolId)
  if (!pool || (pool.status !== 'locked' && pool.status !== 'in_progress')) return
  const { version } = await lockStore(tools).head(poolId)
  const seats = await activeSeatRows(tools, poolId)
  const charges = poolCharges(quoteTotalCents(pool.quote), moneySeats(pool, seats), pool.organizerDiscountPct)
  for (const s of seats) {
    const target = charges.get(s.recordId)!.total
    const held = heldFor(await userTxs(tools, s.data.userId), poolId)
    if (target === held) continue
    await writeTx(tools, {
      userId: s.data.userId, poolId, amountCents: held - target, kind: held === 0 ? 'hold' : 'adjust',
      key: `hold:${poolId}:${s.recordId}:v${version}:${held}>${target}`,
      note: held === 0 ? 'Held for your truck share + 8% service fee' : 'Share changed (someone left, the price was updated, or a route change)',
    })
  }
}

/** What a newcomer of this size would owe if they joined now (used for the balance check). */
function estimateFor(pool: Pool, seats: { recordId: string; data: SeatRow }[], volumeCuFt: number): number {
  const rows = [...seats, { recordId: '__new__', data: { userId: '__new__', volumeCuFt, status: 'active', isOrganizer: false } as SeatRow }]
  return poolCharges(quoteTotalCents(pool.quote), moneySeats(pool, rows), pool.organizerDiscountPct).get('__new__')!.total
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`

/** Default deadline: 3 days before move day, but never sooner than 2 hours from now. */
function defaultDeadline(date: string): number | null {
  const dayStart = Date.parse(`${date}T00:00:00-05:00`)
  const d = Math.max(dayStart - CONFIG.deadline.daysBefore * 86_400_000, Date.now() + CONFIG.deadline.minLeadHours * 3_600_000)
  return d < dayStart ? d : null
}

/** A pool as the matcher sees it (ledger head + members-only destination). */
async function candidateFor(tools: ActionTools, poolId: string, p: Pool): Promise<PoolCandidate | null> {
  const priv = await getPrivate(tools, poolId)
  if (!priv) return null
  const { snapshot } = await lockStore(tools).head(poolId)
  return {
    poolId, date: p.date, status: snapshot.status, deadlineAt: p.deadlineAt,
    usableCuFt: snapshot.usableCuFt, usedCuFt: usedCuFt(snapshot),
    pickups: snapshot.seats.filter((s) => s.pickup).map((s) => ({ lat: s.pickup!.lat, lng: s.pickup!.lng })),
    destination: priv.destination, destinationKey: p.destinationKey, quote: p.quote, organizerDiscountPct: p.organizerDiscountPct,
    seats: snapshot.seats.map((s) => ({ seatId: s.seatId, volumeCuFt: s.volumeCuFt, isOrganizer: !!s.isOrganizer, storageMonths: s.storageMonths })),
  }
}

// ---------------------------------------------------------------- social: names, notifications, email

const APP_URL = 'https://haulpool.app.space'
type UserRow = { email?: string; name?: string }
type Profile = { userId: string; school?: string; year?: string; bio?: string; avatar?: string; emailNotify?: boolean }
type LookingPost = {
  userId: string; status: 'looking' | 'matched' | 'hidden'; date?: string; moveType?: string; fromLabel?: string; toLabel?: string
  fromCity?: string; toCity?: string; destinationKey?: string; pickup?: { lat: number; lng: number }; destination?: { lat: number; lng: number }; volumeCuFt?: number
  flexDays?: number
}

async function userRow(tools: ActionTools, userId: string): Promise<UserRow | null> {
  const r = await tools.get<UserRow & Record<string, unknown>>('users', userId)
  return r.success ? r.data.record.data : null
}
const firstName = (u: UserRow | null) => (u?.name ?? 'Someone').split(' ')[0]

async function profileRec(tools: ActionTools, userId: string) {
  const r = await tools.query<Profile>('profiles', { where: { userId }, limit: 1 })
  return r.success && r.data.records.length ? r.data.records[0] : null
}

/**
 * In-app notification (+ email when asked and the person hasn't turned emails off).
 * The notification key is unique: the same event never notifies or emails twice.
 */
async function notify(tools: ActionTools, n: { userId: string; kind: string; title: string; body?: string; link?: string; key: string; fromUserId?: string; email?: boolean }): Promise<void> {
  try {
    const r = await tools.create('notifications', { userId: n.userId, kind: n.kind, title: n.title.slice(0, 120), body: n.body?.slice(0, 240), link: n.link, fromUserId: n.fromUserId, read: false, at: Date.now(), key: n.key })
    if (!r.success) return // duplicate = already sent
    if (!n.email) return
    const profile = await profileRec(tools, n.userId)
    if (profile?.data.emailNotify === false) return
    const to = (await userRow(tools, n.userId))?.email
    if (!to || to.endsWith('.invalid')) return // demo people never get email
    const url = `${APP_URL}${n.link ?? '/home'}`
    await tools.integration('email/send', {
      to,
      subject: n.title,
      text: `${n.body ?? ''}\n\nOpen HaulPool: ${url}\n\nYou get these emails because you use HaulPool. Turn them off in your profile.`,
      html: `<p style="font:16px/1.5 sans-serif">${escapeHtml(n.body ?? '')}</p><p><a href="${url}" style="background:#0a6b45;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font:600 15px sans-serif">Open HaulPool</a></p><p style="font:12px sans-serif;color:#56625d">You get these because you use HaulPool. Turn emails off in your profile.</p>`,
    })
  } catch { /* notifications must never break the action that triggered them */ }
}
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const prettyDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const poolRoute = (p: Pool) => (p.moveType === 'city' ? `${p.fromCity} → ${p.toCity}` : `${p.areaLabel || 'campus'} → ${p.destinationLabel}`)

/** Tell everyone in a pool (except `exceptUserId`). */
async function notifyPool(tools: ActionTools, poolId: string, exceptUserId: string | null, n: { kind: string; title: string; body?: string; keyPart: string; email?: boolean; fromUserId?: string }) {
  for (const s of await activeSeatRows(tools, poolId)) {
    if (s.data.userId === exceptUserId) continue
    await notify(tools, { userId: s.data.userId, kind: n.kind, title: n.title, body: n.body, link: `/pools/${poolId}`, key: `${n.kind}:${poolId}:${n.keyPart}:${s.data.userId}`, email: n.email, fromUserId: n.fromUserId })
  }
}

/** Keep the public "looking" post in step with the draft and pool membership (if the person opted in). */
async function syncLooking(tools: ActionTools, userId: string, opts: { create?: boolean; status?: LookingPost['status'] } = {}) {
  const r = await tools.query<LookingPost>('lookingPosts', { where: { userId }, limit: 1 })
  const existing = r.success && r.data.records.length ? r.data.records[0] : null
  if (!existing && !opts.create) return
  const draft = await getDraft(tools, userId)
  const inPool = !!(await activeSeat(tools, userId))
  const status: LookingPost['status'] = opts.status ?? (existing?.data.status === 'hidden' ? 'hidden' : inPool ? 'matched' : 'looking')
  const data = {
    userId, status, date: draft?.date, moveType: draft?.moveType ?? 'local',
    fromLabel: draft?.pickup?.label, toLabel: draft?.destination?.label,
    fromCity: cityLabelOf(draft?.pickup), toCity: cityLabelOf(draft?.destination), destinationKey: draft?.destination?.key,
    pickup: draft?.pickup ? { lat: draft.pickup.lat, lng: draft.pickup.lng } : undefined,
    destination: draft?.destination ? { lat: draft.destination.lat, lng: draft.destination.lng } : undefined,
    volumeCuFt: draft?.volumeCuFt ?? 0, flexDays: draft?.flexDays ?? CONFIG.dates.flexDefaultDays, updatedAt: Date.now(),
  }
  if (existing) await tools.update('lookingPosts', existing.recordId, data)
  else await tools.create('lookingPosts', data)
}

/** Would this looking person fit this pool? Same rules as search. */
function lookerFits(post: LookingPost, c: PoolCandidate): boolean {
  if (!post.date || !post.pickup || !post.destination || !post.volumeCuFt) return false
  return hardFilter(
    { userId: post.userId, date: post.date, pickup: post.pickup, destination: post.destination, destinationKey: post.destinationKey, volumeCuFt: post.volumeCuFt, flexDays: post.flexDays ?? 0 },
    c, Date.now(),
  ).ok
}

/** A new truck: tell looking people it fits (in-app + email). */
async function announcePool(tools: ActionTools, poolId: string, pool: Pool) {
  const c = await candidateFor(tools, poolId, pool)
  if (!c) return
  const posts = await tools.query<LookingPost>('lookingPosts', { where: { status: 'looking' }, limit: 300 })
  if (!posts.success) return
  const who = firstName(await userRow(tools, pool.organizerId))
  for (const p of posts.data.records) {
    if (p.data.userId === pool.organizerId || !lookerFits(p.data, c)) continue
    await notify(tools, {
      userId: p.data.userId, kind: 'new_truck', fromUserId: pool.organizerId, link: `/pools/${poolId}`, key: `new_truck:${poolId}:${p.data.userId}`, email: true,
      title: `${who} is going ${pool.moveType === 'city' ? `to ${pool.toCity}` : `to ${pool.destinationLabel}`} on ${prettyDate(pool.date)} — join their truck?`,
      body: `A new ${VEHICLES[pool.vehicleType]?.label.toLowerCase() ?? 'truck'} matches your move (${poolRoute(pool)}). Open it to see your share.`,
    })
  }
}

/** The pool's group chat: one per pool, members = everyone in it (history visible to new members). */
async function syncPoolChat(tools: ActionTools, poolId: string, pool?: Pool | null) {
  const p = pool ?? (await getPool(tools, poolId))
  if (!p) return
  const members = (await activeSeatRows(tools, poolId)).map((s) => s.data.userId)
  const r = await tools.query<{ poolId: string }>('conversations', { where: { kind: 'pool', poolId }, limit: 1 })
  const conv = r.success && r.data.records.length ? r.data.records[0] : null
  const title = `${poolRoute(p)} · ${prettyDate(p.date)}`
  if (!conv) {
    await tools.create('conversations', { kind: 'pool', poolId, memberIds: members, title, lastAt: 0, reads: {} })
    return
  }
  await tools.update('conversations', conv.recordId, { memberIds: members, title })
  const msgs = await tools.query('messages', { where: { conversationId: conv.recordId }, limit: 500 })
  if (msgs.success) for (const m of msgs.data.records) await tools.update('messages', m.recordId, { memberIds: members })
}

const cityLabelOf = (p?: Place) => p?.cityLabel ?? 'Pittsburgh, PA'
const cityKeyOf = (p?: Place) => p?.cityKey ?? HOME_CITY_KEY

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// ---------------------------------------------------------------- actions

export const actions: Record<string, ActionHandler<Env>> = {
  /** Save "My move". Server recomputes volume; pickup and storage are chosen from src/places.ts. */
  async saveDraft({ userId, params, tools }) {
    const existing = await getDraft(tools, userId)
    // A save that doesn't send items (e.g. contact only) keeps the list you already have.
    const items = (params.items ?? existing?.items ?? []) as ItemLine[]
    let volumeCuFt: number
    try { volumeCuFt = totalCuFt(items) } catch (e) { return fail((e as Error).message, 'bad_items') }
    if (params.date !== undefined && !isDate(params.date)) return fail('Date must be YYYY-MM-DD', 'bad_date')
    const flexDays = params.flexDays !== undefined
      ? Math.max(0, Math.min(CONFIG.dates.flexMaxDays, Math.round(Number(params.flexDays) || 0)))
      : existing?.flexDays ?? CONFIG.dates.flexDefaultDays
    const moveType: MoveType = params.moveType === 'city' ? 'city' : params.moveType === 'local' ? 'local' : existing?.moveType ?? 'local'
    let pickup = existing?.pickup
    const pickupIn = params.pickup ?? params.pickupKey
    if (pickupIn !== undefined) {
      const p = resolvePlace(pickupIn)
      if (!p) return fail('Pick where you are moving from', 'bad_pickup')
      pickup = p
    }
    let destination = existing?.destination
    const destIn = params.destination ?? params.destinationKey ?? params.storageKey
    if (destIn !== undefined) {
      const d = resolvePlace(destIn)
      if (!d) return fail('Pick where you are moving to', 'bad_destination')
      destination = d
    }
    if (pickup && destination) {
      const sameCity = cityKeyOf(pickup) === cityKeyOf(destination)
      if (moveType === 'local' && !sameCity) return fail('For a move to another city, choose "City to city"', 'wrong_move_type')
      if (moveType === 'city' && sameCity) return fail('Pick a different city to move to, or choose "Around town"', 'wrong_move_type')
      if (pickup.key === destination.key) return fail('Pickup and destination are the same place', 'same_place')
    }
    let pickupDetail = existing?.pickupDetail
    if (params.pickupDetail !== undefined) {
      const d = parseDetail(params.pickupDetail, pickup)
      if (d === 'too_far') return fail('Your pinned location is far from the pickup area you chose. Pick the area again or re-pin.', 'bad_detail')
      pickupDetail = d
    }
    let destDetail = existing?.destDetail
    if (params.destDetail !== undefined) {
      const d = parseDetail(params.destDetail, destination)
      if (d === 'too_far') return fail('That drop-off pin is far from the area you chose.', 'bad_detail')
      destDetail = d
    }
    let contact = existing?.contact
    if (params.contact !== undefined) {
      const c = parseContact(params.contact)
      if (c === 'bad') return fail('Check your contact: pick a method and enter a valid number, email or handle.', 'bad_contact')
      contact = c
    }

    // Already in a pool? The pool must stay consistent with this move.
    const seat = await activeSeat(tools, userId)
    let poolToSync: { poolId: string; seatId: string } | null = null
    let orgDestChange = false
    let destExtraCents = 0
    if (seat) {
      const pool = await getPool(tools, seat.poolId)
      const date = (params.date as string | undefined) ?? existing?.date
      if (pool && date !== pool.date) return fail('You are in a pool for that day, so the date is fixed. Leave the pool to change it.', 'in_pool')
      if (pool && moveType !== (pool.moveType ?? 'local')) return fail('You are in a pool, so the kind of move is fixed. Leave the pool to change it.', 'in_pool')
      const pickupChanged = !!pickup && (pickup.key ?? '') !== (existing?.pickup?.key ?? '')
      const destChanged = !!destination && (destination.key ?? '') !== (existing?.destination?.key ?? '')
      if (pool && pickupChanged && destChanged) return fail('Change your pickup and your destination one at a time.', 'one_at_a_time')

      // New destination while in a pool.
      //   organizer, before lock: the truck's destination changes; everyone is told and can leave free.
      //   organizer, after lock: refused — the truck is booked.
      //   member: allowed if it's still where this truck goes (same rule as joining); a farther
      //           drop-off in the same city costs only them, after they accept the exact amount.
      if (pool && destChanged && destination) {
        if (pool.status !== 'open' && pool.status !== 'locked') return fail('This pool is finished.', 'in_pool')
        const priv = await getPrivate(tools, seat.poolId)
        if (pool.organizerId === userId) {
          if (pool.status === 'locked') return fail('Your truck is locked and booked, so its destination can\'t change here. Tell your pool in the group chat; if plans changed, hand the pool over (Leave) or cancel it.', 'locked')
          orgDestChange = true
        } else if (priv) {
          const { snapshot } = await lockStore(tools).head(seat.poolId)
          const base = bestInsertion(snapshot.seats.filter((x) => x.seatId !== seat.id && x.pickup).map((x) => x.pickup!), priv.destination, pickup ?? existing!.pickup!).baseMi
          const long = base > CONFIG.route.longDistanceMi
          const sameStorage = destination.key === pool.destinationKey
          const fits = sameStorage || haversineMi(destination, priv.destination) <= (long ? CONFIG.route.cityDestinationMi : CONFIG.route.sameDestinationMi)
          if (!fits) {
            return fail(`${destination.label} isn't where this truck is going (${pool.destinationLabel}). Leave the pool (${pool.status === 'locked' ? 'a $10 fee after lock' : 'free before lock'}) and find a truck going there.`, 'dest_mismatch')
          }
          const drop = (d?: Place) => (long && d && d.key !== pool.destinationKey ? roadMi(priv.destination, d) : 0)
          destExtraCents = extraRouteCents(drop(destination) - drop(existing?.destination), pool.quote.perMileCents)
          if (destExtraCents > 0 && Number(params.acceptExtraCents) !== destExtraCents) {
            return fail(`Dropping off at ${destination.label} adds about ${Math.round((drop(destination) - drop(existing?.destination)) * 10) / 10} mi. That costs ${money(destExtraCents)}, paid only by you. Accept it, or keep your old drop-off.`, `needs_accept:${destExtraCents}`)
          }
        }
      }
      // New pickup area while in a pool: allowed if it's still on the way. A longer route costs
      // only the person who moved; they must accept the exact amount first.
      if (pool && pickupChanged && pickup) {
        if (pool.status !== 'open' && pool.status !== 'locked') return fail('This pool is finished.', 'in_pool')
        const priv = await getPrivate(tools, seat.poolId)
        const { snapshot } = await lockStore(tools).head(seat.poolId)
        const others = snapshot.seats.filter((x) => x.seatId !== seat.id && x.pickup).map((x) => x.pickup!)
        const mine = snapshot.seats.find((x) => x.seatId === seat.id)?.pickup
        if (priv && mine) {
          const now = bestInsertion(others, priv.destination, pickup)
          const before = bestInsertion(others, priv.destination, mine)
          if (now.detourMi > detourCapMi(now.baseMi) * CONFIG.score.nearMiss.detourMultiplier) {
            return fail(`${pickup.label} is too far off this truck's route. Leave the pool to move your pickup there.`, 'too_far')
          }
          const extra = extraRouteCents(now.detourMi - before.detourMi, pool.quote.perMileCents)
          if (extra > 0 && Number(params.acceptExtraCents) !== extra) {
            return fail(`Moving your pickup to ${pickup.label} adds about ${Math.round((now.detourMi - before.detourMi) * 10) / 10} mi. That costs ${money(extra)}, paid only by you. Accept it, or leave the pool.`, `needs_accept:${extra}`)
          }
          const r = await changePool(lockStore(tools), { poolId: seat.poolId, actorId: userId, op: 'move_pickup', apply: seatPickupOp(seat.id, { label: pickup.label, lat: pickup.lat, lng: pickup.lng }) })
          if (!r.ok) return fail(r.reason, 'cannot_move')
          if (extra > 0) {
            const cur = await tools.get<SeatRow>('seats', seat.id)
            const prevExtra = cur.success ? (cur.data.record.data.extraCents ?? 0) : 0
            await tools.update('seats', seat.id, { extraCents: prevExtra + extra })
          }
        }
      }
      if (pool && volumeCuFt !== seat.volumeCuFt) {
        const r = await changePool(lockStore(tools), { poolId: seat.poolId, actorId: userId, op: 'resize_seat', apply: seatResizeOp(seat.id, volumeCuFt) })
        if (!r.ok) return fail(r.reason, 'does_not_fit')
      }
      poolToSync = { poolId: seat.poolId, seatId: seat.id }
    }

    const data = {
      userId, items, volumeCuFt, pickup, destination, moveType, pickupDetail, destDetail, contact, flexDays,
      date: (params.date as string | undefined) ?? existing?.date,
      storageMonths: destination && storageByKey(destination.key ?? '') ? Math.max(0, Math.min(12, Number(params.storageMonths ?? existing?.storageMonths ?? 0))) : 0,
    }
    const r = existing ? await tools.update('moveDrafts', existing.recordId, data) : await tools.create('moveDrafts', data)
    if (!r.success) return fail(r.error)
    if (poolToSync && destExtraCents > 0) {
      const cur = await tools.get<SeatRow>('seats', poolToSync.seatId)
      await tools.update('seats', poolToSync.seatId, { extraCents: (cur.success ? (cur.data.record.data.extraCents ?? 0) : 0) + destExtraCents })
    }
    if (poolToSync && orgDestChange && destination) {
      // The organizer moved the truck's destination (pool still open).
      const pool = (await getPool(tools, poolToSync.poolId))!
      const isStorage = !!storageByKey(destination.key ?? '')
      await tools.update('pools', poolToSync.poolId, {
        destinationKey: destination.key, destinationLabel: destination.label, toCity: cityLabelOf(destination),
        hasStorage: isStorage && !!pool.hasStorage, storageMonthlyCents: isStorage ? pool.storageMonthlyCents : 0,
      })
      const priv = await getPrivate(tools, poolToSync.poolId)
      if (priv) await tools.update('poolPrivate', priv.id, { destination })
      const who = firstName(await userRow(tools, userId))
      await notifyPool(tools, poolToSync.poolId, userId, {
        kind: 'destination', keyPart: `${destination.key}:${Date.now()}`, email: true, fromUserId: userId,
        title: `${who} changed the truck's destination to ${destination.label}`,
        body: `If that doesn't work for you, you can leave for free — the pool isn't locked yet. Your share may change with the new route.`,
      })
      await syncPoolChat(tools, poolToSync.poolId)
    }
    if (poolToSync) {
      await tools.update('seats', poolToSync.seatId, { volumeCuFt, fragileCuFt: fragileCuFt(items), items })
      const priv = await getPrivate(tools, poolToSync.poolId)
      if (priv) await syncPrivate(tools, poolToSync.poolId, priv.id, priv.destination)
      await reconcileHolds(tools, poolToSync.poolId)
    }
    await syncLooking(tools, userId)
    // Funnel step "saved a move" = a complete move (the wizard also saves partial progress).
    if (pickup && destination && data.date && items.length > 0) {
      await track(tools, 'draft_saved', userId, { props: { volumeCuFt, items: items.length, storage: !!storageByKey(destination.key ?? ''), moveType } })
    }
    return ok({ volumeCuFt, pickupFound: !!pickup, poolUpdated: !!poolToSync })
  },

  /** Post a pool. The organizer takes the first seat (ledger version 1). */
  async createPool({ userId, params, tools }) {
    const draft = await getDraft(tools, userId)
    if (!draft?.pickup || !draft.destination || !draft.date) return fail('Fill in your move (date, pickup, destination) first', 'no_draft')
    if (!draft.contact) return fail('Add a way for your pool to reach you (My move, last step)', 'no_contact')
    const vehicleType = params.vehicleType as VehicleType
    const vehicle = VEHICLES[vehicleType]
    if (!vehicle) return fail('Unknown vehicle type', 'bad_vehicle')
    const bufferPct = Number(params.bufferPct ?? CONFIG.buffer.defaultPct)
    const usable = usableCuFt(vehicle.capacityCuFt, bufferPct)
    if (draft.volumeCuFt > usable) return fail(`Your items (${draft.volumeCuFt} cu ft) do not fit a ${vehicle.label}`, 'too_big')
    const q = (params.quote as Partial<Quote> | undefined) ?? {}
    const estMiles = Math.max(1, Math.round(routeMi([draft.pickup, draft.destination])))
    const quote: Quote = {
      baseDayCents: vehicle.baseDayCents,
      perMileCents: Number(q.perMileCents ?? (vehicle.own ? 20 : 119)), // defaults are estimates
      miles: Number(q.miles ?? estMiles),
      fuelCents: Number(q.fuelCents ?? Math.round((estMiles / CONFIG.route.mpg) * CONFIG.route.fuelPerGallonCents)),
      otherCents: Number(q.otherCents ?? 0),
    }
    const bad = (n: number) => !Number.isFinite(n) || n < 0
    if ([quote.perMileCents, quote.miles, quote.fuelCents, quote.otherCents].some(bad) || quoteTotalCents(quote) > CONFIG.quoteBoundsCents.max) {
      return fail('That price looks wrong — check per mile, miles and fuel', 'bad_quote')
    }
    const deadlineAt = params.deadlineAt !== undefined ? Number(params.deadlineAt) : defaultDeadline(draft.date)
    if (!deadlineAt || !(deadlineAt > Date.now())) return fail('Your move is too soon to pool up. Pick a later date.', 'bad_deadline')

    // Wallet check: enough for your share if just one more person your size joins.
    const probe = { organizerId: userId, quote, organizerDiscountPct: Math.min(Number(params.organizerDiscountPct ?? CONFIG.split.organizerDiscountPct), CONFIG.split.organizerDiscountMaxPct), hasStorage: !!params.hasStorage, storageMonthlyCents: Number(params.storageMonthlyCents ?? 0) } as Pool
    const need = poolCharges(quoteTotalCents(quote), moneySeats(probe, [
      { recordId: 'me', data: { userId, volumeCuFt: draft.volumeCuFt, isOrganizer: true, status: 'active', storageMonths: draft.storageMonths } },
      { recordId: 'plus1', data: { userId: 'x', volumeCuFt: draft.volumeCuFt, status: 'active', storageMonths: draft.storageMonths } },
    ]), probe.organizerDiscountPct).get('me')!.total
    const bal = await balanceFor(tools, userId)
    if (bal < need) return fail(`Add ${money(need - bal)} to your wallet first. You need ${money(need)} (your share if one more person joins, plus the 8% fee). Nothing is taken until the pool locks.`, `low_balance:${need}`)

    await activeSeat(tools, userId) // releases a seat left over from a finished move
    const poolId = crypto.randomUUID()
    const seatId = crypto.randomUUID()
    const store = lockStore(tools)
    if (!(await store.reserveUser(seatId, poolId, userId, draft.volumeCuFt))) return fail('You are already in a pool. Leave it first.', 'already_in_a_pool')

    const pool: Pool = {
      organizerId: userId, date: draft.date, status: 'open', vehicleType, capacityCuFt: vehicle.capacityCuFt, bufferPct,
      areaLabel: String(params.areaLabel ?? '').slice(0, 80), destinationKey: draft.destination.key, destinationLabel: draft.destination.label,
      hasStorage: !!params.hasStorage, storageMonthlyCents: Number(params.storageMonthlyCents ?? 0),
      quote, quoteIsEstimate: params.quote === undefined, organizerDiscountPct: Math.min(Number(params.organizerDiscountPct ?? CONFIG.split.organizerDiscountPct), CONFIG.split.organizerDiscountMaxPct),
      deadlineAt, departureTime: params.departureTime as string | undefined,
      moveType: draft.moveType ?? 'local', fromCity: cityLabelOf(draft.pickup), toCity: cityLabelOf(draft.destination),
    }
    const created = await tools.create('pools', pool, poolId)
    if (!created.success) { await store.setSeatStatus(seatId, 'rejected'); return fail(created.error) }
    const snap: Snapshot = {
      status: 'open', usableCuFt: usable,
      seats: [{ seatId, userId, volumeCuFt: draft.volumeCuFt, isOrganizer: true, pickup: draft.pickup, storageMonths: draft.storageMonths }],
    }
    await tools.create('poolVersions', { poolId, version: 1, op: 'create', actorId: userId, snapshot: snap })
    await tools.update('seats', seatId, { status: 'active', isOrganizer: true, items: draft.items, fragileCuFt: fragileCuFt(draft.items), storageMonths: draft.storageMonths ?? 0, boxCode: 'A-1' })
    const priv = await tools.create('poolPrivate', { poolId, organizerId: userId, memberIds: [userId], destination: draft.destination })
    if (priv.success) await syncPrivate(tools, poolId, priv.data.recordId, draft.destination)
    await syncLooking(tools, userId)
    await syncPoolChat(tools, poolId)
    const fresh = await getPool(tools, poolId)
    if (fresh) await announcePool(tools, poolId, fresh)
    await track(tools, 'pool_created', userId, { poolId, props: { vehicle: vehicleType, volumeCuFt: draft.volumeCuFt, storage: !!params.hasStorage } })
    return ok({ poolId })
  },

  /** Rank open pools for the caller's draft. Returns no coordinates (spec §5, §12.1). */
  async searchPools({ userId, tools }) {
    const draft = await getDraft(tools, userId)
    if (!draft?.pickup || !draft.destination || !draft.date) return fail('Fill in your move first', 'no_draft')
    const flex = draft.flexDays ?? CONFIG.dates.flexDefaultDays
    const pools = await tools.query<Pool>('pools', { where: { status: 'open' }, limit: 200 })
    if (!pools.success) return fail(pools.error)
    const candidates: PoolCandidate[] = []
    for (const rec of pools.data.records) {
      if (rec.data.organizerId === userId) continue
      if (Math.abs(daysBetween(draft.date, rec.data.date)) > flex) continue // cheap pre-filter before the private lookups
      const c = await candidateFor(tools, rec.recordId, rec.data)
      if (c) candidates.push(c)
    }
    const results = rankPools(
      { userId, date: draft.date, pickup: draft.pickup, destination: draft.destination, destinationKey: draft.destination.key, volumeCuFt: draft.volumeCuFt, storageMonths: draft.storageMonths, flexDays: flex },
      candidates, Date.now(),
    )
    await track(tools, 'search_run', userId, { props: { results: results.filter((x) => !x.nearMiss).length, nearMiss: results.filter((x) => x.nearMiss).length, open: candidates.length } })
    return ok({ results })
  },

  /** Join with the version lock; never overbooks (spec §11.2). */
  async joinPool({ userId, params, tools }) {
    const poolId = String(params.poolId ?? '')
    const pool = await getPool(tools, poolId)
    if (!pool) return fail('Pool not found', 'not_found')
    const draft = await getDraft(tools, userId)
    if (!draft?.pickup || !draft.date) return fail('Fill in your move first', 'no_draft')
    const flex = draft.flexDays ?? CONFIG.dates.flexDefaultDays
    if (Math.abs(daysBetween(draft.date, pool.date)) > flex) {
      return fail(`This truck leaves ${prettyDate(pool.date)}, more than ${flex} day${flex === 1 ? '' : 's'} from your date. Change your date or how flexible you are in My move.`, 'wrong_date')
    }
    if (!draft.contact) return fail('Add a way for your pool to reach you (My move, last step)', 'no_contact')
    if (!draft.destination) return fail('Fill in your move first', 'no_draft')
    // Same destination rule as search (an invite link must not bypass it). Capacity is the lock's job.
    const priv0 = await getPrivate(tools, poolId)
    if (priv0) {
      const { snapshot } = await lockStore(tools).head(poolId)
      const h = hardFilter(
        { userId, date: pool.date, pickup: draft.pickup, destination: draft.destination, destinationKey: draft.destination.key, volumeCuFt: 0 }, // date window checked above
        { poolId, date: pool.date, status: 'open', deadlineAt: Number.MAX_SAFE_INTEGER, usableCuFt: snapshot.usableCuFt, usedCuFt: 0,
          pickups: snapshot.seats.filter((x) => x.pickup).map((x) => x.pickup!), destination: priv0.destination, destinationKey: pool.destinationKey,
          quote: pool.quote, organizerDiscountPct: pool.organizerDiscountPct, seats: [] },
        Date.now(), { detour: CONFIG.score.nearMiss.detourMultiplier, capacityPct: 0 },
      )
      if (!h.ok && h.why === 'destination') return fail(`This truck goes to ${pool.destinationLabel}, not where you are going`, 'wrong_destination')
    }
    const need = estimateFor(pool, await activeSeatRows(tools, poolId), draft.volumeCuFt)
    const bal = await balanceFor(tools, userId)
    if (bal < need) return fail(`Add ${money(need - bal)} to your wallet to join. Your share would be about ${money(need)} including the 8% fee. Nothing is taken until the pool locks.`, `low_balance:${need}`)
    await activeSeat(tools, userId) // releases a seat left over from a finished move
    const seatId = crypto.randomUUID()
    const store = lockStore(tools)
    const r = await joinPool(store, {
      poolId, seatId, userId, volumeCuFt: draft.volumeCuFt, deadlineAt: pool.deadlineAt,
      seat: { pickup: draft.pickup, storageMonths: draft.storageMonths },
    })
    if (!r.ok) {
      const msg = { already_in_a_pool: 'You are already in a pool. Leave it first.', full: 'Not enough space left — someone just took it.', closed: 'This pool is no longer open.', busy: 'Lots of people are joining right now. Try again.' }[r.reason]
      await track(tools, 'join_rejected', userId, { poolId, props: { reason: r.reason } })
      return fail(msg, r.reason)
    }
    await tools.update('seats', seatId, { items: draft.items, fragileCuFt: fragileCuFt(draft.items), storageMonths: draft.storageMonths ?? 0, boxCode: `M-${r.version}` })
    const priv = await getPrivate(tools, poolId)
    if (priv) await syncPrivate(tools, poolId, priv.id, priv.destination)
    if (draft.date !== pool.date) {
      const d = await tools.query('moveDrafts', { where: { userId }, limit: 1 })
      if (d.success && d.data.records[0]) await tools.update('moveDrafts', d.data.records[0].recordId, { date: pool.date })
    }
    await syncLooking(tools, userId)
    await syncPoolChat(tools, poolId, pool)
    const joiner = firstName(await userRow(tools, userId))
    await notifyPool(tools, poolId, userId, { kind: 'joined', keyPart: seatId, email: true, fromUserId: userId, title: `${joiner} joined your truck`, body: `${joiner} joined ${poolRoute(pool)} on ${prettyDate(pool.date)} with ${draft.volumeCuFt} cu ft. Your share just went down.` })
    await track(tools, 'pool_joined', userId, { poolId, props: { volumeCuFt: draft.volumeCuFt, version: r.version, via: params.via === 'share' ? 'share' : 'search' } })
    return ok({ seatId, version: r.version })
  },

  /**
   * Leave a pool.
   *   before lock: free.  after lock: hold refunded minus $10, which goes to the people left as credit.
   *   organizer: the next person who joined becomes organizer (alone → use cancelPool).
   */
  async leavePool({ userId, params, tools }) {
    const poolId = String(params.poolId ?? '')
    const pool = await getPool(tools, poolId)
    if (!pool) return fail('Pool not found', 'not_found')
    const mine = (await activeSeatRows(tools, poolId)).find((x) => x.data.userId === userId)
    if (!mine) return fail('You are not in this pool', 'not_member')
    const locked = pool.status === 'locked'
    const store = lockStore(tools)

    let r: Awaited<ReturnType<typeof changePool>>
    if (mine.data.isOrganizer) {
      r = await changePool(store, { poolId, actorId: userId, op: 'transfer', apply: transferOp(mine.recordId) })
      if (!r.ok) return fail(r.reason === 'you are the only one; cancel the pool instead' ? 'You are the only one here. Use "Cancel pool" instead.' : r.reason, 'cannot_leave')
      const next = r.snapshot.seats[0]
      await tools.update('pools', poolId, { organizerId: next.userId })
      await tools.update('seats', next.seatId, { isOrganizer: true, boxCode: 'A-1' })
      const priv = await getPrivate(tools, poolId)
      if (priv) await tools.update('poolPrivate', priv.id, { organizerId: next.userId })
    } else {
      r = await changePool(store, { poolId, actorId: userId, op: locked ? 'leave_late' : 'leave', apply: locked ? leaveLockedOp(mine.recordId) : leaveOp(mine.recordId) })
      if (!r.ok) return fail(r.reason, 'cannot_leave')
    }
    await tools.update('seats', mine.recordId, { status: 'left', activeUserKey: null, isOrganizer: false })

    if (locked) {
      const held = heldFor(await userTxs(tools, userId), poolId)
      await writeTx(tools, { userId, poolId, amountCents: held, kind: 'release', key: `release:${poolId}:${mine.recordId}`, note: 'Your hold is returned because you left' })
      await writeTx(tools, { userId, poolId, amountCents: -CONFIG.fees.cancelCents, kind: 'cancel_fee', key: `cancelfee:${poolId}:${mine.recordId}`, note: 'Cancellation fee for leaving a locked pool' })
      const credits = cancelCredits(r.snapshot.seats.map((x) => ({ seatId: x.seatId, volumeCuFt: x.volumeCuFt })))
      for (const x of r.snapshot.seats) {
        await writeTx(tools, { userId: x.userId, poolId, amountCents: credits.get(x.seatId) ?? 0, kind: 'credit', key: `credit:${poolId}:${mine.recordId}:${x.seatId}`, note: 'Credit from a member who left after lock' })
      }
      await reconcileHolds(tools, poolId)
    }
    const priv = await getPrivate(tools, poolId)
    if (priv) await syncPrivate(tools, poolId, priv.id, priv.destination)
    await syncLooking(tools, userId)
    await syncPoolChat(tools, poolId, pool)
    const leaver = firstName(await userRow(tools, userId))
    await notifyPool(tools, poolId, userId, { kind: 'left', keyPart: mine.recordId, email: locked, fromUserId: userId,
      title: mine.data.isOrganizer ? `${leaver} left — you're the organizer now?` : `${leaver} left your truck`,
      body: locked ? `${leaver} left after lock. You got part of their $10 fee as credit; shares were adjusted.` : `${leaver} left ${poolRoute(pool)}. There's room for someone else — invite people.` })
    await track(tools, 'pool_left', userId, { poolId, props: { late: locked, organizer: !!mine.data.isOrganizer } })
    return ok({ left: true, feeCents: locked ? CONFIG.fees.cancelCents : 0 })
  },

  /** Organizer alone in the pool cancels it. Free while open; $10 if they had already locked it. */
  async cancelPool({ userId, params, tools }) {
    const poolId = String(params.poolId ?? '')
    const pool = await getPool(tools, poolId)
    if (!pool) return fail('Pool not found', 'not_found')
    if (pool.organizerId !== userId) return fail('Only the organizer can cancel', 'forbidden')
    const wasLocked = pool.status === 'locked'
    const r = await changePool(lockStore(tools), { poolId, actorId: userId, op: 'cancel', apply: cancelOp })
    if (!r.ok) return fail(r.reason, 'cannot_cancel')
    await tools.update('pools', poolId, { status: 'cancelled', cancelReason: 'organizer' })
    for (const x of await activeSeatRows(tools, poolId)) await tools.update('seats', x.recordId, { status: 'left', activeUserKey: null })
    if (wasLocked) {
      const held = heldFor(await userTxs(tools, userId), poolId)
      await writeTx(tools, { userId, poolId, amountCents: held, kind: 'release', key: `release:${poolId}:cancel`, note: 'Hold returned: pool cancelled' })
      await writeTx(tools, { userId, poolId, amountCents: -CONFIG.fees.cancelCents, kind: 'cancel_fee', key: `cancelfee:${poolId}:cancel`, note: 'Cancellation fee for cancelling a locked pool' })
      await writeTx(tools, { userId: PLATFORM, poolId, amountCents: CONFIG.fees.cancelCents, kind: 'fee_revenue', key: `rev:cancel:${poolId}` })
    }
    await track(tools, 'pool_left', userId, { poolId, props: { cancelled: true, late: wasLocked } })
    return ok({ cancelled: true })
  },

  /** Organizer updates the truck and the real price (before move day). Members' holds follow after lock. */
  async updatePool({ userId, params, tools }) {
    const poolId = String(params.poolId ?? '')
    const pool = await getPool(tools, poolId)
    if (!pool) return fail('Pool not found', 'not_found')
    if (pool.organizerId !== userId) return fail('Only the organizer can edit the truck and price', 'forbidden')
    if (pool.status !== 'open' && pool.status !== 'locked') return fail('This pool is finished', 'closed')
    const vehicleType = (params.vehicleType as VehicleType | undefined) ?? pool.vehicleType
    const vehicle = VEHICLES[vehicleType]
    if (!vehicle) return fail('Unknown vehicle type', 'bad_vehicle')
    const q = (params.quote as Partial<Quote> | undefined) ?? {}
    const quote: Quote = {
      baseDayCents: Number(q.baseDayCents ?? pool.quote.baseDayCents), perMileCents: Number(q.perMileCents ?? pool.quote.perMileCents),
      miles: Number(q.miles ?? pool.quote.miles), fuelCents: Number(q.fuelCents ?? pool.quote.fuelCents), otherCents: Number(q.otherCents ?? pool.quote.otherCents),
    }
    const bad = (n: number) => !Number.isFinite(n) || n < 0
    if (Object.values(quote).some(bad) || quoteTotalCents(quote) > CONFIG.quoteBoundsCents.max) return fail('That price looks wrong — check the numbers', 'bad_quote')
    const usable = usableCuFt(vehicle.capacityCuFt, pool.bufferPct)
    const r = await changePool(lockStore(tools), { poolId, actorId: userId, op: 'edit', apply: resizeOp(usable) })
    if (!r.ok) return fail(r.reason, 'too_small')
    const departureTime = typeof params.departureTime === 'string' && /^\d{2}:\d{2}$/.test(params.departureTime) ? params.departureTime : pool.departureTime
    await tools.update('pools', poolId, { vehicleType, capacityCuFt: vehicle.capacityCuFt, quote, quoteIsEstimate: params.isEstimate === true, departureTime })
    await reconcileHolds(tools, poolId)
    const { version } = await lockStore(tools).head(poolId)
    await notifyPool(tools, poolId, userId, { kind: 'price', keyPart: `v${version}`, email: pool.status === 'locked', title: `Truck price updated: ${money(quoteTotalCents(quote))} total`, body: `The organizer entered the real booking for ${poolRoute(pool)}. Open the pool to see your new share.` })
    return ok({ totalCents: quoteTotalCents(quote) })
  },

  /** Top up your wallet. TEST MODE: no card is charged; real top-ups use DeepSpace checkout (next step). */
  async topUp({ userId, params, tools }) {
    const amount = Math.round(Number(params.amountCents))
    const { topUpMinCents, topUpMaxCents, topUpDailyMaxCents } = CONFIG.fees
    if (!Number.isInteger(amount) || amount < topUpMinCents || amount > topUpMaxCents) return fail(`Top up between ${money(topUpMinCents)} and ${money(topUpMaxCents)}`, 'bad_amount')
    const since = Date.now() - 86_400_000
    const today = (await userTxs(tools, userId)).filter((t) => t.kind === 'topup' && (t.at ?? 0) > since).reduce((a, t) => a + t.amountCents, 0)
    if (today + amount > topUpDailyMaxCents) return fail(`Daily top-up limit is ${money(topUpDailyMaxCents)}`, 'limit')
    await writeTx(tools, { userId, amountCents: amount, kind: 'topup', key: `topup:${userId}:${crypto.randomUUID()}`, note: 'Wallet top-up (test mode — no card charged)' })
    return ok({ balanceCents: await balanceFor(tools, userId) })
  },

  /** Organizer locks the pool (the cron task calls the same op at the deadline). */
  async lockPool({ userId, params, tools }) {
    const poolId = String(params.poolId ?? '')
    const pool = await getPool(tools, poolId)
    if (!pool) return fail('Pool not found', 'not_found')
    if (pool.organizerId !== userId) return fail('Only the organizer can lock this pool', 'forbidden')
    const r = await changePool(lockStore(tools), { poolId, actorId: userId, op: 'lock', apply: lockOp })
    if (!r.ok) return fail(r.reason, 'cannot_lock')
    await tools.update('pools', poolId, { status: 'locked' })
    await reconcileHolds(tools, poolId)
    await notifyPool(tools, poolId, userId, { kind: 'locked', keyPart: 'lock', email: true, title: `Your truck is locked for ${prettyDate(pool.date)}`, body: `${poolRoute(pool)} is set. Your share + fee is now held from your wallet. Label your boxes and confirm pickup time in the group chat.` })
    const { snapshot } = await lockStore(tools).head(poolId)
    await track(tools, 'pool_locked', userId, { poolId, props: { memberIds: snapshot.seats.map((x) => x.userId), seats: snapshot.seats.length, fillPct: Math.round((usedCuFt(snapshot) / snapshot.usableCuFt) * 100) } })
    return ok({ status: 'locked' })
  },

  /** Organizer marks the move as done (after move day). Last funnel step. */
  async completePool({ userId, params, tools }) {
    const poolId = String(params.poolId ?? '')
    const pool = await getPool(tools, poolId)
    if (!pool) return fail('Pool not found', 'not_found')
    if (pool.organizerId !== userId) return fail('Only the organizer can mark the move done', 'forbidden')
    if (pool.status !== 'locked' && pool.status !== 'in_progress') return fail('Lock the pool before marking it done', 'not_locked')
    await reconcileHolds(tools, poolId) // make sure holds match the final price
    const seats = await activeSeatRows(tools, poolId)
    const charges = poolCharges(quoteTotalCents(pool.quote), moneySeats(pool, seats), pool.organizerDiscountPct)
    const r = await tools.update('pools', poolId, { status: 'completed' })
    if (!r.success) return fail(r.error)
    // The organizer paid for the truck: they receive every share (+ accepted extras). HaulPool keeps the fees.
    const payout = [...charges.values()].reduce((a, c) => a + c.share + c.extra, 0)
    await writeTx(tools, { userId, poolId, amountCents: payout, kind: 'payout', key: `payout:${poolId}`, note: 'Everyone\'s shares for the truck you booked' })
    for (const [seatId, c] of charges) await writeTx(tools, { userId: PLATFORM, poolId, amountCents: c.fee, kind: 'fee_revenue', key: `rev:${poolId}:${seatId}` })
    await notifyPool(tools, poolId, userId, { kind: 'completed', keyPart: 'done', title: 'Your move is marked done 🎉', body: `${poolRoute(pool)} is finished. Your share was paid from your wallet. Thanks for sharing the truck!` })
    // The move is over: free everyone for their next move.
    for (const s of seats) await tools.update('seats', s.recordId, { status: 'done', activeUserKey: null })
    const { snapshot } = await lockStore(tools).head(poolId)
    await track(tools, 'pool_completed', userId, { poolId, props: { memberIds: snapshot.seats.map((x) => x.userId), seats: snapshot.seats.length } })
    return ok({ status: 'completed' })
  },

  /**
   * Browser-side events (allow-listed names, PII-free props). 'visit' is counted once per
   * user per day so refreshing doesn't inflate the top of the funnel.
   */
  async track({ userId, params, tools }) {
    const name = String(params.name ?? '')
    if (!(CLIENT_EVENTS as readonly string[]).includes(name)) return fail('Unknown event', 'bad_event')
    if (name === 'visit') {
      const day = new Date().toISOString().slice(0, 10)
      const seen = await tools.query('events', { where: { name, userId, day }, limit: 1 })
      if (seen.success && seen.data.records.length > 0) return ok({ tracked: false })
    }
    const poolId = typeof params.poolId === 'string' && /^[0-9a-f-]{36}$/i.test(params.poolId) ? params.poolId : undefined
    await track(tools, name as EventName, userId, { poolId, props: cleanProps(params.props) })
    return ok({ tracked: true })
  },

  /**
   * Any US city → coordinates, via the openweathermap/geocoding integration (city-level only;
   * street addresses 404 — see VERIFY.md). Used for "City to city" moves outside the built-in list.
   */
  async findCity({ params, tools }) {
    const q = String(params.q ?? '').replace(/[^\p{L} ,.'-]/gu, '').trim().slice(0, 60)
    if (q.length < 2) return ok({ cities: [] })
    const r = await tools.integration<unknown>('openweathermap/geocoding', { q: /,\s*US$/i.test(q) ? q : `${q},US`, limit: 5 })
    if (!r.success) return ok({ cities: [], note: 'lookup_failed' })
    const raw = r.data as unknown
    const list = (Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown })?.data) ? (raw as { data: unknown[] }).data : []) as {
      name?: string; state?: string; country?: string; lat?: number; lon?: number
    }[]
    const seen = new Set<string>()
    const cities = list
      .filter((c) => c && c.country === 'US' && typeof c.lat === 'number' && typeof c.lon === 'number' && c.name)
      .map((c) => ({ label: c.state ? `${c.name}, ${US_STATE_ABBR[c.state] ?? c.state}` : c.name!, lat: c.lat!, lng: c.lon! }))
      .filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)))
    return ok({ cities })
  },

  /**
   * Photo scan: AI suggests item counts from 1–3 room photos. Suggestions only — the person
   * confirms each line in the UI, and volume is still computed by our code. Limited per day.
   */
  async scanPhotos({ userId, params, tools, env }) {
    const images = Array.isArray(params.images) ? params.images : []
    if (images.length === 0 || images.length > SCAN_LIMITS.maxImages) return fail(`Add 1–${SCAN_LIMITS.maxImages} photos`, 'bad_images')
    if (!images.every(isImageDataUrl)) return fail('Photos must be JPEG/PNG and not too large', 'bad_images')
    const day = new Date().toISOString().slice(0, 10)
    const used = await tools.query('aiUsage', { where: { userId, day, kind: 'scan' }, limit: SCAN_LIMITS.perDay })
    const count = used.success ? used.data.records.length : 0
    if (count >= SCAN_LIMITS.perDay) return fail(`You have used today's ${SCAN_LIMITS.perDay} scans. Add items by hand, or try tomorrow.`, 'limit')
    await tools.create('aiUsage', { userId, day, kind: 'scan' }) // count before calling: a failed call still costs
    try {
      const model = createDeepSpaceAI(env, 'anthropic')('claude-sonnet-5-5')
      const res = await generateText({
        model,
        maxOutputTokens: 800,
        messages: [{
          role: 'user',
          content: [
            ...(images as string[]).map((img) => ({ type: 'image' as const, image: img.slice(img.indexOf(',') + 1), mediaType: img.slice(5, img.indexOf(';')) })),
            { type: 'text' as const, text: scanPrompt() },
          ],
        }],
      })
      const { items, summary } = parseScanReply(res.text)
      await track(tools, 'scan_done', userId, { props: { photos: images.length, found: items.length } })
      return ok({ items, note: summary, left: SCAN_LIMITS.perDay - count - 1 })
    } catch (e) {
      console.error('[scanPhotos]', (e as Error).message)
      return fail('The photo scan is not available right now. You can still add items by hand.', 'ai_failed')
    }
  },

    /** "Plan my next move": release your seat if your pool is finished (completed or cancelled). */
  async releaseFinished({ userId, tools }) {
    const still = await activeSeat(tools, userId)
    return ok({ released: !still })
  },

  // ------------------------------------------------------------ social

  /** Your public profile. */
  async saveProfile({ userId, params, tools }) {
    const data = {
      userId,
      school: cleanText(params.school, 60), year: cleanText(params.year, 20), bio: cleanText(params.bio, 200),
      avatar: typeof params.avatar === 'string' && [...params.avatar].length <= 2 ? params.avatar : undefined,
      emailNotify: params.emailNotify !== false, updatedAt: Date.now(),
    }
    // Contact is private: it lives on your own draft (only you can read it) and is shared
    // with your pool's members only once you're in a pool. Set it once here, at sign-up.
    if (params.contact !== undefined) {
      const c = parseContact(params.contact)
      if (c === 'bad') return fail('Check your contact: pick a method and enter a valid number, email or handle.', 'bad_contact')
      const draft = await tools.query('moveDrafts', { where: { userId }, limit: 1 })
      const row = draft.success ? draft.data.records[0] : undefined
      const cr = row ? await tools.update('moveDrafts', row.recordId, { contact: c ?? null }) : await tools.create('moveDrafts', { userId, items: [], volumeCuFt: 0, contact: c, flexDays: CONFIG.dates.flexDefaultDays })
      if (!cr.success) return fail(cr.error)
    }
    const existing = await profileRec(tools, userId)
    const r = existing ? await tools.update('profiles', existing.recordId, data) : await tools.create('profiles', data)
    if (!r.success) return fail(r.error)
    const seat = await activeSeat(tools, userId)
    if (seat && params.contact !== undefined) {
      const priv = await getPrivate(tools, seat.poolId)
      if (priv) await syncPrivate(tools, seat.poolId, priv.id, priv.destination)
    }
    return ok({ saved: true })
  },

  /** Opt in/out of the public "looking for a truck" list (area level only). */
  async setLooking({ userId, params, tools }) {
    const draft = await getDraft(tools, userId)
    if (params.on && !(draft?.date && draft.pickup && draft.destination && draft.volumeCuFt)) return fail('Finish My move first, so people know where you are going', 'no_draft')
    await syncLooking(tools, userId, { create: true, status: params.on ? undefined : 'hidden' })
    if (params.on) {
      const r = await tools.query<LookingPost>('lookingPosts', { where: { userId }, limit: 1 })
      if (r.success && r.data.records[0]?.data.status === 'hidden') await tools.update('lookingPosts', r.data.records[0].recordId, { status: (await activeSeat(tools, userId)) ? 'matched' : 'looking' })
    }
    return ok({ on: !!params.on })
  },

  /** Looking people who fit your open truck (organizer or member), best first. */
  async poolCandidates({ userId, params, tools }) {
    const poolId = String(params.poolId ?? '')
    const pool = await getPool(tools, poolId)
    if (!pool || pool.status !== 'open') return ok({ people: [] })
    const seats = await activeSeatRows(tools, poolId)
    if (!seats.some((s) => s.data.userId === userId)) return fail('Only people in this pool can see who fits it', 'forbidden')
    const c = await candidateFor(tools, poolId, pool)
    if (!c) return ok({ people: [] })
    const posts = await tools.query<LookingPost>('lookingPosts', { where: { status: 'looking' }, limit: 300 })
    const people = (posts.success ? posts.data.records : [])
      .filter((p) => !seats.some((s) => s.data.userId === p.data.userId) && lookerFits(p.data, c))
      .map((p) => ({ userId: p.data.userId, fromLabel: p.data.fromLabel, toLabel: p.data.toLabel, volumeCuFt: p.data.volumeCuFt, estimateCents: estimateFor(pool, seats, p.data.volumeCuFt ?? 0) }))
    return ok({ people })
  },

  /** Invite a looking person to your truck: in-app + email, once per pool per person. */
  async invite({ userId, params, tools }) {
    const poolId = String(params.poolId ?? '')
    const to = String(params.userId ?? '')
    const pool = await getPool(tools, poolId)
    if (!pool || pool.status !== 'open') return fail('This pool is not open', 'closed')
    const seats = await activeSeatRows(tools, poolId)
    if (!seats.some((s) => s.data.userId === userId)) return fail('Join the pool first', 'forbidden')
    if (seats.some((s) => s.data.userId === to)) return fail('They are already in this pool', 'member')
    const post = await tools.query<LookingPost>('lookingPosts', { where: { userId: to }, limit: 1 })
    if (!post.success || post.data.records[0]?.data.status !== 'looking') return fail('They are not looking for a truck right now', 'not_looking')
    const sent = await tools.query('notifications', { where: { kind: 'invite', fromUserId: userId }, limit: 50 })
    if (sent.success && sent.data.records.length >= 20) return fail('You have sent a lot of invites. Wait for replies first.', 'limit')
    const who = firstName(await userRow(tools, userId))
    const est = estimateFor(pool, seats, post.data.records[0].data.volumeCuFt ?? 0)
    await notify(tools, {
      userId: to, kind: 'invite', fromUserId: userId, link: `/pools/${poolId}?ref=invite`, key: `invite:${poolId}:${to}`, email: true,
      title: `${who} is going ${pool.moveType === 'city' ? `to ${pool.toCity}` : `to ${pool.destinationLabel}`} on ${prettyDate(pool.date)} — join their truck`,
      body: `${who} invited you to share a ${VEHICLES[pool.vehicleType]?.label.toLowerCase() ?? 'truck'} (${poolRoute(pool)}). Your share would be about ${money(est)} including the fee.`,
    })
    await track(tools, 'share_copied', userId, { poolId, props: { how: 'invite' } })
    return ok({ invited: true })
  },

  /** Open (or reuse) a private 1-to-1 conversation. */
  async openDm({ userId, params, tools }) {
    const other = String(params.userId ?? '')
    if (!other || other === userId) return fail('Pick someone else to message', 'bad_user')
    if (!(await userRow(tools, other))) return fail('User not found', 'not_found')
    const dmKey = [userId, other].sort().join('|')
    const found = await tools.query('conversations', { where: { dmKey }, limit: 1 })
    if (found.success && found.data.records.length) return ok({ conversationId: found.data.records[0].recordId })
    const r = await tools.create('conversations', { kind: 'dm', dmKey, memberIds: [userId, other], lastAt: 0, reads: {} })
    if (r.success) return ok({ conversationId: r.data.recordId })
    const again = await tools.query('conversations', { where: { dmKey }, limit: 1 }) // lost a race: someone just created it
    return again.success && again.data.records.length ? ok({ conversationId: again.data.records[0].recordId }) : fail(r.error)
  },

  /** Send a message. Only members of the conversation can; the copy of memberIds keeps it private. */
  async sendMessage({ userId, params, tools }) {
    const conversationId = String(params.conversationId ?? '')
    const text = typeof params.text === 'string' ? params.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000) : ''
    if (!text) return fail('Write something first', 'empty')
    const conv = await tools.get<{ kind: string; memberIds: string[]; lastAt: number; title?: string; poolId?: string } & Record<string, unknown>>('conversations', conversationId)
    if (!conv.success) return fail('Conversation not found', 'not_found')
    const c = conv.data.record.data
    if (!c.memberIds.includes(userId)) return fail('You are not in this conversation', 'forbidden')
    const recent = await tools.query<{ at: number }>('messages', { where: { conversationId, senderId: userId }, orderBy: 'at', orderDir: 'desc', limit: 10 })
    if (recent.success && recent.data.records.length >= 10 && Date.now() - recent.data.records[9].data.at < 60_000) return fail('Slow down a little — too many messages in a minute', 'rate')
    const at = Date.now()
    const r = await tools.create('messages', { conversationId, senderId: userId, text, at, memberIds: c.memberIds })
    if (!r.success) return fail(r.error)
    const reads = { ...((conv.data.record.data.reads as Record<string, number>) ?? {}), [userId]: at }
    await tools.update('conversations', conversationId, { lastText: text.slice(0, 120), lastAt: at, lastSenderId: userId, reads })
    // First message in a 1-to-1 → tell the other person (in-app only; unread badges cover the rest)
    if (c.kind === 'dm' && !c.lastAt) {
      const who = firstName(await userRow(tools, userId))
      for (const m of c.memberIds) if (m !== userId) {
        await notify(tools, { userId: m, kind: 'message', fromUserId: userId, link: `/messages/${conversationId}`, key: `dm:${conversationId}:${m}`, email: true, title: `${who} sent you a message`, body: text.slice(0, 200) })
      }
    }
    return ok({ messageId: r.data.recordId })
  },

  /** Mark a conversation read up to now. */
  async markRead({ userId, params, tools }) {
    const conversationId = String(params.conversationId ?? '')
    const conv = await tools.get<{ memberIds: string[]; reads?: Record<string, number> } & Record<string, unknown>>('conversations', conversationId)
    if (!conv.success || !conv.data.record.data.memberIds.includes(userId)) return fail('Conversation not found', 'not_found')
    await tools.update('conversations', conversationId, { reads: { ...(conv.data.record.data.reads ?? {}), [userId]: Date.now() } })
    return ok({ read: true })
  },

  /** Organizer marks a member as paid. */
  async markPaid({ userId, params, tools }) {
    const seatId = String(params.seatId ?? '')
    const seat = await tools.get<{ poolId: string }>('seats', seatId)
    if (!seat.success) return fail('Seat not found', 'not_found')
    const pool = await getPool(tools, seat.data.record.data.poolId)
    if (!pool || pool.organizerId !== userId) return fail('Only the organizer can mark payments', 'forbidden')
    const r = await tools.update('seats', seatId, { paid: params.paid !== false })
    return r.success ? ok({ paid: params.paid !== false }) : fail(r.error)
  },
}

const US_STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
}

// Owner-only demo data, built on the real actions above (src/actions/demo.ts).
Object.assign(actions, createDemoActions(actions))

/**
 * Deadline sweep (run by the cron task in src/cron.ts, never callable by users).
 * 2+ people → lock and take holds. Alone → the pool closes, no fee ("didn't fill").
 */
export async function sweepDeadlines(tools: ActionTools, now = Date.now()): Promise<{ locked: number; closed: number }> {
  const open = await tools.query<Pool>('pools', { where: { status: 'open' }, limit: 200 })
  let locked = 0, closed = 0
  if (!open.success) return { locked, closed }
  for (const rec of open.data.records) {
    if (rec.data.deadlineAt > now) continue
    const poolId = rec.recordId
    const { snapshot } = await lockStore(tools).head(poolId)
    if (snapshot.seats.length >= 2) {
      const r = await changePool(lockStore(tools), { poolId, actorId: 'system', op: 'auto_lock', apply: lockOp })
      if (!r.ok) continue
      await tools.update('pools', poolId, { status: 'locked' })
      await reconcileHolds(tools, poolId)
      await notifyPool(tools, poolId, null, { kind: 'locked', keyPart: 'lock', email: true, title: `Your truck is locked for ${prettyDate(rec.data.date)}`, body: `The deadline passed, so ${poolRoute(rec.data)} locked with ${r.snapshot.seats.length} people. Your share + fee is held from your wallet.` })
      await track(tools, 'pool_locked', rec.data.organizerId, { poolId, props: { memberIds: r.snapshot.seats.map((x) => x.userId), seats: r.snapshot.seats.length, auto: true } })
      locked++
    } else {
      const r = await changePool(lockStore(tools), { poolId, actorId: 'system', op: 'auto_close', apply: cancelOp })
      if (!r.ok) continue
      await tools.update('pools', poolId, { status: 'cancelled', cancelReason: 'not_filled' })
      await notify(tools, { userId: rec.data.organizerId, kind: 'closed', link: `/pools/${poolId}`, key: `closed:${poolId}`, email: true,
        title: `Nobody joined your truck in time`, body: `${poolRoute(rec.data)} on ${prettyDate(rec.data.date)} closed at the deadline. No fee was charged. You can start a new pool or move solo.` })
      for (const x of await activeSeatRows(tools, poolId)) await tools.update('seats', x.recordId, { status: 'left', activeUserKey: null })
      closed++
    }
  }
  return { locked, closed }
}
