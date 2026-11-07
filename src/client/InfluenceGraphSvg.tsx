/**
 * Inline SVG radial graph (ported from Lab app.js renderGraph).
 * SYNC: keep layout / radii / stroke / 近中远 / selection neighborhood aligned with
 *   influence-net/app/static/app.js + styles.css (+ selection-focus.ts)
 * No iframe — mounts <svg data-influence-canvas> in the sidebar.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  HORIZON_STROKE,
  horizonFill,
  horizonStroke,
  primaryHorizon,
} from './horizon-color.ts'
import { layoutRadial, ringGeometry } from './layout-radial.ts'
import {
  DIM_OPACITY,
  edgeDisplayName,
  selectionFocus,
  truncateEdgeLabel,
} from './selection-focus.ts'

export interface CanvasNode {
  id: string
  name?: string
  type?: string
  kind?: string
  props?: Record<string, unknown>
}

export interface CanvasEdge {
  id?: string
  name?: string
  label?: string
  rel?: string
  kind?: string
  source?: string
  target?: string
  attribution_tier?: string
  evidence_refs?: unknown
  evidence_urls?: unknown
  props?: Record<string, unknown>
}

export interface InfluenceGraphSvgProps {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  selectedId: string | null
  onSelectNode: (node: CanvasNode) => void
  onSelectEdge: (edge: CanvasEdge) => void
  onClearSelection: () => void
}

const wrapStyle: CSSProperties = {
  position: 'relative',
  flex: '1 1 auto',
  minHeight: 160,
  height: '100%',
  width: '100%',
  overflow: 'hidden',
  background: '#fff',
}

const emptyStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#666',
  fontSize: 13,
  pointerEvents: 'none',
}

function isCenter(n: CanvasNode): boolean {
  return n.props?.role === 'center' || n.kind === 'center'
}

function isDim(n: CanvasNode): boolean {
  return n.kind === 'dimension' || n.type === 'Dimension'
}

export function InfluenceGraphSvg({
  nodes,
  edges,
  selectedId,
  onSelectNode,
  onSelectEdge,
  onClearSelection,
}: InfluenceGraphSvgProps): ReactNode {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const measure = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const width = Math.max(el.clientWidth || 0, 1)
    const height = Math.max(el.clientHeight || 0, 1)
    setSize((prev) =>
      Math.abs(prev.width - width) > 1 || Math.abs(prev.height - height) > 1
        ? { width, height }
        : prev,
    )
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, nodes.length])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  // Flex settle can be tiny on first paint — retry a few frames
  useEffect(() => {
    if (size.width >= 40 && size.height >= 40) return
    let frames = 0
    let id = 0
    const tick = () => {
      measure()
      frames += 1
      if (frames < 8) id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [size.width, size.height, measure])

  const width = Math.max(size.width, 1)
  const height = Math.max(size.height, 1)
  const ready = width >= 40 && height >= 40
  const pos = ready ? layoutRadial(nodes, width, height, edges) : {}
  const guides = ready ? ringGeometry(width, height) : null
  // SYNC: influence-net/app/static/app.js selectionFocus — dim non-neighbors, edge names on focus
  const focus = selectionFocus(selectedId, nodes, edges)

  return (
    <div ref={wrapRef} style={wrapStyle} data-influence-canvas-wrap>
      <svg
        data-influence-canvas
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: '100%' }}
        onClick={() => {
          if (selectedId) onClearSelection()
        }}
      >
        {ready &&
          guides &&
          guides.rings.map((ring) => (
            <g key={`ring-${ring.key}`} data-horizon-ring={ring.key} pointerEvents="none">
              <circle
                cx={guides.cx}
                cy={guides.cy}
                r={ring.r}
                fill="none"
                stroke={HORIZON_STROKE[ring.key]}
                strokeWidth={1}
                strokeDasharray="4 5"
                opacity={0.45}
              />
              <text
                x={guides.cx + ring.r}
                y={guides.cy - 4}
                textAnchor="start"
                fontSize={10}
                fill={HORIZON_STROKE[ring.key]}
                opacity={0.7}
                style={{ userSelect: 'none' }}
              >
                {ring.label}
              </text>
            </g>
          ))}
        {ready &&
          edges.map((e, i) => {
            const a = e.source ? pos[e.source] : undefined
            const b = e.target ? pos[e.target] : undefined
            if (!a || !b) return null
            const eid = String(e.id || `e${i}`)
            const hasNarrative = !!(e.props && e.props.narrative)
            const isAgg = e.kind === 'agg' || e.rel === 'aggregates'
            const selected = selectedId === eid
            const inFocus = !focus.active || focus.edgeIds.has(eid)
            const dimmed = focus.active && !inFocus
            const hz = primaryHorizon(e.props?.horizons)
            let stroke = horizonStroke(e.props?.horizons, '#999')
            let strokeWidth = 1
            if (hasNarrative) strokeWidth = 2
            if (isAgg) {
              stroke = hz ? stroke : '#888'
              strokeWidth = 1.5
            }
            if (selected || (focus.active && inFocus)) {
              stroke = selected ? '#246' : stroke
              strokeWidth = selected ? 2.5 : Math.max(strokeWidth, 1.75)
            }
            const showName = focus.active && inFocus
            const rawName = showName ? edgeDisplayName(e) : ''
            const name = rawName ? truncateEdgeLabel(rawName) : ''
            const mx = (a.x + b.x) / 2
            const my = (a.y + b.y) / 2
            return (
              <g
                key={eid}
                data-edge-id={eid}
                data-dimmed={dimmed ? '1' : undefined}
                data-horizon={hz || undefined}
                opacity={dimmed ? DIM_OPACITY : 0.85}
                style={{ cursor: 'pointer' }}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onSelectEdge({ ...e, id: eid })
                }}
              >
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
                {name ? (
                  <text
                    data-edge-name={eid}
                    x={mx}
                    y={my - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#333"
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {name}
                  </text>
                ) : null}
              </g>
            )
          })}
        {ready &&
          nodes.map((n) => {
            const p = pos[n.id]
            if (!p) return null
            const center = isCenter(n)
            const dim = isDim(n)
            const r = center ? 18 : dim ? 14 : 12
            const selected = selectedId === n.id
            const inFocus = !focus.active || focus.nodeIds.has(n.id)
            const dimmed = focus.active && !inFocus
            const hz = primaryHorizon(n.props?.horizons)
            let fill = horizonFill(n.props?.horizons, '#e8e8e8')
            let stroke = horizonStroke(n.props?.horizons, '#888')
            let strokeWidth = 1.5
            if (center) {
              fill = '#ddd'
              stroke = '#1a1a1a'
              strokeWidth = 2.5
            }
            if (dim) {
              fill = '#eef2f7'
              stroke = '#567'
            }
            if (selected) {
              fill = '#cde'
              stroke = '#246'
              strokeWidth = 2.5
            } else if (focus.active && inFocus) {
              strokeWidth = Math.max(strokeWidth, 2)
            }
            const countSuffix =
              dim && n.props ? ` (${String(n.props.object_count ?? 0)})` : ''
            const label = `${n.name || n.id}${countSuffix}`
            return (
              <g
                key={n.id}
                data-node-id={n.id}
                data-dimmed={dimmed ? '1' : undefined}
                data-horizon={hz || undefined}
                opacity={dimmed ? DIM_OPACITY : 1}
                style={{ cursor: 'pointer' }}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onSelectNode(n)
                }}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
                <text
                  x={p.x}
                  y={p.y + r + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#222"
                  style={{ userSelect: 'none' }}
                >
                  {label}
                </text>
              </g>
            )
          })}
      </svg>
      {nodes.length === 0 ? (
        <div style={emptyStyle}>无节点（检查滤镜或导入）</div>
      ) : null}
    </div>
  )
}
