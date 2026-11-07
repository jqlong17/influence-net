/** 标的 dropdown for the influence panel topbar. */
import type { CSSProperties, ReactNode, RefObject } from 'react'

export interface NetRow {
  net_id: string
  name?: string
  title?: string
  ticker?: string
}

export function netLabel(n: NetRow): string {
  const name = n.name || n.title || n.net_id
  return n.ticker ? `${name} ${n.ticker}` : name
}

export interface NetPickerProps {
  pickerRef: RefObject<HTMLDivElement | null>
  nets: NetRow[]
  activeNetId: string
  activeLabel: string
  menuOpen: boolean
  switching: boolean
  chipBase: CSSProperties
  menuStyle: CSSProperties
  onToggle: () => void
  onActivate: (netId: string) => void
}

export function NetPicker({
  pickerRef,
  nets,
  activeNetId,
  activeLabel,
  menuOpen,
  switching,
  chipBase,
  menuStyle,
  onToggle,
  onActivate,
}: NetPickerProps): ReactNode {
  return (
    <div
      ref={pickerRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)' }}>标的</span>
      <button
        type="button"
        data-net-picker
        disabled={switching}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        onClick={(ev) => {
          ev.stopPropagation()
          if (!switching) onToggle()
        }}
        style={{
          ...chipBase,
          minWidth: 140,
          maxWidth: 200,
          textAlign: 'left',
          paddingRight: 22,
          position: 'relative',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {switching ? '切换中…' : activeLabel || '加载中…'}
        <span
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 11,
            color: '#666',
          }}
        >
          ▾
        </span>
      </button>
      {menuOpen ? (
        <ul style={menuStyle} role="listbox" data-net-menu>
          {nets.length === 0 ? (
            <li style={{ padding: '6px 12px', color: '#666' }}>暂无标的</li>
          ) : (
            nets.map((n) => (
              <li
                key={n.net_id}
                role="option"
                aria-selected={n.net_id === activeNetId}
                data-net-id={n.net_id}
                onClick={() => onActivate(n.net_id)}
                style={{
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontWeight: n.net_id === activeNetId ? 600 : 400,
                  background: n.net_id === activeNetId ? '#eee' : undefined,
                }}
              >
                {netLabel(n)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
