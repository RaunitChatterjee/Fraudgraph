import { useMemo } from 'react'
import * as d3 from 'd3'
import { fmtDuration, inr } from './lib.jsx'
import { nodeColor } from './Graph.jsx'

const mins = (ts, origin) => (Date.parse(ts + 'Z') - Date.parse(origin + 'Z')) / 60000

/**
 * Swim-lane view of how the money moved over time: one lane per account, minutes since the
 * victim's transfer on the x axis. The first 60 minutes ("golden hour") are shaded: that is the
 * window in which a freeze request can still catch funds.
 */
export default function FlowTimeline({ nodes, edges, originTs, filedAt, selectedId, onSelect }) {
  const model = useMemo(() => {
    if (!originTs) return null
    const lanes = nodes.filter((n) => n.role === 'victim' || n.role === 'mule' || n.role === 'boundary')
      .sort((a, b) => a.hop - b.hop || (a.first_in || 0) - (b.first_in || 0))
    const idx = new Map(lanes.map((n, i) => [n.id, i]))
    const ev = edges.map((e) => ({ ...e, t: Math.max(0, mins(e.ts, originTs)) }))
    const maxT = Math.max(75, ...ev.map((e) => e.t))
    const filed = filedAt ? mins(filedAt, originTs) : null
    return { lanes, idx, ev, maxT, filed }
  }, [nodes, edges, originTs, filedAt])
  if (!model) return null
  const { lanes, idx, ev, maxT, filed } = model

  const W = 1000, labelW = 108, rowH = 22, top = 30, bottom = 26
  const H = top + lanes.length * rowH + bottom
  const domainMax = filed != null && filed < maxT * 2.2 ? Math.max(maxT, filed) : maxT
  const x = d3.scaleLinear([0, domainMax * 1.04], [labelW, W - 16])
  const r = d3.scaleSqrt([0, d3.max(ev, (e) => e.amount) || 1], [2.5, 8])
  const ticks = x.ticks(7)
  const laneY = (id) => top + idx.get(id) * rowH + rowH / 2

  return (
    <div className="max-h-[420px] overflow-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 720 }} role="img"
        aria-label="Timeline of fund movement per account, minutes since the original transfer">
        <rect x={x(0)} y={top - 8} width={x(60) - x(0)} height={H - top - bottom + 8} fill="rgb(var(--gold))" fillOpacity="0.1" />
        <text x={(x(0) + x(60)) / 2} y={top - 14} textAnchor="middle" fontSize="10.5" fill="rgb(var(--gold))" fontWeight="600">golden hour</text>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 8} y2={H - bottom} stroke="currentColor" strokeOpacity="0.08" />
            <text x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.6">{t === 0 ? 'transfer' : fmtDuration(t)}</text>
          </g>
        ))}
        {filed != null && filed <= domainMax * 1.04 && (
          <g>
            <line x1={x(filed)} x2={x(filed)} y1={top - 8} y2={H - bottom} stroke="#f2545b" strokeDasharray="4 3" />
            <text x={x(filed)} y={top - 14} textAnchor="middle" fontSize="10.5" fill="#f2545b" fontWeight="600">complaint filed</text>
          </g>
        )}
        {lanes.map((n, i) => (
          <g key={n.id} onClick={() => onSelect?.(n.id)} style={{ cursor: 'pointer' }}>
            <rect x={0} y={top + i * rowH} width={W} height={rowH} fill={n.id === selectedId ? 'rgb(var(--accent))' : 'transparent'} fillOpacity="0.12" />
            <line x1={labelW} x2={W - 16} y1={laneY(n.id)} y2={laneY(n.id)} stroke="currentColor" strokeOpacity="0.1" />
            <circle cx={10} cy={laneY(n.id)} r="4" fill={nodeColor(n)} />
            <text x={20} y={laneY(n.id)} dy="0.32em" fontSize="10.5" className="mono" fill="currentColor">{n.id.slice(-7)}</text>
            <text x={labelW - 8} y={laneY(n.id)} dy="0.32em" textAnchor="end" fontSize="9.5" fill="currentColor" fillOpacity="0.55">
              {n.role === 'victim' ? 'victim' : `hop ${n.hop}`}
            </text>
          </g>
        ))}
        {ev.map((e, i) => {
          const sy = idx.has(e.src) ? laneY(e.src) : null
          if (sy == null) return null
          if (e.kind === 'withdrawal') {
            const s = r(e.amount)
            return (
              <rect key={i} x={x(e.t) - s} y={sy - s} width={s * 2} height={s * 2} fill="#f5a524" fillOpacity="0.9" transform={`rotate(45 ${x(e.t)} ${sy})`}>
                <title>{`Cash withdrawal ${inr(e.amount)} at +${fmtDuration(e.t)}`}</title>
              </rect>
            )
          }
          const dy = idx.has(e.dst) ? laneY(e.dst) : null
          return (
            <g key={i}>
              {dy != null && <line x1={x(e.t)} x2={x(e.t)} y1={sy} y2={dy} stroke={e.loop ? '#f2545b' : '#7f8db0'} strokeOpacity="0.5" />}
              <circle cx={x(e.t)} cy={sy} r={r(e.amount)} fill="#4c9aff" fillOpacity="0.75" stroke="rgb(14 22 40)" strokeWidth="0.8">
                <title>{`${inr(e.amount)} ${e.src.slice(-6)} to ${e.dst.slice(-6)} at +${fmtDuration(e.t)}`}</title>
              </circle>
              {dy != null && <circle cx={x(e.t)} cy={dy} r={2.4} fill="#4c9aff" />}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
