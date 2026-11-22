/**
 * Test helper: an in-memory stand-in for the DeepSpace record store that enforces each
 * collection's uniqueOn, records sent emails, and serves seeded users. Not used by the app.
 */
import type { ActionTools } from 'deepspace/worker'
import { haulpoolSchemas } from '../schemas/haulpool-schemas'

type Rec = { recordId: string; data: Record<string, unknown> }

export function fakeTools(): ActionTools & { all: (c: string) => Rec[]; emails: { to: string; subject: string }[] } {
  const db = new Map<string, Rec[]>()
  const unique = new Map(haulpoolSchemas.map((s) => [s.name, s.uniqueOn ?? []]))
  const rows = (c: string) => db.get(c) ?? (db.set(c, []), db.get(c)!)
  const matches = (d: Record<string, unknown>, where: Record<string, unknown> = {}) => Object.entries(where).every(([k, v]) => d[k] === v)
  const tools = {
    all: rows,
    async create(c: string, data: Record<string, unknown>, recordId?: string) {
      const u = unique.get(c) ?? []
      if (u.length && u.every((k) => data[k] !== null && data[k] !== undefined) && rows(c).some((r) => u.every((k) => r.data[k] === data[k]))) {
        return { success: false, error: `Duplicate: ${u.join(',')}` }
      }
      const id = recordId ?? crypto.randomUUID()
      rows(c).push({ recordId: id, data: structuredClone(data) })
      return { success: true, data: { recordId: id } }
    },
    async update(c: string, id: string, patch: Record<string, unknown>) {
      const r = rows(c).find((x) => x.recordId === id)
      if (!r) return { success: false, error: 'not found' }
      const next = { ...r.data, ...structuredClone(patch) }
      const u = unique.get(c) ?? []
      if (u.length && u.every((k) => next[k] !== null && next[k] !== undefined) && rows(c).some((x) => x !== r && u.every((k) => x.data[k] === next[k]))) {
        return { success: false, error: 'Duplicate' }
      }
      r.data = next
      return { success: true, data: {} }
    },
    async remove(c: string, id: string) {
      db.set(c, rows(c).filter((r) => r.recordId !== id))
      return { success: true, data: {} }
    },
    async deleteWhere(c: string, where: Record<string, unknown>) {
      const before = rows(c).length
      db.set(c, rows(c).filter((r) => !matches(r.data, where)))
      return { success: true, data: { deleted: before - rows(c).length } }
    },
    async registerUser(o: { userId: string; name?: string; email?: string }) {
      const existing = rows('users').find((r) => r.recordId === o.userId)
      if (existing) existing.data = { ...existing.data, name: o.name, email: o.email }
      else rows('users').push({ recordId: o.userId, data: { name: o.name, email: o.email } })
      return { success: true, data: {} }
    },
    async get(c: string, id: string) {
      const r = rows(c).find((x) => x.recordId === id)
      return r ? { success: true, data: { record: r } } : { success: false, error: 'not found' }
    },
    async query(c: string, q: { where?: Record<string, unknown>; orderBy?: string; orderDir?: 'asc' | 'desc'; limit?: number } = {}) {
      let out = rows(c).filter((r) => matches(r.data, q.where))
      if (q.orderBy) out = [...out].sort((a, b) => ((a.data[q.orderBy!] as number) - (b.data[q.orderBy!] as number)) * (q.orderDir === 'desc' ? -1 : 1))
      return { success: true, data: { records: out.slice(0, q.limit ?? 50) } }
    },
    emails: [] as { to: string; subject: string }[],
    async integration(endpoint: string, data: { to: string; subject: string }) {
      if (endpoint === 'email/send') { tools.emails.push({ to: data.to, subject: data.subject }); return { success: true, data: {} } }
      return { success: false, error: 'offline' }
    },
  }
  return tools as unknown as ActionTools & { all: (c: string) => Rec[]; emails: { to: string; subject: string }[] }
}

