/**
 * "My move" — a 3-step wizard: When & where → Your stuff → Review.
 * Progress is saved to the server on every "Next", so it survives refreshes and devices.
 * Returning users with a complete move land on Review.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Building2, Check, Plane, Search, Truck } from 'lucide-react'
import { useAuth, useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { ItemPicker } from '@/components/haul/ItemPicker'
import { PhotoScan } from '@/components/haul/PhotoScan'
import { TruckLoad } from '@/components/haul/TruckLoad'
import { CityPicker, type CityChoice } from '@/components/haul/CityPicker'
import { ExactSpot } from '@/components/haul/ExactSpot'
import { ContactPicker, contactOk } from '@/components/haul/ContactPicker'
import { CITIES, HOME_CITY_KEY, PICKUP_PLACES, STORAGE_PLACES, cityByKey, placeByKey } from '@/places'
import { CONFIG, ITEMS, ROOM_PRESETS, VEHICLES, type ItemKey, type VehicleType } from '@/config'
import { fragileCuFt, mediumBoxEquivalent, totalCuFt, usableCuFt, type ItemLine } from '@/lib/volume'
import { api, type Contact, type Detail, type DraftPlace, type DraftRec, type GeoCity, type MoveType, type SeatRec } from '@/lib/api'
import { haversineMi } from '@/lib/route'

const STEPS = ['When & where', 'Your stuff', 'Review'] as const

function smallestVehicle(cuFt: number): VehicleType | null {
  const order: VehicleType[] = ['own_suv', 'cargo_van', 'truck_10', 'truck_15', 'truck_20', 'truck_26']
  return order.find((v) => usableCuFt(VEHICLES[v].capacityCuFt, CONFIG.buffer.defaultPct) >= cuFt) ?? null
}

const fieldCls = 'h-11 w-full rounded-xl border border-input bg-card px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40'

export default function MovePage() {
  const { userId } = useAuth()
  const { records, status } = useQuery<DraftRec>('moveDrafts', { where: { userId: userId ?? '' }, limit: 1 })
  const draft = records[0]?.data
  const navigate = useNavigate()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [items, setItems] = useState<ItemLine[]>([])
  const [preset, setPreset] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [moveType, setMoveType] = useState<MoveType>('local')
  const [pickupKey, setPickupKey] = useState('')
  const [destKey, setDestKey] = useState('')
  // city-to-city
  const [fromCity, setFromCity] = useState<CityChoice | null>(cityByKey(HOME_CITY_KEY)!)
  const [fromArea, setFromArea] = useState<string | GeoCity | null>(null)
  const [toCity, setToCity] = useState<CityChoice | null>(null)
  const [toArea, setToArea] = useState<string | GeoCity | null>(null)
  const [pickupDetail, setPickupDetail] = useState<Detail | null>(null)
  const [destDetail, setDestDetail] = useState<Detail | null>(null)
  const [contact, setContact] = useState<Contact | null>(null)
  const [months, setMonths] = useState(3)
  const [flexDays, setFlexDays] = useState<number>(CONFIG.dates.flexDefaultDays)
  const mySeats = useQuery<SeatRec>('seats', { where: { userId: userId ?? '', status: 'active' }, limit: 1 })
  const inPool = mySeats.records[0]?.data
  const inPoolIsOrganizer = !!inPool?.isOrganizer
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded || status !== 'ready') return
    if (draft) {
      setItems(draft.items ?? [])
      setDate(draft.date ?? '')
      if (draft.moveType === 'city') {
        setMoveType('city')
        const [fc, fa] = fromDraftPlace(draft.pickup)
        const [tc, ta] = fromDraftPlace(draft.destination)
        setFromCity(fc); setFromArea(fa); setToCity(tc); setToArea(ta)
      } else {
        setPickupKey(draft.pickup?.key ?? '')
        setDestKey(draft.destination?.key ?? '')
      }
      if (draft.storageMonths) setMonths(draft.storageMonths)
      setPickupDetail(draft.pickupDetail ?? null)
      setDestDetail(draft.destDetail ?? null)
      setContact(draft.contact ?? null)
      if (draft.flexDays !== undefined) setFlexDays(draft.flexDays)
      if (draft.date && draft.pickup && draft.destination && (draft.items ?? []).length > 0) setStep(2)
    }
    setLoaded(true)
  }, [status, draft, loaded])

  const volume = useMemo(() => {
    try { return { cuFt: totalCuFt(items), error: null as string | null } } catch (e) { return { cuFt: 0, error: (e as Error).message } }
  }, [items])
  const isStorage = moveType === 'local' && STORAGE_PLACES.some((s) => s.key === destKey)
  const hint = smallestVehicle(volume.cuFt)
  const today = new Date().toISOString().slice(0, 10)
  const pickup = moveType === 'local' ? pickupKey || null : fromArea
  const destination = moveType === 'local' ? destKey || null : toArea
  const placesOk = moveType === 'local'
    ? !!pickupKey && !!destKey && destKey !== pickupKey
    : !!fromArea && !!toArea && !!fromCity && !!toCity && fromCity.key !== toCity.key
  const step1Ok = !!date && date >= today && placesOk
  const tripMi = useMemo(() => {
    const a = placeLatLng(pickup), b = placeLatLng(destination)
    return a && b ? Math.round(haversineMi(a, b) * 1.3) : null
  }, [pickup, destination])
  const step2Ok = items.length > 0 && !volume.error
  const itemCount = items.reduce((n, l) => n + l.qty, 0)

  async function persist(acceptExtraCents?: number): Promise<boolean> {
    setSaving(true)
    const r = await api.saveDraft({
      items, date: date || undefined, moveType, pickup: pickup ?? undefined, destination: destination ?? undefined, storageMonths: isStorage ? months : 0,
      pickupDetail: cleanDetail(pickupDetail), destDetail: cleanDetail(destDetail), contact: contactOk(contact) ? contact : undefined, acceptExtraCents, flexDays,
    })
    setSaving(false)
    if (!r.success) {
      // In a pool and the new pickup makes the route longer: show the exact cost, let them accept.
      const m = r.code ? /^needs_accept:(\d+)$/.exec(r.code) : null
      if (m && window.confirm(`${r.error}\n\nOK = accept and pay it. Cancel = keep your old pickup.`)) return persist(Number(m[1]))
      if (!m) toast.error('Could not save', r.error)
      return false
    }
    if (r.data.poolUpdated) toast.success('Your pool is updated', 'Your space and share in the truck now match this list.')
    return true
  }

  function nearestLocal(lat: number, lng: number): string | null {
    const best = PICKUP_PLACES.map((p) => ({ p, d: haversineMi({ lat, lng }, p) })).sort((a, b) => a.d - b.d)[0]
    if (!best || best.d > 10) return null
    setPickupKey(best.p.key)
    return best.p.label
  }
  function nearestCityArea(lat: number, lng: number): string | null {
    let best: { city: (typeof CITIES)[number]; area: (typeof CITIES)[number]['areas'][number]; d: number } | null = null
    for (const c of CITIES) for (const a of c.areas) {
      const d = haversineMi({ lat, lng }, a)
      if (!best || d < best.d) best = { city: c, area: a, d }
    }
    if (!best || best.d > 25) return null
    setFromCity(best.city); setFromArea(best.area.key)
    return `${best.area.label}, ${best.city.label}`
  }

  async function go(to: number) {
    if (to > step && !(await persist())) return
    setStep(to)
    api.track('wizard_step', { step: to + 1 })
    document.querySelector('main')?.scrollTo({ top: 0 })
  }

  async function finish(next: string) {
    if (await persist()) navigate(next)
  }

  function applyPreset(key: string) {
    const p = ROOM_PRESETS.find((x) => x.key === key)
    if (!p) return
    setItems(Object.entries(p.items).map(([k, qty]) => ({ kind: 'preset', key: k as ItemKey, qty: qty! })))
    setPreset(key)
    api.track('preset_used', { preset: key })
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-32 pt-8">
      <h1 className="text-2xl font-semibold text-foreground">Plan your move</h1>
      <p className="mt-1 text-sm text-muted-foreground">Three quick steps. We save as you go.</p>
      {inPool && (
        <p className="mt-4 rounded-xl border border-primary/40 bg-accent/60 p-3 text-sm text-foreground" data-testid="in-pool-note">
          🚚 You're in a pool. What you can still change:
          <span className="mt-1 block text-xs">• <b>Your stuff</b> — your space and share update right away, if it fits.</span>
          <span className="block text-xs">• <b>Pickup</b> — if it's still on the way; a longer route costs only you.</span>
          <span className="block text-xs">• <b>Destination</b> — {inPoolIsOrganizer ? 'you organize, so you can move the whole truck before it locks (everyone is told and can leave free).' : 'only to another spot where this truck goes (e.g. another area of the same city). Somewhere else? Leave the pool and find another truck.'}</span>
          <span className="block text-xs">• The <b>date</b> and the kind of move stay fixed while you're in it.</span>
        </p>
      )}

      {/* progress */}
      <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Progress">
        {STEPS.map((label, i) => {
          const done = i < step
          const current = i === step
          return (
            <li key={label}>
              <button type="button" disabled={i > step} onClick={() => setStep(i)} className="w-full text-left disabled:cursor-default" aria-current={current ? 'step' : undefined}>
                <div className={`h-1.5 rounded-full ${done || current ? 'bg-primary' : 'bg-muted'}`} />
                <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${current ? 'text-foreground' : 'text-muted-foreground'}`}>
                  <span className={`grid size-5 place-items-center rounded-full text-[10px] ${done ? 'bg-primary text-primary-foreground' : current ? 'border-2 border-primary text-primary' : 'border border-border'}`}>
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  {label}
                </div>
              </button>
            </li>
          )
        })}
      </ol>

      {step === 0 && (
        <section className="mt-8 space-y-5" data-testid="step-where">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">📅 What day are you moving out?</span>
            <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} data-testid="move-date" className={`${fieldCls} disabled:opacity-60`} disabled={!!inPool} />
            <span className="text-xs text-muted-foreground">We match you with trucks leaving around this day.</span>
          </label>
          <div className="grid gap-1.5 text-sm" data-testid="flex-days">
            <span className="font-medium text-foreground">How flexible is your date?</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Date flexibility">
              {[0, 1, 2, 3].map((d) => (
                <button key={d} type="button" role="radio" aria-checked={flexDays === d} onClick={() => setFlexDays(d)} disabled={!!inPool}
                  className={`h-9 rounded-full border px-3 text-sm ${flexDays === d ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'} disabled:opacity-60`}>
                  {d === 0 ? 'Exact day' : `± ${d} day${d > 1 ? 's' : ''}`}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {flexDays === 0 ? 'Only trucks leaving that exact day.' : `Trucks leaving up to ${flexDays} day${flexDays > 1 ? 's' : ''} before or after. More flexible = more trucks to share. If you join one, your move date becomes its date.`}
            </span>
          </div>
          <div className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">🚚 What kind of move?</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {([['local', Building2, 'Around town', 'Within Pittsburgh, or into storage'], ['city', Plane, 'City to city', 'e.g. Pittsburgh → New York']] as const).map(([k, Icon, t, d]) => (
                <button key={k} type="button" role="radio" aria-checked={moveType === k} onClick={() => setMoveType(k)} data-testid={`move-type-${k}`} disabled={!!inPool && moveType !== k}
                  className={`rounded-xl border p-3 text-left ${moveType === k ? 'border-primary bg-accent' : 'border-border bg-card'}`}>
                  <Icon className={`size-5 ${moveType === k ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div className="mt-1 font-semibold text-foreground">{t}</div>
                  <div className="text-xs text-muted-foreground">{d}</div>
                </button>
              ))}
            </div>
          </div>

          {moveType === 'local' ? (
            <>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">📍 Where should the truck pick you up?</span>
                <select value={pickupKey} onChange={(e) => setPickupKey(e.target.value)} data-testid="move-pickup" className={fieldCls}>
                  <option value="">Choose your building or area</option>
                  <optgroup label="Campus buildings">
                    {PICKUP_PLACES.filter((p) => p.kind === 'building').map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </optgroup>
                  <optgroup label="Neighborhoods">
                    {PICKUP_PLACES.filter((p) => p.kind === 'neighborhood').sort((a, b) => a.label.localeCompare(b.label)).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </optgroup>
                </select>
                <span className="text-xs text-muted-foreground">Others only see the area, never your exact address, until you are in the same pool.</span>
              </label>
              <ExactSpot detail={pickupDetail} onDetail={setPickupDetail} onLocated={nearestLocal} placeholder="Street address, building entrance or unit (optional)" testId="pickup-exact" />
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">🏁 Where is your stuff going?</span>
                <select value={destKey} onChange={(e) => setDestKey(e.target.value)} data-testid="move-destination" className={fieldCls}>
                  <option value="">Choose a storage unit or your new neighborhood</option>
                  <optgroup label="Storage over the break (shared unit)">
                    {STORAGE_PLACES.map((st) => <option key={st.key} value={st.key}>{st.label} · ~${Math.round(st.tenByTenCents / 100)}/mo for 10×10</option>)}
                  </optgroup>
                  <optgroup label="My new place in Pittsburgh">
                    {PICKUP_PLACES.filter((p) => p.kind === 'neighborhood').sort((a, b) => a.label.localeCompare(b.label)).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </optgroup>
                </select>
                {destKey && destKey === pickupKey && <span className="text-xs text-destructive">Pickup and destination are the same place.</span>}
              </label>
              {destKey && !isStorage && (
                <ExactSpot detail={destDetail} onDetail={setDestDetail} allowLocate={false} placeholder="New address, for the driver (optional)" testId="dest-exact" />
              )}
            </>
          ) : (
            <>
              <CityPicker label="📍 Moving from" city={fromCity} onCity={setFromCity} area={fromArea} onArea={setFromArea} excludeKey={toCity?.key} testId="from-city" />
              <ExactSpot detail={pickupDetail} onDetail={setPickupDetail} onLocated={nearestCityArea} placeholder="Pickup street address or unit (optional)" testId="pickup-exact" />
              <CityPicker label="🏁 Moving to" city={toCity} onCity={setToCity} area={toArea} onArea={setToArea} excludeKey={fromCity?.key} testId="to-city" />
              {toCity && <ExactSpot detail={destDetail} onDetail={setDestDetail} allowLocate={false} placeholder="Drop-off address in the new city (optional)" testId="dest-exact" />}
              {fromCity && toCity && fromCity.key === toCity.key && <span className="text-xs text-destructive">Same city — choose "Around town" instead.</span>}
              {tripMi && moveType === 'city' && (
                <p className="rounded-xl bg-secondary px-3 py-2 text-xs text-foreground">🛣️ About <span className="font-semibold">{tripMi} miles</span> by road. You'll match with people driving to the same city that day, even if they're going to a different neighborhood.</p>
              )}
            </>
          )}
          {isStorage && (
            <div className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">🗓️ How many months in storage?</span>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 6, 9, 12].map((m) => (
                  <button key={m} type="button" onClick={() => setMonths(m)}
                    className={`h-9 min-w-12 rounded-full border px-3 text-sm ${months === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'}`}>
                    {m}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">Summer break is usually 3 months. You only pay for the months you use.</span>
            </div>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="mt-8" data-testid="step-stuff">
          {volume.cuFt > 0 && hint && (
            <div className="mb-6 rounded-2xl border border-border bg-card p-4">
              <TruckLoad capacityCuFt={VEHICLES[hint].capacityCuFt} usableCuFt={usableCuFt(VEHICLES[hint].capacityCuFt, CONFIG.buffer.defaultPct)}
                segments={[{ label: 'Your stuff', cuFt: volume.cuFt, mine: true }]} vehicleLabel={`Your stuff in a ${VEHICLES[hint].label.toLowerCase()}`} />
              {roomFor(hint, volume.cuFt) > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">There's room for about <span className="font-semibold text-foreground">{roomFor(hint, volume.cuFt)} more people</span> with this much stuff — that's who splits the cost with you.</p>
              )}
            </div>
          )}
          <PhotoScan value={items} onApply={(v) => { setItems(v); setPreset(null) }} />
          <h2 className="mt-6 text-sm font-medium text-foreground">Or start from a typical room, then adjust</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {ROOM_PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => applyPreset(p.key)} data-testid={`preset-${p.key}`}
                className={`rounded-xl border p-3 text-left transition-colors ${preset === p.key ? 'border-primary bg-accent' : 'border-border bg-card hover:border-primary/50'}`}>
                <div className="text-xl" aria-hidden>{p.icon}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{p.label}</div>
                <div className="text-xs text-muted-foreground">{p.hint}</div>
              </button>
            ))}
          </div>
          <div className="mt-6">
            <ItemPicker value={items} onChange={(v) => { setItems(v); setPreset(null) }} />
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="mt-8 space-y-4" data-testid="step-review">
          <div className="rounded-2xl border border-border bg-card p-4">
            <Row label="Moving day" value={date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : '—'} onEdit={() => setStep(0)} />
            <Row label="Move" value={moveType === 'city' ? `City to city${tripMi ? ` · ~${tripMi} mi` : ''}` : 'Around town'} onEdit={() => setStep(0)} />
            <Row label="From" value={placeText(pickup)} onEdit={() => setStep(0)} />
            <Row label="To" value={placeText(destination)} onEdit={() => setStep(0)} />
            {isStorage && <Row label="Storage" value={`${months} month${months === 1 ? '' : 's'}`} onEdit={() => setStep(0)} />}
            <Row label="Your stuff" value={`${itemCount} items · ${volume.cuFt} cu ft`} onEdit={() => setStep(1)} />
            <p className="mt-3 text-xs text-muted-foreground">
              {items.filter((l) => l.kind === 'preset').map((l) => `${l.qty}× ${l.kind === 'preset' ? ITEMS[l.key].label.toLowerCase() : ''}`).join(', ')}
            </p>
          </div>
          {hint && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <TruckLoad size="sm" capacityCuFt={VEHICLES[hint].capacityCuFt} usableCuFt={usableCuFt(VEHICLES[hint].capacityCuFt, CONFIG.buffer.defaultPct)}
                segments={[{ label: 'Your stuff', cuFt: volume.cuFt, mine: true }]} vehicleLabel={VEHICLES[hint].label} />
            </div>
          )}
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">📞 How your pool reaches you</p>
            <p className="mb-3 mt-0.5 text-xs text-muted-foreground">{draft?.contact ? 'From your profile — change it here if you like.' : 'Add it now or when you join. Only people in your pool see it.'}</p>
            <ContactPicker value={contact} onChange={setContact} />
          </div>
          <p className="text-sm text-foreground">How do you want to get there?</p>
          <button type="button" onClick={() => finish('/search')} disabled={saving} data-testid="find-ride"
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-primary bg-accent/50 p-4 text-left disabled:opacity-60">
            <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground"><Search className="size-5" /></span>
            <span className="flex-1">
              <span className="block font-semibold text-foreground">Find a truck going my way</span>
              <span className="block text-xs text-muted-foreground">See trucks leaving the same day with room for your stuff, cheapest first.</span>
            </span>
            <ArrowRight className="size-5 text-primary" />
          </button>
          <button type="button" onClick={() => finish(inPool ? `/pools/${inPool.poolId}` : '/pools/new')} disabled={saving}
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left disabled:opacity-60">
            <span className="grid size-10 place-items-center rounded-full bg-secondary text-foreground"><Truck className="size-5" /></span>
            <span className="flex-1">
              <span className="block font-semibold text-foreground">I have or will rent a vehicle</span>
              <span className="block text-xs text-muted-foreground">Start a pool, fill the empty space, and pay less. Organizers get a discount.</span>
            </span>
            <ArrowRight className="size-5 text-muted-foreground" />
          </button>
        </section>
      )}

      {/* sticky footer: volume + navigation */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-card/95 backdrop-blur md:bottom-0">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 text-sm" data-testid="move-volume">
            {volume.error ? (
              <span className="text-destructive">{volume.error}</span>
            ) : volume.cuFt > 0 ? (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span key={volume.cuFt} className="hp-bump font-semibold text-foreground">{volume.cuFt} cu ft</span>
                  <span className="truncate text-xs text-muted-foreground">≈ {mediumBoxEquivalent(volume.cuFt)} boxes{fragileCuFt(items) > 0 ? ` · ${fragileCuFt(items)} fragile` : ''}</span>
                </div>
                {hint ? (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-[var(--color-tape)] transition-[width] duration-300"
                        style={{ width: `${Math.min(100, (volume.cuFt / usableCuFt(VEHICLES[hint].capacityCuFt, CONFIG.buffer.defaultPct)) * 100)}%` }} />
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">of a {VEHICLES[hint].label.toLowerCase()}</span>
                  </div>
                ) : (
                  <span className="text-xs text-destructive">Bigger than our largest truck</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Step {step + 1} of 3</span>
            )}
          </div>
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)} aria-label="Back"><ArrowLeft className="size-4" /></Button>
          )}
          {step < 2 && (
            <Button onClick={() => go(step + 1)} disabled={saving || (step === 0 ? !step1Ok : !step2Ok)} loading={saving} data-testid="next">
              Next <ArrowRight className="ml-1 size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-3 text-right">
        <span className="font-medium text-foreground">{value}</span>
        <button type="button" onClick={onEdit} className="text-xs font-medium text-primary">Edit</button>
      </span>
    </div>
  )
}

