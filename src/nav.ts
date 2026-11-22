/**
 * Navigation Config
 *
 * Add one entry per nav item. Routes are handled by generouted
 * (file-based routing in src/pages/), this just controls what
 * appears in the navigation bar.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'My pool' },
  { path: '/move', label: 'My move' },
  { path: '/search', label: 'Find' },
  { path: '/messages', label: 'Messages' },
  { path: '/wallet', label: 'Wallet' },
  // Owner-only analytics lives at /admin/funnel (bookmark it). Kept out of the app's
  // menu on purpose: it's an internal tool, not a user feature. The page and the
  // `events` permissions still block everyone but admins.
  // The /api-status debug page still exists — add
  // `{ path: '/api-status', label: 'API Status', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]
