/**
 * Pick a city (popular chips or search any US city), then an area in it.
 * Popular cities have named areas; other cities resolve via geocoding to "Anywhere in <city>".
 */
import { useEffect, useMemo, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { CITIES, type CityDef } from '@/places'
import { api, type GeoCity } from '@/lib/api'

export type CityChoice = { key: string; label: string; lat: number; lng: number; areas?: CityDef['areas'] }

export function CityPicker({ label, city, onCity, area, onArea, excludeKey, testId }: {
  label: string
  city: CityChoice | null
  onCity: (c: CityChoice | null) => void
  area: string | GeoCity | null
  onArea: (a: string | GeoCity | null) => void
  excludeKey?: string
  testId?: string
}) {
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState<GeoCity[]>([])
  const [searching, setSearching] = useState(false)
  const local = useMemo(() => (q.length < 2 ? [] : CITIES.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))), [q])

  useEffect(() => {
    if (q.trim().length < 3) { setRemote([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const r = await api.findCity(q.trim())
      setSearching(false)
      setRemote(r.success ? r.data.cities : [])
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const pickCurated = (c: CityDef) => { onCity(c); onArea(null); setQ('') }
  const pickGeo = (g: GeoCity) => {
    const curated = CITIES.find((c) => Math.abs(c.lat - g.lat) < 0.15 && Math.abs(c.lng - g.lng) < 0.15)
    if (curated) return pickCurated(curated)
    onCity({ key: `geo:${g.lat.toFixed(3)},${g.lng.toFixed(3)}`, label: g.label, lat: g.lat, lng: g.lng })
    onArea(g)
    setQ('')
  }

  return (
    <div className="grid gap-2 text-sm" data-testid={testId}>
      <span className="font-medium text-foreground">{label}</span>
      {city ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-foreground"><MapPin className="size-4 text-primary" />{city.label}</span>
            <button type="button" className="text-xs font-medium text-primary" onClick={() => { onCity(null); onArea(null) }}>Change city</button>
          </div>
          {city.areas ? (
            <select value={typeof area === 'string' ? area : ''} onChange={(e) => onArea(e.target.value || null)}
              className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-foreground" data-testid={testId ? `${testId}-area` : undefined}>
              <option value="">Which area?</option>
              {city.areas.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">We'll match on the city. Share the exact address with your pool once you join.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {CITIES.filter((c) => c.key !== excludeKey).slice(0, 10).map((c) => (
              <button key={c.key} type="button" onClick={() => pickCurated(c)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/60">
                {c.label.replace(/, [A-Z]{2}$/, '')}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Another US city… e.g. Raleigh, NC"
              className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-foreground" />
          </div>
          {(local.length > 0 || remote.length > 0 || searching) && (
            <ul className="overflow-hidden rounded-xl border border-border bg-card">
              {local.filter((c) => c.key !== excludeKey).map((c) => (
                <li key={c.key}><button type="button" onClick={() => pickCurated(c)} className="w-full px-3 py-2 text-left hover:bg-accent">{c.label} <span className="text-xs text-muted-foreground">· areas listed</span></button></li>
              ))}
              {remote.filter((g) => !local.some((c) => c.label === g.label)).map((g) => (
                <li key={`${g.lat},${g.lng}`}><button type="button" onClick={() => pickGeo(g)} className="w-full px-3 py-2 text-left hover:bg-accent">{g.label}</button></li>
              ))}
              {searching && <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
