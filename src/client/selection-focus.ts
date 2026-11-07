/**
 * Selection neighborhood + edge display name.
 * SYNC: keep with influence-net/app/static/app.js selectionFocus / edgeDisplayName.
 */

export const DIM_OPACITY = 0.2

export type EdgeLike = {
  id?: string
  name?: string
  label?: string
  rel?: string
  source?: string
  target?: string
  props?: Record<string, unknown>
}

export type NodeLike = { id: string }

export function edgeDisplayName(e: EdgeLike): string {
  const props = e.props || {}
  const candidates: unknown[] = [
    e.name,
    e.label,
    props.channel,
    props.narrative_refined,
    props.narrative,
    e.rel,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return ''
}

export function truncateEdgeLabel(s: string, max = 22): string {
  if (!s) return ''
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

export interface SelectionFocus {
  active: boolean
  nodeIds: Set<string>
  edgeIds: Set<string>
}

/** 1-hop neighborhood for a selected node, or endpoints for a selected edge. */
export function selectionFocus(
  selectedId: string | null | undefined,
  nodes: NodeLike[],
  edges: EdgeLike[],
): SelectionFocus {
  if (!selectedId) {
    return { active: false, nodeIds: new Set(), edgeIds: new Set() }
  }
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const edgeMatch = edges.find((e, i) => String(e.id || `e${i}`) === selectedId)
  if (edgeMatch) {
    const eid = String(edgeMatch.id || selectedId)
    const ns = new Set<string>()
    if (edgeMatch.source) ns.add(edgeMatch.source)
    if (edgeMatch.target) ns.add(edgeMatch.target)
    return { active: true, nodeIds: ns, edgeIds: new Set([eid]) }
  }
  if (!nodeIdSet.has(selectedId)) {
    return { active: false, nodeIds: new Set(), edgeIds: new Set() }
  }
  const ns = new Set<string>([selectedId])
  const es = new Set<string>()
  edges.forEach((e, i) => {
    const eid = String(e.id || `e${i}`)
    if (e.source === selectedId || e.target === selectedId) {
      es.add(eid)
      if (e.source) ns.add(e.source)
      if (e.target) ns.add(e.target)
    }
  })
  return { active: true, nodeIds: ns, edgeIds: es }
}
