import { describe, expect, it } from 'vitest'
import { nextViewMode, viewToLabQuery, type ViewMode } from '../../src/client/view-mode.ts'
import { VIEW_RADAR, VIEW_RELATION } from '../../src/client/labels.ts'

describe('view mode switch', () => {
  it('defaults to 关系网 and toggles to 雷达维', () => {
    const initial: ViewMode = 'relation'
    expect(nextViewMode(initial)).toBe('radar')
    expect(nextViewMode('radar')).toBe('relation')
  })

  it('maps UI mode to Lab get_graph view query', () => {
    expect(viewToLabQuery('relation')).toBe('instance')
    expect(viewToLabQuery('radar')).toBe('abstract')
  })

  it('labels for modes stay 关系网 / 雷达维', () => {
    expect(VIEW_RELATION).toBe('关系网')
    expect(VIEW_RADAR).toBe('雷达维')
  })
})
