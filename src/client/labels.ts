/** Investor-facing copy for the 影响网 right-sidebar panel. */

/** Right-sidebar tab kind opened via `openTab('influence-net')`. */
export const TAB_KIND = 'influence-net'

/** Implementation id / keyed slot dispatch key. */
export const PLUGIN_ID = 'influence-net'

/** Guide capsule + chip title. */
export const GUIDE_TITLE = '影响网'

/** Instance-grain view label (never 「实例」in UI). */
export const VIEW_RELATION = '关系网'

/** Dimension-grain view label (never 「对象类型」in UI). */
export const VIEW_RADAR = '雷达维'

/** Guide description under the capsule. */
export const GUIDE_DESCRIPTION =
  '看这只票的关系网，或按雷达维看结构；调研可经对话写入本地影响网'

/** Words that must not appear in user-facing panel copy. */
export const USER_FACING_FORBIDDEN = ['实例', '对象类型'] as const
