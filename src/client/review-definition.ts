import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseReviewAddress, REVIEW_ID, REVIEW_KIND } from '../protocol.js'
import type { ReviewThreadsKey } from './locales.js'

export function reviewDefinition(
  t: (key: ReviewThreadsKey, params?: Record<string, unknown>) => string,
): SidebarRightTabDefinition {
  return {
    id: REVIEW_ID,
    kind: REVIEW_KIND,
    patterns: ['dsh-resource://changes-review/**'],
    priority: 'extension',
    canOpen: (address) => parseReviewAddress(address) !== undefined,
    title: (address) => {
      const parsed = parseReviewAddress(address)
      switch (parsed?.kind) {
        case 'turn':
          return t('title.turn', { turn: String(parsed.turn) })
        case 'work':
          return t('title.work')
        case 'revision':
          return t('title.revision')
        case undefined:
          return t('title.review')
      }
    },
  }
}
