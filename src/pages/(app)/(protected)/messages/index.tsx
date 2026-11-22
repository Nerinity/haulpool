/** Your conversations: 1-to-1 chats and your pools' group chats. Only ones you're in are ever sent to you. */
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useAuth, useQuery, useUserLookup } from 'deepspace'
import { EmptyState } from '@/components/ui'
import { Avatar } from '@/components/haul/People'
import { isUnread, timeAgo, type ConversationRec } from '@/lib/api'

export default function MessagesPage() {
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const { records, status } = useQuery<ConversationRec>('conversations', { orderBy: 'lastAt', orderDir: 'desc', limit: 100 })
  const convs = records.filter((c) => c.data.kind === 'pool' || c.data.lastAt > 0)

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
      <h1 className="text-2xl font-extrabold text-foreground">Messages</h1>
      {status === 'loading' ? (
        <div className="mt-4 h-40 animate-pulse rounded-2xl bg-card" />
      ) : convs.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No messages yet" description="Message a truck organizer or someone looking for a truck from Find, or chat with your pool once you join one." />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" data-testid="conversations">
          {convs.map((c) => {
            const other = c.data.kind === 'dm' ? c.data.memberIds.find((m) => m !== userId) ?? '' : ''
            const unread = isUnread(c.data, userId ?? '')
            return (
              <li key={c.recordId}>
                <Link to={`/messages/${c.recordId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary">
                  {c.data.kind === 'pool'
                    ? <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Users className="size-5" /></span>
                    : <Avatar userId={other} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`truncate ${unread ? 'font-extrabold' : 'font-semibold'} text-foreground`}>
                        {c.data.kind === 'pool' ? `Pool chat · ${c.data.title ?? ''}` : getName(other) ?? 'Member'}
                      </p>
                      {c.data.lastAt > 0 && <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(c.data.lastAt)}</span>}
                    </div>
                    <p className={`truncate text-sm ${unread ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {c.data.lastText ? `${c.data.lastSenderId === userId ? 'You: ' : ''}${c.data.lastText}` : 'Say hi to your pool'}
                    </p>
                  </div>
                  {unread && <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-label="unread" />}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
