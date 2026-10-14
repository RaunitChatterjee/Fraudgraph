import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { ErrorBox, Panel, PriorityBadge, ScoreBar, Spinner, STATUS_LABEL, STATUSES, TypoTag, compactInr, fmtTime, inr, useTypo } from '../lib.jsx'

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabnum">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  )
}

export default function Queue({ onOpenCase, presetTypology, refreshKey }) {
  const typoMap = useTypo()
  const [stats, setStats] = useState(null)
  const [tab, setTab] = useState('cases')
  const [cases, setCases] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [f, setF] = useState({ status: '', typology: presetTypology || '', priority: '', q: '' })
  const [err, setErr] = useState(null)

  useEffect(() => { if (presetTypology) { setF((x) => ({ ...x, typology: presetTypology })); setTab('alerts') } }, [presetTypology])
  useEffect(() => { api.stats().then(setStats).catch(setErr) }, [refreshKey])
  useEffect(() => {
    setErr(null)
    if (tab === 'cases') api.cases(f).then(setCases).catch(setErr)
    else api.alerts({ typology: f.typology, q: f.q, limit: 200 }).then(setAlerts).catch(setErr)
  }, [tab, f, refreshKey])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const sel = 'rounded border border-line bg-panel px-2 py-1.5 text-sm'

  return (
    <div className="space-y-3">
      {stats && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Open cases" value={(stats.cases_by_status.open || 0) + (stats.cases_by_status.investigating || 0)} sub={`${stats.cases_by_priority.Critical || 0} critical, ${stats.cases_by_priority.High || 0} high`} />
          <Stat label="Funds reported lost" value={compactInr(stats.amount_reported)} sub={`${stats.complaints} complaints`} />
          <Stat label="Funds frozen (simulated)" value={compactInr(stats.amount_frozen)} sub={`${stats.frozen_accounts} accounts`} />
          <Stat label="Accounts flagged" value={stats.flagged_accounts} sub={`of ${stats.accounts.toLocaleString('en-IN')}`} />
          <Stat label="Transactions" value={stats.transactions.toLocaleString('en-IN')} sub={`${stats.window_days}-day window`} />
          <Stat label="Data as of" value={fmtTime(stats.as_of).split(',')[0]} sub="synthetic dataset" />
        </div>
      )}

      <Panel
        title={tab === 'cases' ? 'Case queue (ranked by composite risk)' : 'Account alerts (ranked by suspicion)'}
        right={
          <div className="flex rounded border border-line text-xs overflow-hidden" role="tablist">
            {[['cases', 'Cases'], ['alerts', 'Account alerts']].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`px-3 py-1 ${tab === k ? 'bg-accent text-white' : 'bg-panel text-muted hover:text-ink'}`}>{l}</button>
            ))}
          </div>
        }>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <input className={`${sel} w-56`} placeholder="Search id, victim, category…" value={f.q} onChange={set('q')} aria-label="Search" />
          <select className={sel} value={f.typology} onChange={set('typology')} aria-label="Filter by typology">
            <option value="">All typologies</option>
            {Object.values(typoMap).map((t) => <option key={t.code} value={t.code}>{t.tid} {t.name}</option>)}
          </select>
          {tab === 'cases' && (
            <>
              <select className={sel} value={f.status} onChange={set('status')} aria-label="Filter by status">
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <select className={sel} value={f.priority} onChange={set('priority')} aria-label="Filter by priority">
                <option value="">All priorities</option>
                {['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </>
          )}
        </div>
        <ErrorBox error={err} />
        <div className="overflow-x-auto">
          {tab === 'cases' ? (
            !cases ? <Spinner /> : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted"><tr className="border-b border-line">
                  {['Priority', 'Case', 'Victim / category', 'Amount', 'Accounts', 'Typologies', 'Filed', 'Status'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id} tabIndex={0} onClick={() => onOpenCase(c.id)} onKeyDown={(e) => e.key === 'Enter' && onOpenCase(c.id)}
                      className="cursor-pointer border-b border-line/60 hover:bg-raised">
                      <td className="px-3 py-2"><PriorityBadge label={c.priority_label} score={c.priority_score} /></td>
                      <td className="px-3 py-2 font-mono text-xs">{c.id}<div className="text-muted">{c.complaint_id}</div></td>
                      <td className="px-3 py-2"><span className="font-mono text-xs">{c.victim_account}</span><div className="text-xs text-muted">{c.category}</div></td>
                      <td className="px-3 py-2 tabnum">{inr(c.amount)}<div className="text-xs text-muted">recoverable {compactInr(c.recoverable_amount)}</div></td>
                      <td className="px-3 py-2 tabnum">{c.accounts_traced}<div className="text-xs text-muted">{c.max_hop_depth} hops</div></td>
                      <td className="px-3 py-2"><div className="flex max-w-[260px] flex-wrap gap-1">{Object.keys(c.typology_counts).map((t) => <TypoTag key={t} code={t} compact />)}</div></td>
                      <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">{fmtTime(c.filed_at)}</td>
                      <td className="px-3 py-2 text-xs">{STATUS_LABEL[c.status]}</td>
                    </tr>
                  ))}
                  {!cases.length && <tr><td colSpan={8} className="p-6 text-center text-muted">No cases match these filters.</td></tr>}
                </tbody>
              </table>
            )
          ) : !alerts ? <Spinner /> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted"><tr className="border-b border-line">
                {['Score', 'Account', 'Holder / bank', 'Typologies', 'Why flagged', 'Case'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {alerts.items.map((a) => (
                  <tr key={a.account_id} className="border-b border-line/60 hover:bg-raised">
                    <td className="px-3 py-2"><ScoreBar value={a.score} /></td>
                    <td className="px-3 py-2 font-mono text-xs">{a.account_id}{a.status === 'frozen' && <span className="ml-1 text-[#a371f7]">frozen</span>}</td>
                    <td className="px-3 py-2">{a.holder_name}<div className="text-xs text-muted">{a.bank}</div></td>
                    <td className="px-3 py-2"><div className="flex max-w-[240px] flex-wrap gap-1">{a.labels.map((t) => <TypoTag key={t} code={t} compact />)}</div></td>
                    <td className="px-3 py-2 text-xs text-muted max-w-[320px]">{a.reason}</td>
                    <td className="px-3 py-2">
                      {a.case_ids.length ? a.case_ids.map((id) => (
                        <button key={id} onClick={() => onOpenCase(id)} className="mr-1 font-mono text-xs text-accent hover:underline">{id}</button>
                      )) : <span className="text-xs text-muted">no complaint yet</span>}
                    </td>
                  </tr>
                ))}
                {!alerts.items.length && <tr><td colSpan={6} className="p-6 text-center text-muted">No alerts.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {tab === 'alerts' && alerts && <div className="px-3 py-2 text-xs text-muted">{alerts.total} accounts at or above the alert threshold.</div>}
      </Panel>
    </div>
  )
}
