/** Selected node/edge detail pane (right of canvas) — generic props dump + evidence + resize.
 * SYNC helpers with Lab app/static/app.js (buildGenericDetailRows / extractEvidenceUrls / SIDE_WIDTH_*).
 */
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import type { CanvasEdge, CanvasNode } from './InfluenceGraphSvg.tsx'
import { HORIZON_STROKE, HORIZON_ORDER, type HorizonKey } from './horizon-color.ts'

export function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/** Default / clamp — SYNC with Lab app.js */
export const DEFAULT_DETAIL_WIDTH = 360
export const MIN_DETAIL_WIDTH = 240
export const MAX_DETAIL_WIDTH = 560
export const DETAIL_WIDTH_STORAGE_KEY = 'influence-net.detailWidth'

export function clampDetailWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DETAIL_WIDTH
  return Math.min(MAX_DETAIL_WIDTH, Math.max(MIN_DETAIL_WIDTH, Math.round(n)))
}

export function readStoredDetailWidth(storage?: {
  getItem(key: string): string | null
}): number {
  try {
    const raw = (storage || (typeof localStorage !== 'undefined' ? localStorage : null))?.getItem(
      DETAIL_WIDTH_STORAGE_KEY,
    )
    if (raw == null || raw === '') return DEFAULT_DETAIL_WIDTH
    return clampDetailWidth(Number(raw))
  } catch {
    return DEFAULT_DETAIL_WIDTH
  }
}

export function writeStoredDetailWidth(
  width: number,
  storage?: { setItem(key: string, value: string): void },
): void {
  try {
    ;(storage || (typeof localStorage !== 'undefined' ? localStorage : null))?.setItem(
      DETAIL_WIDTH_STORAGE_KEY,
      String(clampDetailWidth(width)),
    )
  } catch {
    /* ignore */
  }
}

/** Light Chinese labels; unknown keys keep their key name. */
export const PROP_LABELS: Record<string, string> = {
  id: 'id',
  name: '名称',
  type: '类型',
  kind: '层级',
  rel: '关系',
  source: '源',
  target: '目标',
  edge_id: '边 id',
  attribution_tier: '归因层级',
  status: '状态',
  ownership_note: '主体说明',
  investment: '投资规模',
  phase1: '一期',
  phase2: '二期',
  output: '产值',
  note: '备注',
  desc: '说明',
  ticker: '代码',
  role: '角色',
  lag: '时滞',
  channel: '通道',
  dimension: '维度',
  horizons: '周期',
  strength: '强度',
  narrative: '原述',
  narrative_refined: '提炼',
  object_count: '对象数',
  link_count: '关系数',
  instance_count: '实例数',
}

/** Keys shown as separate 「证据链接」block — not duplicated in prop rows. */
const EVIDENCE_BAG_KEYS = new Set([
  'evidence_refs',
  'evidence_urls',
  'evidence',
  'urls',
  'sources',
])

export interface DetailRow {
  key: string
  label: string
  value: string
  /** when value is a single http(s) URL */
  href?: string
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') {
    const t = v.trim()
    return !t || t === '—' || t === '-' || t === 'null' || t === 'undefined'
  }
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

export function formatPropValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')) {
      return v.map(String).join(', ')
    }
    try {
      return JSON.stringify(v, null, 0)
    } catch {
      return String(v)
    }
  }
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function labelFor(key: string): string {
  return PROP_LABELS[key] || key
}

function singleHttpUrl(text: string): string | undefined {
  const t = text.trim()
  if (/^https?:\/\/\S+$/i.test(t)) return t
  return undefined
}

/**
 * Generic detail rows: core identity first, then ALL remaining props
 * (skip empty; evidence bags deferred to evidenceLinksHtml).
 */
