/**
 * Photo scan: the AI looks at room photos and suggests item counts from OUR catalog.
 * The AI only suggests — this file validates its answer, and the person confirms
 * every line before anything is saved. Volume is still computed by src/lib/volume.ts.
 */
import { ITEMS, type ItemKey } from '../config'

export const SCAN_LIMITS = { maxImages: 3, maxImageChars: 1_600_000, perDay: 5, maxQtyPerItem: 20 } as const

export interface ScannedItem { key: ItemKey; qty: number; confidence: 'high' | 'medium' | 'low'; note?: string }

export function scanPrompt(): string {
  const catalog = (Object.keys(ITEMS) as ItemKey[]).map((k) => `- ${k}: ${ITEMS[k].label} (${ITEMS[k].cuFt} cu ft)`).join('\n')
  return [
    'You help a college student estimate what they are moving. Look at the photo(s) of their room.',
    'Count the items that would go in a moving truck, using ONLY these catalog keys:',
    catalog,
    '',
    'Rules:',
    '- Loose things (clothes, books, kitchen stuff, decor) → estimate how many medium boxes they fill (box_medium).',
    '- Do not count built-in furniture (closets, radiators, fixed shelves) or things that obviously belong to the building.',
    '- If two photos show the same item, count it once.',
    '- confidence: high = clearly visible, medium = partly visible, low = guessing.',
    'Reply with JSON only, no prose: {"items":[{"key":"desk","qty":1,"confidence":"high","note":"wooden desk by window"}],"summary":"one short sentence"}',
  ].join('\n')
}

/** Parse and validate the model's reply. Unknown keys and bad numbers are dropped, never trusted. */
export function parseScanReply(text: string): { items: ScannedItem[]; summary?: string } {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { items: [] }
  let obj: unknown
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return { items: [] } }
  const raw = (obj as { items?: unknown })?.items
  const summary = typeof (obj as { summary?: unknown })?.summary === 'string' ? String((obj as { summary: string }).summary).slice(0, 200) : undefined
  if (!Array.isArray(raw)) return { items: [], summary }
  const byKey = new Map<ItemKey, ScannedItem>()
  for (const r of raw as Record<string, unknown>[]) {
    const key = String(r?.key ?? '') as ItemKey
    if (!(key in ITEMS)) continue
    const qty = Math.round(Number(r.qty))
    if (!Number.isFinite(qty) || qty < 1) continue
    const confidence = r.confidence === 'high' || r.confidence === 'low' ? r.confidence : 'medium'
    const note = typeof r.note === 'string' ? r.note.replace(/[<>]/g, '').slice(0, 80) : undefined
    const prev = byKey.get(key)
    byKey.set(key, { key, qty: Math.min(SCAN_LIMITS.maxQtyPerItem, (prev?.qty ?? 0) + qty), confidence: prev ? prev.confidence : confidence, note: prev?.note ?? note })
  }
  return { items: [...byKey.values()], summary }
}

export function isImageDataUrl(s: unknown): s is string {
  return typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= SCAN_LIMITS.maxImageChars
}
