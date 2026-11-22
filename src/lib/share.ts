/** Invite text + native share sheet or clipboard. Used by the pool page and the My pool hub. */
import { VEHICLES } from '../config'
import type { PoolRec } from './api'

export function inviteText(pool: PoolRec, leftCuFt: number, perPersonDollars: number | null): string {
  const route = pool.moveType === 'city' ? `from ${pool.fromCity} to ${pool.toCity}` : `from ${pool.areaLabel || 'campus'} to ${pool.destinationLabel}`
  return `🚚 Moving out ${pool.date}? I'm sharing a ${VEHICLES[pool.vehicleType]?.label.toLowerCase() ?? 'truck'} ${route}. ${leftCuFt} cu ft left${perPersonDollars ? `, about $${perPersonDollars} each` : ''}. Join on HaulPool:`
}

/** Returns how it was shared, or null if the person closed the sheet. */
export async function shareInvite(poolId: string, text: string): Promise<'native' | 'clipboard' | null> {
  const url = `${window.location.origin}/pools/${poolId}?ref=share`
  try {
    if (navigator.share) { await navigator.share({ text, url }); return 'native' }
    await navigator.clipboard.writeText(`${text} ${url}`)
    return 'clipboard'
  } catch {
    return null
  }
}
