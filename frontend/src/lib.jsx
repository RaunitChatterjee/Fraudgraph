import { createContext, useContext } from 'react'

export const inr = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0)

export const compactInr = (v) => {
  v = v || 0
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(1)} K`
  return `₹${Math.round(v)}`
}

/** Timestamps ending in Z are real UTC instants (notes, freezes) -> shown in local time.
 *  Naive timestamps are synthetic wall-clock times -> shown exactly as stored. */
export const fmtTime = (s) => {
  if (!s) return '-'
  const utc = s.endsWith('Z')
  const d = new Date(utc ? s : s + 'Z')
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, ...(utc ? {} : { timeZone: 'UTC' }),
  })
}
export const fmtDay = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })

export const fmtDuration = (min) => {
  if (min == null) return '-'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h >= 48 ? `${(min / 1440).toFixed(1)} d` : m ? `${h} h ${m} m` : `${h} h`
}

export const PRIORITY_HEX = { Critical: '#f2545b', High: '#f08a3c', Medium: '#e5b53a', Low: '#7f8db0' }
export const STATUS_LABEL = { open: 'Open', investigating: 'Investigating', funds_frozen: 'Funds frozen', closed: 'Closed' }
export const STATUSES = Object.keys(STATUS_LABEL)
export const TACTIC_HEX = { Preparation: '#9b7bf0', Placement: '#4c9aff', Layering: '#e5b53a', Extraction: '#f2545b' }

export const TypoContext = createContext({})
export const useTypo = () => useContext(TypoContext)

export function TypoTag({ code, compact }) {
  const map = useTypo()
  const t = map[code]
  const color = t ? TACTIC_HEX[t.tactic] : '#7f8db0'
  return (
    <span title={t ? `${t.tid} ${t.name} (${t.tactic}): ${t.description}` : code}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2 py-0.5 text-[11px] leading-none whitespace-nowrap">
      <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span className="mono text-muted">{t ? t.tid : code}</span>{!compact && t && <span>{t.name}</span>}
    </span>
  )
}

export function PriorityBadge({ label, score }) {
  const c = PRIORITY_HEX[label] || PRIORITY_HEX.Low
  return (
    <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium" style={{ color: c, background: c + '1f' }}>
      {label}{score !== undefined && <span className="num opacity-80">{Math.round(score)}</span>}
    </span>
  )
}

export function ScoreBar({ value }) {
  const pct = Math.round((value || 0) * 100)
  const tone = value >= 0.8 ? '#f2545b' : value >= 0.5 ? '#f08a3c' : '#7f8db0'
  return (
    <div className="flex items-center gap-2" title={`Composite suspicion ${value?.toFixed?.(2)}`}>
      <div className="h-1.5 w-14 overflow-hidden rounded bg-raised"><div className="h-full" style={{ width: `${pct}%`, background: tone }} /></div>
      <span className="num w-8 text-xs text-muted">{value?.toFixed?.(2)}</span>
    </div>
  )
}

export function Panel({ title, sub, right, children, className = '', bodyClass = '' }) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div><h2 className="text-[13px] font-semibold">{title}</h2>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>{right}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export function Spinner({ label = 'Loading' }) {
  return <div className="p-6 text-sm text-muted" role="status">{label}…</div>
}

export function ErrorBox({ error }) {
  return error ? <div className="m-3 rounded border border-crit/50 bg-crit/10 p-2 text-sm text-crit" role="alert">{String(error.message || error)}</div> : null
}

const ICONS = {
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  queue: 'M4 6h16M4 12h16M4 18h10',
  matrix: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z',
  eval: 'M4 19V5m0 14h16M8 15l3-4 3 2 4-6',
  plus: 'M12 5v14M5 12h14',
  sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zm9 16-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5',
  freeze: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9',
  clock: 'M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
}
export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={ICONS[name]} /></svg>
  )
}
