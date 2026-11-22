import { Minus, Plus } from 'lucide-react'
import { CONFIG, ITEMS, ITEM_GROUPS, ITEM_ICONS, type ItemKey } from '../../config'
import type { ItemLine } from '../../lib/volume'

/** Preset item counters, grouped, with icons. Volume is shown per item so people learn what takes space. */
export function ItemPicker({ value, onChange }: { value: ItemLine[]; onChange: (v: ItemLine[]) => void }) {
  const qty = (k: ItemKey) => value.find((l) => l.kind === 'preset' && l.key === k)?.qty ?? 0
  const set = (k: ItemKey, n: number) => {
    const rest = value.filter((l) => !(l.kind === 'preset' && l.key === k))
    onChange(n > 0 ? [...rest, { kind: 'preset', key: k, qty: n }] : rest)
  }
  return (
    <div className="space-y-5">
      {ITEM_GROUPS.map((g) => (
        <section key={g.label}>
          <h3 className="mb-1 text-sm font-bold text-foreground">{g.label}</h3>
          {g.keys.some((k) => ITEMS[k].fragile) && (
            <p className="mb-2 text-xs text-muted-foreground">These ride on top of your stuff with nothing stacked on them, so each counts as {CONFIG.items.fragileFactor}× its size.</p>
          )}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {g.keys.map((k) => {
              const n = qty(k)
              return (
                <li key={k} className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${n > 0 ? 'bg-accent/40' : ''}`}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-lg" aria-hidden>{ITEM_ICONS[k]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{ITEMS[k].label}</div>
                    <div className="text-xs text-muted-foreground">
                      {ITEMS[k].fragile
                        ? `${ITEMS[k].cuFt} cu ft · counts as ${ITEMS[k].cuFt * CONFIG.items.fragileFactor}`
                        : `${ITEMS[k].cuFt} cu ft each${ITEMS[k].sourced ? '' : ' · rough guess'}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Fewer ${ITEMS[k].label}`}
                    onClick={() => set(k, Math.max(0, n - 1))}
                    disabled={n === 0}
                    className="grid size-9 place-items-center rounded-full border border-border bg-background text-foreground disabled:opacity-30"
                  >
                    <Minus className="size-4" />
                  </button>
                  <span className={`w-6 text-center text-sm tabular-nums ${n > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`} data-testid={`qty-${k}`}>{n}</span>
                  <button
                    type="button"
                    aria-label={`More ${ITEMS[k].label}`}
                    onClick={() => set(k, n + 1)}
                    className="grid size-9 place-items-center rounded-full border border-primary/40 bg-background text-primary"
                  >
                    <Plus className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
