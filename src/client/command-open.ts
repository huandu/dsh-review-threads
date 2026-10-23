import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  parseReviewAddress,
  REVIEW_OPEN_MARKER,
  type RevisionReviewAddress,
  type WorkReviewAddress,
} from '../protocol.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'command/executed'(
      sessionId: SessionId,
      name: string,
      result: CommandResult,
    ): void
  }
}

export function reviewAddressFromCommand(
  name: string,
  result: CommandResult,
): WorkReviewAddress | RevisionReviewAddress | undefined {
  if (
    name !== 'review' ||
    result.kind !== 'success' ||
    result.text === undefined ||
    !result.text.startsWith(REVIEW_OPEN_MARKER)
  ) {
    return undefined
  }
  const address = parseReviewAddress(
    result.text.slice(REVIEW_OPEN_MARKER.length),
  )
  return address?.kind === 'work' || address?.kind === 'revision'
    ? address
    : undefined
}
