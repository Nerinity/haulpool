/**
 * Exact spot for pickup or drop-off: "Use my current location" (pins GPS coordinates and lets
 * the parent pick the nearest area) and/or a typed street address. Only pool members see it.
 */
import { useState } from 'react'
import { Crosshair, Loader2, Lock, X } from 'lucide-react'
import type { Detail } from '@/lib/api'

export function ExactSpot({ detail, onDetail, onLocated, allowLocate = true, placeholder, testId }: {
  detail: Detail | null
  onDetail: (d: Detail | null) => void
  /** Called with the GPS fix so the parent can choose the nearest area; return its name, or null if none is near. */
  onLocated?: (lat: number, lng: number) => string | null
  allowLocate?: boolean
  placeholder: string
  testId?: string
}) {
  const [locating, setLocating] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const pinned = detail?.lat !== undefined && detail?.lng !== undefined

  function locate() {
    if (!('geolocation' in navigator)) { setMsg('This browser cannot share your location. Type your address instead.'); return }
    setLocating(true)
    setMsg(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const { latitude: lat, longitude: lng, accuracy } = pos.coords
        const area = onLocated?.(lat, lng) ?? null
        if (onLocated && !area) { setMsg('You seem to be far from the areas we list. Pick your area above, then type your address.'); return }
        onDetail({ ...(detail ?? {}), lat, lng })
        setMsg(`Pinned${area ? ` near ${area}` : ''} (±${Math.round(accuracy)} m).`)
      },
      (err) => {
        setLocating(false)
        setMsg(err.code === err.PERMISSION_DENIED ? 'Location is blocked for this site. Allow it in your browser, or type your address.' : 'Could not get your location. Type your address instead.')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  return (
    <div className="grid gap-2" data-testid={testId}>
      <div className="flex gap-2">
        <input value={detail?.address ?? ''} placeholder={placeholder} maxLength={120}
          onChange={(e) => onDetail({ ...(detail ?? {}), address: e.target.value || undefined })}
          className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40" />
        {allowLocate && (
          <button type="button" onClick={locate} disabled={locating} aria-label="Use my current location"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-primary/50 bg-card px-3 text-sm font-semibold text-primary disabled:opacity-60">
            {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
            <span className="hidden sm:inline">Use my location</span>
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Lock className="size-3" />Only people in your pool see this.</span>
        {pinned && (
          <button type="button" className="inline-flex items-center gap-1 font-medium text-foreground" onClick={() => { onDetail(detail?.address ? { address: detail.address } : null); setMsg(null) }}>
            📍 Location pinned <X className="size-3" />
          </button>
        )}
        {msg && <span className="text-foreground">{msg}</span>}
      </div>
    </div>
  )
}
