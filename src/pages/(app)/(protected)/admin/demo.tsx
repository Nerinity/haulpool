/**
 * Owner-only: load or remove demo data, to see the app the way it looks with many people.
 * Runs the real actions as pretend students (see src/actions/demo.ts).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthProfileReady } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { api } from '@/lib/api'

const STEP_LABEL = [
  'Adding 8 students with profiles', 'Maya plans her move', 'Emma plans her move', 'Jordan plans his move', 'Priya plans her move',
  'Sam plans his move', 'Li plans his move', 'Ava plans her move', 'Noah plans his move', 'Li, Ava and Noah list themselves as looking',
  'Maya starts a 15\' truck, Emma joins', 'Jordan starts a 10\' truck', 'Priya starts a 20\' truck to New York, Sam joins',
  'Group chats start talking', 'Li messages you; Maya invites you',
]

export default function DemoPage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const toast = useToast()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState<'seed' | 'clear' | null>(null)
  const [done, setDone] = useState<{ date: string; fitsOwner: boolean } | null>(null)

  if (user?.role !== 'admin') return <p className="px-4 py-8 text-sm text-muted-foreground">This page is for the app owner.</p>

  async function seed() {
    setBusy('seed'); setLog([]); setDone(null)
    let step: number | null = 0
    while (step !== null) {
      setLog((l) => [...l, `${STEP_LABEL[step!] ?? `Step ${step}`}…`])
      const r = await api.seedDemo(step)
      if (!r.success) { toast.error('Stopped', r.error); setBusy(null); return }
      if (r.data.warning) setLog((l) => [...l, `  ⚠ ${r.data.warning}`])
      if (r.data.next === null) setDone({ date: r.data.date, fitsOwner: r.data.fitsOwner })
      step = r.data.next
    }
    setBusy(null)
    toast.success('Demo data loaded')
  }

  async function clear() {
    if (!window.confirm('Remove all demo people, trucks and chats? If you joined a demo truck, your hold comes back with no fee.')) return
    setBusy('clear')
    const r = await api.clearDemo()
    setBusy(null)
    if (r.success) { toast.success('Demo data removed', `${r.data.pools} trucks, ${r.data.people} people`); setLog([]); setDone(null) }
    else toast.error('Not removed', r.error)
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
      <h1 className="text-2xl font-extrabold text-foreground">Demo data</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Fill the app with 8 pretend students so you can see it busy. Everything goes through the real rules — wallets, matching, invites, chat —
        just run as them. They show a <span className="rounded-full bg-[var(--color-tape)]/40 px-1.5 text-[10px] font-bold text-[#4d3a00]">Demo</span> badge and never get emails.
      </p>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm text-foreground">
        <p className="font-bold">What you'll get</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li><b className="text-foreground">Maya's 15' truck</b> going where you're going on your move day (if you've planned your move), with Emma already in it — you'll get an invite.</li>
          <li><b className="text-foreground">Jordan's 10' truck</b> to a different storage unit, waiting for people.</li>
          <li><b className="text-foreground">Priya's 20' truck to New York</b>, with Sam in it.</li>
          <li><b className="text-foreground">Li, Ava and Noah</b> looking for trucks (Find → People looking). Li sends you a message.</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Tip: plan your own move first (around town, more than 5 days out) so Maya's truck fits you. Loading also lists you as looking, so Maya's invite can reach you; you can untick that in Find.</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={seed} loading={busy === 'seed'} disabled={!!busy} data-testid="seed-demo">Load demo data</Button>
        <Button variant="outline" onClick={clear} loading={busy === 'clear'} disabled={!!busy}>Remove demo data</Button>
      </div>
      {log.length > 0 && (
        <ol className="mt-4 space-y-1 rounded-2xl border border-border bg-card p-4 text-sm text-foreground" aria-live="polite">
          {log.map((l, i) => <li key={i}>{l}</li>)}
        </ol>
      )}
      {done && (
        <div className="mt-4 rounded-2xl border-2 border-primary bg-accent/50 p-4 text-sm text-foreground">
          <p className="font-bold">Done. Move day for the demo: {new Date(`${done.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <p className="mt-1">{done.fitsOwner ? 'Check the bell — Maya invited you to her truck.' : 'Plan a move on that day to see trucks that fit you.'} Then try:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to="/search?tab=people"><Button size="sm" variant="outline">People looking</Button></Link>
            <Link to="/search"><Button size="sm" variant="outline">Trucks</Button></Link>
            <Link to="/messages"><Button size="sm" variant="outline">Messages</Button></Link>
            <Link to="/home"><Button size="sm" variant="outline">My pool</Button></Link>
          </div>
        </div>
      )}
    </div>
  )
}
