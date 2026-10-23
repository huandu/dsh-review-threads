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
      const turn = parseReviewAddress(address)?.turn
      return turn === undefined ? 'Review' : `Review · turn ${String(turn)}`
    },
  }
}