export function buildGenericDetailRows(
  entity: {
    id?: string
    name?: string
    type?: string
    kind?: string
    rel?: string
    source?: string
    target?: string
    attribution_tier?: string
    props?: Record<string, unknown> | null
    [k: string]: unknown
  },
  opts?: { kind?: 'node' | 'edge' },
): DetailRow[] {
  const props = (entity.props || {}) as Record<string, unknown>
  const rows: DetailRow[] = []
  const seen = new Set<string>()

  const push = (key: string, raw: unknown) => {
    if (seen.has(key)) return
    if (EVIDENCE_BAG_KEYS.has(key)) return
    if (isEmptyValue(raw)) return
    const value = formatPropValue(raw).trim()
    if (!value || value === '—' || value === '[]' || value === '{}') return
    seen.add(key)
    const href = singleHttpUrl(value)
    rows.push({ key, label: labelFor(key), value, href })
  }

  const isEdge =
    opts?.kind === 'edge' ||
    entity.rel != null ||
    (typeof entity.id === 'string' && String(entity.id).startsWith('e_')) ||
    (entity.source != null && entity.target != null && entity.name == null && entity.type == null)

  if (isEdge) {
    push('edge_id', entity.id)
    push('rel', entity.rel)
    push('source', entity.source)
    push('target', entity.target)
    push('kind', entity.kind)
    push('attribution_tier', entity.attribution_tier)
  } else {
    push('id', entity.id)
    push('name', entity.name)
    push('type', entity.type)
    push('kind', entity.kind || 'instance')
  }

  // Top-level fields on entity (beyond core), then props — never invent
  for (const [k, v] of Object.entries(entity)) {
    if (k === 'props' || k === 'id' || k === 'name' || k === 'type' || k === 'kind') continue
    if (k === 'rel' || k === 'source' || k === 'target' || k === 'attribution_tier') continue
    if (k === 'evidence_refs' || k === 'evidence_urls') continue
    push(k, v)
  }
  for (const [k, v] of Object.entries(props)) {
    push(k, v)
  }
  return rows
}

/** @deprecated prefer buildGenericDetailRows — kept for call-site compatibility */
export function nodeDetailRows(n: CanvasNode): Array<[string, string]> {
  return buildGenericDetailRows(n, { kind: 'node' }).map((r) => [r.label, r.value])
}

/** @deprecated prefer buildGenericDetailRows */
export function edgeDetailRows(e: CanvasEdge): Array<[string, string]> {
  return buildGenericDetailRows(e as Record<string, unknown>, { kind: 'edge' }).map((r) => [
    r.label,
    r.value,
  ])
}

export function extractEvidenceUrls(...sources: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (u: string) => {
    const s = String(u || '').trim()
    if (!s.startsWith('http://') && !s.startsWith('https://')) return
    if (seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  const walk = (v: unknown, depth = 0): void => {
    if (v == null || depth > 5) return
    if (typeof v === 'string') {
      add(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
      return
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.url === 'string') add(o.url)
      for (const key of EVIDENCE_BAG_KEYS) {
        if (key in o) walk(o[key], depth + 1)
      }
      if (depth === 0 && o.props && typeof o.props === 'object') {
        walk(o.props, depth + 1)
      }
      // top-level evidence_refs on edges
      if (depth === 0 && Array.isArray(o.evidence_refs)) walk(o.evidence_refs, depth + 1)
      if (depth === 0 && Array.isArray(o.evidence_urls)) walk(o.evidence_urls, depth + 1)
    }
  }
  for (const s of sources) walk(s, 0)
  return out
}

function shortUrlLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 28 ? `${u.pathname.slice(0, 26)}…` : u.pathname
    return `${u.host}${path === '/' ? '' : path}`
  } catch {
    return url.length > 48 ? `${url.slice(0, 46)}…` : url
  }
}

export function evidenceLinksHtml(urls: string[]): string {
  if (!urls.length) return ''
  const items = urls
    .map(
      (u) =>
        `<li><a href="${escapeText(u)}" target="_blank" rel="noopener noreferrer">${escapeText(
          shortUrlLabel(u),
        )}</a></li>`,
    )
    .join('')
  return `<div class="evidence-links" data-evidence-links style="margin-top:10px;padding-top:8px;border-top:1px dashed #ccc"><div style="color:#666;margin-bottom:4px">证据链接</div><ul style="margin:0;padding-left:1.1em;word-break:break-all">${items}</ul></div>`
}

export function rowsToDetailHtml(rows: DetailRow[] | Array<[string, string]>): string {
  const normalized: DetailRow[] = rows.map((r) =>
    Array.isArray(r)
      ? { key: r[0], label: r[0], value: r[1] }
      : r,
  )
  const dl = normalized
    .map((r) => {
      const body = r.href
        ? `<a href="${escapeText(r.href)}" target="_blank" rel="noopener noreferrer">${escapeText(
            r.value,
          )}</a>`
        : escapeText(r.value)
      return `<dt style="color:#666">${escapeText(r.label)}</dt><dd style="margin:0 0 6px;overflow-wrap:anywhere;word-break:break-word">${body}</dd>`
    })
    .join('')
  return `<dl style="margin:0;display:grid;grid-template-columns:minmax(72px,88px) 1fr;gap:2px 8px">${dl}</dl>`
}

export const HORIZON_ZH: Record<string, string> = {
  near: '近',
  mid: '中',
  long: '远',
}

export const SNIPPET_MAX = 48

export function isDimensionNode(n: {
  kind?: string
  type?: string
}): boolean {
  return n.kind === 'dimension' || n.type === 'Dimension'
}

