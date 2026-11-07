import { describe, expect, it } from 'vitest'
import {
  buildDimInstanceListHtml,
  buildDimensionDetailHtml,
  buildEdgeDetailHtml,
  buildGenericDetailRows,
  buildInstanceDetailWithBackHtml,
  buildNodeDetailHtml,
  clampDetailWidth,
  DEFAULT_DETAIL_WIDTH,
  DETAIL_WIDTH_STORAGE_KEY,
  evidenceLinksHtml,
  extractEvidenceUrls,
  filterInstancesByHorizon,
  formatHorizonsZh,
  horizonChipsHtml,
  instancesForDimension,
  isDimensionNode,
  MAX_DETAIL_WIDTH,
  MIN_DETAIL_WIDTH,
  readStoredDetailWidth,
  truncateSnippet,
} from '../src/client/DetailPane.tsx'

describe('buildGenericDetailRows', () => {
  it('puts core identity first then all remaining props', () => {
    const rows = buildGenericDetailRows({
      id: 'cap_dandong',
      name: '丹东基地（签约，未投产）',
      type: 'ProductPlatform',
      kind: 'instance',
      props: {
        dimension: 'dim_capacity',
        horizons: ['mid', 'long'],
        narrative: '签约未投产',
        status: 'signed_not_operational',
        ownership_note: '签约主体亨通集团',
        investment: '25亿元/300亩/两期',
        phase1: '一期内容',
        phase2: '二期内容',
        output: '年产值20亿元',
        custom_metric: 42,
      },
    })
    const keys = rows.map((r) => r.key)
    expect(keys.slice(0, 4)).toEqual(['id', 'name', 'type', 'kind'])
    expect(keys).toContain('status')
    expect(keys).toContain('investment')
    expect(keys).toContain('phase1')
    expect(keys).toContain('phase2')
    expect(keys).toContain('output')
    expect(keys).toContain('ownership_note')
    expect(keys).toContain('custom_metric')
    expect(keys).toContain('narrative')
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.status.label).toBe('状态')
    expect(byKey.custom_metric.label).toBe('custom_metric')
    expect(byKey.investment.value).toContain('25亿')
  })

  it('skips empty / null / dash-only values and evidence bags (links separate)', () => {
    const rows = buildGenericDetailRows({
      id: 'x',
      name: 'n',
      props: {
        empty: '',
        nil: null,
        dash: '—',
        evidence_refs: [{ url: 'https://a.example' }],
        evidence_urls: ['https://b.example'],
        keep: 'yes',
      },
    })
    const keys = rows.map((r) => r.key)
    expect(keys).not.toContain('empty')
    expect(keys).not.toContain('nil')
    expect(keys).not.toContain('dash')
    expect(keys).not.toContain('evidence_refs')
    expect(keys).not.toContain('evidence_urls')
    expect(keys).toContain('keep')
  })

  it('formats arrays/objects readably', () => {
    const rows = buildGenericDetailRows({
      id: 'e1',
      props: { horizons: ['near', 'mid'], nested: { a: 1 } },
    })
    const by = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(by.horizons).toBe('near, mid')
    expect(by.nested).toContain('"a"')
  })
})

describe('extractEvidenceUrls', () => {
  it('pulls urls from evidence_refs objects and evidence_urls arrays', () => {
    expect(
      extractEvidenceUrls({
        evidence_refs: [
          { url: 'https://a.example/x', via: 'mcp' },
          'https://b.example/y',
        ],
        evidence_urls: ['https://c.example/z'],
      }),
    ).toEqual([
      'https://a.example/x',
      'https://b.example/y',
      'https://c.example/z',
    ])
  })

  it('dedupes and ignores non-http', () => {
    expect(
      extractEvidenceUrls(
        { evidence_refs: [{ url: 'https://a.example' }, { url: 'ftp://no' }] },
        { evidence_urls: ['https://a.example', 'notaurl'] },
      ),
    ).toEqual(['https://a.example'])
  })

  it('walks edge top-level evidence_refs and props', () => {
    expect(
      extractEvidenceUrls({
        evidence_refs: [{ url: 'https://edge.example/1' }],
        props: { evidence_urls: ['https://edge.example/2'] },
      }),
    ).toEqual(['https://edge.example/1', 'https://edge.example/2'])
  })
})

