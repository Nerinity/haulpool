/** Small shared bits for people: avatar, name link to their profile, and a "Message" button. */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useQuery, useUserLookup } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { api, isDemoUser, type ProfileRec } from '@/lib/api'

export function useProfile(userId?: string) {
  const { records } = useQuery<ProfileRec>('profiles', { where: { userId: userId ?? '__none__' }, limit: 1 })
  return records[0]?.data
}

export function Avatar({ userId, size = 'md' }: { userId: string; size?: 'sm' | 'md' | 'lg' }) {
  const { getName } = useUserLookup()
  const profile = useProfile(userId)
  const name = getName(userId) ?? '?'
  const cls = size === 'lg' ? 'size-20 text-4xl' : size === 'sm' ? 'size-7 text-sm' : 'size-10 text-lg'
  // Stable pastel from the id so people are easy to tell apart without photos
  const hue = [...userId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-bold ${cls}`} style={{ background: `hsl(${hue} 55% 88%)`, color: `hsl(${hue} 45% 25%)` }} aria-hidden>
      {profile?.avatar || name[0]?.toUpperCase()}
    </span>
  )
}

export function UserLink({ userId, suffix, size = 'sm' }: { userId: string; suffix?: string; size?: 'sm' | 'md' }) {
  const { getName } = useUserLookup()
  return (
    <Link to={`/u/${userId}`} className="inline-flex min-w-0 items-center gap-2 font-semibold text-foreground hover:underline">
      <Avatar userId={userId} size={size} />
      <span className="truncate">{getName(userId) ?? 'Member'}{suffix ? <span className="font-normal text-muted-foreground"> {suffix}</span> : null}</span>
      {isDemoUser(userId) && <DemoBadge />}
    </Link>
  )
}

export function MessageButton({ userId, label = 'Message', size = 'sm', variant = 'outline' }: { userId: string; label?: string; size?: 'sm' | 'default'; variant?: 'outline' | 'default' }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <Button size={size} variant={variant} loading={busy} onClick={async () => {
      setBusy(true)
      const r = await api.openDm(userId)
      setBusy(false)
      if (!r.success) return toast.error('Could not open chat', r.error)
      navigate(`/messages/${r.data.conversationId}`)
    }}>
      <MessageCircle className="mr-1.5 size-4" />{label}
    </Button>
  )
}

export function DemoBadge() {
  return <span className="shrink-0 rounded-full bg-[var(--color-tape)]/40 px-1.5 py-0.5 text-[10px] font-bold text-[#4d3a00]" title="Pretend person, added as demo data">Demo</span>
}
