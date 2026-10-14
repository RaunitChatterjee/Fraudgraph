import { createContext, useContext } from 'react'

export const inr = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0)

export const compactInr = (v) => {
  v = v || 0
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  return inr(v)
}

export const fmtTime = (s) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-')

export const PRIORITY = {
  Critical: 'text-crit border-crit/50 bg-crit/10',
  High: 'text-high border-high/50 bg-high/10',
  Medium: 'text-med border-med/50 bg-med/10',
  Low: 'text-muted border-line bg-raised',
}

export const STATUS_LABEL = { open: 'Open', investigating: 'Investigating', funds_frozen: 'Funds frozen', closed: 'Closed' }
export const STATUSES = Object.keys(STATUS_LABEL)

export const TACTIC_TONE = {
  Preparation: 'border-l-[#a371f7]', Placement: 'border-l-[#2f81f7]',
  Layering: 'border-l-[#d29922]', Extraction: 'border-l-[#f85149]',
}

export const TypoContext = createContext({})
export const useTypo = () => useContext(TypoContext)

export function TypoTag({ code, compact }) {
  const map = useTypo()
  const t = map[code]
  return (
    <span title={t ? `${t.tid} ${t.name}: ${t.description}` : code}
      className="inline-flex items-center rounded border border-line bg-raised px-1.5 py-0.5 text-[11px] leading-none text-ink whitespace-nowrap">
      <span className="font-mono text-muted mr-1">{t ? t.tid : code}</span>{!compact && t ? t.name : ''}
    </span>
  )
}

export function PriorityBadge({ label, score }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium ${PRIORITY[label] || PRIORITY.Low}`}>
      {label}{score !== undefined && <span className="tabnum opacity-80">{Math.round(score)}</span>}
    </span>
  )
}

export function ScoreBar({ value }) {
  const pct = Math.round((value || 0) * 100)
  const tone = value >= 0.8 ? 'bg-crit' : value >= 0.5 ? 'bg-high' : 'bg-low'
  return (
    <div className="flex items-center gap-2" title={`Composite suspicion ${value?.toFixed?.(2)}`}>
      <div className="h-1.5 w-14 rounded bg-raised overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      <span className="tabnum text-xs text-muted w-7">{value?.toFixed?.(2)}</span>
    </div>
  )
}

export function Panel({ title, right, children, className = '' }) {
  return (
    <section className={`rounded-md border border-line bg-panel ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <h2 className="text-sm font-semibold">{title}</h2>{right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Spinner({ label = 'Loading' }) {
  return <div className="p-6 text-sm text-muted" role="status">{label}…</div>
}

export function ErrorBox({ error }) {
  return error ? <div className="m-3 rounded border border-crit/50 bg-crit/10 p-2 text-sm text-crit" role="alert">{String(error.message || error)}</div> : null
}
