/**
 * HaulPool collections (spec §10).
 *
 * Rule of thumb: clients only READ business collections. Every write goes through a
 * server action (src/actions), which checks the caller and enforces capacity.
 * Signed-out visitors ('*') and viewers see nothing.
 */
import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const NONE: RolePermissions = { read: false, create: false, update: false, delete: false }
const ADMIN_ALL: RolePermissions = { read: true, create: true, update: true, delete: true }
const READ_ONLY = (read: RolePermissions['read']): RolePermissions => ({ read, create: false, update: false, delete: false })

const json = { kind: 'json' } as const
const plain = { kind: 'plain' } as const

/** Public-safe pool info: what search cards and the detail header show. No coordinates. */
export const poolsSchema: CollectionSchema = {
  name: 'pools',
  ownerField: 'organizerId',
  columns: [
    { name: 'organizerId', storage: 'text', interpretation: plain, required: true },
    { name: 'date', storage: 'text', interpretation: { kind: 'date' }, required: true }, // YYYY-MM-DD, school-local
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['open', 'locked', 'in_progress', 'completed', 'cancelled'] }, default: 'open' },
    { name: 'vehicleType', storage: 'text', interpretation: plain, required: true },
    { name: 'capacityCuFt', storage: 'number', interpretation: plain, required: true },
    { name: 'bufferPct', storage: 'number', interpretation: plain, default: 20 },
    { name: 'areaLabel', storage: 'text', interpretation: plain, maxLength: 80 },
    { name: 'destinationKey', storage: 'text', interpretation: plain },
    { name: 'destinationLabel', storage: 'text', interpretation: plain, maxLength: 120 },
    { name: 'hasStorage', storage: 'number', interpretation: { kind: 'boolean' }, default: 0 },
    { name: 'storageMonthlyCents', storage: 'number', interpretation: plain, default: 0 },
    { name: 'quote', storage: 'text', interpretation: json }, // Quote from src/lib/split.ts
    { name: 'quoteIsEstimate', storage: 'number', interpretation: { kind: 'boolean' }, default: 1 },
    { name: 'organizerDiscountPct', storage: 'number', interpretation: plain, default: 10 },
    { name: 'deadlineAt', storage: 'number', interpretation: plain, required: true }, // epoch ms
    { name: 'departureTime', storage: 'text', interpretation: plain }, // HH:MM
    { name: 'moveType', storage: 'text', interpretation: plain, default: 'local' }, // 'local' | 'city'
    { name: 'fromCity', storage: 'text', interpretation: plain, maxLength: 80 },
    { name: 'toCity', storage: 'text', interpretation: plain, maxLength: 80 },
    { name: 'cancelReason', storage: 'text', interpretation: plain }, // 'organizer' | 'not_filled'
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY(true), admin: ADMIN_ALL },
}

/** Members-only details: exact addresses and stop order. 'collaborator' = organizer or in memberIds. */
export const poolPrivateSchema: CollectionSchema = {
  name: 'poolPrivate',
  ownerField: 'organizerId',
  collaboratorsField: 'memberIds', // JSON array of user ids (SDK: shared/types CollectionSchema)
  uniqueOn: ['poolId'],
  columns: [
    { name: 'poolId', storage: 'text', interpretation: plain, required: true },
    { name: 'organizerId', storage: 'text', interpretation: plain, required: true },
    { name: 'memberIds', storage: 'text', interpretation: json, default: [] },
    { name: 'stops', storage: 'text', interpretation: json, default: [] }, // [{seatId,userId,label,lat,lng,order,boxCode}]
    { name: 'destination', storage: 'text', interpretation: json }, // {label,address,lat,lng}
    { name: 'routeMiles', storage: 'number', interpretation: plain, default: 0 },
    { name: 'dropoffs', storage: 'text', interpretation: json, default: [] }, // [{seatId,userId,label,address?,lat?,lng?}]
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY('collaborator'), admin: ADMIN_ALL },
}

/**
 * One row per person per pool. `activeUserKey` = userId while pending/active, null after;
 * uniqueOn makes "one active seat per person" a data-layer guarantee (spec §10).
 */
