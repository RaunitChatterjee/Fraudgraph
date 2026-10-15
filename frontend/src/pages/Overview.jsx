import { useEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import { api } from '../api.js'
import { AreaChart, Donut, HBars, PRIORITY_PARTS, Sparkline } from '../charts.jsx'
import { ErrorBox, Panel, PriorityBadge, Spinner, PRIORITY_HEX, TACTIC_HEX, compactInr, fmtDuration, fmtTime, inr } from '../lib.jsx'

/** Per case: how long the money kept moving vs how long the victim took to complain. */
function LagPlot({ lag, onOpenCase }) {
  const W = 900, labelW = 92, rowH = 21, top = 26, bottom = 28
  const rows = lag.filter((l) => l.report_delay_min != null)
  const H = top + rows.length * rowH + bottom
  const maxV = Math.max(120, d3.max(rows, (r) => Math.max(r.report_delay_min, r.money_span_minutes)) * 1.1)
  const x = d3.scaleLog([10, maxV], [labelW, W - 20]).clamp(true)
  const ticks = [15, 60, 360, 1440, 2880].filter((t) => t <= maxV)
  const lab = (t) => (t < 60 ? `${t}m` : t < 1440 ? `${t / 60}h` : `${t / 1440}d`)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label="For each case, time until funds were fully cashed out versus time until the complaint was filed">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - bottom} stroke="currentColor" strokeOpacity={t === 60 ? 0.0 : 0.09} />
          <text x={x(t)} y={H - 10} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.6">{lab(t)}</text>
        </g>
      ))}
      <rect x={x(10)} y={top - 6} width={x(60) - x(10)} height={H - bottom - top + 6} fill="#d98e04" fillOpacity="0.15" />
      <text x={(x(10) + x(60)) / 2} y={top - 12} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#a86b00">golden hour</text>
      {rows.map((r, i) => {
        const y = top + i * rowH + rowH / 2
        const gone = r.gone_before_filing
        return (
          <g key={r.case_id} onClick={() => onOpenCase(r.case_id)} style={{ cursor: 'pointer' }}>
            <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
            <circle cx={7} cy={y} r="3.5" fill={PRIORITY_HEX[r.priority]} />
            <text x={18} y={y} dy="0.33em" fontSize="10.5" className="mono" fill="currentColor">{r.case_id}</text>
            <line x1={x(10)} x2={x(10)} y1={y} y2={y} />
            <rect x={x(10)} y={y - 3} width={Math.max(2, x(Math.max(10, r.money_span_minutes)) - x(10))} height="6" rx="1" fill="currentColor" fillOpacity="0.8">
              <title>{`Funds fully cashed out ${fmtDuration(r.money_span_minutes)} after the transfer`}</title>
            </rect>
            <path d={`M ${x(r.report_delay_min)} ${y - 6} l 6 6 l -6 6 l -6 -6 z`} fill={gone ? '#c8372d' : '#2f7a5f'}>
              <title>{`Complaint filed ${fmtDuration(r.report_delay_min)} after the transfer${gone ? ': money already gone' : ''}`}</title>
            </path>
          </g>
        )
      })}
    </svg>
  )
}

