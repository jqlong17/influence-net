/** Static 影响网 tab type + guide declaration. */

import {
  GUIDE_DESCRIPTION,
  GUIDE_TITLE,
  PLUGIN_ID,
  TAB_KIND,
} from './labels.ts'

export { PLUGIN_ID, TAB_KIND }

/** Minimal shape matching SidebarRightTabDefinition fields we use. */
export interface InfluenceNetTabDefinition {
  id: string
  kind: string
  priority: 'extension' | 'builtin' | 'fallback'
  title: (address: string) => string
  guide: Array<{
    order: number
    title: () => string
    description: () => string
  }>
}

/** Build the extension tab definition (investor-facing copy). */
export function influenceNetDefinition(): InfluenceNetTabDefinition {
  return {
    id: PLUGIN_ID,
    kind: TAB_KIND,
    priority: 'extension',
    title: () => GUIDE_TITLE,
    guide: [
      {
        order: 45,
        title: () => GUIDE_TITLE,
        description: () => GUIDE_DESCRIPTION,
      },
    ],
  }
}
