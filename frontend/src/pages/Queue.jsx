import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { ErrorBox, Panel, PriorityBadge, ScoreBar, Spinner, STATUS_LABEL, STATUSES, TypoTag, compactInr, fmtDuration, fmtTime, useTypo } from '../lib.jsx'

/** Where the reported money is: cashed out / still held / elsewhere (in transit or lost track of). */
function MoneyBar({ amount, cash, held }) {
  const a = Math.max(amount, 1)
  const c = Math.min(1, cash / a), h = Math.min(1 - c, held / a), o = Math.max(0, 1 - c - h)
  return (
    <div className="w-36" title={`Cashed out ${compactInr(cash)} · still held ${compactInr(held)} · elsewhere ${compactInr(o * a)}`}>
      <div className="flex h-2 overflow-hidden rounded bg-raised">
        <i style={{ width: `${c * 100}%`, background: '#d98e04' }} /><i style={{ width: `${h * 100}%`, background: '#2f7a5f' }} />
        <i style={{ width: `${o * 100}%`, background: '#a89f8e', opacity: 0.5 }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{compactInr(cash)} out</span><span>{compactInr(held)} held</span></div>
    </div>
  )
}

export default function Queue({ onOpenCase, onOpenAccount, presetTypology, refreshKey }) {
  const typoMap = useTypo()
  const [tab, setTab] = useState(presetTypology ? 'alerts' : 'cases')
  const [cases, setCases] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [f, setF] = useState({ status: '', typology: presetTypology || '', priority: '', q: '' })
  const [err, setErr] = useState(null)

  useEffect(() => { if (presetTypology) { setF((x) => ({ ...x, typology: presetTypology })); setTab('alerts') } }, [presetTypology])
  useEffect(() => {
    setErr(null)
    if (tab === 'cases') api.cases(f).then(setCases).catch(setErr)
    else api.alerts({ typology: f.typology, q: f.q, limit: 200 }).then(setAlerts).catch(setErr)
  }, [tab, f, refreshKey])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const sel = 'rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm'
  const th = 'px-4 py-2.5 text-left text-xs font-medium text-muted'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-medium leading-tight">Investigation queue</h1>
          <p className="text-sm text-muted">{tab === 'cases' ? 'Complaints ranked by composite risk. Open one to trace the money.' : 'Every account the detector flagged, whether or not a complaint exists yet.'}</p>
        </div>
        <div className="flex rounded-sm border border-line bg-panel p-0.5 text-sm" role="tablist">
          {[['cases', 'Cases'], ['alerts', 'Account alerts']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded px-3 py-1 ${tab === k ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}>{l}</button>
          ))}
        </div>
      </div>

      <Panel>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <input className={`${sel} w-64`} placeholder="Search id, victim, category…" value={f.q} onChange={set('q')} aria-label="Search" />
          <select className={sel} value={f.typology} onChange={set('typology')} aria-label="Filter by typology">
            <option value="">All typologies</option>
            {Object.values(typoMap).map((t) => <option key={t.code} value={t.code}>{t.tid} {t.name}</option>)}
          </select>
          {tab === 'cases' && (
            <>
              <select className={sel} value={f.status} onChange={set('status')} aria-label="Filter by status">
                <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <select className={sel} value={f.priority} onChange={set('priority')} aria-label="Filter by priority">
                <option value="">All priorities</option>{['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </>
          )}
        </div>
        <ErrorBox error={err} />
        <div className="overflow-x-auto">
          {tab === 'cases' ? (
            !cases ? <Spinner /> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line">
                  <th className={th}>Priority</th><th className={th}>Case</th><th className={th}>Victim</th><th className={th}>Where the money is</th>
                  <th className={th}>Network</th><th className={th}>Typologies</th><th className={th}>Complaint lag</th><th className={th}>Status</th>
                </tr></thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id} tabIndex={0} onClick={() => onOpenCase(c.id)} onKeyDown={(e) => e.key === 'Enter' && onOpenCase(c.id)}
                      className={`rail-priority-${c.priority_label} cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised`}>
                      <td className="px-4 py-3"><PriorityBadge label={c.priority_label} score={c.priority_score} /></td>
                      <td className="px-4 py-3"><div className="mono text-xs">{c.id}</div><div className="text-xs text-muted">{c.category}</div></td>
                      <td className="px-4 py-3"><div className="mono text-xs">{c.victim_account}</div><div className="num font-medium">{compactInr(c.amount)}</div></td>
                      <td className="px-4 py-3"><MoneyBar amount={c.amount} cash={c.cash_out_total} held={c.recoverable_amount} /></td>
                      <td className="num px-4 py-3">{c.accounts_traced}<span className="text-xs text-muted"> accts · {c.max_hop_depth} hops</span></td>
                      <td className="px-4 py-3"><div className="flex max-w-[230px] flex-wrap gap-1">{Object.keys(c.typology_counts).map((t) => <TypoTag key={t} code={t} compact />)}</div></td>
                      <td className="px-4 py-3 text-xs"><div className="num">{fmtDuration(c.report_delay_min)}</div><div className="text-muted">{fmtTime(c.filed_at)}</div></td>
                      <td className="px-4 py-3 text-xs">{STATUS_LABEL[c.status]}</td>
                    </tr>
                  ))}
                  {!cases.length && <tr><td colSpan={8} className="p-8 text-center text-muted">No cases match these filters.</td></tr>}
                </tbody>
              </table>
            )
          ) : !alerts ? <Spinner /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line">
                <th className={th}>Suspicion</th><th className={th}>Account</th><th className={th}>Holder</th><th className={th}>Typologies</th><th className={th}>Why flagged</th><th className={th}>Case</th>
              </tr></thead>
              <tbody>
                {alerts.items.map((a) => (
                  <tr key={a.account_id} onClick={() => onOpenAccount(a.account_id)} className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised">
                    <td className="px-4 py-2.5"><ScoreBar value={a.score} /></td>
                    <td className="px-4 py-2.5"><span className="mono text-xs">{a.account_id}</span>{a.status === 'frozen' && <span className="ml-2 rounded bg-frozen/20 px-1.5 py-0.5 text-[11px] text-frozen">frozen</span>}</td>
                    <td className="px-4 py-2.5">{a.holder_name}<div className="text-xs text-muted">{a.bank}</div></td>
                    <td className="px-4 py-2.5"><div className="flex max-w-[220px] flex-wrap gap-1">{a.labels.map((t) => <TypoTag key={t} code={t} compact />)}</div></td>
                    <td className="max-w-[320px] px-4 py-2.5 text-xs text-muted">{a.reason}</td>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {a.case_ids.length ? a.case_ids.map((id) => <button key={id} onClick={() => onOpenCase(id)} className="mono mr-1 text-xs text-accent hover:underline">{id}</button>)
                        : <span className="text-xs text-muted">no complaint yet</span>}
                    </td>
                  </tr>
                ))}
                {!alerts.items.length && <tr><td colSpan={6} className="p-8 text-center text-muted">No alerts.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {tab === 'alerts' && alerts && <div className="border-t border-line px-4 py-2 text-xs text-muted">{alerts.total} accounts at or above the alert threshold. Click a row for the full analysis.</div>}
      </Panel>
    </div>
  )
}
