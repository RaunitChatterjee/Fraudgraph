import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import FlowTimeline from '../FlowTimeline.jsx'
import Graph from '../Graph.jsx'
import { ErrorBox, Icon, Panel, PriorityBadge, ScoreBar, Spinner, STATUS_LABEL, STATUSES, TypoTag, compactInr, fmtDuration, fmtTime, inr } from '../lib.jsx'

export default function CaseView({ caseId, onBack, onChanged, onOpenAccount }) {
  const [c, setC] = useState(null)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)
  const [extra, setExtra] = useState({ nodes: [], edges: [] })
  const [tab, setTab] = useState('account')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api.case(caseId).then(setC).catch(setErr), [caseId])
  useEffect(() => { setC(null); setExtra({ nodes: [], edges: [] }); setSel(null); load() }, [load])

  const baseNodes = useMemo(() => (c ? c.analysis.nodes.map((n) => ({ ...n, label: n.holder_name })) : []), [c])
  const baseEdges = useMemo(() => (c ? c.analysis.edges.map((e) => ({ source: e.src, target: e.dst, amount: e.amount, loop: e.loop })) : []), [c])
  const nodes = useMemo(() => [...baseNodes, ...extra.nodes], [baseNodes, extra])
  const edges = useMemo(() => [...baseEdges, ...extra.edges], [baseEdges, extra])
  const selected = nodes.find((n) => n.id === sel)

  const expand = async (id) => {
    if (id.startsWith('CASH:')) return
    try {
      const nb = await api.neighborhood(id, 1)
      const have = new Set(nodes.map((n) => n.id))
      const haveE = new Set(edges.map((e) => `${e.source}>${e.target}`))
      setExtra((x) => ({
        nodes: [...x.nodes, ...nb.nodes.filter((n) => !have.has(n.id)).map((n) => ({ ...n, role: 'neighbor' }))],
        edges: [...x.edges, ...nb.edges.filter((e) => !haveE.has(`${e.src}>${e.dst}`)).map((e) => ({ source: e.src, target: e.dst, amount: e.total }))],
      }))
    } catch (e) { setErr(e) }
  }

  const act = async (fn) => {
    setBusy(true); setErr(null)
    try { setC(await fn()); onChanged?.() } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  if (!c) return <div><button onClick={onBack} className="text-sm text-accent">← Queue</button><ErrorBox error={err} />{!err && <Spinner />}</div>
  const st = c.analysis.stats
  const cp = c.complaint
  const mules = c.analysis.nodes.filter((n) => n.role === 'mule').sort((a, b) => a.hop - b.hop || b.score - a.score)
  const heldAccts = mules.filter((n) => n.retained > 0 && n.status !== 'frozen').length
  const goneBefore = c.report_delay_min != null && c.report_delay_min > st.money_span_minutes
  const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="text-sm text-muted hover:text-ink">Investigation queue</button>
        <span className="text-muted">/</span>
        <h1 className="mono text-lg font-semibold">{c.id}</h1>
        <PriorityBadge label={c.priority_label} score={c.priority_score} />
        <select value={c.status} disabled={busy} onChange={(e) => act(() => api.updateCase(c.id, { status: e.target.value }))}
          className="rounded-md border border-line bg-panel px-2 py-1 text-sm" aria-label="Case status">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <a href={api.reportUrl(c.id)} className={`${btn} ml-auto`} download><Icon name="download" size={14} />Export PDF report</a>
      </div>
      <ErrorBox error={err} />

      <Panel bodyClass="grid gap-x-8 gap-y-3 p-4 text-[13px] md:grid-cols-2 xl:grid-cols-4">
        <div><div className="text-xs text-muted">Complaint</div><div className="font-medium">{cp.category}</div>
          <div className="text-xs text-muted">{inr(cp.amount)} from <span className="mono">{cp.victim_account}</span></div></div>
        <div><div className="text-xs text-muted">Reporting lag</div>
          <div className="font-medium">{fmtDuration(c.report_delay_min)} after the transfer</div>
          <div className={`text-xs ${goneBefore ? 'text-crit' : 'text-ok'}`}>{goneBefore ? 'Funds were fully cashed out before the complaint' : 'Complaint filed while funds were still moving'}</div></div>
        <div><div className="text-xs text-muted">Money trail</div><div className="font-medium">{st.accounts_traced} accounts, {st.max_hop_depth} hops, {fmtDuration(st.money_span_minutes)}</div>
          <div className="text-xs text-muted">{compactInr(st.cash_out_total)} cashed out{st.loops_detected ? ` · ${st.loops_detected} loop(s)` : ''}</div></div>
        <div><div className="text-xs text-muted">Still recoverable</div><div className="font-medium">{inr(st.recoverable_amount)}</div>
          <div className="text-xs text-muted">{heldAccts} account(s) holding funds · {inr(c.frozen_amount)} frozen</div></div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Panel title="Money trail" sub="Click an account for details, double-click to expand its neighbours, drag to pin" bodyClass="">
          <Graph nodes={nodes} edges={edges} selectedId={sel} onSelect={(id) => { setSel(id); setTab('account') }} onExpand={expand} height={500} />
        </Panel>

        <Panel
          right={
            <div className="flex rounded-md border border-line bg-bg/50 p-0.5 text-xs" role="tablist">
              {[['account', 'Account'], ['accounts', `All (${mules.length})`], ['timeline', 'Notes']].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`rounded px-2.5 py-1 ${tab === k ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}>{l}</button>
              ))}
            </div>
          }>
          <div className="max-h-[548px] overflow-y-auto p-4 text-sm">
            {tab === 'account' && (!selected ? (
              <div className="space-y-3 text-muted">
                <p>Select an account on the graph or timeline to see why it was flagged.</p>
                <p className="text-ink">{cp.description}</p>
                <p className="text-xs">Priority: {Object.entries(c.analysis.priority.components).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}</p>
                {c.linked_accounts.length > 0 && (
                  <div className="border-t border-line pt-3">
                    <div className="font-medium text-ink">Linked accounts off the money trail</div>
                    <p className="mb-1 text-xs">Opened alongside traced accounts with shared KYC device or address.</p>
                    {c.linked_accounts.slice(0, 8).map((a) => (
                      <button key={a.id} onClick={() => onOpenAccount(a.id)} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs hover:bg-raised">
                        <span className="mono">{a.id}</span><span>{a.via.split(' with')[0]} · {a.score.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div><div className="mono text-xs text-muted">{selected.id}</div>
                  <div className="text-base font-semibold">{selected.holder_name || selected.label}</div>
                  <div className="text-xs text-muted">{selected.bank} {selected.account_type && `· ${selected.account_type}`}{selected.status === 'frozen' && ' · frozen'}</div></div>
                {selected.score != null && <ScoreBar value={selected.score} />}
                <div className="flex flex-wrap gap-1">{(selected.typologies || selected.labels || []).map((t) => <TypoTag key={t} code={t} />)}</div>
                {selected.role === 'mule' && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {[['Hop', selected.hop], ['Received', inr(selected.inflow)], ['Forwarded', inr(selected.outflow)], ['Cash withdrawn', inr(selected.withdrawn)], ['Still held', inr(selected.retained)]].map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-line/50 py-1"><dt className="text-muted">{k}</dt><dd className="num">{v}</dd></div>
                    ))}
                  </dl>
                )}
                {selected.evidence?.length > 0 && (
                  <div><div className="mb-1 text-xs font-semibold">Why flagged</div>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-muted">{selected.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {!selected.id.startsWith('CASH:') && <button className={btn} onClick={() => onOpenAccount(selected.id)}>Full analysis</button>}
                  {!selected.id.startsWith('CASH:') && <button className={btn} onClick={() => expand(selected.id)}>Expand neighbours</button>}
                  {selected.role === 'mule' && selected.status !== 'frozen' && (
                    <button className={`${btn} border-crit/60 text-crit`} disabled={busy}
                      onClick={() => window.confirm(`Simulate freezing ${selected.id}? Est. ${inr(selected.retained)} held.`) && act(() => api.freeze(c.id, selected.id))}>
                      <Icon name="freeze" size={14} />Freeze (simulated)
                    </button>
                  )}
                </div>
              </div>
            ))}

            {tab === 'accounts' && (
              <table className="w-full text-xs">
                <thead className="text-left text-muted"><tr><th className="py-1 font-medium">Account</th><th className="font-medium">Hop</th><th className="font-medium">Score</th><th className="text-right font-medium">Held</th></tr></thead>
                <tbody>{mules.map((n) => (
                  <tr key={n.id} onClick={() => { setSel(n.id); setTab('account') }} className="cursor-pointer border-t border-line/60 hover:bg-raised">
                    <td className="mono py-1.5">{n.id.slice(-8)}{n.status === 'frozen' && <span className="ml-1 text-frozen">frozen</span>}</td><td>{n.hop}</td>
                    <td><ScoreBar value={n.score} /></td><td className="num text-right">{compactInr(n.retained)}</td>
                  </tr>))}</tbody>
              </table>
            )}

            {tab === 'timeline' && (
              <div className="space-y-4">
                <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) act(() => api.addNote(c.id, note)).then(() => setNote('')) }} className="space-y-2">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Investigator note…"
                    className="w-full rounded-md border border-line bg-bg p-2 text-sm" aria-label="Investigator note" />
                  <button className={btn} disabled={busy || !note.trim()}>Add note</button>
                </form>
                <ol className="space-y-3">
                  {[...c.events].reverse().map((e) => (
                    <li key={e.id} className="border-l-2 border-line pl-3 text-xs">
                      <div className="text-muted">{fmtTime(e.ts)} · {e.actor}</div>
                      <div>{e.kind === 'note' ? e.payload.text : e.kind === 'freeze' ? `Froze ${e.payload.account_id} (est. ${inr(e.payload.amount_frozen)} held)`
                        : e.kind === 'status' ? `Status: ${STATUS_LABEL[e.payload.from]} → ${STATUS_LABEL[e.payload.to]}` : 'Case created; trace and prioritisation run'}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="When the money moved" sub="One lane per account, time since the victim's transfer. Circles are transfers (sized by amount), diamonds are cash withdrawals.">
        <div className="p-3"><FlowTimeline nodes={c.analysis.nodes} edges={c.analysis.edges} originTs={c.origin_ts} filedAt={cp.filed_at}
          selectedId={sel} onSelect={(id) => { setSel(id); setTab('account') }} /></div>
      </Panel>
    </div>
  )
}
