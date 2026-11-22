/** Bell with unread count; opens your latest notifications. Clicking one marks it read and opens it. */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import { timeAgo, type NotificationRec } from '@/lib/api'
import { Avatar } from './People'

export function NotificationBell() {
  const { userId } = useAuth()
  const navigate = useNavigate()
  const { records } = useQuery<NotificationRec>('notifications', { where: { userId: userId ?? '' }, orderBy: 'at', orderDir: 'desc', limit: 30 })
  const { put } = useMutations<NotificationRec>('notifications')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const unread = records.filter((n) => !n.data.read)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} onClick={() => setOpen(!open)} data-testid="bell"
        className="relative grid size-9 place-items-center rounded-full text-foreground hover:bg-secondary">
        <Bell className="size-5" />
        {unread.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{unread.length > 9 ? '9+' : unread.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="font-bold text-foreground">Notifications</p>
            {unread.length > 0 && (
              <button type="button" className="text-xs font-semibold text-primary" onClick={() => unread.forEach((n) => void put(n.recordId, { read: true }))}>Mark all read</button>
            )}
          </div>
          {records.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing yet. You'll hear here when someone invites you, joins your truck, or a truck that fits you shows up.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {records.map((n) => (
                <li key={n.recordId}>
                  <button type="button" className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-secondary ${n.data.read ? '' : 'bg-accent/40'}`}
                    onClick={() => { if (!n.data.read) void put(n.recordId, { read: true }); setOpen(false); if (n.data.link) navigate(n.data.link) }}>
                    {n.data.fromUserId ? <Avatar userId={n.data.fromUserId} size="sm" /> : <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-foreground">🚚</span>}
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.data.read ? 'font-medium' : 'font-bold'} text-foreground`}>{n.data.title}</span>
                      {n.data.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.data.body}</span>}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(n.data.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Unread conversation count (for the Messages tab badge). */
export function useUnreadChats(): number {
  const { userId } = useAuth()
  const { records } = useQuery<{ lastAt: number; lastSenderId?: string; reads?: Record<string, number> }>('conversations', { limit: 100 })
  return records.filter((c) => c.data.lastAt && c.data.lastSenderId !== userId && (c.data.reads?.[userId ?? ''] ?? 0) < c.data.lastAt).length
}
