/** How your pool reaches you. Only pool members see it. */
import { CONTACT_LABEL, type Contact, type ContactMethod } from '@/lib/api'

const METHODS: ContactMethod[] = ['text', 'whatsapp', 'wechat', 'call', 'email', 'instagram']
const PLACEHOLDER: Record<ContactMethod, string> = {
  text: '+1 412 555 0134', call: '+1 412 555 0134', whatsapp: '+1 412 555 0134', wechat: 'Your WeChat ID', email: 'you@school.edu', instagram: '@yourhandle',
}

export function contactOk(c: Contact | null): boolean {
  if (!c || !c.handle.trim()) return false
  if (c.method === 'email') return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.handle.trim())
  if (c.method === 'text' || c.method === 'call' || c.method === 'whatsapp') return /^[+\d][\d\s().-]{6,20}$/.test(c.handle.trim())
  return true
}

export function ContactPicker({ value, onChange }: { value: Contact | null; onChange: (c: Contact) => void }) {
  const method = value?.method ?? 'text'
  return (
    <div className="grid gap-2" data-testid="contact">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Contact method">
        {METHODS.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => onChange({ method: m, handle: value?.handle ?? '' })}
            className={`h-8 rounded-full border px-3 text-xs font-semibold ${method === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'}`}>
            {CONTACT_LABEL[m]}
          </button>
        ))}
      </div>
      <input value={value?.handle ?? ''} onChange={(e) => onChange({ method, handle: e.target.value })} placeholder={PLACEHOLDER[method]} maxLength={60}
        inputMode={method === 'email' ? 'email' : method === 'wechat' || method === 'instagram' ? 'text' : 'tel'}
        className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40" />
      {value?.handle && !contactOk(value) && <span className="text-xs text-destructive">That doesn't look like a valid {CONTACT_LABEL[method].toLowerCase()} {method === 'email' ? 'address' : 'number'}.</span>}
    </div>
  )
}
