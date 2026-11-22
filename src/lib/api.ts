/**
 * Thin client wrappers around server actions (POST /api/actions/:name).
 * The browser never writes records directly; every change goes through an action.
 */
import { getAuthToken } from 'deepspace'
import type { ItemLine } from './volume'
import type { MatchResult } from './match'
import type { VehicleType } from '../config'

export type ActionEnvelope<T> = { success: true; data: T } | { success: false; error: string; code?: string }

async function callAction<T>(name: string, params: Record<string, unknown> = {}): Promise<ActionEnvelope<T>> {
  const token = await getAuthToken()
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  })
  let json: ActionEnvelope<T>
  try {
    json = (await res.json()) as ActionEnvelope<T>
  } catch {
    return { success: false, error: `Request failed (${res.status})` }
  }
  if (!res.ok && (json as { success?: boolean })?.success === undefined) {
    return { success: false, error: (json as { error?: string })?.error ?? `Request failed (${res.status})` }
  }
  return json
}

export const api = {
  saveDraft: (p: {
    items?: ItemLine[]; date?: string; moveType?: MoveType; pickup?: PlaceInput; destination?: PlaceInput; storageMonths?: number
    pickupDetail?: Detail | null; destDetail?: Detail | null; contact?: Contact | null; acceptExtraCents?: number; flexDays?: number
  }) => callAction<{ volumeCuFt: number; pickupFound: boolean; poolUpdated: boolean }>('saveDraft', p),
  createPool: (p: {
    vehicleType: VehicleType
    bufferPct?: number
    departureTime?: string
    areaLabel?: string
    hasStorage?: boolean
    storageMonthlyCents?: number
    organizerDiscountPct?: number
    quote?: { perMileCents?: number; miles?: number; fuelCents?: number; otherCents?: number }
  }) => callAction<{ poolId: string }>('createPool', p),
  findCity: (q: string) => callAction<{ cities: GeoCity[]; note?: string }>('findCity', { q }),
  scanPhotos: (images: string[]) => callAction<{ items: ScannedItem[]; note?: string; left: number }>('scanPhotos', { images }),
  searchPools: () => callAction<{ results: MatchResult[] }>('searchPools'),
  joinPool: (poolId: string, via?: 'share' | 'search') => callAction<{ seatId: string; version: number }>('joinPool', { poolId, via }),
  leavePool: (poolId: string) => callAction<{ left: true; feeCents: number }>('leavePool', { poolId }),
  lockPool: (poolId: string) => callAction<{ status: 'locked' }>('lockPool', { poolId }),
  markPaid: (seatId: string, paid: boolean) => callAction<{ paid: boolean }>('markPaid', { seatId, paid }),
  cancelPool: (poolId: string) => callAction<{ cancelled: true }>('cancelPool', { poolId }),
  updatePool: (p: { poolId: string; vehicleType?: VehicleType; departureTime?: string; isEstimate?: boolean; quote?: { baseDayCents?: number; perMileCents?: number; miles?: number; fuelCents?: number; otherCents?: number } }) =>
    callAction<{ totalCents: number }>('updatePool', p),
  topUp: (amountCents: number) => callAction<{ balanceCents: number }>('topUp', { amountCents }),
  saveProfile: (p: { school?: string; year?: string; bio?: string; avatar?: string; emailNotify?: boolean; contact?: Contact | null }) => callAction<{ saved: true }>('saveProfile', p),
  setLooking: (on: boolean) => callAction<{ on: boolean }>('setLooking', { on }),
  poolCandidates: (poolId: string) => callAction<{ people: { userId: string; fromLabel?: string; toLabel?: string; volumeCuFt?: number; estimateCents: number }[] }>('poolCandidates', { poolId }),
  invite: (poolId: string, userId: string) => callAction<{ invited: true }>('invite', { poolId, userId }),
  openDm: (userId: string) => callAction<{ conversationId: string }>('openDm', { userId }),
  sendMessage: (conversationId: string, text: string) => callAction<{ messageId: string }>('sendMessage', { conversationId, text }),
  markRead: (conversationId: string) => callAction<{ read: true }>('markRead', { conversationId }),
  seedDemo: (step: number) => callAction<{ next: number | null; total: number; warning: string | null; date: string; fitsOwner: boolean }>('seedDemo', { step }),
  clearDemo: () => callAction<{ pools: number; people: number }>('clearDemo', {}),
  releaseFinished: () => callAction<{ released: boolean }>('releaseFinished', {}),
  completePool: (poolId: string) => callAction<{ status: 'completed' }>('completePool', { poolId }),
  /** Fire-and-forget analytics; never awaited by UI code paths that matter. */
  track: (name: 'visit' | 'wizard_step' | 'preset_used' | 'share_copied' | 'invite_opened', props?: Record<string, string | number | boolean>, poolId?: string) => {
    void callAction('track', { name, props, poolId }).catch(() => undefined)
  },
}

export type MoveType = 'local' | 'city'
export interface Detail { address?: string; lat?: number; lng?: number }
export type ContactMethod = 'text' | 'call' | 'whatsapp' | 'wechat' | 'email' | 'instagram'
export interface Contact { method: ContactMethod; handle: string }
export interface GeoCity { label: string; lat: number; lng: number }
/** A list key (Pittsburgh spot, storage unit, "city:area") or a geocoded city. */
export type PlaceInput = string | GeoCity
export interface ScannedItem { key: string; qty: number; confidence: 'high' | 'medium' | 'low'; note?: string }

