/**
 * Truck-load picture: a side view of the cargo box, loaded in pickup order.
 *
 * Stop 1 is picked up first, so its stuff goes in first, right behind the cab; each later
 * stop loads behind the one before, toward the back door. Every person is ONE block —
 * never split, never overlapping — numbered by their stop. Fragile things ride on top of
 * that person's block (nothing is stacked on them). The hatched strip at the back door is
 * the packing buffer. If the load is too big, the blocks shrink to fit and the box turns red.
 * Pure SVG, theme colors. Layout math is in `layoutLoad` (tested).
 */
import { useId } from 'react'

/** cuFt is the person's total (fragile already counted 1.5×); fragileCuFt is the part of it that's fragile. */
export interface LoadSegment { label: string; cuFt: number; fragileCuFt?: number; mine?: boolean; order?: number }

export interface LoadBlock { label: string; stop: number; x: number; w: number; fragileH: number; mine: boolean; cuFt: number; fragileCuFt: number; shade: number }

// geometry (viewBox 400×150): cargo box x 10..290, cab from 290
export const BOX = { X0: 14, X1: 286, Y0: 22, Y1: 108 } as const
const GAP = 1.5 // white seam between people

/** Order by stop, then lay blocks from the cab backwards, scaled so they never overlap or leave the box. */
export function layoutLoad(capacityCuFt: number, usableCuFt: number, segments: LoadSegment[]): { blocks: LoadBlock[]; bufferX: number; over: boolean } {
  const { X0, X1, Y0, Y1 } = BOX
  const boxW = X1 - X0
  const usableW = boxW * Math.min(1, usableCuFt / Math.max(capacityCuFt, 1))
  const sorted = segments
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.cuFt > 0)
    .sort((a, b) => (a.s.order ?? a.i + 1) - (b.s.order ?? b.i + 1) || a.i - b.i)
  const used = sorted.reduce((a, { s }) => a + s.cuFt, 0)
  const over = used > usableCuFt
  // Space per cu ft: the usable area normally; when over, the whole box (it's drawn red).
  const room = (over ? boxW : usableW) - GAP * Math.max(0, sorted.length - 1)
  const perCuFt = room / Math.max(over ? used : usableCuFt, 1)
  let cursor = X1
  const blocks = sorted.map(({ s }, k) => {
    const w = Math.max(2, s.cuFt * perCuFt)
    const x = Math.max(X0, cursor - w)
    const width = cursor - x
    cursor = x - GAP
    const fragile = Math.min(s.fragileCuFt ?? 0, s.cuFt)
    const fragileH = fragile > 0 ? Math.max(10, ((Y1 - Y0) * fragile) / s.cuFt) : 0
    return { label: s.label, stop: s.order ?? k + 1, x, w: width, fragileH, mine: !!s.mine, cuFt: s.cuFt, fragileCuFt: fragile, shade: k % 2 ? 0.45 : 0.7 }
  })
  return { blocks, bufferX: X1 - usableW, over }
}