export const seatsSchema: CollectionSchema = {
  name: 'seats',
  uniqueOn: ['activeUserKey'],
  columns: [
    { name: 'poolId', storage: 'text', interpretation: plain, required: true },
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['pending', 'active', 'rejected', 'left', 'removed', 'done'] }, default: 'pending' }, // done = the move finished
    { name: 'activeUserKey', storage: 'text', interpretation: plain },
    { name: 'isOrganizer', storage: 'number', interpretation: { kind: 'boolean' }, default: 0 },
    { name: 'volumeCuFt', storage: 'number', interpretation: plain, required: true },
    { name: 'items', storage: 'text', interpretation: json, default: [] },
    { name: 'storageMonths', storage: 'number', interpretation: plain, default: 0 },
    { name: 'availability', storage: 'text', interpretation: json }, // P2
    { name: 'fragileCuFt', storage: 'number', interpretation: plain, default: 0 }, // part of volumeCuFt that's fragile (rides on top)
    { name: 'extraCents', storage: 'number', interpretation: plain, default: 0 }, // accepted cost of a longer route after an address change
    { name: 'boxCode', storage: 'text', interpretation: plain }, // e.g. "B-3"
    { name: 'paid', storage: 'number', interpretation: { kind: 'boolean' }, default: 0 },
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY(true), admin: ADMIN_ALL },
}

/** Concurrency ledger: whoever inserts (poolId, version) first wins (spec §11). */
export const poolVersionsSchema: CollectionSchema = {
  name: 'poolVersions',
  uniqueOn: ['poolId', 'version'],
  columns: [
    { name: 'poolId', storage: 'text', interpretation: plain, required: true },
    { name: 'version', storage: 'number', interpretation: plain, required: true },
    { name: 'op', storage: 'text', interpretation: plain, required: true },
    { name: 'actorId', storage: 'text', interpretation: plain },
    { name: 'snapshot', storage: 'text', interpretation: json, required: true },
  ],
  permissions: { '*': NONE, viewer: NONE, member: NONE, admin: READ_ONLY(true) },
}

/** "Send at most once": insert first, send only if the insert succeeded. */
export const emailLogSchema: CollectionSchema = {
  name: 'emailLog',
  uniqueOn: ['poolId', 'kind', 'userId'],
  columns: [
    { name: 'poolId', storage: 'text', interpretation: plain, required: true },
    { name: 'kind', storage: 'text', interpretation: plain, required: true },
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
  ],
  permissions: { '*': NONE, viewer: NONE, member: NONE, admin: READ_ONLY(true) },
}

/** One row per AI call; the action counts today's rows before calling (spec §8.2). */
export const aiUsageSchema: CollectionSchema = {
  name: 'aiUsage',
  ownerField: 'userId',
  columns: [
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
    { name: 'day', storage: 'text', interpretation: plain, required: true }, // YYYY-MM-DD
    { name: 'kind', storage: 'text', interpretation: plain, required: true },
    { name: 'poolId', storage: 'text', interpretation: plain },
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY('own'), admin: READ_ONLY(true) },
}

/** The "My move" form, saved so it survives devices; coordinates are cached here (spec §10). */
export const moveDraftsSchema: CollectionSchema = {
  name: 'moveDrafts',
  ownerField: 'userId',
  uniqueOn: ['userId'],
  columns: [
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
    { name: 'date', storage: 'text', interpretation: { kind: 'date' } },
    { name: 'items', storage: 'text', interpretation: json, default: [] },
    { name: 'volumeCuFt', storage: 'number', interpretation: plain, default: 0 },
    { name: 'pickup', storage: 'text', interpretation: json }, // {label, lat, lng, buildingKey?}
    { name: 'destination', storage: 'text', interpretation: json }, // {label, key?, lat, lng}
    { name: 'storageMonths', storage: 'number', interpretation: plain, default: 0 },
    { name: 'moveType', storage: 'text', interpretation: plain, default: 'local' }, // 'local' | 'city'
    // Private details. Only the owner reads this row; members of the same pool see them
    // through poolPrivate.stops (copied by the server in syncPrivate).
    { name: 'pickupDetail', storage: 'text', interpretation: json }, // {address?, lat?, lng?}
    { name: 'destDetail', storage: 'text', interpretation: json },   // {address?, lat?, lng?}
    { name: 'contact', storage: 'text', interpretation: json },      // {method, handle}
    { name: 'flexDays', storage: 'number', interpretation: plain, default: 3 }, // can move this many days earlier/later
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY('own'), admin: READ_ONLY(true) },
}

