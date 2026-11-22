/** Start a pool. Shows the organizer what they pay alone vs. with a full truck — the real reason to recruit. */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { CONFIG, VEHICLES, type VehicleType } from '@/config'
import { STORAGE_PLACES } from '@/places'
import { usableCuFt } from '@/lib/volume'
import { routeMi } from '@/lib/route'
import { TruckLoad } from '@/components/haul/TruckLoad'
import { useNeedsContact } from '@/components/haul/ContactDialog'
import { quoteTotalCents, truckSplit } from '@/lib/split'
import { api, dollars, walletUrlFor, type DraftRec } from '@/lib/api'
import { serviceFee } from '@/lib/wallet'

const CHOICES: VehicleType[] = ['own_suv', 'cargo_van', 'truck_10', 'truck_15', 'truck_20', 'truck_26']

export default function NewPoolPage() {
  const { userId } = useAuth()
  const { records } = useQuery<DraftRec>('moveDrafts', { where: { userId: userId ?? '' }, limit: 1 })
  const draft = records[0]?.data
  const navigate = useNavigate()
  const toast = useToast()

  const [vehicle, setVehicle] = useState<VehicleType>('truck_15')
  const [perMile, setPerMile] = useState('1.19')
  const estMiles = draft?.pickup && draft.destination ? Math.max(1, Math.round(routeMi([draft.pickup, draft.destination]))) : 12
  const estFuel = Math.round((estMiles / CONFIG.route.mpg) * CONFIG.route.fuelPerGallonCents) / 100
  const [milesIn, setMiles] = useState<string | null>(null) // null = use the estimate
  const [fuelIn, setFuel] = useState<string | null>(null)
  const miles = milesIn ?? String(estMiles)
  const fuel = fuelIn ?? estFuel.toFixed(2)
  const [departure, setDeparture] = useState('09:00')
  const [discount, setDiscount] = useState<number>(CONFIG.split.organizerDiscountPct)
  const [busy, setBusy] = useState(false)

  const storage = STORAGE_PLACES.find((s) => s.key === draft?.destination?.key)
  const [rent, setRent] = useState<string>('')
  const rentCents = Math.round(Number(rent || (storage ? storage.tenByTenCents / 100 : 0)) * 100)

  const spec = VEHICLES[vehicle]
  const usable = usableCuFt(spec.capacityCuFt, CONFIG.buffer.defaultPct)
  const myCuFt = draft?.volumeCuFt ?? 0

  const preview = useMemo(() => {
    try {
      const total = quoteTotalCents({
        baseDayCents: spec.baseDayCents, perMileCents: Math.round(Number(perMile) * 100), miles: Number(miles),
        fuelCents: Math.round(Number(fuel) * 100), otherCents: 0,
      })
      const mine = Math.max(myCuFt, 1)
      const me = { seatId: 'me', volumeCuFt: mine, isOrganizer: true }
      // Typical case: 3 more people with about as much stuff as you (capped by what fits).
      const others = Math.min(3, Math.floor((usable - mine) / mine))
      const typical = others > 0
        ? truckSplit(total, [me, ...Array.from({ length: others }, (_, i) => ({ seatId: `o${i}`, volumeCuFt: mine, isOrganizer: false }))], discount).get('me')!
        : total
      // Best case: the free space gets fully booked (3 people share it equally).
      const rest = Math.max(1, Math.floor((usable - mine) / 3))
      const full = usable - mine >= 3
        ? truckSplit(total, [me, ...[1, 2, 3].map((i) => ({ seatId: `f${i}`, volumeCuFt: rest, isOrganizer: false }))], discount).get('me')!
        : typical
      return { total, alone: total, others, typical, full }
    } catch { return null }
  }, [spec, perMile, miles, fuel, myCuFt, usable, discount])

  const gate = useNeedsContact()
  async function create() {
    setBusy(true)
    let created: string | null = null
    await gate.run(async () => {
      const r = await api.createPool({
        vehicleType: vehicle, departureTime: departure, organizerDiscountPct: discount,
        areaLabel: draft?.pickup?.label, hasStorage: !!storage, storageMonthlyCents: storage ? rentCents : 0,
        quote: { perMileCents: Math.round(Number(perMile) * 100), miles: Number(miles), fuelCents: Math.round(Number(fuel) * 100) },
      })
      if (r.success) created = r.data.poolId
      return r
    }, 'Your truck is open', '/pools/new')
    setBusy(false)
    if (created) navigate(`/pools/${created}`)
  }

  if (!draft?.date || !draft.pickup || !draft.destination) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Fill in your move first.</p>
        <Button className="mt-3" onClick={() => navigate('/move')}>Go to My move</Button>
      </div>
    )
  }

  const tooBig = myCuFt > usable
  const field = 'h-10 rounded-md border border-input bg-background px-3 text-foreground'
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      {gate.dialog}
      <h1 className="text-2xl font-semibold text-foreground">Start a pool</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {draft.date} · from {draft.pickup.label} to {draft.destination.label} · your stuff: {myCuFt} cu ft
      </p>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">Vehicle</span>
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleType)} className={field} data-testid="pool-vehicle">
            {CHOICES.map((v) => (
              <option key={v} value={v}>
                {VEHICLES[v].label} · {usableCuFt(VEHICLES[v].capacityCuFt, CONFIG.buffer.defaultPct)} cu ft usable
                {VEHICLES[v].own ? ' · costs shared, no profit' : ` · from $${(VEHICLES[v].baseDayCents / 100).toFixed(2)}/day`}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm"><span className="font-medium text-foreground">Per mile ($)</span>
          <input inputMode="decimal" value={perMile} onChange={(e) => setPerMile(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium text-foreground">Miles <span className="font-normal text-muted-foreground">(est. {estMiles})</span></span>
          <input inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium text-foreground">Fuel ($) <span className="font-normal text-muted-foreground">(est. {CONFIG.route.mpg} mpg)</span></span>
          <input inputMode="decimal" value={fuel} onChange={(e) => setFuel(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium text-foreground">Leave at</span>
          <input type="time" value={departure} onChange={(e) => setDeparture(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium text-foreground">Organizer discount (%)</span>
          <input type="number" min={0} max={CONFIG.split.organizerDiscountMaxPct} value={discount}
            onChange={(e) => setDiscount(Math.min(CONFIG.split.organizerDiscountMaxPct, Math.max(0, Number(e.target.value))))} className={field} /></label>
        {storage && (
          <label className="grid gap-1 text-sm"><span className="font-medium text-foreground">Unit rent ($/month)</span>
            <input inputMode="decimal" placeholder={String(storage.tenByTenCents / 100)} value={rent} onChange={(e) => setRent(e.target.value)} className={field} /></label>
        )}
      </section>
      <p className="mt-2 text-xs text-muted-foreground">Defaults are estimates. Put in your real quote when you book; everyone sees it labeled as an estimate until then.</p>

      <div className="mt-6 rounded-2xl border border-border bg-card p-4">
        <TruckLoad capacityCuFt={spec.capacityCuFt} usableCuFt={usable} segments={[{ label: 'Your stuff', cuFt: myCuFt, mine: true }]} vehicleLabel={spec.label} />
      </div>

      {preview && !tooBig && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4" data-testid="organizer-preview">
          <p className="text-sm text-muted-foreground">Total cost {dollars(preview.total)}{milesIn === null || fuelIn === null ? ' (estimate)' : ''}</p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-secondary p-2">
              <dt className="text-[11px] text-muted-foreground">Alone</dt>
              <dd className="text-base font-semibold text-foreground">{dollars(preview.alone + serviceFee(preview.alone))}</dd>
            </div>
            <div className="rounded-xl border-2 border-primary bg-accent/50 p-2">
              <dt className="text-[11px] text-muted-foreground">{preview.others > 0 ? `${preview.others} more like you` : 'Typical'}</dt>
              <dd className="text-base font-semibold text-primary">{dollars(preview.typical + serviceFee(preview.typical))}</dd>
            </div>
            <div className="rounded-xl bg-secondary p-2">
              <dt className="text-[11px] text-muted-foreground">Truck fills up</dt>
              <dd className="text-base font-semibold text-foreground">{dollars(preview.full + serviceFee(preview.full))}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Prices include HaulPool's {CONFIG.fees.servicePct}% service fee. Everyone pays for the space their stuff takes. "More like you" assumes each person brings about {myCuFt} cu ft, like you.
            "Fills up" means every free cu ft is booked. You get {discount}% off for organizing.
          </p>
        </div>
      )}
      {tooBig && <p className="mt-6 text-sm text-destructive">Your items need {myCuFt} cu ft; this vehicle holds {usable}. Pick a bigger one.</p>}

      <Button className="mt-6 w-full" onClick={create} disabled={busy || tooBig} loading={busy} data-testid="create-pool">Start the pool</Button>
    </div>
  )
}
