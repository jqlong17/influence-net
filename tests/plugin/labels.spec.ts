import { describe, expect, it } from 'vitest'
import {
  GUIDE_TITLE,
  TAB_KIND,
  VIEW_RELATION,
  VIEW_RADAR,
  USER_FACING_FORBIDDEN,
} from '../../src/client/labels.ts'

describe('influence-lab sidebar labels', () => {
  it('uses investor-facing view names 关系网 and 雷达维', () => {
    expect(VIEW_RELATION).toBe('关系网')
    expect(VIEW_RADAR).toBe('雷达维')
    expect(GUIDE_TITLE).toBe('影响网')
    expect(TAB_KIND).toBe('influence-net')
  })

  it('never exposes 实例 / 对象类型 in user-facing constants', () => {
    const exposed = [VIEW_RELATION, VIEW_RADAR, GUIDE_TITLE]
    for (const text of exposed) {
      for (const bad of USER_FACING_FORBIDDEN) {
        expect(text.includes(bad)).toBe(false)
      }
    }
  })
})
