/**
 * Right-sidebar 影响网 panel — native canvas (no iframe).
 * Topbar: 标的 picker + 雷达维/关系网 + 版本 v1 + 刷新; filters; SVG graph; detail pane.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  buildDimensionDetailHtml,
  buildEdgeDetailHtml,
  buildInstanceDetailWithBackHtml,
  buildNodeDetailHtml,
  DetailPane,
  filterInstancesByHorizon,
  instancesForDimension,
  isDimensionNode,
  readStoredDetailWidth,
  escapeText,
  writeStoredDetailWidth,
} from './DetailPane.tsx'
import { FilterBar } from './FilterBar.tsx'
import {
  activateNet,
  fetchGraphFiltered,
  fetchNets,
  fetchStructure,
} from './engine-fetch.ts'
import {
  InfluenceGraphSvg,
  type CanvasEdge,
  type CanvasNode,
} from './InfluenceGraphSvg.tsx'
import { GUIDE_TITLE, VIEW_RADAR, VIEW_RELATION } from './labels.ts'
import { NetPicker, netLabel, type NetRow } from './NetPicker.tsx'
import { ENGINE_DEFAULT_BASE } from '../engine-paths.ts'
import { viewToLabQuery, type ViewMode } from './view-mode.ts'

const ENGINE_BASE = ((): string => {
  try {
    const g = globalThis as typeof globalThis & { INFLUENCE_NET_URL?: string }
    if (typeof g.INFLUENCE_NET_URL === 'string' && g.INFLUENCE_NET_URL) {
      return g.INFLUENCE_NET_URL
    }
  } catch {
    /* ignore */
  }
  return ENGINE_DEFAULT_BASE
})()

const VERSION_URL = 'https://influence.notta.uk'

interface StructurePayload {
  net_id?: string
  title?: string
  center?: { id?: string; name?: string; ticker?: string }
  dimensions?: Array<{ id: string; name?: string }>
  horizons?: Record<string, { name?: string }>
}

interface GraphPayload {
  net_id?: string
  view?: string
  nodes?: CanvasNode[]
  edges?: CanvasEdge[]
}

const HZ_FALLBACK: Record<string, string> = {
  near: '近期',
  mid: '中期',
  long: '远期',
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  color: 'var(--dsw-alias-label-primary, #222)',
  background: 'var(--dsw-alias-bg-base, #f3f3f3)',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: 1.5,
  overflow: 'hidden',
}

const topbarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  borderBottom: '1px solid var(--dsw-alias-stroke-border, #ddd)',
  flex: '0 0 auto',
  background: 'var(--dsw-alias-bg-elevated, #fff)',
  position: 'relative',
  zIndex: 5,
}

const chipBase: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  padding: '4px 10px',
  border: '1px solid var(--dsw-alias-stroke-border, #888)',
  borderRadius: 2,
  background: 'var(--dsw-alias-bg-base, #fff)',
  color: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const segWrap: CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--dsw-alias-stroke-border, #888)',
  borderRadius: 2,
  overflow: 'hidden',
}

const filterBox: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--dsw-alias-stroke-border, #ddd)',
  background: 'var(--dsw-alias-bg-elevated, #fafafa)',
  flex: '0 0 auto',
}

const filterRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  marginBottom: 6,
}

const filterTitle: CSSProperties = {
  flex: '0 0 48px',
  color: 'var(--dsw-alias-label-secondary, #666)',
  fontSize: 12,
  paddingTop: 4,
}

const chipsRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  flex: 1,
}

const bodyRow: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'row',
  overflow: 'hidden',
}

const canvasCol: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#fff',
}

const detailHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 8px',
  borderBottom: '1px dashed var(--dsw-alias-stroke-border, #bbb)',
  background: 'var(--dsw-alias-bg-base, #eee)',
  fontSize: 11,
  color: 'var(--dsw-alias-label-secondary, #666)',
}

const detailBody: CSSProperties = {
  padding: 8,
  overflow: 'auto',
  flex: 1,
  fontSize: 12,
}

const statusStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '4px 10px',
  fontSize: 11,
  color: 'var(--dsw-alias-label-secondary, #666)',
  borderTop: '1px solid var(--dsw-alias-stroke-border, #ddd)',
  background: 'var(--dsw-alias-bg-base, #f3f3f3)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  minWidth: '100%',
  width: 'max-content',
  maxWidth: 280,
  maxHeight: 260,
  overflow: 'auto',
  margin: 0,
  padding: '4px 0',
  listStyle: 'none',
  background: '#fff',
  border: '1px solid #888',
  boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
  zIndex: 30,
}

export function InfluenceLabBody(_props: Record<string, unknown> = {}): ReactNode {
  const [mode, setMode] = useState<ViewMode>('relation')
  const [nets, setNets] = useState<NetRow[]>([])
  const [activeNetId, setActiveNetId] = useState('')
  const [structure, setStructure] = useState<StructurePayload | null>(null)
  const [graph, setGraph] = useState<GraphPayload | null>(null)
  const [dimension, setDimension] = useState<string | null>(null)
  const [horizon, setHorizon] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailHtml, setDetailHtml] = useState<string>('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailWidth, setDetailWidth] = useState(() => readStoredDetailWidth())
  const [menuOpen, setMenuOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [status, setStatus] = useState('loading…')
  const [error, setError] = useState<string | null>(null)
  const [booted, setBooted] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const dimCtxRef = useRef<{
    dim: CanvasNode
    instances: CanvasNode[]
    edges: CanvasEdge[]
  } | null>(null)

  const labView = viewToLabQuery(mode)

  const loadGraph = useCallback(
    async (opts?: {
      view?: typeof labView
      dimension?: string | null
      horizon?: string | null
      mode?: ViewMode
    }) => {
      const v = opts?.view ?? labView
      const dim = opts?.dimension === undefined ? dimension : opts.dimension
      const hz = opts?.horizon === undefined ? horizon : opts.horizon
      const m = opts?.mode ?? mode
      try {
        const raw = (await fetchGraphFiltered(ENGINE_BASE, {
          view: v,
          dimension: dim,
          horizon: hz,
        })) as GraphPayload
        setGraph(raw)
        setError(null)
        const n = (raw.nodes || []).length
        const e = (raw.edges || []).length
        setStatus(
          `net=${raw.net_id || '—'} · ${m === 'radar' ? VIEW_RADAR : VIEW_RELATION} · nodes=${n} · edges=${e}` +
            (dim ? ` · dim=${dim}` : ' · dim=全部') +
            (hz ? ` · hz=${hz}` : ' · hz=全部'),
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setStatus(`加载失败: ${msg}`)
      }
    },
    [labView, dimension, horizon, mode],
  )

  /** Structure + nets only — graph loads via the filter effect after booted.
   * Retries so a just-spawned engine (empty-home → 工业富联 seed) can finish. */
  const bootMeta = useCallback(async () => {
    const attempts = 8
    let lastErr: unknown = null
    for (let i = 0; i < attempts; i++) {
      try {
        const struct = (await fetchStructure(ENGINE_BASE)) as StructurePayload
        const netsRes = (await fetchNets(ENGINE_BASE)) as {
          nets?: NetRow[]
          active_net_id?: string
        }
        const list = netsRes.nets || []
        // Engine up but seed still writing: wait for at least one net once.
        if (list.length === 0 && i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 400))
          continue
        }
        setStructure(struct)
        setNets(list)
        setActiveNetId(struct.net_id || netsRes.active_net_id || '')
        setError(null)
        setBooted(true)
        return
      } catch (err) {
        lastErr = err
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 400))
          continue
        }
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'engine unreachable')
    setError(msg)
    setStatus(`加载失败: ${msg} — 插件应会自动拉起引擎；也可手动 ./engine/run.sh`)
    setBooted(true)
  }, [])

  useEffect(() => {
    void bootMeta()
  }, [bootMeta])

  // Single graph-load path: after meta boot, and whenever view/filters change
  useEffect(() => {
    if (!booted) return
    void loadGraph()
  }, [booted, labView, dimension, horizon, loadGraph])

  // Horizon / dimension filter change: refresh open dim-instance list
  useEffect(() => {
    if (!booted) return
    const ctx = dimCtxRef.current
    if (!ctx?.dim || mode !== 'radar') return
    if (!isDimensionNode(ctx.dim)) return
    const dimNode = ctx.dim
    void (async () => {
      try {
        const raw = (await fetchGraphFiltered(ENGINE_BASE, {
          view: 'instance',
          dimension: dimNode.id,
          horizon,
        })) as GraphPayload
        const instances = filterInstancesByHorizon(
          instancesForDimension(raw.nodes || [], dimNode.id),
          horizon,
        )
        const edges = raw.edges || []
        dimCtxRef.current = { dim: dimNode, instances, edges }
        setDetailHtml(buildDimensionDetailHtml(dimNode, instances, edges))
      } catch {
        /* keep prior detail on filter refresh failure */
      }
    })()
  }, [booted, horizon, dimension, mode])

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!pickerRef.current) return
      if (!pickerRef.current.contains(ev.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const activeLabel = useMemo(() => {
    const hit = nets.find((n) => n.net_id === activeNetId)
    if (hit) return netLabel(hit)
    const c = structure?.center
    if (c?.name || c?.ticker) return [c.name, c.ticker].filter(Boolean).join(' ')
    return activeNetId || '选择标的'
  }, [nets, activeNetId, structure])

  const onActivate = async (netId: string) => {
    if (!netId || netId === activeNetId || switching) return
    setSwitching(true)
    setMenuOpen(false)
    try {
      await activateNet(ENGINE_BASE, netId)
      setSelectedId(null)
      setDetailOpen(false)
      setDimension(null)
      setHorizon(null)
      setActiveNetId(netId)
      const struct = (await fetchStructure(ENGINE_BASE)) as StructurePayload
      setStructure(struct)
      const netsRes = (await fetchNets(ENGINE_BASE)) as {
        nets?: NetRow[]
        active_net_id?: string
      }
      setNets(netsRes.nets || [])
      setActiveNetId(struct.net_id || netsRes.active_net_id || netId)
      await loadGraph({ dimension: null, horizon: null })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStatus(`切换标的失败: ${msg}`)
    } finally {
      setSwitching(false)
    }
  }

  const refresh = async () => {
    await bootMeta()
    await loadGraph()
  }

  const setViewMode = (next: ViewMode) => {
    setMode(next)
    setSelectedId(null)
    setDetailOpen(false)
    setDetailHtml('')
    dimCtxRef.current = null
  }

  const showNode = (n: CanvasNode) => {
    setSelectedId(n.id)
    // 雷达维：维度节点 → 摘要 + 该维全部对象列表（另拉 instance 视图）
    if (mode === 'radar' && isDimensionNode(n)) {
      void (async () => {
        try {
          const raw = (await fetchGraphFiltered(ENGINE_BASE, {
            view: 'instance',
            dimension: n.id,
            horizon,
          })) as GraphPayload
          const instances = filterInstancesByHorizon(
            instancesForDimension(raw.nodes || [], n.id),
            horizon,
          )
          const edges = raw.edges || []
          dimCtxRef.current = { dim: n, instances, edges }
          setDetailHtml(buildDimensionDetailHtml(n, instances, edges))
          setDetailOpen(true)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          dimCtxRef.current = { dim: n, instances: [], edges: [] }
          setDetailHtml(
            buildDimensionDetailHtml(n, []) +
              `<div class="muted" style="margin-top:8px;color:#864">加载该维对象失败：${escapeText(msg)}</div>`,
          )
          setDetailOpen(true)
        }
      })()
      return
    }
    dimCtxRef.current = null
    const related = (graph?.edges || []).filter(
      (e) => e.source === n.id || e.target === n.id,
    )
    setDetailHtml(buildNodeDetailHtml(n, related))
    setDetailOpen(true)
  }

  const onDetailClick = (ev: { target: EventTarget | null }) => {
    const el = ev.target as HTMLElement | null
    if (!el || typeof el.closest !== 'function') return
    const back = el.closest('[data-back-dim]')
    if (back) {
      const ctx = dimCtxRef.current
      if (ctx) {
        setDetailHtml(buildDimensionDetailHtml(ctx.dim, ctx.instances, ctx.edges))
      }
      return
    }
    const row = el.closest('[data-dim-instance]') as HTMLElement | null
    if (!row) return
    const id = row.getAttribute('data-dim-instance')
    const ctx = dimCtxRef.current
    if (!id || !ctx) return
    const inst = ctx.instances.find((x) => x.id === id)
    if (!inst) return
    const related = ctx.edges.filter((e) => e.source === id || e.target === id)
    setDetailHtml(buildInstanceDetailWithBackHtml(inst, related))
  }

  const showEdge = (e: CanvasEdge) => {
    const eid = String(e.id || '')
    setSelectedId(eid)
    setDetailHtml(buildEdgeDetailHtml(e))
    setDetailOpen(true)
  }

  const clearSelection = () => {
    setSelectedId(null)
    setDetailOpen(false)
    setDetailHtml('')
    dimCtxRef.current = null
  }

  const dims = structure?.dimensions || []
  const nodes = graph?.nodes || []
  const edges = graph?.edges || []

  const horizonLabels = useMemo(() => {
    const out: Record<string, string> = { ...HZ_FALLBACK }
    for (const h of ['near', 'mid', 'long'] as const) {
      const name = structure?.horizons?.[h]?.name
      if (name) out[h] = name
    }
    return out
  }, [structure])

  const chipStyle = (active: boolean): CSSProperties => ({
    ...chipBase,
    background: active ? 'var(--dsw-alias-bg-highlight, #e8eef5)' : chipBase.background,
    fontWeight: active ? 600 : 400,
  })

  const segStyle = (active: boolean): CSSProperties => ({
    ...chipBase,
    border: 'none',
    borderRadius: 0,
    background: active ? 'var(--dsw-alias-bg-highlight, #dde6f0)' : 'transparent',
    fontWeight: active ? 600 : 400,
  })

  return (
    <div style={rootStyle} data-influence-net-panel data-view={mode}>
      <div style={topbarStyle}>
        <NetPicker
          pickerRef={pickerRef}
          nets={nets}
          activeNetId={activeNetId}
          activeLabel={activeLabel}
          menuOpen={menuOpen}
          switching={switching}
          chipBase={chipBase}
          menuStyle={menuStyle}
          onToggle={() => setMenuOpen((o) => !o)}
          onActivate={(id) => void onActivate(id)}
        />

        <div style={segWrap} role="group" aria-label="图谱视图">
          <button
            type="button"
            data-view-tab="radar"
            style={segStyle(mode === 'radar')}
            onClick={() => setViewMode('radar')}
          >
            {VIEW_RADAR}
          </button>
          <button
            type="button"
            data-view-tab="relation"
            style={segStyle(mode === 'relation')}
            onClick={() => setViewMode('relation')}
          >
            {VIEW_RELATION}
          </button>
        </div>

        <a
          href={VERSION_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-version-link
          style={{ ...chipBase, textDecoration: 'none' }}
        >
          版本 v1
        </a>

        <button
          type="button"
          data-influence-refresh
          style={chipBase}
          onClick={() => void refresh()}
        >
          刷新
        </button>
      </div>

      <FilterBar
        dims={dims}
        dimension={dimension}
        horizon={horizon}
        horizonLabels={horizonLabels}
        filterBox={filterBox}
        filterRow={filterRow}
        filterTitle={filterTitle}
        chipsRow={chipsRow}
        chipStyle={chipStyle}
        onDimension={setDimension}
        onHorizon={setHorizon}
      />

      <div style={bodyRow}>
        <div style={canvasCol}>
          <InfluenceGraphSvg
            nodes={nodes}
            edges={edges}
            selectedId={selectedId}
            onSelectNode={showNode}
            onSelectEdge={showEdge}
            onClearSelection={clearSelection}
          />
        </div>
        <DetailPane
          open={detailOpen}
          detailHtml={detailHtml}
          width={detailWidth}
          onWidthChange={(w) => {
            setDetailWidth(w)
            writeStoredDetailWidth(w)
          }}
          detailHead={detailHead}
          detailBody={detailBody}
          chipBase={chipBase}
          onClose={clearSelection}
          onDetailClick={onDetailClick}
        />
      </div>

      <div style={statusStyle} data-influence-status title={status}>
        {error ? `⚠ ${error}` : status}
        {!error ? ` · ${GUIDE_TITLE}` : ''}
      </div>
    </div>
  )
}