/**
 * Product analytics (埋点). One row per event. No addresses, names or free text in props:
 * only ids, counts and short codes. Only admins (the app owner) can read; nobody writes
 * from the browser — server actions insert rows (see src/lib/events.ts).
 */
export const eventsSchema: CollectionSchema = {
  name: 'events',
  columns: [
    { name: 'name', storage: 'text', interpretation: plain, required: true },
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
    { name: 'day', storage: 'text', interpretation: plain, required: true }, // YYYY-MM-DD (UTC)
    { name: 'at', storage: 'number', interpretation: plain, required: true }, // epoch ms
    { name: 'poolId', storage: 'text', interpretation: plain },
    { name: 'props', storage: 'text', interpretation: json, default: {} },
  ],
  permissions: { '*': NONE, viewer: NONE, member: NONE, admin: READ_ONLY(true) },
}

/**
 * Wallet ledger: one row per money movement (+ in, − out). Balance = sum of your rows.
 * `key` is unique, so a retried step can never charge twice. Only the server writes;
 * you can read your own rows. userId '__platform__' rows are HaulPool's fee revenue.
 */
export const walletTxSchema: CollectionSchema = {
  name: 'walletTx',
  ownerField: 'userId',
  uniqueOn: ['key'],
  columns: [
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
    { name: 'amountCents', storage: 'number', interpretation: plain, required: true },
    { name: 'kind', storage: 'text', interpretation: plain, required: true }, // see TxKind in src/lib/wallet.ts
    { name: 'poolId', storage: 'text', interpretation: plain },
    { name: 'key', storage: 'text', interpretation: plain, required: true },
    { name: 'note', storage: 'text', interpretation: plain, maxLength: 140 },
    { name: 'at', storage: 'number', interpretation: plain, required: true },
    { name: 'testMode', storage: 'number', interpretation: { kind: 'boolean' }, default: 1 },
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY('own'), admin: READ_ONLY(true) },
}

// ------------------------------------------------------------------ social (11/19)

/** Public profile: anyone signed in can read it. Written only through saveProfile. */
export const profilesSchema: CollectionSchema = {
  name: 'profiles',
  ownerField: 'userId',
  uniqueOn: ['userId'],
  columns: [
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
    { name: 'school', storage: 'text', interpretation: plain, maxLength: 60 },
    { name: 'year', storage: 'text', interpretation: plain, maxLength: 20 },
    { name: 'bio', storage: 'text', interpretation: plain, maxLength: 200 },
    { name: 'avatar', storage: 'text', interpretation: plain, maxLength: 8 }, // one emoji
    { name: 'emailNotify', storage: 'number', interpretation: { kind: 'boolean' }, default: 1 },
    { name: 'updatedAt', storage: 'number', interpretation: plain },
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY(true), admin: READ_ONLY(true) },
}

/**
 * "I'm looking for a truck" — opt-in, public to signed-in users, AREA level only
 * (never the exact address or contact). Kept in sync with the draft by the server.
 */
