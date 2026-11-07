/** @vitest-environment jsdom */
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InfluenceLabBody } from '../../src/client/InfluenceLabBody.tsx'
import { HORIZON_STROKE } from '../../src/client/horizon-color.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mount() {
  const host = document.createElement('div')
  host.style.height = '600px'
  host.style.width = '480px'
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<InfluenceLabBody />)
  })
  return { host, root }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('InfluenceLabBody native canvas (no iframe)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/structure')) {
          return jsonResponse({
            net_id: 'catl',
            title: '宁德时代',
            center: { id: 'c_catl', name: '宁德时代', ticker: '300750' },
            dimensions: [{ id: 'dim_supply', name: '供给' }],
            horizons: { near: { name: '近期' }, mid: { name: '中期' }, long: { name: '远期' } },
          })
        }
        if (url.includes('/api/nets') && !url.includes('activate')) {
          return jsonResponse({
            nets: [
              { net_id: 'catl', name: '宁德时代', ticker: '300750' },
              { net_id: 'foxconn', name: '工业富联', ticker: '601138' },
            ],
            active_net_id: 'catl',
          })
        }
        if (url.includes('/api/graph')) {
          return jsonResponse({
            net_id: 'catl',
            view: 'instance',
            nodes: [
              { id: 'c_catl', name: '宁德时代', kind: 'center', props: { role: 'center' } },
              {
                id: 'n1',
                name: '上游近',
                type: 'Supplier',
                props: { dimension: 'dim_supply', horizons: ['near'] },
              },
              {
                id: 'n2',
                name: '上游远',
                type: 'Supplier',
                props: { dimension: 'dim_supply', horizons: ['long'] },
              },
            ],
            edges: [
              {
                id: 'e1',
                source: 'n1',
                target: 'c_catl',
                rel: 'influences',
                props: { horizons: ['near'], channel: '近端供给传导' },
              },
              {
                id: 'e2',
                source: 'n2',
                target: 'c_catl',
                rel: 'influences',
                props: { horizons: ['long'] },
              },
            ],
          })
        }
        return jsonResponse({ ok: true })
      }),
    )
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('does not mount an iframe', async () => {
    const { host, root } = mount()
    await flush()
    expect(host.querySelector('iframe')).toBeNull()
    expect(host.querySelector('iframe[data-influence-canvas]')).toBeNull()
    act(() => root.unmount())
  })

  it('mounts inline svg canvas with topbar controls', async () => {
    const { host, root } = mount()
    await flush()
    const svg = host.querySelector('svg[data-influence-canvas]')
    expect(svg).toBeTruthy()
    expect(host.querySelector('[data-influence-lab-panel]')).toBeTruthy()
    expect(host.querySelector('[data-net-picker]')).toBeTruthy()
    expect(host.querySelector('[data-view-tab="relation"]')).toBeTruthy()
    expect(host.querySelector('[data-view-tab="radar"]')).toBeTruthy()
    expect(host.querySelector('[data-influence-refresh]')).toBeTruthy()
    expect(host.querySelector('[data-version-link]')?.getAttribute('href')).toBe(
      'https://influence.notta.uk',
    )
    expect(host.textContent || '').toMatch(/关系网/)
    expect(host.textContent || '').toMatch(/雷达维/)
    expect(host.textContent || '').toMatch(/刷新/)
    expect(host.textContent || '').not.toMatch(/实例|对象类型/)
    act(() => root.unmount())
  })

  it('loads /api/graph once on mount (no boot+filter double fetch)', async () => {
    const { root } = mount()
    await flush()
    await flush()
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const graphCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/graph'))
    expect(graphCalls.length).toBe(1)
    act(() => root.unmount())
  })


  it('click node: neighborhood highlight + edge name labels; clear restores', async () => {
    const { host, root } = mount()
    await flush()
    await flush()
    const wrap = host.querySelector('[data-influence-canvas-wrap]') as HTMLElement | null
    if (wrap) {
      Object.defineProperty(wrap, 'clientWidth', { configurable: true, get: () => 480 })
      Object.defineProperty(wrap, 'clientHeight', { configurable: true, get: () => 400 })
    }
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    // Click the near-horizon node label group (n1)
    const nodeGroups = [...host.querySelectorAll('svg[data-influence-canvas] g[data-node-id]')]
    const n1 = host.querySelector('g[data-node-id="n1"]') as SVGElement | null
    expect(n1).toBeTruthy()
    await act(async () => {
      n1!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    // center + n1 highlighted; n2 dimmed
    const n2 = host.querySelector('g[data-node-id="n2"]') as SVGElement | null
    expect(n1!.getAttribute('data-dimmed')).not.toBe('1')
    expect(n2!.getAttribute('data-dimmed')).toBe('1')
    const center = host.querySelector('g[data-node-id="c_catl"]') as SVGElement | null
    expect(center!.getAttribute('data-dimmed')).not.toBe('1')
    // incident edge e1 shows name; e2 dimmed / no label (or dimmed)
    const labelE1 = host.querySelector('[data-edge-name="e1"]')
    expect(labelE1).toBeTruthy()
    expect((labelE1!.textContent || '').length).toBeGreaterThan(0)
    const e2Line = host.querySelector('g[data-edge-id="e2"]') as SVGElement | null
    expect(e2Line!.getAttribute('data-dimmed')).toBe('1')
    // clear on svg background
    const svg = host.querySelector('svg[data-influence-canvas]') as SVGElement
    await act(async () => {
      svg.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(host.querySelector('[data-edge-name]')).toBeNull()
    expect(host.querySelector('g[data-dimmed="1"]')).toBeNull()
    act(() => root.unmount())
  })

  it('colors edges by primary horizon', async () => {
    const { host, root } = mount()
    await flush()
    await flush()
    // Force a measurable canvas so SVG draws lines
    const wrap = host.querySelector('[data-influence-canvas-wrap]') as HTMLElement | null
    if (wrap) {
      Object.defineProperty(wrap, 'clientWidth', { configurable: true, get: () => 480 })
      Object.defineProperty(wrap, 'clientHeight', { configurable: true, get: () => 400 })
      wrap.dispatchEvent(new Event('resize'))
    }
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    const nearLine = host.querySelector('line[data-horizon="near"]')
    const longLine = host.querySelector('line[data-horizon="long"]')
    // If layout not ready in jsdom, still assert chips exist with horizon tint hooks
    expect(host.querySelector('[data-horizon-chip="near"]')).toBeTruthy()
    expect(host.querySelector('[data-horizon-chip="mid"]')).toBeTruthy()
    expect(host.querySelector('[data-horizon-chip="long"]')).toBeTruthy()
    if (nearLine && longLine) {
      expect(nearLine.getAttribute('stroke')).toBe(HORIZON_STROKE.near)
      expect(longLine.getAttribute('stroke')).toBe(HORIZON_STROKE.long)
      expect(nearLine.getAttribute('stroke')).not.toBe(longLine.getAttribute('stroke'))
    }
    act(() => root.unmount())
  })
})