/** Instance nodes whose props.dimension === dimId (skip center / Dimension). */
export function instancesForDimension(
  nodes: Array<{
    id: string
    kind?: string
    type?: string
    props?: Record<string, unknown> | null
    dimension?: string
  }>,
  dimId: string,
): CanvasNode[] {
  if (!dimId) return []
  return nodes.filter((n) => {
    if (isDimensionNode(n)) return false
    if (n.kind === 'center' || (n.props && n.props.role === 'center')) return false
    const d = (n.props && (n.props.dimension as string)) || n.dimension
    return d === dimId
  }) as CanvasNode[]
}

export function formatHorizonsZh(horizons: unknown): string {
  if (!Array.isArray(horizons) || !horizons.length) return ''
  const labels: string[] = []
  const seen = new Set<string>()
  for (const key of ['near', 'mid', 'long']) {
    const hit = horizons.some((h) => String(h).toLowerCase() === key)
    if (hit && !seen.has(key)) {
      seen.add(key)
      labels.push(HORIZON_ZH[key] || key)
    }
  }
  // unknown horizon keys (keep raw, de-dup)
  for (const h of horizons) {
    const k = String(h || '').toLowerCase()
    if (!k || seen.has(k) || HORIZON_ZH[k]) continue
    seen.add(k)
    labels.push(String(h))
  }
  return labels.join(' · ')
}

/** Keep instances whose props.horizons intersects selected horizon; null/empty = all. */
export function filterInstancesByHorizon<T extends { props?: Record<string, unknown> | null }>(
  instances: T[],
  horizon: string | null | undefined,
): T[] {
  if (!horizon || horizon === 'all') return instances
  const want = String(horizon).toLowerCase()
  return instances.filter((n) => {
    const hz = (n.props && n.props.horizons) as unknown
    if (!Array.isArray(hz) || !hz.length) return false
    return hz.some((h) => String(h).toLowerCase() === want)
  })
}

/** Colored 近/中/远 chips — SYNC Lab app.js horizonChipsHtml + HORIZON_STROKE. */
export function horizonChipsHtml(horizons: unknown): string {
  if (!Array.isArray(horizons) || !horizons.length) return ''
  const chips: string[] = []
  const seen = new Set<string>()
  for (const key of HORIZON_ORDER) {
    const hit = horizons.some((h) => String(h).toLowerCase() === key)
    if (!hit || seen.has(key)) continue
    seen.add(key)
    const color = HORIZON_STROKE[key as HorizonKey]
    const label = HORIZON_ZH[key] || key
    chips.push(
      `<span class="dim-hz-chip hz-${key}" data-horizon="${key}" style="color:${color};font-weight:600;letter-spacing:0.02em">${escapeText(label)}</span>`,
    )
  }
  for (const h of horizons) {
    const k = String(h || '').toLowerCase()
    if (!k || seen.has(k) || HORIZON_ZH[k]) continue
    seen.add(k)
    chips.push(
      `<span class="dim-hz-chip" data-horizon="${escapeText(k)}" style="color:#666;letter-spacing:0.02em">${escapeText(String(h))}</span>`,
    )
  }
  return chips.join('<span class="dim-hz-sep" style="color:#999"> · </span>')
}

