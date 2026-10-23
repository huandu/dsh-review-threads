import type { Context } from '@deepseek-ai/cordis'
import { registerReviewRoutes } from './routes.js'

export const name = 'dsh-review-threads'

export const inject = ['connection', 'workspaceChanges']

export function apply(ctx: Context): void {
  registerReviewRoutes(ctx)
}