export function TruckLoad({
  capacityCuFt, usableCuFt, segments, vehicleLabel, size = 'md', legend,
}: { capacityCuFt: number; usableCuFt: number; segments: LoadSegment[]; vehicleLabel?: string; size?: 'sm' | 'md'; legend?: boolean }) {
  const uid = useId().replace(/:/g, '')
  const { X0, X1, Y0, Y1 } = BOX
  const used = segments.reduce((a, s) => a + Math.max(0, s.cuFt), 0)
  const left = Math.max(0, usableCuFt - used)
  const pct = Math.round((used / Math.max(usableCuFt, 1)) * 100)
  const { blocks, bufferX, over } = layoutLoad(capacityCuFt, usableCuFt, segments)
  const anyFragile = blocks.some((b) => b.fragileCuFt > 0)
  const showLegend = legend ?? blocks.length > 1
  const fill = (b: LoadBlock) => (b.mine ? 'var(--color-tape, var(--color-primary))' : 'var(--color-primary)')
  const opacity = (b: LoadBlock) => (b.mine ? 1 : b.shade)

  return (
    <figure className="w-full" aria-label={`${vehicleLabel ?? 'Truck'}: ${used} of ${usableCuFt} cubic feet used, ${left} left. Loaded in pickup order: ${blocks.map((b) => `${b.stop} ${b.label}`).join(', ')}`}>
      <svg viewBox="0 0 400 150" className={size === 'sm' ? 'h-auto w-full max-w-xs' : 'h-auto w-full'} role="img">
        <defs>
          <pattern id={`boxes-${uid}`} width="14" height="14" patternUnits="userSpaceOnUse">
            <rect width="14" height="14" fill="none" stroke="var(--color-card)" strokeOpacity="0.55" strokeWidth="1.2" />
          </pattern>
          <pattern id={`glass-${uid}`} width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="1.3" fill="var(--color-card)" fillOpacity="0.95" />
          </pattern>
          <pattern id={`hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-muted-foreground)" strokeOpacity="0.35" strokeWidth="2" />
          </pattern>
        </defs>

        {/* cargo box */}
        <rect x="10" y="18" width="280" height="94" rx="6" fill="var(--color-card)" stroke={over ? 'var(--color-destructive)' : 'var(--color-foreground)'} strokeOpacity="0.8" strokeWidth="2.5" />
        {/* packing buffer at the back door */}
        {!over && bufferX > X0 + 1 && <rect x={X0} y={Y0} width={bufferX - X0} height={Y1 - Y0} fill={`url(#hatch-${uid})`} />}

        {/* one block per person, stop 1 behind the cab */}
        {blocks.map((b) => (
          <g key={`${b.stop}-${b.label}`}>
            <title>{`Stop ${b.stop} · ${b.label}: ${b.cuFt} cu ft${b.fragileCuFt ? ` (${b.fragileCuFt} fragile, on top)` : ''}`}</title>
            <rect x={b.x} y={Y0} width={b.w} height={Y1 - Y0} rx="2" fill={fill(b)} fillOpacity={opacity(b)} />
            <rect x={b.x} y={Y0 + b.fragileH} width={b.w} height={Y1 - Y0 - b.fragileH} fill={`url(#boxes-${uid})`} />
            {b.fragileH > 0 && (
              <>
                <rect x={b.x} y={Y0} width={b.w} height={b.fragileH} fill={`url(#glass-${uid})`} />
                <line x1={b.x} x2={b.x + b.w} y1={Y0 + b.fragileH} y2={Y0 + b.fragileH} stroke="var(--color-card)" strokeWidth="1.5" />
              </>
            )}
            {b.w >= 16 && (
              <g>
                <circle cx={b.x + b.w / 2} cy={Y1 - 11} r="7.5" fill="var(--color-card)" />
                <text x={b.x + b.w / 2} y={Y1 - 7.6} textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--color-foreground)">{b.stop}</text>
              </g>
            )}
          </g>
        ))}
        {over && <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill="var(--color-destructive)" fillOpacity="0.12" />}

        {/* cab */}
        <path d="M290 40 h46 l26 30 v42 h-72 z" fill="var(--color-secondary)" stroke="var(--color-foreground)" strokeOpacity="0.8" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M300 48 h32 l18 22 h-50 z" fill="var(--color-card)" stroke="var(--color-foreground)" strokeOpacity="0.5" strokeWidth="1.5" strokeLinejoin="round" />
        <rect x="354" y="92" width="10" height="6" rx="1.5" fill="var(--color-primary)" fillOpacity="0.8" />
        {/* chassis + wheels */}
        <rect x="10" y="112" width="354" height="6" rx="2" fill="var(--color-foreground)" fillOpacity="0.75" />
        {[62, 104, 324].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="126" r="15" fill="var(--color-foreground)" fillOpacity="0.85" />
            <circle cx={cx} cy="126" r="6" fill="var(--color-card)" />
          </g>
        ))}
        <text x="12" y="14" textAnchor="start" fontSize="11" fill="var(--color-muted-foreground)">{vehicleLabel ?? ''}</text>
        {blocks.length > 1 && <text x={X1} y="14" textAnchor="end" fontSize="10" fill="var(--color-muted-foreground)">← loaded from the cab, stop by stop</text>}
      </svg>

      <figcaption className="mt-1 space-y-1.5 text-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={over ? 'font-medium text-destructive' : 'text-foreground'} data-testid="capacity-used">
            <span className="text-sm font-semibold">{used}</span> of {usableCuFt} cu ft · {pct}% full
          </span>
          <span className="text-muted-foreground" data-testid="capacity-left">
            {over ? `${used - usableCuFt} cu ft too much` : `${left} cu ft free`}
            {' · '}<span className="inline-block h-2 w-3 align-middle" style={{ background: 'repeating-linear-gradient(45deg, var(--color-muted-foreground) 0 1px, transparent 1px 4px)', opacity: 0.6 }} /> packing buffer
            {anyFragile && <> · <span className="inline-block h-2 w-3 rounded-sm align-middle" style={{ background: 'radial-gradient(circle, var(--color-muted-foreground) 1px, transparent 1.3px) 0 0 / 4px 4px' }} /> fragile, on top</>}
          </span>
        </div>
        {showLegend && (
          <ol className="flex flex-wrap gap-x-3 gap-y-1" data-testid="load-legend">
            {blocks.map((b) => (
              <li key={`${b.stop}-${b.label}`} className="flex items-center gap-1.5 text-muted-foreground">
                <span className="grid size-4 place-items-center rounded-full text-[9px] font-extrabold text-foreground ring-1 ring-border"
                  style={{ background: b.mine ? 'var(--color-tape)' : `color-mix(in srgb, var(--color-primary) ${Math.round(b.shade * 100)}%, white)`, color: b.mine ? '#3b2c00' : 'white' }}>{b.stop}</span>
                <span className={b.mine ? 'font-semibold text-foreground' : ''}>{b.label}</span>
                <span>{b.cuFt} cu ft{b.fragileCuFt ? ` (${b.fragileCuFt} fragile)` : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </figcaption>
    </figure>
  )
}
