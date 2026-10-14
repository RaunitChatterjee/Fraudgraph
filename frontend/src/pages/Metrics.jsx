import { useEffect, useState } from 'react'
import { api } from '../api.js'
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
  const th = 'px-2 py-1.5 text-left font-medium text-muted'
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold">Evaluation</h1>
        <p className="max-w-3xl text-sm text-muted">Measured against the fraud rings injected into the synthetic dataset. The generator is far cleaner than real
          transaction data, so treat these as a regression harness, not a real-world accuracy claim.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title={`Account detection @ threshold ${d.threshold}`}>
          <div className="grid grid-cols-4 gap-2 p-3 text-center">
            {[['Precision', pct(d.precision)], ['Recall', pct(d.recall)], ['F1', pct(d.f1)], ['False positives', d.false_positives]].map(([l, v]) => (
              <div key={l} className="rounded bg-raised p-2"><div className="text-xs text-muted">{l}</div><div className="text-lg font-semibold tabnum">{v}</div></div>))}
          </div>
          <table className="w-full text-sm"><thead><tr className="border-y border-line"><th className={th}>Threshold</th><th className={th}>Flagged</th><th className={th}>Precision</th><th className={th}>Recall</th></tr></thead>
            <tbody>{d.curve.map((r) => <tr key={r.threshold} className="border-b border-line/50 tabnum"><td className="px-2 py-1">{r.threshold}</td><td className="px-2">{r.flagged}</td><td className="px-2">{pct(r.precision)}</td><td className="px-2">{pct(r.recall)}</td></tr>)}</tbody></table>
        </Panel>
        <Panel title="False positives on legitimate high-volume accounts">
          <table className="w-full text-sm"><thead><tr className="border-b border-line"><th className={th}>Group</th><th className={th}>Accounts</th><th className={th}>Flagged</th><th className={th}>Rate</th></tr></thead>
            <tbody>{Object.entries(m.false_positive_rate).map(([k, v]) => <tr key={k} className="border-b border-line/50 tabnum"><td className="px-2 py-1.5">{k.replaceAll('_', ' ')}</td><td className="px-2">{v.accounts}</td><td className="px-2">{v.flagged}</td><td className="px-2">{pct(v.rate)}</td></tr>)}</tbody></table>
          <p className="p-3 text-xs text-muted">Primary-typology label accuracy on injected mules: {pct(m.typology.primary_label_accuracy)}</p>
        </Panel>
        <Panel title="Per-typology">
          <table className="w-full text-sm"><thead><tr className="border-b border-line"><th className={th}>Typology</th><th className={th}>Support</th><th className={th}>Predicted</th><th className={th}>Recall</th><th className={th}>Precision</th></tr></thead>
            <tbody>{m.typology.per_typology.map((t) => <tr key={t.code} className="border-b border-line/50 tabnum"><td className="px-2 py-1.5">{t.name}</td><td className="px-2">{t.support}</td><td className="px-2">{t.predicted}</td><td className="px-2">{pct(t.recall)}</td><td className="px-2">{pct(t.precision)}</td></tr>)}</tbody></table>
          <p className="p-3 text-xs text-muted">Tier-1 precision is low by design of the composite: downstream mules also receive large inflows and forward them quickly, so they pick up the Tier-1 label as a secondary tag.</p>
        </Panel>
        <Panel title="Trace quality and speed">
          <dl className="grid grid-cols-2 gap-2 p-3 text-sm tabnum">
            {[['Complaints traced', m.trace.complaints_evaluated], ['Mean precision', pct(m.trace.mean_precision)], ['Mean recall', pct(m.trace.mean_recall)],
              ['Mean hop depth', m.trace.mean_hop_depth], ['Mean trace time', `${m.trace.mean_trace_ms} ms`], ['Mean money span', `${m.trace.mean_money_span_minutes} min`],
              ['Alert → case → report', m.workflow?.available ? `${m.workflow.total_ms} ms (${m.workflow.interactions} interactions)` : '-']].map(([l, v]) => (
              <div key={l} className="rounded bg-raised p-2"><dt className="text-xs text-muted">{l}</dt><dd className="font-semibold">{v}</dd></div>))}
          </dl>
        </Panel>
      </div>
    </div>
  )
}
