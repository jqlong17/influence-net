/** Dimension + 近中远 filter chips. Horizon chip tints match graph colors. */
import type { CSSProperties, ReactNode } from 'react'
import { HORIZON_STROKE, type HorizonKey } from './horizon-color.ts'

export interface DimRow {
  id: string
  name?: string
}

export interface FilterBarProps {
  dims: DimRow[]
  dimension: string | null
  horizon: string | null
  horizonLabels: Record<string, string>
  filterBox: CSSProperties
  filterRow: CSSProperties
  filterTitle: CSSProperties
  chipsRow: CSSProperties
  chipStyle: (active: boolean) => CSSProperties
  onDimension: (id: string | null) => void
  onHorizon: (id: string | null) => void
}

const HZ_KEYS: HorizonKey[] = ['near', 'mid', 'long']

export function FilterBar({
  dims,
  dimension,
  horizon,
  horizonLabels,
  filterBox,
  filterRow,
  filterTitle,
  chipsRow,
  chipStyle,
  onDimension,
  onHorizon,
}: FilterBarProps): ReactNode {
  return (
    <div style={filterBox} data-influence-filters>
      <div style={filterRow}>
        <span style={filterTitle}>维度</span>
        <div style={chipsRow}>
          <button type="button" style={chipStyle(!dimension)} onClick={() => onDimension(null)}>
            全部
          </button>
          {dims.map((d) => (
            <button
              key={d.id}
              type="button"
              style={chipStyle(dimension === d.id)}
              onClick={() => onDimension(d.id)}
            >
              {d.name || d.id}
            </button>
          ))}
        </div>
      </div>
      <div style={{ ...filterRow, marginBottom: 0 }}>
        <span style={filterTitle}>近中远</span>
        <div style={chipsRow}>
          <button type="button" style={chipStyle(!horizon)} onClick={() => onHorizon(null)}>
            全部
          </button>
          {HZ_KEYS.map((h) => {
            const active = horizon === h
            const tint = HORIZON_STROKE[h]
            return (
              <button
                key={h}
                type="button"
                data-horizon-chip={h}
                style={{
                  ...chipStyle(active),
                  borderColor: tint,
                  color: active ? undefined : tint,
                  boxShadow: active ? `inset 0 -2px 0 ${tint}` : undefined,
                }}
                onClick={() => onHorizon(h)}
              >
                {horizonLabels[h] || h}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
