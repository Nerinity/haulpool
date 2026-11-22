/**
 * Wallet — prepaid balance that pays for pools. TEST MODE: top-ups don't charge a card.
 * Every movement is a row in walletTx (only you can read yours); balance = their sum.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Lock, Plus } from 'lucide-react'
import { useAuth, useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { CONFIG } from '@/config'
import { api, dollars, type WalletTxRec } from '@/lib/api'

const LABEL: Record<WalletTxRec['kind'], string> = {
  topup: 'Added money', hold: 'Held for a pool', adjust: 'Pool price changed', release: 'Hold returned',
  cancel_fee: 'Cancellation fee', credit: 'Credit', payout: 'Truck payout', fee_revenue: 'HaulPool fee',
}

export default function WalletPage() {
  const { userId } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const need = Number(params.get('need') ?? 0)
  const back = params.get('back')
  const { records, status } = useQuery<WalletTxRec>('walletTx', { where: { userId: userId ?? '' }, orderBy: 'at', orderDir: 'desc', limit: 500 })
  const [busy, setBusy] = useState<number | null>(null)
  const [custom, setCustom] = useState('')

  const txs = useMemo(() => records.map((r) => ({ id: r.recordId, ...r.data })), [records])
  const balance = txs.reduce((a, t) => a + t.amountCents, 0)
  const heldByPool = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of txs) if (t.poolId && (t.kind === 'hold' || t.kind === 'adjust' || t.kind === 'release')) m.set(t.poolId, (m.get(t.poolId) ?? 0) - t.amountCents)
    return [...m.entries()].filter(([, v]) => v > 0)
  }, [txs])
  const suggested = need > balance ? Math.max(CONFIG.fees.topUpMinCents, Math.ceil((need - balance) / 500) * 500) : 0

  async function add(cents: number) {
    setBusy(cents)
    const r = await api.topUp(cents)
    setBusy(null)
    if (!r.success) return toast.error('Not added', r.error)
    toast.success(`Added ${dollars(cents)}`, 'Test mode: no card was charged.')
    if (back && r.data.balanceCents >= need) navigate(back)
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
      <section className="rounded-2xl bg-primary p-5 text-primary-foreground">
        <p className="text-sm font-semibold opacity-85">HaulPool wallet</p>
        <p className="mt-1 text-4xl font-black" data-testid="wallet-balance">{status === 'loading' ? '…' : dollars(balance)}</p>
        {heldByPool.length > 0 && <p className="mt-1 text-sm opacity-90"><Lock className="mr-1 inline size-3.5" />{dollars(heldByPool.reduce((a, [, v]) => a + v, 0))} paid into your pool, settled after move day</p>}
        <p className="mt-3 inline-block rounded-full bg-[var(--color-tape)] px-2.5 py-0.5 text-xs font-bold text-[#3b2c00]">Test mode: adding money doesn't charge a card</p>
      </section>

      {need > balance && (
        <p className="mt-4 rounded-xl border border-primary/40 bg-accent/60 p-3 text-sm text-foreground">
          You need {dollars(need)} for that pool; add at least {dollars(need - balance)}.
        </p>
      )}

      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="font-bold text-foreground">Add money</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {[...new Set([suggested, 2000, 5000, 10000, 50000].filter((c) => c >= CONFIG.fees.topUpMinCents))].map((c) => (
            <Button key={c} variant={c === suggested ? 'default' : 'outline'} onClick={() => add(c)} loading={busy === c} disabled={busy !== null}>
              <Plus className="mr-1 size-4" />{dollars(c)}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input inputMode="decimal" placeholder="Other amount" value={custom} onChange={(e) => setCustom(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm text-foreground" />
          <Button variant="outline" disabled={!custom || busy !== null} onClick={() => add(Math.round(Number(custom) * 100))}>Add</Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          How it works: joining needs enough balance for your share; nothing is taken until the pool locks. At lock, your share + {CONFIG.fees.servicePct}% service fee is held.
          Leaving after lock returns it minus a {dollars(CONFIG.fees.cancelCents)} fee, which goes to the people left. After the move, the organizer gets the shares for the truck.
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="font-bold text-foreground">History</h2>
        {txs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No activity yet. Add money to join or start a pool.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border" data-testid="wallet-history">
            {txs.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className={`grid size-8 shrink-0 place-items-center rounded-full ${t.amountCents > 0 ? 'bg-primary/10 text-primary' : 'bg-secondary text-foreground'}`}>
                  {t.amountCents > 0 ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{LABEL[t.kind]}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.note ?? ''}{t.note ? ' · ' : ''}{new Date(t.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                </div>
                <span className={`font-bold tabular-nums ${t.amountCents > 0 ? 'text-primary' : 'text-foreground'}`}>{t.amountCents > 0 ? '+' : '−'}{dollars(Math.abs(t.amountCents))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
