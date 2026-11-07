/** Register the 影响网 right-sidebar tab (关系网 / 雷达维). */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { influenceNetDefinition, PLUGIN_ID } from './definition.ts'
import { InfluenceLabBody } from './InfluenceLabBody.tsx'

export { InfluenceLabBody } from './InfluenceLabBody.tsx'
export {
  GUIDE_TITLE,
  PLUGIN_ID,
  TAB_KIND,
  VIEW_RADAR,
  VIEW_RELATION,
} from './labels.ts'

/** Required right-sidebar services. */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight'] as const

/** Register tab type + pane body. */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.sidebarRightTabs.register(influenceNetDefinition()),
    'influence-net.type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: PLUGIN_ID },
          InfluenceLabBody,
        ),
      ),
    'influence-net.body',
  )
}
