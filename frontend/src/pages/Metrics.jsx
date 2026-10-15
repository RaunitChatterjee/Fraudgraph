import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { HBars, LineChart } from '../charts.jsx'
import { ErrorBox, Panel, Spinner } from '../lib.jsx'

const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`)

export default function Metrics() {
  const [m, setM] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api.metrics().then(setM).catch(setErr) }, [])
  if (err) return <ErrorBox error={err} />
  if (!m) return <Spinner label="Evaluating against injected ground truth" />
  if (!m.available) return <p className="text-muted">{m.reason}</p>
  const d = m.detection
  const th = 'px-3 py-2 text-left text-xs font-medium text-muted'
  const stat = (l, v) => (
    <div className="rounded-md bg-raised p-3"><div className="text-xs text-muted">{l}</div><div className="num mt-0.5 text-lg font-semibold">{v}</div></div>
  )
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-[28px] font-medium leading-tight">Evaluation</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Scored against the fraud rings injected into the synthetic dataset. The generator is far cleaner than real transaction data and the detector was tuned
          on it, so read this as a regression harness, not a claim about real-world accuracy.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Account detection at threshold ${d.threshold}`}>
          <div className="grid grid-cols-4 gap-2 p-4">
            {stat('Precision', pct(d.precision))}{stat('Recall', pct(d.recall))}{stat('F1', pct(d.f1))}{stat('False positives', d.false_positives)}
          </div>
          <div className="px-4 pb-4">
            <LineChart xs={d.curve.map((r) => r.threshold)} series={[
              { name: 'Precision', color: 'currentColor', values: d.curve.map((r) => r.precision) },
              { name: 'Recall', color: '#c8372d', values: d.curve.map((r) => r.recall) }]} yDomain={[0.5, 1.02]} />
            <div className="mt-1 flex gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-ink" />Precision</span>
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-crit" />Recall</span><span>by alert threshold</span>
            </div>
          </div>
        </Panel>
        <Panel title="False positives on legitimate high-volume accounts" sub="Merchants and payroll accounts look like mules to a naive detector">
          <div className="space-y-4 p-4">
            <HBars max={1} rows={Object.entries(m.false_positive_rate).map(([k, v]) => ({
              key: k, label: `${k.replaceAll('_', ' ')} (${v.flagged}/${v.accounts})`, value: v.rate, color: v.rate > 0 ? '#c8372d' : '#2f7a5f' }))}
              format={pct} />
            <p className="text-xs text-muted">Primary-typology label accuracy on injected mules: <b className="text-ink">{pct(m.typology.primary_label_accuracy)}</b></p>
          </div>
        </Panel>
        <Panel title="Per typology" sub="Recall = share of accounts with that true label that received it">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line"><th className={th}>Typology</th><th className={th}>Support</th><th className={th}>Predicted</th><th className={th}>Recall</th><th className={th}>Precision</th></tr></thead>
            <tbody>{m.typology.per_typology.map((t) => (
              <tr key={t.code} className="num border-b border-line/50 last:border-0"><td className="px-3 py-2">{t.name}</td><td className="px-3">{t.support}</td><td className="px-3">{t.predicted}</td><td className="px-3">{pct(t.recall)}</td><td className="px-3">{pct(t.precision)}</td></tr>))}</tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted">Tier-1 precision is low by design: downstream mules also receive large inflows and forward them fast, so they pick up the Tier-1 tag as a secondary label.</p>
        </Panel>
        <Panel title="Trace quality and speed">
          <dl className="grid grid-cols-2 gap-2 p-4 text-sm">
            {[['Complaints traced', m.trace.complaints_evaluated], ['Mean precision', pct(m.trace.mean_precision)], ['Mean recall', pct(m.trace.mean_recall)],
              ['Mean hop depth', m.trace.mean_hop_depth], ['Mean trace time', `${m.trace.mean_trace_ms} ms`], ['Mean money span', `${m.trace.mean_money_span_minutes} min`],
              ['Alert → case → report', m.workflow?.available ? `${m.workflow.total_ms} ms` : '-']].map(([l, v]) => (
              <div key={l} className="rounded-md bg-raised p-3"><dt className="text-xs text-muted">{l}</dt><dd className="num mt-0.5 font-semibold">{v}</dd></div>))}
          </dl>
        </Panel>
      </div>
    </div>
  )
}
