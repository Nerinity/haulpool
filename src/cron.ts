/**
 * Scheduled tasks (registered into AppCronRoom in worker.ts).
 *
 * pool-deadlines: every 15 minutes, pools past their deadline lock themselves when 2+ people
 * are in (holds are taken from wallets), or close with no fee when the organizer is alone.
 * Runs as the app owner through the same tools the server actions use; the version lock
 * makes it safe to run alongside people joining or locking by hand.
 */
import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { createActionTools } from './server/action-routes'
import { sweepDeadlines } from './actions'

export const tasks: CronTask[] = [{ name: 'pool-deadlines', intervalMinutes: 15 }]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== 'pool-deadlines') return
  const tools = createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT)
  const r = await sweepDeadlines(tools)
  if (r.locked || r.closed) console.info(`[cron] pool-deadlines locked=${r.locked} closed=${r.closed}`)
}
