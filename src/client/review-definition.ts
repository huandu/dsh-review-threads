import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseReviewAddress, REVIEW_ID, REVIEW_KIND } from '../protocol.js'

export function reviewDefinition(): SidebarRightTabDefinition {
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
          return `Review · turn ${String(parsed.turn)}`
        case 'work':
          return 'Review · working tree'
        case 'revision':
          return 'Review · revision range'
        case undefined:
          return 'Review'
      }
    },
  }
}