/** Record shapes as the browser reads them (see src/schemas/haulpool-schemas.ts). */
export interface PoolRec {
  organizerId: string; date: string; status: 'open' | 'locked' | 'in_progress' | 'completed' | 'cancelled'
  vehicleType: VehicleType; capacityCuFt: number; bufferPct: number; areaLabel?: string
  destinationKey?: string; destinationLabel?: string; hasStorage?: boolean; storageMonthlyCents?: number
  quote: { baseDayCents: number; perMileCents: number; miles: number; fuelCents: number; otherCents: number }
  quoteIsEstimate?: boolean; organizerDiscountPct: number; deadlineAt: number; departureTime?: string
  moveType?: MoveType; fromCity?: string; toCity?: string; cancelReason?: 'organizer' | 'not_filled'
}
export interface WalletTxRec {
  userId: string; amountCents: number; kind: 'topup' | 'hold' | 'adjust' | 'release' | 'cancel_fee' | 'credit' | 'payout' | 'fee_revenue'
  poolId?: string; key: string; note?: string; at: number; testMode?: boolean
}
export interface SeatRec {
  poolId: string; userId: string; status: 'pending' | 'active' | 'rejected' | 'left' | 'removed'
  isOrganizer?: boolean; volumeCuFt: number; fragileCuFt?: number; extraCents?: number; items: ItemLine[]; storageMonths: number; boxCode?: string; paid?: boolean
}
export interface PoolPrivateRec {
  poolId: string; organizerId: string; memberIds: string[]
  stops: { seatId: string; userId: string; label: string; order: number; address?: string; exact?: { lat: number; lng: number }; contact?: Contact }[]
  dropoffs?: { seatId: string; userId: string; label: string; address?: string; exact?: { lat: number; lng: number } }[]
  destination?: { label: string; lat?: number; lng?: number }; routeMiles: number
}
export interface DraftRec {
  userId: string; date?: string; items: ItemLine[]; volumeCuFt: number
  pickup?: DraftPlace; destination?: DraftPlace; storageMonths?: number; moveType?: MoveType
  pickupDetail?: Detail; destDetail?: Detail; contact?: Contact; flexDays?: number
}
export interface DraftPlace { key?: string; label: string; lat: number; lng: number; cityKey?: string; cityLabel?: string }

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** Tap-to-contact links for pool members. */
export function contactHref(c: Contact): string | null {
  const digits = c.handle.replace(/[^\d+]/g, '')
  switch (c.method) {
    case 'text': return `sms:${digits}`
    case 'call': return `tel:${digits}`
    case 'whatsapp': return `https://wa.me/${digits.replace(/^\+/, '')}`
    case 'email': return `mailto:${c.handle}`
    case 'instagram': return `https://instagram.com/${c.handle.replace(/^@/, '')}`
    default: return null // WeChat has no public deep link: show the ID to copy
  }
}
export const CONTACT_LABEL: Record<ContactMethod, string> = {
  text: 'Text', call: 'Call', whatsapp: 'WhatsApp', wechat: 'WeChat', email: 'Email', instagram: 'Instagram',
}
/** Google Maps link for a stop: exact pin if any, else the typed address, else the area. */
export function mapsHref(p: { address?: string; exact?: { lat: number; lng: number }; label: string }): string {
  const q = p.exact ? `${p.exact.lat},${p.exact.lng}` : p.address ?? p.label
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

/** If an action failed for lack of wallet balance, the wallet URL to top up and come back. */
export function walletUrlFor(r: { success: boolean; code?: string }, back: string): string | null {
  const m = !r.success && r.code ? /^low_balance:(\d+)$/.exec(r.code) : null
  return m ? `/wallet?need=${m[1]}&back=${encodeURIComponent(back)}` : null
}

// ------------------------------------------------------------------ social records
export interface ProfileRec { userId: string; school?: string; year?: string; bio?: string; avatar?: string; emailNotify?: boolean }
export interface LookingPostRec {
  userId: string; status: 'looking' | 'matched' | 'hidden'; date?: string; moveType?: MoveType; fromLabel?: string; toLabel?: string
  fromCity?: string; toCity?: string; volumeCuFt?: number; flexDays?: number; updatedAt?: number
}
export interface ConversationRec {
  kind: 'dm' | 'pool'; memberIds: string[]; poolId?: string; title?: string; lastText?: string; lastAt: number; lastSenderId?: string; reads?: Record<string, number>
}
export interface MessageRec { conversationId: string; senderId: string; text: string; at: number }
export interface NotificationRec { userId: string; kind: string; title: string; body?: string; link?: string; fromUserId?: string; read: boolean; at: number }

export const isUnread = (c: ConversationRec, me: string) => !!c.lastAt && c.lastSenderId !== me && (c.reads?.[me] ?? 0) < c.lastAt

export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const isDemoUser = (id: string) => id.startsWith('demo_')

/**
 * Pickup order for the truck picture: the members-only route order when you can see it;
 * otherwise join order (organizer first, then box codes M-2, M-3… which follow join order).
 */
export function stopOrder(seats: { recordId: string; data: SeatRec }[], stops?: { seatId: string; order: number }[]): Map<string, number> {
  if (stops && stops.length) {
    const m = new Map(stops.map((x) => [x.seatId, x.order]))
    if (seats.every((s) => m.has(s.recordId))) return m
  }
  const joinNo = (s: SeatRec) => (s.isOrganizer ? 0 : Number(/\d+/.exec(s.boxCode ?? '')?.[0] ?? 999))
  const sorted = [...seats].sort((a, b) => joinNo(a.data) - joinNo(b.data))
  return new Map(sorted.map((s, i) => [s.recordId, i + 1]))
}
