import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import { reviewThreadsDomain } from './domain.js'
import { GitRunner } from './git.js'
import { registerReviewRoutes } from './routes.js'
import { ReviewThreadService } from './service.js'

export const name = 'dsh-review-threads'

export const inject = [
  'connection',
  'sessions',
  'storageDomain',
  'subprocess',
  'workspaceChanges',
]

export async function apply(ctx: Context): Promise<void> {
  const lifetime = new AbortController()
  const domain = await ctx.storageDomain.open(reviewThreadsDomain)
  const git = new GitRunner(ctx, lifetime.signal)
  const service = new ReviewThreadService(ctx, domain, git)
  ctx.provide('reviewThreads', service)
  ctx.effect(
    () => async () => {
      lifetime.abort()
      await domain.close()
    },
    'dsh-review-threads: storage',
  )
  registerReviewRoutes(ctx)
}