export const lookingPostsSchema: CollectionSchema = {
  name: 'lookingPosts',
  ownerField: 'userId',
  uniqueOn: ['userId'],
  columns: [
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
    { name: 'status', storage: 'text', interpretation: plain, required: true }, // 'looking' | 'matched' | 'hidden'
    { name: 'date', storage: 'text', interpretation: plain },
    { name: 'moveType', storage: 'text', interpretation: plain },
    { name: 'fromLabel', storage: 'text', interpretation: plain },
    { name: 'toLabel', storage: 'text', interpretation: plain },
    { name: 'fromCity', storage: 'text', interpretation: plain },
    { name: 'toCity', storage: 'text', interpretation: plain },
    { name: 'destinationKey', storage: 'text', interpretation: plain },
    { name: 'pickup', storage: 'text', interpretation: json },      // area center {lat,lng}
    { name: 'destination', storage: 'text', interpretation: json }, // area center {lat,lng}
    { name: 'volumeCuFt', storage: 'number', interpretation: plain },
    { name: 'flexDays', storage: 'number', interpretation: plain, default: 0 },
    { name: 'updatedAt', storage: 'number', interpretation: plain },
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY(true), admin: READ_ONLY(true) },
}

/**
 * Private conversations (1-to-1 or a pool's group chat). Only the people in memberIds can
 * read them — enforced by the server per record, not by the page. Written only by actions.
 */
export const conversationsSchema: CollectionSchema = {
  name: 'conversations',
  collaboratorsField: 'memberIds',
  uniqueOn: ['dmKey'], // null for pool chats
  columns: [
    { name: 'kind', storage: 'text', interpretation: plain, required: true }, // 'dm' | 'pool'
    { name: 'memberIds', storage: 'text', interpretation: json, default: [] },
    { name: 'dmKey', storage: 'text', interpretation: plain }, // "<userA>|<userB>" sorted
    { name: 'poolId', storage: 'text', interpretation: plain },
    { name: 'title', storage: 'text', interpretation: plain, maxLength: 80 },
    { name: 'lastText', storage: 'text', interpretation: plain, maxLength: 120 },
    { name: 'lastAt', storage: 'number', interpretation: plain, default: 0 },
    { name: 'lastSenderId', storage: 'text', interpretation: plain },
    { name: 'reads', storage: 'text', interpretation: json, default: {} }, // {userId: lastReadAt}
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY('collaborator'), admin: READ_ONLY(true) },
}

export const messagesSchema: CollectionSchema = {
  name: 'messages',
  collaboratorsField: 'memberIds',
  columns: [
    { name: 'conversationId', storage: 'text', interpretation: plain, required: true },
    { name: 'senderId', storage: 'text', interpretation: plain, required: true },
    { name: 'text', storage: 'text', interpretation: plain, maxLength: 1000, required: true },
    { name: 'at', storage: 'number', interpretation: plain, required: true },
    { name: 'memberIds', storage: 'text', interpretation: json, default: [] }, // copy of the conversation's, for per-record access
  ],
  permissions: { '*': NONE, viewer: NONE, member: READ_ONLY('collaborator'), admin: READ_ONLY(true) },
}

/** In-app notifications. You read yours and can only flip `read`. */
export const notificationsSchema: CollectionSchema = {
  name: 'notifications',
  ownerField: 'userId',
  uniqueOn: ['key'],
  columns: [
    { name: 'userId', storage: 'text', interpretation: plain, required: true },
    { name: 'kind', storage: 'text', interpretation: plain, required: true },
    { name: 'title', storage: 'text', interpretation: plain, maxLength: 120, required: true },
    { name: 'body', storage: 'text', interpretation: plain, maxLength: 240 },
    { name: 'link', storage: 'text', interpretation: plain, maxLength: 200 },
    { name: 'fromUserId', storage: 'text', interpretation: plain },
    { name: 'read', storage: 'number', interpretation: { kind: 'boolean' }, default: 0 },
    { name: 'at', storage: 'number', interpretation: plain, required: true },
    { name: 'key', storage: 'text', interpretation: plain, required: true },
  ],
  permissions: {
    '*': NONE, viewer: NONE,
    member: { read: 'own', create: false, update: 'own', delete: false, writableFields: ['read'] },
    admin: READ_ONLY(true),
  },
}

export const haulpoolSchemas = [
  poolsSchema, poolPrivateSchema, seatsSchema, poolVersionsSchema, emailLogSchema, aiUsageSchema, moveDraftsSchema, eventsSchema, walletTxSchema,
  profilesSchema, lookingPostsSchema, conversationsSchema, messagesSchema, notificationsSchema,
]
