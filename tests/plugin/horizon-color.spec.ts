import { describe, expect, it } from 'vitest'
import {
  HORIZON_FILL,
  HORIZON_STROKE,
  horizonFill,
  horizonStroke,
  primaryHorizon,
} from '../../src/client/horizon-color.ts'

describe('primaryHorizon', () => {
  it('prefers near over mid/long', () => {
    expect(primaryHorizon(['mid', 'near', 'long'])).toBe('near')
  })
  it('falls back to mid then long', () => {
    expect(primaryHorizon(['long', 'mid'])).toBe('mid')
    expect(primaryHorizon(['long'])).toBe('long')
  })
  it('returns null for empty / unknown', () => {
    expect(primaryHorizon(null)).toBeNull()
    expect(primaryHorizon([])).toBeNull()
    expect(primaryHorizon(['x'])).toBeNull()
  })
})

describe('horizonStroke / horizonFill', () => {
  it('maps each key to distinct colors', () => {
    const strokes = ['near', 'mid', 'long'].map((h) => horizonStroke([h]))
    expect(new Set(strokes).size).toBe(3)
    expect(horizonStroke(['near'])).toBe(HORIZON_STROKE.near)
    expect(horizonFill(['mid'])).toBe(HORIZON_FILL.mid)
    expect(horizonStroke(null, '#999')).toBe('#999')
  })
})
