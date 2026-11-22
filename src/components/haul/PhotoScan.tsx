/**
 * Photo scan: pick or take 1–3 photos → AI suggests items → the person ticks what's right.
 * Photos are shrunk in the browser (≤1280 px JPEG), sent once, and never stored.
 */
import { useRef, useState } from 'react'
import { Camera, Check, Loader2, X } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { ITEMS, ITEM_ICONS, type ItemKey } from '@/config'
import { api, type ScannedItem } from '@/lib/api'
import type { ItemLine } from '@/lib/volume'

const MAX = 3

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Could not read that photo'))
      i.src = url
    })
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.8)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function PhotoScan({ value, onApply }: { value: ItemLine[]; onApply: (v: ItemLine[]) => void }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<(ScannedItem & { on: boolean })[] | null>(null)
  const [note, setNote] = useState<string | undefined>()

  async function addFiles(files: FileList | null) {
    if (!files) return
    try {
      const next = [...photos]
      for (const f of Array.from(files).slice(0, MAX - photos.length)) next.push(await shrink(f))
      setPhotos(next)
      setFound(null)
    } catch (e) {
      toast.error('Photo problem', (e as Error).message)
    }
  }

  async function scan() {
    setBusy(true)
    const r = await api.scanPhotos(photos)
    setBusy(false)
    if (!r.success) return toast.error('Scan did not work', r.error)
    if (r.data.items.length === 0) return toast.error('Nothing found', 'Try a wider photo of the room, in good light.')
    setFound(r.data.items.map((x) => ({ ...x, on: x.confidence !== 'low' })))
    setNote(r.data.note)
  }

  function apply() {
    if (!found) return
    // Take the larger of what you already listed and what the scan saw, so nothing is counted twice.
    const next = [...value]
    for (const f of found.filter((x) => x.on)) {
      const i = next.findIndex((l) => l.kind === 'preset' && l.key === f.key)
      if (i >= 0) next[i] = { ...next[i], qty: Math.max(next[i].qty, f.qty) }
      else next.push({ kind: 'preset', key: f.key as ItemKey, qty: f.qty })
    }
    onApply(next)
    setFound(null)
    setPhotos([])
    toast.success('Added to your list', 'Check the counts below — add boxes for things in closets and drawers.')
  }

  return (
    <div className="rounded-2xl border border-dashed border-primary/50 bg-accent/30 p-4" data-testid="photo-scan">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Camera className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Scan your room</p>
          <p className="text-xs text-muted-foreground">Snap 1–3 photos. AI suggests what's there; you check it. Photos aren't saved.</p>
        </div>
      </div>

      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden
        onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />

      {photos.length > 0 && (
        <div className="mt-3 flex gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative size-20 overflow-hidden rounded-xl border border-border">
              <img src={p} alt={`Room photo ${i + 1}`} className="size-full object-cover" />
              {busy && <div className="absolute inset-0 animate-pulse bg-primary/20" />}
              {!busy && (
                <button type="button" aria-label="Remove photo" onClick={() => { setPhotos(photos.filter((_, k) => k !== i)); setFound(null) }}
                  className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-foreground/70 text-background"><X className="size-3" /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {!found && (
        <div className="mt-3 flex flex-wrap gap-2">
          {photos.length < MAX && (
            <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
              <Camera className="mr-1.5 size-4" />{photos.length === 0 ? 'Take or choose photos' : 'Add another'}
            </Button>
          )}
          {photos.length > 0 && (
            <Button size="sm" onClick={scan} disabled={busy} data-testid="scan-run">
              {busy ? <><Loader2 className="mr-1.5 size-4 animate-spin" />Looking at your stuff…</> : 'Scan'}
            </Button>
          )}
        </div>
      )}

      {found && (
        <div className="mt-4">
          {note && <p className="mb-2 text-xs text-muted-foreground">“{note}”</p>}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {found.map((f, i) => (
              <li key={f.key}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" checked={f.on} onChange={() => setFound(found.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))} className="size-4 accent-[var(--color-primary)]" />
                  <span aria-hidden>{ITEM_ICONS[f.key as ItemKey]}</span>
                  <span className="flex-1 text-foreground">{f.qty}× {ITEMS[f.key as ItemKey]?.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${f.confidence === 'high' ? 'bg-success/15 text-success' : f.confidence === 'low' ? 'bg-muted text-muted-foreground' : 'bg-warning/15 text-warning'}`}>
                    {f.confidence === 'high' ? 'clear' : f.confidence === 'low' ? 'guess' : 'likely'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={apply} disabled={!found.some((x) => x.on)} data-testid="scan-apply"><Check className="mr-1.5 size-4" />Add checked items</Button>
            <Button size="sm" variant="ghost" onClick={() => setFound(null)}>Back</Button>
          </div>
        </div>
      )}
    </div>
  )
}