function Kpi({ label, value, sub, spark, color }) {
  return (
    <div className="flex items-end justify-between gap-3 border-r border-line px-4 py-3 last:border-r-0">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="num font-display mt-0.5 text-[26px] font-medium leading-tight">{value}</div>
        {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
      </div>
      {spark && <Sparkline data={spark} color={color} />}
    </div>
  )
}

export default function Overview({ onOpenCase, refreshKey }) {
  const [ov, setOv] = useState(null)
  const [stats, setStats] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    api.overview().then(setOv).catch(setErr)
    api.stats().then(setStats).catch(setErr)
  }, [refreshKey])

  const med = useMemo(() => {
    if (!ov) return null
    const d = ov.lag.map((l) => l.report_delay_min).filter((v) => v != null)
    const s = ov.lag.map((l) => l.money_span_minutes)
    return { delay: d3.median(d), span: d3.median(s) }
  }, [ov])

  if (err) return <ErrorBox error={err} />
  if (!ov || !stats) return <Spinner />
  const open = (stats.cases_by_status.open || 0) + (stats.cases_by_status.investigating || 0)
  const daily = ov.complaints_by_day

  return (
    <div className="space-y-4">
      <Panel bodyClass="p-5 md:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div>
            <p className="font-display text-[30px] font-medium leading-[1.15]">
              In {ov.gone_before_filing} of {ov.total_cases} cases the money was already cashed out before the complaint was filed.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Typical complaint lag is <b className="text-ink">{fmtDuration(med.delay)}</b> after the transfer; the typical mule chain finishes
              cashing out in <b className="text-ink">{fmtDuration(med.span)}</b>. Tracing has to start from the first complaint and run in seconds,
              not hop by hop through bank statements.
            </p>
            <div className="mt-4 space-y-1.5 text-xs text-muted">
              <div className="flex items-center gap-2"><i className="inline-block h-1.5 w-8 bg-ink" />time until funds fully cashed out</div>
              <div className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rotate-45 bg-crit" />complaint filed after cash-out (money gone)</div>
              <div className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rotate-45 bg-ok" />complaint filed while funds still moving</div>
            </div>
          </div>
          <div className="max-h-[430px] overflow-y-auto pr-1"><LagPlot lag={ov.lag} onOpenCase={onOpenCase} /></div>
        </div>
      </Panel>

      <div className="grid overflow-hidden rounded-lg border border-line bg-panel sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Open cases" value={open} sub={`${ov.priority.Critical} critical · ${ov.priority.High} high`} />
        <Kpi label="Reported lost" value={compactInr(ov.totals.reported)} sub={`${stats.complaints} complaints`}
          spark={daily.map((d) => d.amount)} color="#c8372d" />
        <Kpi label="Cash-out detected" value={compactInr(ov.totals.cash_out)} sub="across traced chains" />
        <Kpi label="Still in mule accounts" value={compactInr(ov.totals.recoverable)} sub={`${compactInr(stats.amount_frozen)} frozen so far`} />
        <Kpi label="Accounts flagged" value={stats.flagged_accounts} sub={`of ${stats.accounts.toLocaleString('en-IN')} · ${stats.transactions.toLocaleString('en-IN')} txns`}
          spark={ov.volume_by_day.map((d) => d.count)} color="currentColor" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Reported fraud per day" sub="Amount in complaints filed, last 21 days">
          <div className="p-4"><AreaChart data={daily.map((d) => ({ day: d.day, value: d.amount }))} color="#c8372d" format={compactInr} /></div>
        </Panel>
        <Panel title="Case priority" sub="Composite of amount, centrality, recency and detection confidence">
          <div className="flex items-center gap-5 p-4">
            <Donut parts={PRIORITY_PARTS(ov.priority)} center={ov.total_cases} />
            <ul className="space-y-1.5 text-[13px]">
              {PRIORITY_PARTS(ov.priority).map((p) => (
                <li key={p.label} className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
                  <span className="w-16">{p.label}</span><span className="num text-muted">{p.value}</span></li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Highest-priority cases" right={<span className="text-xs text-muted">click to investigate</span>} bodyClass="divide-y divide-line">
          {ov.top_cases.map((c) => (
            <button key={c.id} onClick={() => onOpenCase(c.id)} className={`rail-priority-${c.priority_label} flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-raised`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="mono text-xs">{c.id}</span><PriorityBadge label={c.priority_label} score={c.priority_score} /></div>
                <div className="mt-0.5 truncate text-xs text-muted">{c.category} · {c.accounts_traced} accounts · {c.max_hop_depth} hops · filed {fmtTime(c.filed_at)}</div>
              </div>
              <div className="num text-sm font-medium">{inr(c.amount)}</div>
            </button>
          ))}
        </Panel>
        <Panel title="Flagged accounts by typology" sub="Accounts at or above the alert threshold">
          <div className="p-4">
            <HBars rows={[...ov.typologies].sort((a, b) => b.flagged - a.flagged).map((t) => ({ key: t.code, label: `${t.tid}  ${t.name}`, value: t.flagged, color: TACTIC_HEX[t.tactic] }))} />
          </div>
        </Panel>
      </div>
    </div>
  )
}
