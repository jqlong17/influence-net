/** Segmented control state for 关系网 / 雷达维. */

export type ViewMode = 'relation' | 'radar'

/** Lab HTTP `view=` query values (API grain; not shown in UI). */
export type LabGraphView = 'instance' | 'abstract'

export function nextViewMode(current: ViewMode): ViewMode {
  return current === 'relation' ? 'radar' : 'relation'
}

export function viewToLabQuery(mode: ViewMode): LabGraphView {
  return mode === 'radar' ? 'abstract' : 'instance'
}
