import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import {
  revisionReviewAddress,
  REVIEW_OPEN_MARKER,
  workReviewAddress,
  type RevisionReviewAddress,
  type WorkReviewAddress,
} from './protocol.js'
import { parseReviewCommand } from './review-command.js'
import type { ReviewThreadService } from './service.js'

export function reviewOpenText(
  address: WorkReviewAddress | RevisionReviewAddress,
): string {
  return `${REVIEW_OPEN_MARKER}${address.kind === 'work' ? workReviewAddress(address.scopeKey) : revisionReviewAddress(address.scopeKey)}`
}

export function registerReviewCommands(
  ctx: Context,
  service: ReviewThreadService,
): void {
  ctx.commands.register({
    name: 'review',
    description:
      'Open the working-tree diff or a committed revision range in Review',
    input: {
      hint: '[<base>..<head> [-- <paths...>]]',
    },
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const command = parseReviewCommand(rawInput)
        if (command.kind === 'working') {
          const scope = await service.prepareWorking(agent.session.id, signal)
          return {
            kind: 'success',
            text: reviewOpenText({ kind: 'work', scopeKey: scope.scopeKey }),
          }
        }
        const scope = await service.prepareRevision(
          agent.session.id,
          command.range,
          command.pathFilters,
          signal,
        )
        return {
          kind: 'success',
          text: reviewOpenText({
            kind: 'revision',
            scopeKey: scope.scopeKey,
          }),
        }
      } catch (error) {
        return {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })
}
