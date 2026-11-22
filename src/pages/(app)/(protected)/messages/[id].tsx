/** One conversation, live. Messages are sent through the server, which checks you're a member. */
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Send } from 'lucide-react'
import { useAuth, useQuery, useUserLookup } from 'deepspace'
import { useToast } from '@/components/ui'
import { Avatar } from '@/components/haul/People'
import { api, type ConversationRec, type MessageRec } from '@/lib/api'

export default function ThreadPage() {
  const { id = '' } = useParams()
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const toast = useToast()
  const conv = useQuery<ConversationRec>('conversations', { limit: 100 }).records.find((c) => c.recordId === id)?.data
  const { records, status } = useQuery<MessageRec>('messages', { where: { conversationId: id }, orderBy: 'at', orderDir: 'asc', limit: 300 })
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const other = conv?.kind === 'dm' ? conv.memberIds.find((m) => m !== userId) ?? '' : ''

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [records.length])
  useEffect(() => { if (id && records.length) void api.markRead(id) }, [id, records.length])

  async function send() {
    const t = text.trim()
    if (!t) return
    setSending(true)
    const r = await api.sendMessage(id, t)
    setSending(false)
    if (!r.success) return toast.error('Not sent', r.error)
    setText('')
  }

  if (status !== 'loading' && !conv) {
    return <p className="mx-auto max-w-xl px-4 py-10 text-sm text-muted-foreground">This conversation isn't available. You may not be in it anymore.</p>
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Link to="/messages" aria-label="Back to messages" className="text-muted-foreground"><ArrowLeft className="size-5" /></Link>
        {conv?.kind === 'dm' ? (
          <Link to={`/u/${other}`} className="flex min-w-0 items-center gap-2">
            <Avatar userId={other} size="sm" />
            <span className="truncate font-bold text-foreground">{getName(other) ?? 'Member'}</span>
          </Link>
        ) : (
          <Link to={`/pools/${conv?.poolId}`} className="min-w-0">
            <p className="truncate font-bold text-foreground">Pool chat</p>
            <p className="truncate text-xs text-muted-foreground">{conv?.title} · {conv?.memberIds.length} people</p>
          </Link>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4" data-testid="thread">
        {records.length === 0 && status !== 'loading' && (
          <p className="py-10 text-center text-sm text-muted-foreground">{conv?.kind === 'pool' ? 'Say hi and agree on a pickup time.' : 'Ask about space, timing, or the route.'}</p>
        )}
        {records.map((m, i) => {
          const mine = m.data.senderId === userId
          const showName = conv?.kind === 'pool' && !mine && records[i - 1]?.data.senderId !== m.data.senderId
          return (
            <div key={m.recordId} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                {showName && <Link to={`/u/${m.data.senderId}`} className="mb-0.5 text-xs font-semibold text-muted-foreground">{getName(m.data.senderId) ?? 'Member'}</Link>}
                <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-card text-foreground ring-1 ring-border'}`}>{m.data.text}</p>
                <span className="mt-0.5 text-[10px] text-muted-foreground">{new Date(m.data.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>

      <form className="flex items-end gap-2 border-t border-border bg-card px-3 py-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={1000} placeholder="Message"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40" />
        <button type="submit" disabled={sending || !text.trim()} aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><Send className="size-4" /></button>
      </form>
    </div>
  )
}