describe('evidenceLinksHtml + build*DetailHtml', () => {
  it('returns empty string when no urls', () => {
    expect(evidenceLinksHtml([])).toBe('')
  })

  it('renders 证据链接 with noopener anchors', () => {
    const html = evidenceLinksHtml(['https://www.stcn.com/article/detail/1.html'])
    expect(html).toContain('证据链接')
    expect(html).toContain('https://www.stcn.com/article/detail/1.html')
    expect(html).toContain('noopener')
    expect(html).toContain('target="_blank"')
  })

  it('node detail includes related edge evidence urls', () => {
    const html = buildNodeDetailHtml(
      {
        id: 'cap_dandong',
        name: '丹东',
        type: 'ProductPlatform',
        props: { status: 'signed_not_operational', investment: '25亿' },
      },
      [
        {
          id: 'e_dandong_to_center',
          source: 'cap_dandong',
          target: 'c_600487',
          evidence_refs: [
            { url: 'https://static.sse.com.cn/disclosure/x.pdf' },
            { url: 'https://www.9fzt.com/detail/x' },
          ],
        },
      ],
    )
    expect(html).toContain('状态')
    expect(html).toContain('投资')
    expect(html).toContain('证据链接')
    expect(html).toContain('static.sse.com.cn')
    expect(html).toContain('9fzt.com')
  })

  it('edge detail shows its own evidence', () => {
    const html = buildEdgeDetailHtml({
      id: 'e1',
      rel: 'influences',
      source: 'a',
      target: 'b',
      evidence_refs: [{ url: 'https://news.example/a' }],
      props: { narrative: '一句原述' },
    })
    expect(html).toContain('原述')
    expect(html).toContain('证据链接')
    expect(html).toContain('news.example')
  })
})

describe('detail width clamp + storage', () => {
  it('defaults in readable Chinese-narrative range', () => {
    expect(DEFAULT_DETAIL_WIDTH).toBeGreaterThanOrEqual(320)
    expect(DEFAULT_DETAIL_WIDTH).toBeLessThanOrEqual(400)
    expect(MIN_DETAIL_WIDTH).toBeLessThanOrEqual(240)
    expect(MAX_DETAIL_WIDTH).toBeGreaterThanOrEqual(520)
  })

  it('clamps width', () => {
    expect(clampDetailWidth(100)).toBe(MIN_DETAIL_WIDTH)
    expect(clampDetailWidth(9999)).toBe(MAX_DETAIL_WIDTH)
    expect(clampDetailWidth(360)).toBe(360)
  })

  it('reads stored width with fallback', () => {
    const mem: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v
      },
    }
    expect(readStoredDetailWidth(storage)).toBe(DEFAULT_DETAIL_WIDTH)
    storage.setItem(DETAIL_WIDTH_STORAGE_KEY, '380')
    expect(readStoredDetailWidth(storage)).toBe(380)
    storage.setItem(DETAIL_WIDTH_STORAGE_KEY, '50')
    expect(readStoredDetailWidth(storage)).toBe(MIN_DETAIL_WIDTH)
  })
})