export function truncateSnippet(s: string, max = SNIPPET_MAX): string {
  const t = String(s || '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1))}…`
}

export function instanceSnippet(n: {
  props?: Record<string, unknown> | null
}): string {
  const p = (n.props || {}) as Record<string, unknown>
  const raw = p.narrative || p.narrative_refined || p.desc || p.note || ''
  return truncateSnippet(String(raw))
}

/** List block under a dimension summary. */
export function buildDimInstanceListHtml(instances: CanvasNode[]): string {
  if (!instances.length) {
    return `<div class="dim-instance-list" data-dim-list style="margin-top:12px;padding-top:10px;border-top:1px dashed #ccc"><div class="dim-instance-empty" style="font-size:12px;color:#666;padding:6px 0">该维下暂无实例</div></div>`
  }
  const items = instances
    .map((n) => {
      const name = escapeText(n.name || n.id)
      const hzHtmlRaw = horizonChipsHtml(n.props && n.props.horizons)
      const snip = escapeText(instanceSnippet(n))
      const hzHtml = hzHtmlRaw
        ? `<span class="dim-instance-hz">${hzHtmlRaw}</span>`
        : ''
      const snipHtml = snip
        ? `<div class="dim-instance-snippet" style="font-size:11px;color:#444;line-height:1.4;overflow-wrap:anywhere">${snip}</div>`
        : ''
      return `<li class="dim-instance-row" data-dim-instance="${escapeText(
        n.id,
      )}" role="button" tabindex="0" style="border:1px solid #ddd;background:#fafafa;padding:7px 8px;margin-bottom:6px;cursor:pointer;border-radius:2px;list-style:none"><div class="dim-instance-name" style="font-weight:600;font-size:12px;margin-bottom:2px">${name}</div><div class="dim-instance-meta" style="font-size:11px;color:#666;margin-bottom:2px">${hzHtml}</div>${snipHtml}</li>`
    })
    .join('')
  return `<div class="dim-instance-list" data-dim-list style="margin-top:12px;padding-top:10px;border-top:1px dashed #ccc"><div class="dim-instance-list-title" style="font-size:11px;color:#666;margin-bottom:6px">该维对象（${instances.length}）</div><ul class="dim-instance-ul" style="list-style:none;margin:0;padding:0">${items}</ul></div>`
}

export function buildDimensionDetailHtml(
  dimNode: CanvasNode,
  instances: CanvasNode[],
  relatedEdges: CanvasEdge[] = [],
): string {
  const urls = extractEvidenceUrls(dimNode, ...relatedEdges)
  return (
    rowsToDetailHtml(buildGenericDetailRows(dimNode, { kind: 'node' })) +
    evidenceLinksHtml(urls) +
    buildDimInstanceListHtml(instances)
  )
}

export function buildInstanceDetailWithBackHtml(
  n: CanvasNode,
  relatedEdges: CanvasEdge[] = [],
): string {
  const back =
    '<button type="button" class="dim-back" data-back-dim style="font:inherit;font-size:12px;margin:0 0 10px;padding:4px 8px;border:1px solid #888;background:#fff;cursor:pointer">← 返回维度</button>'
  return back + buildNodeDetailHtml(n, relatedEdges)
}

export function buildNodeDetailHtml(n: CanvasNode, relatedEdges: CanvasEdge[] = []): string {
  const urls = extractEvidenceUrls(n, ...relatedEdges)
  return rowsToDetailHtml(buildGenericDetailRows(n, { kind: 'node' })) + evidenceLinksHtml(urls)
}

export function buildEdgeDetailHtml(e: CanvasEdge): string {
  const urls = extractEvidenceUrls(e)
  return (
    rowsToDetailHtml(buildGenericDetailRows(e as Record<string, unknown>, { kind: 'edge' })) +
    evidenceLinksHtml(urls)
  )
}

export interface DetailPaneProps {
  open: boolean
  detailHtml: string
  width: number
  onWidthChange: (w: number) => void
  detailHead: CSSProperties
  detailBody: CSSProperties
  chipBase: CSSProperties
  onClose: () => void
  /** Event delegation for dim instance rows / back link inside HTML body. */
  onDetailClick?: (ev: ReactMouseEvent<HTMLDivElement>) => void
}

export function DetailPane({
  open,
  detailHtml,
  width,
  onWidthChange,
  detailHead,
  detailBody,
  chipBase,
  onClose,
  onDetailClick,
}: DetailPaneProps): ReactNode {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(width)
  const widthRef = useRef(width)
  widthRef.current = width

  const onMove = useCallback(
    (ev: MouseEvent) => {
      if (!dragging.current) return
      const next = clampDetailWidth(startW.current + (startX.current - ev.clientX))
      onWidthChange(next)
    },
    [onWidthChange],
  )

  const onUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    writeStoredDetailWidth(widthRef.current)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onMove, onUp])

  if (!open) return null

  const detailCol: CSSProperties = {
    flex: `0 0 ${width}px`,
    width,
    maxWidth: '50%',
    borderLeft: '1px solid var(--dsw-alias-stroke-border, #ddd)',
    background: 'var(--dsw-alias-bg-elevated, #fff)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  }

  const handleStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
    cursor: 'col-resize',
    zIndex: 5,
    background: 'transparent',
  }

  return (
    <aside style={detailCol} data-influence-detail data-detail-width={width}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整详情宽度"
        title="拖动调整宽度"
        data-detail-resize
        style={handleStyle}
        onMouseDown={(ev) => {
          ev.preventDefault()
          dragging.current = true
          startX.current = ev.clientX
          startW.current = width
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
      />
      <div style={detailHead}>
        <span>选中详情</span>
        <button type="button" style={chipBase} onClick={onClose}>
          收起
        </button>
      </div>
      <div
        style={detailBody}
        data-detail-body
        onClick={onDetailClick}
        dangerouslySetInnerHTML={{
          __html: detailHtml || '<span style="color:#666">点节点或边，详情显示在这里</span>',
        }}
      />
    </aside>
  )
}
