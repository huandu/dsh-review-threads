import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import { reviewThreadsDomain } from './domain.js'
import { registerReviewCommands } from './commands.js'
import { GitRunner } from './git.js'
import { registerReviewRoutes } from './routes.js'
import { RealtimeHub } from './realtime.js'
import { ReviewThreadService } from './service.js'
import { registerReviewSkill } from './skills.js'
import { registerReviewTools } from './tools.js'

export const name = 'dsh-review-threads'

export const inject = [
  'agents',
  'commands',
  'connection',
  'sessions',
  'skills',
  'storageDomain',
  'subprocess',
  'tools',
  'workspaceChanges',
]

export async function apply(ctx: Context): Promise<void> {
  const lifetime = new AbortController()
  const domain = await ctx.storageDomain.open(reviewThreadsDomain)
  const git = new GitRunner(ctx, lifetime.signal)
  const service = new ReviewThreadService(ctx, domain, git)
  const realtime = new RealtimeHub()
  ctx.provide('reviewThreads', service)
  registerReviewTools(ctx, service)
  registerReviewCommands(ctx, service)
  await registerReviewSkill(ctx)
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'workspace/changes') return
    void Promise.all([
      service.markCodeChanged(session.id),
      service.refreshSessionWorking(session.id, lifetime.signal),
    ]).catch((error: unknown) => {
      ctx.logger.warn('dsh-review-threads: working snapshot refresh failed')
      ctx.logger.warn(error)
    })
  })
  ctx.on('domain/changed', (event) => {
    if (event.domain === 'review_threads') realtime.notify()
  })
  ctx.effect(
    () => async () => {
      lifetime.abort()
      await domain.close()
    },
    'dsh-review-threads: storage',
  )
  registerReviewRoutes(ctx, realtime)
}
