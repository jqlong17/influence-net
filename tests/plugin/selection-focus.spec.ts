import { describe, expect, it } from 'vitest'
import {
  DIM_OPACITY,
  edgeDisplayName,
  selectionFocus,
  truncateEdgeLabel,
} from '../../src/client/selection-focus.ts'

describe('edgeDisplayName', () => {
  it('prefers name, then label, then props.channel, then narrative, then rel', () => {
    expect(edgeDisplayName({ name: '专名', rel: 'influences', props: { channel: '通道' } })).toBe(
      '专名',
    )
    expect(edgeDisplayName({ label: '标签', rel: 'influences', props: { channel: '通道' } })).toBe(
      '标签',
    )
    expect(edgeDisplayName({ rel: 'influences', props: { channel: '平台代际→出货' } })).toBe(
      '平台代际→出货',
    )
    expect(
      edgeDisplayName({
        rel: 'influences',
        props: { narrative_refined: '提炼一句', narrative: '原述很长' },
      }),
    ).toBe('提炼一句')
    expect(edgeDisplayName({ rel: 'influences', props: {} })).toBe('influences')
    expect(edgeDisplayName({ props: {} })).toBe('')
  })
})

describe('truncateEdgeLabel', () => {
  it('keeps short labels and truncates long ones', () => {
    expect(truncateEdgeLabel('短')).toBe('短')
    expect(truncateEdgeLabel('一二三四五六七八九十一二三四五六七八九十', 10)).toBe(
      '一二三四五六七八九…',
    )
  })
})

describe('selectionFocus', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const edges = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
    { id: 'e3', source: 'c', target: 'd' },
  ]

  it('returns inactive when nothing selected', () => {
    const f = selectionFocus(null, nodes, edges)
    expect(f.active).toBe(false)
    expect(f.nodeIds.size).toBe(0)
    expect(f.edgeIds.size).toBe(0)
  })

  it('highlights 1-hop neighbors and incident edges for a node', () => {
    const f = selectionFocus('b', nodes, edges)
    expect(f.active).toBe(true)
    expect([...f.nodeIds].sort()).toEqual(['a', 'b', 'c'])
    expect([...f.edgeIds].sort()).toEqual(['e1', 'e2'])
    expect(f.nodeIds.has('d')).toBe(false)
    expect(f.edgeIds.has('e3')).toBe(false)
  })

  it('highlights endpoints when an edge is selected', () => {
    const f = selectionFocus('e2', nodes, edges)
    expect(f.active).toBe(true)
    expect([...f.nodeIds].sort()).toEqual(['b', 'c'])
    expect([...f.edgeIds]).toEqual(['e2'])
  })
})

describe('DIM_OPACITY', () => {
  it('is in the soft dim range', () => {
    expect(DIM_OPACITY).toBeGreaterThanOrEqual(0.15)
    expect(DIM_OPACITY).toBeLessThanOrEqual(0.25)
  })
})