/** How many more people with the same amount of stuff fit in this vehicle. */
function roomFor(v: VehicleType, cuFt: number): number {
  return Math.max(0, Math.floor((usableCuFt(VEHICLES[v].capacityCuFt, CONFIG.buffer.defaultPct) - cuFt) / Math.max(cuFt, 1)))
}

function placeLatLng(p: string | GeoCity | null): { lat: number; lng: number } | null {
  if (!p) return null
  if (typeof p !== 'string') return p
  const k = placeByKey(p)
  return k ? { lat: k.lat, lng: k.lng } : null
}

function placeText(p: string | GeoCity | null): string {
  if (!p) return '—'
  if (typeof p !== 'string') return `Anywhere in ${p.label}`
  const k = placeByKey(p)
  return k ? (k.cityKey === HOME_CITY_KEY ? k.label : `${k.label}, ${k.cityLabel}`) : '—'
}

function fromDraftPlace(p?: DraftPlace): [CityChoice | null, string | GeoCity | null] {
  if (!p) return [null, null]
  if (p.cityKey?.startsWith('geo:')) {
    const g = { label: p.cityLabel ?? p.label, lat: p.lat, lng: p.lng }
    return [{ key: p.cityKey, ...g }, g]
  }
  const city = CITIES.find((c) => c.key === (p.cityKey ?? HOME_CITY_KEY)) ?? null
  return [city, p.key ?? null]
}

/** Send null to clear; drop empty strings. */
function cleanDetail(d: Detail | null): Detail | null {
  if (!d) return null
  const address = d.address?.trim() || undefined
  const pinned = d.lat !== undefined && d.lng !== undefined
  if (!address && !pinned) return null
  return { address, ...(pinned ? { lat: d.lat, lng: d.lng } : {}) }
}
