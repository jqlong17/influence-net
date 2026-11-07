import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activateNet,
  fetchGraph,
  fetchGraphFiltered,
  fetchHealth,
  fetchNets,
  fetchStructure,
  LAB_ACTIVATE_PATH,
  LAB_READ_PATHS,
} from '../src/client/engine-fetch.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('engine-fetch (panel API)', () => {
  it('GETs /api/graph with view query only', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ view: 'instance', nodes: [], edges: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const body = (await fetchGraph('http://127.0.0.1:18765', 'instance')) as { view: string }
    expect(body.view).toBe('instance')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://127.0.0.1:18765/api/graph?view=instance')
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('fetchGraphFiltered adds dimension/horizon', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ nodes: [], edges: [] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await fetchGraphFiltered('http://127.0.0.1:18765', {
      view: 'abstract',
      dimension: 'dim_x',
      horizon: 'near',
    })
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://127.0.0.1:18765/api/graph?view=abstract&dimension=dim_x&horizon=near',
    )
  })

  it('exposes read paths + activate for 标的 switch', () => {
    expect(LAB_READ_PATHS).toEqual(
      expect.arrayContaining(['/api/health', '/api/graph', '/api/nets', '/api/structure']),
    )
    expect(LAB_ACTIVATE_PATH).toBe('/api/nets/activate')
    expect(LAB_READ_PATHS.some((p) => p.includes('mcp'))).toBe(false)
  })

  it('fetchHealth / fetchNets / fetchStructure are GET', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ ok: true, url }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await fetchHealth('http://127.0.0.1:18765')
    await fetchNets('http://127.0.0.1:18765')
    await fetchStructure('http://127.0.0.1:18765')
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.method ?? 'GET').toBe('GET')
    }
  })

  it('activateNet POSTs only /api/nets/activate', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, net_id: 'catl' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await activateNet('http://127.0.0.1:18765', 'catl')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://127.0.0.1:18765/api/nets/activate')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ net_id: 'catl' }))
  })
})

describe('client sources have no MCP write / sqlite helpers', () => {
  it('client tree forbids sqlite and mcp apply/propose; POST only for activate', () => {
    const root = join(import.meta.dirname, '../src/client')
    const files = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
    const paths = readFileSync(join(import.meta.dirname, '../src/engine-paths.ts'), 'utf8')
    const blob = files.map((f) => readFileSync(join(root, f), 'utf8')).join('\n') + '\n' + paths
    expect(blob).not.toMatch(/sqlite3?\b/i)
    expect(blob).not.toMatch(/\/api\/mcp\/(apply|propose|bulk_seed|reject)/)
    // Only allowed POST is nets/activate (literal lives in engine-paths.ts)
    const postHits = blob.match(/method:\s*['"]POST['"]/g) || []
    expect(postHits.length).toBe(1)
    expect(paths).toMatch(/\/api\/nets\/activate/)
    expect(blob).toMatch(/LAB_ACTIVATE_PATH/)
  })
})
