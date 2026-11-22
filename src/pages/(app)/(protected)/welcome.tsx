/**
 * First sign-in: set up your profile once — who you are, and how your pool can reach you.
 * The contact is private (your own record; shared only with people in your truck).
 */
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, useUserLookup } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { Logo } from '@/components/haul/Logo'
import { ContactPicker, contactOk } from '@/components/haul/ContactPicker'
import { api, type Contact } from '@/lib/api'

const AVATARS = ['📦', '🚚', '🎒', '🪴', '🎸', '📚', '🐱', '🐶', '🌟', '🍜', '🏀', '🎨']
const field = 'h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40'

export default function WelcomePage() {
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const next = params.get('next') && params.get('next')!.startsWith('/') ? params.get('next')! : '/move'
  const [avatar, setAvatar] = useState('')
  const [school, setSchool] = useState('')
  const [year, setYear] = useState('')
  const [contact, setContact] = useState<Contact | null>(null)
  const [emailNotify, setEmailNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const first = (getName(userId ?? '') ?? '').split(' ')[0]

  async function save() {
    setBusy(true)
    const r = await api.saveProfile({ avatar, school, year, emailNotify, contact: contactOk(contact) ? contact : undefined })
    setBusy(false)
    if (!r.success) return toast.error('Not saved', r.error)
    navigate(next, { replace: true })
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-10 pt-8" data-testid="welcome">
      <Logo />
      <h1 className="mt-6 text-2xl font-extrabold text-foreground">Welcome{first ? `, ${first}` : ''}! Set up your profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">Once, and you're done. People see your name, school and avatar when you organize or join a truck.</p>

      <div className="mt-6 space-y-5">
        <div>
          <p className="text-sm font-medium text-foreground">Pick an avatar</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Avatar">
            {AVATARS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={avatar === a} onClick={() => setAvatar(avatar === a ? '' : a)}
                className={`grid size-11 place-items-center rounded-full border text-xl ${avatar === a ? 'border-primary bg-accent' : 'border-border bg-card'}`}>{a}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm"><span className="font-medium">School</span><input value={school} maxLength={60} onChange={(e) => setSchool(e.target.value)} placeholder="Carnegie Mellon" className={field} /></label>
          <label className="grid gap-1 text-sm"><span className="font-medium">Class of</span><input value={year} maxLength={20} onChange={(e) => setYear(e.target.value)} placeholder="2027" className={field} /></label>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">📞 How can your truck-mates reach you?</p>
          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Only people in the same truck ever see this. You won't be asked again when you join.</p>
          <ContactPicker value={contact} onChange={setContact} />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={emailNotify} onChange={(e) => setEmailNotify(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Email me about invites, trucks that fit my move, and my pool
        </label>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={save} loading={busy} disabled={!!contact?.handle && !contactOk(contact)} data-testid="welcome-save">Save and continue</Button>
        <button type="button" className="text-sm font-semibold text-muted-foreground hover:text-foreground"
          onClick={() => { try { sessionStorage.setItem('hp_skip_welcome', '1') } catch { /* ignore */ } navigate(next, { replace: true }) }}>
          Skip for now
        </button>
      </div>
    </div>
  )
}
