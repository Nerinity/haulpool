import { CONFIG, ITEMS, type ItemKey } from '../config'

/** A line in a person's item list. Either a preset (key) or a custom item with inch dimensions. */
export type ItemLine =
  | { kind: 'preset'; key: ItemKey; qty: number }
  | { kind: 'custom'; name: string; qty: number; lengthIn: number; widthIn: number; heightIn: number }

export class VolumeError extends Error {}

const CU_IN_PER_CU_FT = 1728

/** Whether a line is fragile and rides on top (custom items are treated as regular). */
export const isFragile = (line: ItemLine) => line.kind === 'preset' && !!ITEMS[line.key]?.fragile

/** Space a line takes in the truck: its size, or fragileFactor × size for fragile items. */
export function effectiveCuFt(line: ItemLine): number {
  return lineCuFt(line) * (isFragile(line) ? CONFIG.items.fragileFactor : 1)
}

/** The fragile part of totalCuFt (effective, rounded up). Drawn as the top layer of your block in the truck. */
export function fragileCuFt(lines: ItemLine[]): number {
  const raw = lines.filter(isFragile).reduce((s, l) => s + effectiveCuFt(l), 0)
  return raw > 0 ? Math.ceil(raw - 1e-9) : 0
}

export function lineCuFt(line: ItemLine): number {
  if (!Number.isInteger(line.qty) || line.qty < 1) throw new VolumeError('Quantity must be a whole number ≥ 1')
  if (line.kind === 'preset') {
    const spec = ITEMS[line.key]
    if (!spec) throw new VolumeError(`Unknown item: ${line.key}`)
    return spec.cuFt * line.qty
  }
  const { lengthIn, widthIn, heightIn } = line
  for (const d of [lengthIn, widthIn, heightIn]) {
    if (!(d > 0)) throw new VolumeError('Dimensions must be positive')
  }
  const each = (lengthIn * widthIn * heightIn) / CU_IN_PER_CU_FT
  if (each > CONFIG.items.maxCustomCuFt) throw new VolumeError(`One custom item can be at most ${CONFIG.items.maxCustomCuFt} cu ft`)
  return each * line.qty
}

/**
 * Total volume of a person's items, rounded UP to a whole cubic foot.
 * The server always recomputes this from the item list; it never trusts a client number (spec §11.2 step 1).
 */
export function totalCuFt(lines: ItemLine[]): number {
  const count = lines.reduce((n, l) => n + l.qty, 0)
  if (count > CONFIG.items.maxPerPerson) throw new VolumeError(`At most ${CONFIG.items.maxPerPerson} items per person`)
  const raw = lines.reduce((s, l) => s + effectiveCuFt(l), 0) // fragile items count 1.5×
  return Math.ceil(raw - 1e-9)
}

/** "≈ N medium boxes", easier to grasp than cubic feet (spec §4). */
export function mediumBoxEquivalent(cuFt: number): number {
  return Math.round(cuFt / CONFIG.items.mediumBoxCuFt)
}

/** True when the list contains irregular shapes (used by the AI buffer advice). */
export function hasIrregular(lines: ItemLine[]): boolean {
  return lines.some((l) => l.kind === 'custom' || ITEMS[l.key].irregular)
}

export function usableCuFt(capacityCuFt: number, bufferPct: number): number {
  const b = Math.min(Math.max(bufferPct, CONFIG.buffer.minPct), CONFIG.buffer.maxPct)
  return Math.floor(capacityCuFt * (1 - b / 100))
}
