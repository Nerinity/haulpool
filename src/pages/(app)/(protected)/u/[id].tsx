/**
 * Profile page: who someone is, what they're moving (area level), the truck they organize,
 * and Message / Invite. Your own page lets you edit it and choose email notifications.
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Truck } from 'lucide-react'
import { useAuth, useQuery, useUserLookup } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { Avatar, DemoBadge, MessageButton, useProfile } from '@/components/haul/People'
import { VEHICLES } from '@/config'
import { api, isDemoUser, type LookingPostRec, type PoolRec, type SeatRec } from '@/lib/api'

const AVATARS = ['📦', '🚚', '🎒', '🪴', '🎸', '📚', '🐱', '🐶', '🌟', '🍜', '🏀', '🎨']
const field = 'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground'

export default function ProfilePage() {
  const { id = '' } = useParams()
  const { userId: me } = useAuth()
  const { getName } = useUserLookup()
  const toast = useToast()
  const profile = useProfile(id)
  const looking = useQuery<LookingPostRec>('lookingPosts', { where: { userId: id }, limit: 1 }).records[0]?.data
  const organizing = useQuery<PoolRec>('pools', { where: { organizerId: id, status: 'open' }, limit: 5 }).records
  const mySeat = useQuery<SeatRec>('seats', { where: { userId: me ?? '', status: 'active' }, limit: 1 }).records[0]?.data
  const isMe = id === me
  const [inviting, setInviting] = useState(false)
  const name = getName(id) ?? 'Member'

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <Avatar userId={id} size="lg" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-2xl font-extrabold text-foreground">{name}{isDemoUser(id) && <DemoBadge />}</h1>
            <p className="text-sm text-muted-foreground">{[profile?.school, profile?.year && `Class of ${profile.year}`].filter(Boolean).join(' · ') || (isMe ? 'Add your school below' : 'Student')}</p>
          </div>
        </div>
        {profile?.bio && <p className="mt-4 text-sm leading-relaxed text-foreground">{profile.bio}</p>}
        {!isMe && (
          <div className="mt-4 flex flex-wrap gap-2">
            <MessageButton userId={id} variant="default" size="default" />
            {mySeat && looking?.status === 'looking' && (
              <Button variant="outline" loading={inviting} onClick={async () => {
                setInviting(true)
                const r = await api.invite(mySeat.poolId, id)
                setInviting(false)
                if (r.success) toast.success('Invite sent', `${name.split(' ')[0]} gets a notification and an email.`)
                else toast.error('Not sent', r.error)
              }}><Truck className="mr-1.5 size-4" />Invite to my truck</Button>
            )}
          </div>
        )}
      </section>

      {looking?.status === 'looking' && looking.date && (
        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">{isMe ? 'You are listed as looking for a truck' : 'Looking for a truck'}</p>
          <p className="mt-1 font-bold text-foreground">{new Date(`${looking.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          <p className="text-sm text-foreground">{looking.moveType === 'city' ? `${looking.fromCity} → ${looking.toCity}` : `${looking.fromLabel} → ${looking.toLabel}`} · {looking.volumeCuFt} cu ft</p>
        </section>
      )}

      {organizing.length > 0 && (
        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">{isMe ? 'Your open truck' : `${name.split(' ')[0]} is organizing`}</p>
          {organizing.map((p) => (
            <Link key={p.recordId} to={`/pools/${p.recordId}`} className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-secondary p-3 text-sm hover:bg-muted">
              <span>
                <span className="block font-bold text-foreground">{p.data.moveType === 'city' ? `${p.data.fromCity} → ${p.data.toCity}` : `${p.data.areaLabel} → ${p.data.destinationLabel}`}</span>
                <span className="text-muted-foreground">{VEHICLES[p.data.vehicleType]?.label} · {p.data.date}</span>
              </span>
              <span className="font-semibold text-primary">View</span>
            </Link>
          ))}
        </section>
      )}

      {isMe && <EditProfile />}
    </div>
  )
}

function EditProfile() {
  const { userId } = useAuth()
  const profile = useProfile(userId ?? undefined)
  const looking = useQuery<LookingPostRec>('lookingPosts', { where: { userId: userId ?? '' }, limit: 1 }).records[0]?.data
  const toast = useToast()
  const [form, setForm] = useState({ school: '', year: '', bio: '', avatar: '', emailNotify: true })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (loaded || !profile) return
    setForm({ school: profile.school ?? '', year: profile.year ?? '', bio: profile.bio ?? '', avatar: profile.avatar ?? '', emailNotify: profile.emailNotify !== false })
    setLoaded(true)
  }, [profile, loaded])
  const listed = looking?.status === 'looking' || looking?.status === 'matched'

  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-4" data-testid="edit-profile">
      <h2 className="font-bold text-foreground">Edit your profile</h2>
      <p className="text-xs text-muted-foreground">Everyone signed in can see this page. Your address and contact stay private.</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Avatar">
        {AVATARS.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={form.avatar === a} onClick={() => setForm({ ...form, avatar: form.avatar === a ? '' : a })}
            className={`grid size-10 place-items-center rounded-full border text-xl ${form.avatar === a ? 'border-primary bg-accent' : 'border-border bg-background'}`}>{a}</button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span className="font-medium">School</span><input value={form.school} maxLength={60} onChange={(e) => setForm({ ...form, school: e.target.value })} placeholder="Carnegie Mellon" className={field} /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Class of</span><input value={form.year} maxLength={20} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="2027" className={field} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span className="font-medium">About you</span>
          <textarea value={form.bio} maxLength={200} rows={3} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Moving to NYC for an internship. Mostly boxes and a desk."
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-3 text-sm">
        <input type="checkbox" checked={form.emailNotify} onChange={(e) => setForm({ ...form, emailNotify: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
        Email me about invites, new matching trucks and my pool
      </label>
      <label className="mt-2 flex items-center gap-3 text-sm">
        <input type="checkbox" checked={listed} onChange={async (e) => {
          const r = await api.setLooking(e.target.checked)
          if (!r.success) toast.error('Not changed', r.error)
        }} className="size-4 accent-[var(--color-primary)]" />
        List me as looking for a truck (shows my date, areas and size — not my address)
      </label>
      <Button className="mt-4" loading={busy} onClick={async () => {
        setBusy(true)
        const r = await api.saveProfile(form)
        setBusy(false)
        if (r.success) toast.success('Profile saved')
        else toast.error('Not saved', r.error)
      }}>Save profile</Button>
    </section>
  )
}
