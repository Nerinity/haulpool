import { CONFIG } from '../config'

export interface LatLng { lat: number; lng: number }

const EARTH_MI = 3958.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversineMi(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_MI * Math.asin(Math.sqrt(h))
}

/** Estimated road miles (straight line × road factor). */
export function roadMi(a: LatLng, b: LatLng): number {
  return haversineMi(a, b) * CONFIG.route.roadFactor
}

export function routeMi(points: LatLng[]): number {
  let s = 0
  for (let i = 0; i + 1 < points.length; i++) s += roadMi(points[i], points[i + 1])
  return s
}

export interface Insertion { baseMi: number; detourMi: number; position: number }

/**
 * Try the new pickup at every position among existing pickups (before the destination)
 * and keep the cheapest. Spec §5.2.
 */
export function bestInsertion(pickups: LatLng[], destination: LatLng, newPickup: LatLng): Insertion {
  const baseMi = routeMi([...pickups, destination])
  let best = { detourMi: Infinity, position: 0 }
  for (let i = 0; i <= pickups.length; i++) {
    const seq = [...pickups.slice(0, i), newPickup, ...pickups.slice(i), destination]
    const d = routeMi(seq) - baseMi
    if (d < best.detourMi - 1e-12) best = { detourMi: d, position: i }
  }
  return { baseMi, ...best }
}

/** clamp(15% × route, 3, 25) miles. */
export function detourCapMi(baseMi: number): number {
  const { detourPct, detourMinMi, detourMaxMi } = CONFIG.route
  return Math.min(Math.max(detourPct * baseMi, detourMinMi), detourMaxMi)
}

/** Distances shown to non-members are rounded so nobody can triangulate an address (spec §12.1). */
export function roundForDisplay(mi: number): number {
  const step = CONFIG.privacy.distanceRoundMi
  return Math.max(step, Math.round(mi / step) * step)
}
