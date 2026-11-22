/** Live capacity bar: one segment per member, the rest is free space. */
export function CapacityBar({ usable, segments }: { usable: number; segments: { label: string; cuFt: number; mine?: boolean }[] }) {
  const used = segments.reduce((a, s) => a + s.cuFt, 0)
  const left = Math.max(0, usable - used)
  const pct = (n: number) => `${Math.min(100, (n / Math.max(usable, 1)) * 100)}%`
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${used} of ${usable} cubic feet booked`}>
        {segments.map((s, i) => (
          <div
            key={i}
            title={`${s.label}: ${s.cuFt} cu ft`}
            style={{ width: pct(s.cuFt) }}
            className={s.mine ? 'bg-primary' : i % 2 === 0 ? 'bg-primary/45' : 'bg-primary/30'}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span data-testid="capacity-used">{used} cu ft booked</span>
        <span data-testid="capacity-left">{left} cu ft left of {usable}</span>
      </div>
    </div>
  )
}
