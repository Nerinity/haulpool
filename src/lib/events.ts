/**
 * Event tracking (埋点) — names, the funnel definition, and the pure funnel math.
 *
 * Privacy rule: props hold only ids, numbers and short codes — never addresses,
 * names or free text. Events are written by server actions, so the numbers can't be
 * faked from the browser except the few "client" events below, which are allow-listed.
 */

/** Events the server writes inside actions (trusted). */
export const SERVER_EVENTS = [
  'draft_saved', 'search_run', 'pool_created', 'pool_joined', 'join_rejected', 'pool_left', 'pool_locked', 'pool_completed', 'scan_done',
] as const

/** Events the browser may send through the `track` action (allow-list). */
export const CLIENT_EVENTS = ['visit', 'wizard_step', 'preset_used', 'share_copied', 'invite_opened'] as const

export type EventName = (typeof SERVER_EVENTS)[number] | (typeof CLIENT_EVENTS)[number]

export interface EventRow { name: string; userId: string; day: string; at: number; poolId?: string; props?: Record<string, unknown> }

/** Funnel steps. A user reaches a step if they fired ANY of its events (distinct users). */
export const FUNNEL: { key: string; label: string; events: EventName[] }[] = [
  { key: 'visit', label: 'Visited', events: ['visit'] },
  { key: 'draft', label: 'Saved a move', events: ['draft_saved'] },
  { key: 'search', label: 'Searched', events: ['search_run', 'pool_created'] },
  { key: 'pool', label: 'Joined or started a pool', events: ['pool_joined', 'pool_created'] },
  { key: 'locked', label: 'Pool locked', events: ['pool_locked'] },
  { key: 'completed', label: 'Move completed', events: ['pool_completed'] },
]

export interface FunnelStep { key: string; label: string; users: number; pctOfFirst: number; dropFromPrev: number }

/**
 * Strict funnel: a user counts at step k only if they also reached every earlier step.
 * pool_locked / pool_completed are written once per pool with props.memberIds, so every
 * member of that pool reaches those steps.
 */
export function computeFunnel(rows: EventRow[], sinceMs = 0): FunnelStep[] {
  const reached = FUNNEL.map(() => new Set<string>())
  for (const r of rows) {
    if (r.at < sinceMs) continue
    const users = Array.isArray(r.props?.memberIds) ? (r.props!.memberIds as string[]) : [r.userId]
    FUNNEL.forEach((step, i) => {
      if ((step.events as string[]).includes(r.name)) users.forEach((u) => reached[i].add(u))
    })
  }
  // strict: intersect with the previous step
  for (let i = 1; i < reached.length; i++) {
    for (const u of [...reached[i]]) if (!reached[i - 1].has(u)) reached[i].delete(u)
  }
  const first = reached[0].size
  return FUNNEL.map((s, i) => {
    const users = reached[i].size
    const prev = i === 0 ? users : reached[i - 1].size
    return {
      key: s.key, label: s.label, users,
      pctOfFirst: first ? Math.round((users / first) * 1000) / 10 : 0,
      dropFromPrev: i === 0 || prev === 0 ? 0 : Math.round(((prev - users) / prev) * 1000) / 10,
    }
  })
}

/** Why joins fail, counted (helps decide: more trucks? bigger trucks?). */
export function rejectReasons(rows: EventRow[], sinceMs = 0): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    if (r.name !== 'join_rejected' || r.at < sinceMs) continue
    const k = String(r.props?.reason ?? 'other')
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

/** Keep props small and PII-free: numbers, booleans, short codes and id arrays only. */
export function cleanProps(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 8)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v)) out[k] = v
  }
  return out
}