describe('dimension detail + instance list', () => {
  const dim = {
    id: 'dim_narrative',
    name: '叙事 / 舆情',
    type: 'Dimension',
    kind: 'dimension',
    props: { dimension: 'dim_narrative', object_count: 2, desc: '市场叙事' },
  }

  const nodes = [
    dim,
    {
      id: 'c_center',
      name: '亨通光电',
      kind: 'center',
      props: { role: 'center' },
    },
    {
      id: 'narr_a',
      name: '产能扩张叙事',
      type: 'Narrative',
      kind: 'instance',
      props: {
        dimension: 'dim_narrative',
        horizons: ['near', 'mid'],
        narrative: '市场把丹东基地解读为远期产能故事，短期难兑现',
      },
    },
    {
      id: 'narr_b',
      name: '订单能见度',
      props: {
        dimension: 'dim_narrative',
        horizons: ['long'],
        narrative_refined: '订单能见度仍偏弱',
      },
    },
    {
      id: 'cap_x',
      name: '别维对象',
      props: { dimension: 'dim_capacity', horizons: ['mid'], narrative: '不该出现' },
    },
  ]

  it('isDimensionNode detects Dimension kind/type', () => {
    expect(isDimensionNode(dim)).toBe(true)
    expect(isDimensionNode(nodes[2])).toBe(false)
    expect(isDimensionNode({ id: 'x', type: 'Dimension' })).toBe(true)
  })

  it('instancesForDimension matches props.dimension and skips center/dim', () => {
    const list = instancesForDimension(nodes, 'dim_narrative')
    expect(list.map((n) => n.id)).toEqual(['narr_a', 'narr_b'])
  })

  it('formatHorizonsZh maps near/mid/long to 近/中/远', () => {
    expect(formatHorizonsZh(['near', 'mid'])).toBe('近 · 中')
    expect(formatHorizonsZh(['long'])).toBe('远')
    expect(formatHorizonsZh([])).toBe('')
    expect(formatHorizonsZh(null)).toBe('')
  })

  it('truncateSnippet cuts long narrative', () => {
    const long = '一二三四五六七八九十'.repeat(6)
    const out = truncateSnippet(long, 20)
    expect(out.length).toBeLessThanOrEqual(21)
    expect(out.endsWith('…')).toBe(true)
  })

  it('list html includes name, horizon zh, snippet; empty state', () => {
    const html = buildDimInstanceListHtml(instancesForDimension(nodes, 'dim_narrative'))
    expect(html).toContain('data-dim-list')
    expect(html).toContain('data-dim-instance="narr_a"')
    expect(html).toContain('产能扩张叙事')
    expect(html).toContain('近')
    expect(html).toContain('中')
    expect(html).toContain('丹东基地')
    expect(html).toContain('订单能见度')
    expect(html).not.toContain('不该出现')

    const empty = buildDimInstanceListHtml([])
    expect(empty).toContain('该维下暂无实例')
  })

  it('dimension detail = generic summary + instance list', () => {
    const list = instancesForDimension(nodes, 'dim_narrative')
    const html = buildDimensionDetailHtml(dim, list)
    expect(html).toContain('叙事 / 舆情')
    expect(html).toContain('对象数')
    expect(html).toContain('data-dim-list')
    expect(html).toContain('narr_a')
  })

  it('instance-from-dim detail has back link', () => {
    const html = buildInstanceDetailWithBackHtml(nodes[2] as never, [])
    expect(html).toContain('data-back-dim')
    expect(html).toContain('返回维度')
    expect(html).toContain('产能扩张叙事')
    expect(html).toContain('原述')
  })

  it('filterInstancesByHorizon intersects props.horizons; null shows all', () => {
    const list = instancesForDimension(nodes, 'dim_narrative')
    expect(filterInstancesByHorizon(list, null).map((n) => n.id)).toEqual(['narr_a', 'narr_b'])
    expect(filterInstancesByHorizon(list, 'near').map((n) => n.id)).toEqual(['narr_a'])
    expect(filterInstancesByHorizon(list, 'long').map((n) => n.id)).toEqual(['narr_b'])
    expect(filterInstancesByHorizon(list, 'mid').map((n) => n.id)).toEqual(['narr_a'])
  })

  it('horizonChipsHtml colors near/mid/long chips', () => {
    const html = horizonChipsHtml(['near', 'long'])
    expect(html).toContain('dim-hz-chip')
    expect(html).toContain('data-horizon="near"')
    expect(html).toContain('data-horizon="long"')
    expect(html).toContain('#c45c26')
    expect(html).toContain('#3d7a4a')
    expect(html).toContain('近')
    expect(html).toContain('远')
    expect(horizonChipsHtml([])).toBe('')
  })

  it('list html uses colored horizon chips', () => {
    const html = buildDimInstanceListHtml(instancesForDimension(nodes, 'dim_narrative'))
    expect(html).toContain('dim-hz-chip')
    expect(html).toContain('data-horizon="near"')
    expect(html).toContain('#c45c26')
  })

})
