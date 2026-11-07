/**
 * Near / mid / long (近中远) colors for graph edges & nodes.
 * Keep in sync with Lab app/static/app.js + styles.css (.hz-near|mid|long).
 * Prefer earliest horizon when props.horizons has several.
 */

export type HorizonKey = 'near' | 'mid' | 'long'

export const HORIZON_ORDER: HorizonKey[] = ['near', 'mid', 'long']

/** Stroke (edges / node border) — muted, readable on white. */
export const HORIZON_STROKE: Record<HorizonKey, string> = {
  near: '#c45c26',
  mid: '#2f6f9f',
  long: '#3d7a4a',
}

/** Fill (instance nodes) — light tint of the stroke. */
export const HORIZON_FILL: Record<HorizonKey, string> = {
  near: '#f3d9c8',
  mid: '#d5e6f2',
  long: '#d8ebd9',
}

export function primaryHorizon(
  horizons: unknown,
): HorizonKey | null {
  if (!Array.isArray(horizons) || horizons.length === 0) return null
  const set = new Set(
    horizons.map((h) => String(h).toLowerCase()).filter(Boolean),
  )
  for (const key of HORIZON_ORDER) {
    if (set.has(key)) return key
  }
  return null
}

export function horizonStroke(horizons: unknown, fallback = '#999'): string {
  const h = primaryHorizon(horizons)
  return h ? HORIZON_STROKE[h] : fallback
}

export function horizonFill(horizons: unknown, fallback = '#e8e8e8'): string {
  const h = primaryHorizon(horizons)
  return h ? HORIZON_FILL[h] : fallback
}
