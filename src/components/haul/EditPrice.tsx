/**
 * Organizer edits the truck and the real price (e.g. after booking with U-Haul).
 * After lock, everyone's wallet hold follows the new price automatically.
 */
import { useState } from 'react'
import { Button, useToast } from '@/components/ui'
import { CONFIG, VEHICLES, type VehicleType } from '@/config'
import { usableCuFt } from '@/lib/volume'
import { quoteTotalCents } from '@/lib/split'
import { api, dollars, type PoolRec } from '@/lib/api'

const CHOICES: VehicleType[] = ['own_suv', 'cargo_van', 'truck_10', 'truck_15', 'truck_20', 'truck_26']
const field = 'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground'

export function EditPrice({ pool, poolId, usedCuFt, onDone }: { pool: PoolRec; poolId: string; usedCuFt: number; onDone: () => void }) {
  const toast = useToast()
  const [vehicle, setVehicle] = useState<VehicleType>(pool.vehicleType)
  const [base, setBase] = useState((pool.quote.baseDayCents / 100).toFixed(2))
  const [perMile, setPerMile] = useState((pool.quote.perMileCents / 100).toFixed(2))
  const [miles, setMiles] = useState(String(pool.quote.miles))
  const [fuel, setFuel] = useState((pool.quote.fuelCents / 100).toFixed(2))
  const [other, setOther] = useState((pool.quote.otherCents / 100).toFixed(2))
  const [time, setTime] = useState(pool.departureTime ?? '09:00')
  const [busy, setBusy] = useState(false)
  const c = (v: string) => Math.round(Number(v) * 100)
  const quote = { baseDayCents: c(base), perMileCents: c(perMile), miles: Number(miles), fuelCents: c(fuel), otherCents: c(other) }
  const total = Object.values(quote).every((n) => Number.isFinite(n) && n >= 0) ? quoteTotalCents(quote) : null
  const usable = usableCuFt(VEHICLES[vehicle].capacityCuFt, pool.bufferPct ?? CONFIG.buffer.defaultPct)

  async function save() {
    setBusy(true)
    const r = await api.updatePool({ poolId, vehicleType: vehicle, quote, departureTime: time, isEstimate: false })
    setBusy(false)
    if (!r.success) return toast.error('Not saved', r.error)
    toast.success('Price updated', pool.status === 'locked' ? 'Everyone\'s hold was adjusted to the new price.' : 'Everyone sees the real price now.')
    onDone()
  }

  return (
    <section className="mt-4 rounded-2xl border-2 border-primary bg-card p-4" data-testid="edit-price-form">
      <h2 className="font-bold text-foreground">Edit truck & price</h2>
      <p className="text-xs text-muted-foreground">Put in your real booking. {pool.status === 'locked' ? 'Everyone\'s wallet hold updates automatically.' : 'Members see the new price right away.'}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm sm:col-span-2"><span className="font-medium">Vehicle</span>
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleType)} className={field}>
            {CHOICES.map((v) => <option key={v} value={v}>{VEHICLES[v].label} · {usableCuFt(VEHICLES[v].capacityCuFt, CONFIG.buffer.defaultPct)} cu ft usable</option>)}
          </select>
          {usable < usedCuFt && <span className="text-xs text-destructive">Too small: {usedCuFt} cu ft is already booked.</span>}
        </label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Day rate ($)</span><input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Per mile ($)</span><input inputMode="decimal" value={perMile} onChange={(e) => setPerMile(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Miles</span><input inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Fuel ($)</span><input inputMode="decimal" value={fuel} onChange={(e) => setFuel(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Other: insurance, dolly ($)</span><input inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Leaves at</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} /></label>
      </div>
      <p className="mt-3 text-sm text-foreground">New truck total: <span className="font-bold">{total !== null ? dollars(total) : '—'}</span></p>
      <div className="mt-3 flex gap-2">
        <Button onClick={save} loading={busy} disabled={total === null || usable < usedCuFt}>Save real price</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </section>
  )
}
