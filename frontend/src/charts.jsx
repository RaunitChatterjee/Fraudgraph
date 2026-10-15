import { useMemo } from 'react'
import * as d3 from 'd3'
import { PRIORITY_HEX, fmtDay } from './lib.jsx'

export function Sparkline({ data, w = 90, h = 26, color = 'currentColor' }) {
  if (!data?.length) return null
  const x = d3.scaleLinear([0, data.length - 1], [2, w - 2])
  const y = d3.scaleLinear([0, d3.max(data) || 1], [h - 2, 2])
  const line = d3.line().x((_, i) => x(i)).y((d) => y(d)).curve(d3.curveMonotoneX)
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={line(data)} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  )
}

export function HBars({ rows, max, format = (v) => v, onPick }) {
  const m = max || Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key || r.label}>
          <button onClick={() => onPick?.(r)} disabled={!onPick}
            className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-left disabled:cursor-default">
            <span className="truncate text-[13px]">{r.label}</span>
            <span className="num text-xs text-muted">{format(r.value)}</span>
            <span className="col-span-2 mt-1 block h-1.5 overflow-hidden rounded-[1px] bg-raised">
              <span className="block h-full transition-[width]" style={{ width: `${(r.value / m) * 100}%`, background: r.color || 'rgb(var(--ink))' }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Donut({ parts, size = 132, center }) {
  const total = d3.sum(parts, (p) => p.value) || 1
  const arcs = d3.pie().sort(null).value((d) => d.value).padAngle(0.025)(parts)
  const arc = d3.arc().innerRadius(size / 2 - 15).outerRadius(size / 2 - 2).cornerRadius(2)
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} role="img"
      aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
      {arcs.map((a, i) => <path key={i} d={arc(a)} fill={parts[i].color} />)}
      <text textAnchor="middle" dy="0.1em" className="num" fontSize="22" fontWeight="600" fill="currentColor">{center ?? total}</text>
    </svg>
  )
}

/** Responsive area chart for a daily series. data: [{day, value}] */
export function AreaChart({ data, color = 'currentColor', format = (v) => v, height = 150, highlightLast }) {
  const W = 640
  const m = { t: 10, r: 8, b: 22, l: 40 }
  const { x, y, area, line, ticks } = useMemo(() => {
    const x = d3.scalePoint(data.map((d) => d.day), [m.l, W - m.r]).padding(0.1)
    const y = d3.scaleLinear([0, d3.max(data, (d) => d.value) || 1], [height - m.b, m.t]).nice()
    const area = d3.area().x((d) => x(d.day)).y0(height - m.b).y1((d) => y(d.value)).curve(d3.curveMonotoneX)(data)
    const line = d3.line().x((d) => x(d.day)).y((d) => y(d.value)).curve(d3.curveMonotoneX)(data)
    return { x, y, area, line, ticks: y.ticks(3) }
  }, [data, height])
  const labelEvery = Math.ceil(data.length / 7)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Daily series chart">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity="0.12" />
          <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.6">{format(t)}</text>
        </g>
      ))}
      <path d={area} fill={color} fillOpacity="0.16" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" />
      {data.map((d, i) => (
        <g key={d.day}>
          {i % labelEvery === 0 && (
            <text x={x(d.day)} y={height - 6} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.6">{fmtDay(d.day)}</text>
          )}
          {d.value > 0 && <circle cx={x(d.day)} cy={y(d.value)} r="2.6" fill={color}><title>{`${fmtDay(d.day)}: ${format(d.value)}`}</title></circle>}
        </g>
      ))}
    </svg>
  )
}

/** Multi-series line chart over a numeric x (used for the precision/recall sweep). */
export function LineChart({ series, xs, height = 170, yDomain = [0, 1] }) {
  const W = 520
  const m = { t: 10, r: 10, b: 24, l: 36 }
  const x = d3.scaleLinear(d3.extent(xs), [m.l, W - m.r])
  const y = d3.scaleLinear(yDomain, [height - m.b, m.t])
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Line chart">
      {y.ticks(4).map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity="0.12" />
          <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.6">{Math.round(t * 100)}%</text>
        </g>
      ))}
      {xs.map((v) => <text key={v} x={x(v)} y={height - 6} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.6">{v}</text>)}
      {series.map((s) => (
        <g key={s.name}>
          <path d={d3.line().x((_, i) => x(xs[i])).y((d) => y(d))(s.values)} fill="none" stroke={s.color} strokeWidth="2" />
          {s.values.map((v, i) => <circle key={i} cx={x(xs[i])} cy={y(v)} r="3" fill={s.color}><title>{`${s.name} @ ${xs[i]}: ${(v * 100).toFixed(1)}%`}</title></circle>)}
        </g>
      ))}
    </svg>
  )
}

export const PRIORITY_PARTS = (p) => ['Critical', 'High', 'Medium', 'Low'].map((k) => ({ label: k, value: p?.[k] || 0, color: PRIORITY_HEX[k] }))
