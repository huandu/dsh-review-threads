import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ReviewTab } from './ReviewTab.js'
import { reviewAddressFromCommand } from './command-open.js'
import { reviewDefinition } from './review-definition.js'
import { revisionReviewAddress, workReviewAddress } from '../protocol.js'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  ctx.on('command/executed', (_sessionId, name, result) => {
    const address = reviewAddressFromCommand(name, result)
    if (address === undefined) return
    ctx.sidebarRight.openResource(
      address.kind === 'work'
        ? workReviewAddress(address.scopeKey)
        : revisionReviewAddress(address.scopeKey),
    )
  })
  const definition = reviewDefinition()
  ctx.effect(
    () => ctx.sidebarRightTabs.register(definition),
    'dsh-review-threads: review tab type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: definition.id,
          },
          ReviewTab,
        ),
      ),
    'dsh-review-threads: review tab body',
  )
}
