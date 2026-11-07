import { describe, expect, it } from 'vitest'
import { LAYOUT_PAD, RING_FRAC, layoutRadial, ringGeometry } from '../../src/client/layout-radial.ts'

describe('layoutRadial', () => {
  it('puts center at mid-box', () => {
    const pos = layoutRadial(
      [
        { id: 'c', props: { role: 'center' } },
        { id: 'a', props: { horizons: ['near'] } },
        { id: 'b', props: { horizons: ['long'] } },
      ],
      400,
      300,
    )
    expect(pos.c).toEqual({ x: 200, y: 150 })
    expect(pos.a).toBeTruthy()
    expect(pos.b).toBeTruthy()
  })

  it('places near closer than mid closer than long', () => {
    const W = 600
    const H = 600
    const cx = 300
    const cy = 300
    const pos = layoutRadial(
      [
        { id: 'c', props: { role: 'center' } },
        { id: 'n', props: { horizons: ['near'] } },
        { id: 'm', props: { horizons: ['mid'] } },
        { id: 'f', props: { horizons: ['long'] } },
      ],
      W,
      H,
    )
    const dist = (id: string) => Math.hypot(pos[id].x - cx, pos[id].y - cy)
    const Rmax = Math.min(W, H) / 2 - LAYOUT_PAD
    expect(dist('n')).toBeCloseTo(Rmax * RING_FRAC.near, 5)
    expect(dist('m')).toBeCloseTo(Rmax * RING_FRAC.mid, 5)
    expect(dist('f')).toBeCloseTo(Rmax * RING_FRAC.long, 5)
    expect(dist('n')).toBeLessThan(dist('m'))
    expect(dist('m')).toBeLessThan(dist('f'))
  })

  it('multi-horizon node uses nearest (near) ring — same as color priority', () => {
    const W = 600
    const H = 600
    const cx = 300
    const cy = 300
    const pos = layoutRadial(
      [
        { id: 'c', props: { role: 'center' } },
        { id: 'multi', props: { horizons: ['mid', 'near', 'long'] } },
      ],
      W,
      H,
    )
    const Rmax = Math.min(W, H) / 2 - LAYOUT_PAD
    const d = Math.hypot(pos.multi.x - cx, pos.multi.y - cy)
    expect(d).toBeCloseTo(Rmax * RING_FRAC.near, 5)
  })

  it('falls back to edge horizon when node has none', () => {
    const W = 600
    const H = 600
    const cx = 300
    const cy = 300
    const pos = layoutRadial(
      [
        { id: 'c', props: { role: 'center' } },
        { id: 'onlyEdge' },
      ],
      W,
      H,
      [
        {
          source: 'c',
          target: 'onlyEdge',
          props: { horizons: ['long'] },
        },
      ],
    )
    const Rmax = Math.min(W, H) / 2 - LAYOUT_PAD
    const d = Math.hypot(pos.onlyEdge.x - cx, pos.onlyEdge.y - cy)
    expect(d).toBeCloseTo(Rmax * RING_FRAC.long, 5)
  })

  it('spreads same-horizon nodes around one ring', () => {
    const nodes = [{ id: 'c', props: { role: 'center' as const } }].concat(
      Array.from({ length: 12 }, (_, i) => ({
        id: `n${i}`,
        props: { horizons: ['near'] },
      })),
    )
    const pos = layoutRadial(nodes, 600, 600)
    const dists = Object.entries(pos)
      .filter(([id]) => id !== 'c')
      .map(([, p]) => Math.hypot(p.x - 300, p.y - 300))
    const uniqueish = new Set(dists.map((d) => Math.round(d)))
    expect(uniqueish.size).toBe(1)
  })
})


describe('ringGeometry', () => {
  it('matches layoutRadial radii for near/mid/long', () => {
    const W = 600
    const H = 600
    const g = ringGeometry(W, H)
    expect(g.cx).toBe(300)
    expect(g.cy).toBe(300)
    expect(g.Rmax).toBe(Math.min(W, H) / 2 - LAYOUT_PAD)
    expect(g.rings.map((r) => r.key)).toEqual(['near', 'mid', 'long'])
    expect(g.rings.map((r) => r.label)).toEqual(['近', '中', '远'])
    expect(g.rings[0].r).toBeCloseTo(g.Rmax * RING_FRAC.near, 5)
    expect(g.rings[1].r).toBeCloseTo(g.Rmax * RING_FRAC.mid, 5)
    expect(g.rings[2].r).toBeCloseTo(g.Rmax * RING_FRAC.long, 5)
  })
})
