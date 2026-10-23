import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ReviewTab } from './ReviewTab.js'
import { reviewDefinition } from './review-definition.js'

export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx: Context): void {
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
