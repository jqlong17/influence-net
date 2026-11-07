/** Multi-ring radial layout for 影响网 graphs (ported from Lab app.js).
 * SYNC: must match influence-net/app/static/app.js layoutRadial
 *   (pad / phase / horizon ring fractions R_near < R_mid < R_far).
 * When changing Lab canvas layout, update this file in the same change.
 *
 * Ring assignment by horizon (近中远): near → inner, mid → middle, long → outer.
 * Node props.horizons first (primaryHorizon = earliest); if missing, prefer
 * connected edge horizons. Multi-horizon uses nearest — same as color priority.
 */

import { primaryHorizon, type HorizonKey } from './horizon-color.ts'

export interface RadialNode {
  id: string
  props?: Record<string, unknown> | null
}

export interface RadialEdge {
  source?: string
  target?: string
  props?: Record<string, unknown> | null
}

export interface Point {
  x: number
  y: number
}

/** Fraction of Rmax — near closest to center, long on the outer rim. */
export const RING_FRAC: Record<HorizonKey, number> = {
  near: 0.38,
  mid: 0.68,
  long: 1.0,
}

/** Must match layoutRadial pad — keep guide rings on the same radii as nodes. */
export const LAYOUT_PAD = 36

/** Short guide labels for dashed concentric rings (近 / 中 / 远). */
export const RING_LABEL: Record<HorizonKey, string> = {
  near: '近',
  mid: '中',
  long: '远',
}

const UNKNOWN_FRAC = RING_FRAC.mid

export interface RingGuide {
  key: HorizonKey
  label: string
  r: number
}

export interface RingGeometry {
  cx: number
  cy: number
  Rmax: number
  rings: RingGuide[]
}

/** Same center / Rmax / ring radii as layoutRadial — for dashed guide circles. */
export function ringGeometry(width: number, height: number): RingGeometry {
  const cx = width / 2
  const cy = height / 2
  const Rmax = Math.max(40, Math.min(width, height) / 2 - LAYOUT_PAD)
  const rings: RingGuide[] = (['near', 'mid', 'long'] as HorizonKey[]).map(
    (key) => ({
      key,
      label: RING_LABEL[key],
      r: Rmax * RING_FRAC[key],
    }),
  )
  return { cx, cy, Rmax, rings }
}

function nodeHorizon(
  node: RadialNode,
  edges: RadialEdge[] | undefined,
): HorizonKey | null {
  const fromNode = primaryHorizon(node.props?.horizons)
  if (fromNode) return fromNode
  if (!edges?.length) return null
  const collected: string[] = []
  for (const e of edges) {
    if (e.source !== node.id && e.target !== node.id) continue
    const h = primaryHorizon(e.props?.horizons)
    if (h) collected.push(h)
  }
  return primaryHorizon(collected)
}

/**
 * Place center at mid-box; others on horizon rings
 * (near inner / mid middle / long outer).
 */
export function layoutRadial(
  nodes: RadialNode[],
  width: number,
  height: number,
  edges?: RadialEdge[],
): Record<string, Point> {
  const cx = width / 2
  const cy = height / 2
  const center =
    nodes.find((n) => n.props?.role === 'center') || nodes[0]
  const others = nodes.filter((n) => n.id !== center?.id)
  const pos: Record<string, Point> = {}
  if (center) pos[center.id] = { x: cx, y: cy }

  const pad = LAYOUT_PAD
  const Rmax = Math.max(40, Math.min(width, height) / 2 - pad)
  if (!others.length) return pos

  const buckets: Record<string, RadialNode[]> = {
    near: [],
    mid: [],
    long: [],
    unknown: [],
  }
  for (const node of others) {
    const h = nodeHorizon(node, edges)
    if (h) buckets[h].push(node)
    else buckets.unknown.push(node)
  }

  const ringOrder: Array<{ key: string; frac: number; phase: number }> = [
    { key: 'near', frac: RING_FRAC.near, phase: 0 },
    { key: 'mid', frac: RING_FRAC.mid, phase: 0.35 },
    { key: 'long', frac: RING_FRAC.long, phase: 0.7 },
    { key: 'unknown', frac: UNKNOWN_FRAC, phase: 0.5 },
  ]

  for (const ring of ringOrder) {
    const group = buckets[ring.key]
    if (!group.length) continue
    const R = Rmax * ring.frac
    const count = group.length
    for (let j = 0; j < count; j++) {
      const node = group[j]
      const a = (j / count) * Math.PI * 2 - Math.PI / 2
      pos[node.id] = {
        x: cx + Math.cos(a + ring.phase) * R,
        y: cy + Math.sin(a + ring.phase) * R,
      }
    }
  }
  return pos
}
