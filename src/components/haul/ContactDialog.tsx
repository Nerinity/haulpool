/**
 * Join / start without a contact on file: ask for it right here, save it to your profile,
 * then carry on — instead of sending people back to the last step of My move.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal, useToast } from '@/components/ui'
import { ContactPicker, contactOk } from './ContactPicker'
import { api, walletUrlFor, type Contact } from '@/lib/api'

type Result = { success: boolean; error?: string; code?: string }

/**
 * Wrap an action that may need a contact: `run(() => api.joinPool(id), 'You are in!', backUrl)`.
 * no_contact → this dialog, then retry; low_balance → wallet, then back.
 */
export function useNeedsContact() {
  const toast = useToast()
  const navigate = useNavigate()
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null)

  async function run(fn: () => Promise<Result>, ok: string, back: string): Promise<boolean> {
    const r = await fn()
    if (r.success) { toast.success(ok); return true }
    if (r.code === 'no_contact') {
      setPending(() => async () => { await run(fn, ok, back) })
      return false
    }
    const wallet = walletUrlFor(r, back)
    if (wallet) { toast.error('Top up your wallet', r.error); navigate(wallet); return false }
    toast.error('Not done', r.error)
    return false
  }

  const dialog = pending ? <ContactDialog onClose={() => setPending(null)} onSaved={async () => { const next = pending; setPending(null); await next() }} /> : null
  return { run, dialog }
}

function ContactDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [contact, setContact] = useState<Contact | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} size="sm" aria-label="How can your pool reach you?">
      <div className="space-y-3 p-1" data-testid="contact-dialog">
        <h2 className="text-lg font-bold text-foreground">How can your pool reach you?</h2>
        <p className="text-sm text-muted-foreground">People in your truck need a way to reach you on move day. Only they can see it. We'll save it to your profile so you only do this once.</p>
        <ContactPicker value={contact} onChange={setContact} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!contactOk(contact)} onClick={async () => {
            setBusy(true)
            const r = await api.saveProfile({ contact: contact! })
            setBusy(false)
            if (!r.success) return toast.error('Not saved', r.error)
            await onSaved()
          }}>Save and continue</Button>
        </div>
      </div>
    </Modal>
  )
}
